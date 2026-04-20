/**
 * Annual Wellness Visit prep service.
 *
 * - Calls the `extract-wellness-input` Edge Function to structure a patient's
 *   freeform dictation.
 * - Builds the shareable Wellness Visit Packet (plain text) from the current
 *   prep state plus profile/medications/preventive/results data.
 */

import { supabase } from '@/lib/supabase';
import { fetchProfileDetail } from '@/services/profiles';
import { fetchMedications } from '@/services/medications';
import { fetchPreventiveItems } from '@/services/preventive';
import type {
  WellnessExtraction,
  WellnessPacket,
  WellnessQuestion,
  WellnessVisitPrep,
} from '@/lib/types/wellnessVisit';
import type { ProfileWithFacts, ProfileFact } from '@/lib/types/profile';
import type { Medication, MedicationWithDetails } from '@/lib/types/medications';
import type { PreventiveItemWithRule } from '@/lib/types/preventive';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

// ── Extraction ────────────────────────────────────────────────────────────

export async function extractWellnessInput(params: {
  text: string;
  profileName: string | null;
  existingConditions: string[];
  existingMedications: string[];
}): Promise<ServiceResult<WellnessExtraction>> {
  if (!params.text.trim()) {
    return { success: false, error: 'Input is empty' };
  }

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    return { success: false, error: 'Not authenticated' };
  }

  const { data, error } = await supabase.functions.invoke(
    'extract-wellness-input',
    {
      body: {
        text: params.text,
        profileName: params.profileName,
        existingConditions: params.existingConditions,
        existingMedications: params.existingMedications,
      },
    },
  );

  if (error) {
    return {
      success: false,
      error: error.message ?? 'Wellness extraction failed',
    };
  }

  return { success: true, data: data as WellnessExtraction };
}

// ── Helpers used to build the packet ──────────────────────────────────────

function formatHumanDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const iso = dateStr.length === 10 ? `${dateStr}T00:00:00` : dateStr;
  const date = new Date(iso);
  if (isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function getFactValue(fact: ProfileFact, keys: string[]): string | null {
  const v = fact.value_json as Record<string, unknown>;
  for (const k of keys) {
    const raw = v[k];
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
  }
  return null;
}

function extractConditions(profile: ProfileWithFacts): {
  name: string;
  diagnosed: string | null;
}[] {
  return profile.facts
    .filter((f) => f.category === 'condition')
    .map((f) => {
      const name = getFactValue(f, ['condition_name', 'name']);
      if (!name) return null;
      const diagnosed =
        getFactValue(f, ['diagnosed_date', 'since']) ?? null;
      return { name, diagnosed };
    })
    .filter((x): x is { name: string; diagnosed: string | null } => x !== null);
}

function extractAllergies(
  profile: ProfileWithFacts,
): { allergen: string; reaction: string | null }[] {
  return profile.facts
    .filter((f) => f.category === 'allergy')
    .map((f) => {
      const allergen = getFactValue(f, ['substance', 'allergen', 'name']);
      if (!allergen) return null;
      const reaction = getFactValue(f, ['reaction', 'severity']);
      return { allergen, reaction };
    })
    .filter(
      (x): x is { allergen: string; reaction: string | null } => x !== null,
    );
}

function extractInsurance(
  profile: ProfileWithFacts,
): { plan: string; member_id: string | null; group: string | null } | null {
  const f = profile.facts.find((x) => x.category === 'insurance');
  if (!f) return null;
  const plan = getFactValue(f, ['plan_name', 'provider', 'plan']);
  if (!plan) return null;
  return {
    plan,
    member_id: getFactValue(f, ['member_id', 'memberId']),
    group: getFactValue(f, ['group_number', 'group']),
  };
}

function extractEmergencyContact(
  profile: ProfileWithFacts,
): { name: string; relationship: string | null; phone: string | null } | null {
  const f = profile.facts.find((x) => x.category === 'emergency_contact');
  if (!f) return null;
  const name = getFactValue(f, ['name']);
  if (!name) return null;
  return {
    name,
    relationship: getFactValue(f, ['relationship']),
    phone: getFactValue(f, ['phone']),
  };
}

function medSignature(med: Medication | MedicationWithDetails, sigText?: string | null): string {
  const core = [
    med.drug_name,
    med.strength ?? null,
    sigText ?? null,
    med.route ? med.route : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return core;
}

// ── Packet Builder ────────────────────────────────────────────────────────

interface BuildPacketParams {
  profileId: string;
  prep: WellnessVisitPrep;
}

export async function buildWellnessPacket(
  params: BuildPacketParams,
): Promise<ServiceResult<WellnessPacket>> {
  const { profileId, prep } = params;

  const [profileRes, medsRes, itemsRes] = await Promise.all([
    fetchProfileDetail(profileId),
    fetchMedications(profileId),
    fetchPreventiveItems(profileId),
  ]);

  if (!profileRes.success) return { success: false, error: profileRes.error };
  if (!medsRes.success) return { success: false, error: medsRes.error };
  if (!itemsRes.success) return { success: false, error: itemsRes.error };

  const profile = profileRes.data;
  const meds = medsRes.data.filter((m) => m.status === 'active');
  const preventiveItems = itemsRes.data.filter((i) => i.status !== 'archived');

  const generatedAt = new Date();
  const generatedOn = generatedAt.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const patientName = profile.display_name ?? 'Patient';

  const lines: string[] = [];

  lines.push('---');
  lines.push('ANNUAL WELLNESS VISIT PREPARATION');
  lines.push(`Prepared for ${patientName}`);
  lines.push(`Generated by CareLead on ${generatedOn}`);
  lines.push('---');
  lines.push('');

  // Current medications
  lines.push('CURRENT MEDICATIONS:');
  if (meds.length === 0) {
    lines.push('- None on file');
  } else {
    meds.forEach((med, i) => {
      const sigText =
        med.sig?.frequency_text ?? med.sig?.dose_text ?? null;
      const prescriber = med.supply?.prescriber_name ?? null;
      const suffix = prescriber ? ` (prescribed by ${prescriber})` : '';
      lines.push(`${i + 1}. ${medSignature(med, sigText)}${suffix}`);
    });
  }
  lines.push('');

  // Conditions
  const conditions = extractConditions(profile);
  lines.push('MEDICAL CONDITIONS:');
  if (conditions.length === 0) {
    lines.push('- None on file');
  } else {
    for (const c of conditions) {
      const since = c.diagnosed ? ` (since ${c.diagnosed})` : '';
      lines.push(`- ${c.name}${since}`);
    }
  }
  lines.push('');

  // Allergies
  const allergies = extractAllergies(profile);
  lines.push('ALLERGIES:');
  if (allergies.length === 0) {
    lines.push('- No known drug allergies on file');
  } else {
    for (const a of allergies) {
      const r = a.reaction ? `: ${a.reaction}` : '';
      lines.push(`- ${a.allergen}${r}`);
    }
  }
  lines.push('');

  // Preventive care status
  const current = preventiveItems.filter(
    (i) => i.status === 'up_to_date' || i.status === 'completed',
  );
  const due = preventiveItems.filter(
    (i) =>
      i.status === 'due' || i.status === 'due_soon' || i.status === 'needs_review',
  );
  const selected = new Set(prep.selectedScreenings);
  const toDiscuss = preventiveItems.filter((i) => selected.has(i.id));

  lines.push('PREVENTIVE CARE STATUS:');
  lines.push('Current:');
  if (current.length === 0) {
    lines.push('  - (none)');
  } else {
    for (const i of current) {
      const last = formatHumanDate(i.last_done_date);
      const suffix = last ? ` — last done ${last}` : '';
      lines.push(`  - ${i.rule.title}${suffix}`);
    }
  }
  lines.push('Due:');
  if (due.length === 0) {
    lines.push('  - (none)');
  } else {
    for (const i of due) {
      lines.push(`  - ${i.rule.title}`);
    }
  }
  if (toDiscuss.length > 0) {
    lines.push('To discuss at this visit:');
    for (const i of toDiscuss) {
      lines.push(`  - ${i.rule.title}`);
    }
  }
  lines.push('');

  // Questions (prioritized)
  lines.push('QUESTIONS FOR MY DOCTOR:');
  if (prep.questions.length === 0) {
    lines.push('- (none)');
  } else {
    const ordered = orderQuestionsByPriority(prep.questions);
    ordered.forEach((q, i) => {
      const prio = q.priority === 'high' ? ' (high priority)' : '';
      lines.push(`${i + 1}. ${q.text}${prio}`);
    });
  }
  lines.push('');

  // Concerns / updates from freeform
  const ex = prep.extractedData;
  if (ex) {
    const anyExtracted =
      (ex.new_symptoms?.length ?? 0) > 0 ||
      (ex.medication_concerns?.length ?? 0) > 0 ||
      (ex.condition_updates?.length ?? 0) > 0 ||
      (ex.lifestyle_changes?.length ?? 0) > 0 ||
      (ex.other_concerns?.length ?? 0) > 0;

    if (anyExtracted) {
      lines.push('CONCERNS AND UPDATES:');
      for (const s of ex.new_symptoms ?? []) {
        const d = s.duration ? ` (${s.duration})` : '';
        const sev = s.severity ? ` — ${s.severity}` : '';
        lines.push(`- New symptom: ${s.description}${d}${sev}`);
      }
      for (const c of ex.medication_concerns ?? []) {
        const med = c.medication ? `${c.medication}: ` : '';
        lines.push(`- Medication concern: ${med}${c.concern}`);
      }
      for (const u of ex.condition_updates ?? []) {
        lines.push(
          `- Condition ${u.update_type}: ${u.condition}${u.detail ? ` — ${u.detail}` : ''}`,
        );
      }
      for (const lc of ex.lifestyle_changes ?? []) {
        lines.push(`- Lifestyle (${lc.area}): ${lc.detail}`);
      }
      for (const oc of ex.other_concerns ?? []) {
        lines.push(`- ${oc}`);
      }
      lines.push('');
    }
  }

  // Insurance
  const insurance = extractInsurance(profile);
  if (insurance) {
    const parts = [insurance.plan];
    if (insurance.member_id) parts.push(`Member ID: ${insurance.member_id}`);
    if (insurance.group) parts.push(`Group: ${insurance.group}`);
    lines.push('INSURANCE:');
    lines.push(parts.join(', '));
    lines.push('');
  }

  // Emergency contact
  const emergency = extractEmergencyContact(profile);
  if (emergency) {
    const rel = emergency.relationship ? ` (${emergency.relationship})` : '';
    const phone = emergency.phone ? `: ${emergency.phone}` : '';
    lines.push('EMERGENCY CONTACT:');
    lines.push(`${emergency.name}${rel}${phone}`);
    lines.push('');
  }

  lines.push('---');
  lines.push(
    'This document was prepared from patient-managed records in CareLead.',
  );
  lines.push('Discuss all items with your healthcare provider.');
  lines.push('---');

  return {
    success: true,
    data: {
      title: `Wellness Visit Prep — ${patientName}`,
      generatedAt: generatedAt.toISOString(),
      text: lines.join('\n'),
    },
  };
}

function priorityWeight(p: WellnessQuestion['priority']): number {
  if (p === 'high') return 0;
  if (p === 'medium') return 1;
  return 2;
}

function orderQuestionsByPriority(
  questions: WellnessQuestion[],
): WellnessQuestion[] {
  // Preserve user-applied order but promote "high" to the top within its block.
  // Users reorder explicitly via the questions screen; this is a safety net.
  return [...questions].sort(
    (a, b) => priorityWeight(a.priority) - priorityWeight(b.priority),
  );
}
