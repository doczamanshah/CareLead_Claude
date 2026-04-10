/**
 * Visit Packet generator. Builds a structured plain-text packet that
 * summarizes the patient's profile and the questions prepared for a
 * specific appointment, suitable for printing or sharing with a provider.
 *
 * The packet text is also persisted into the appointment's `prep_json`
 * under `packet_content` so it can be re-rendered without regenerating.
 */

import { supabase } from '@/lib/supabase';
import { getPrepStatus } from '@/lib/types/appointments';
import type { Appointment, VisitPrep } from '@/lib/types/appointments';
import type { Profile, ProfileFact } from '@/lib/types/profile';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

interface PacketResult {
  packet: string;
  prep: VisitPrep;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function formatMedicationLine(fact: ProfileFact): string {
  const v = fact.value_json as Record<string, unknown>;
  const name =
    readString(v.drug_name) ??
    readString(v.name) ??
    readString(v['medication.name']) ??
    'Unnamed medication';
  const dose =
    readString(v.dose) ??
    readString(v.dosage) ??
    readString(v['medication.dosage']);
  const freq =
    readString(v.frequency) ??
    readString(v['medication.frequency']);
  const parts = [name];
  if (dose) parts.push(dose);
  if (freq) parts.push(freq);
  return `- ${parts.join(', ')}`;
}

function formatConditionLine(fact: ProfileFact): string {
  const v = fact.value_json as Record<string, unknown>;
  const name =
    readString(v.condition_name) ??
    readString(v.name) ??
    readString(v['condition.name']) ??
    'Unnamed condition';
  const status = readString(v.status);
  return status ? `- ${name} (${status})` : `- ${name}`;
}

function formatAllergyLine(fact: ProfileFact): string {
  const v = fact.value_json as Record<string, unknown>;
  const substance =
    readString(v.substance) ??
    readString(v['allergy.substance']) ??
    'Unknown substance';
  const reaction = readString(v.reaction);
  return reaction ? `${substance} (${reaction})` : substance;
}

function formatInsuranceLine(fact: ProfileFact): string {
  const v = fact.value_json as Record<string, unknown>;
  const plan =
    readString(v.plan_name) ??
    readString(v.plan) ??
    readString(v.payer_name) ??
    readString(v.provider) ??
    readString(v['insurance.provider']) ??
    'Insurance plan';
  const member =
    readString(v.member_id) ?? readString(v['insurance.member_id']);
  return member ? `${plan} - Member ID: ${member}` : plan;
}

function formatVisitDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const time = d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${date} at ${time}`;
}

function buildPacketText(
  profile: Profile,
  facts: ProfileFact[],
  appointment: Appointment,
  prep: VisitPrep,
): string {
  const medications = facts.filter((f) => f.category === 'medication');
  const conditions = facts.filter((f) => f.category === 'condition');
  const allergies = facts.filter((f) => f.category === 'allergy');
  const insurance = facts.filter((f) => f.category === 'insurance');

  const lines: string[] = [];

  // Draft watermark — included whenever the underlying prep isn't ready,
  // so anyone receiving the shared text knows it's still being edited.
  const isDraft = getPrepStatus(prep) !== 'ready';
  if (isDraft) {
    lines.push('*** DRAFT — VISIT PREP IN PROGRESS ***');
    lines.push('');
  }

  // Header
  const providerLabel = appointment.provider_name
    ? `Visit with ${appointment.provider_name}`
    : appointment.title;
  lines.push(`${providerLabel} — ${formatVisitDateTime(appointment.start_time)}`);
  lines.push(`Patient: ${profile.display_name}`);
  lines.push('');

  // Questions & concerns (patient items first, AI items second, dismissed hidden)
  const visibleQs = prep.questions.filter((q) => !q.dismissed);
  const patientQs = visibleQs.filter((q) => q.source === 'patient' || q.source === 'user_added');
  const aiQs = visibleQs.filter((q) => q.source === 'ai_suggested');
  const orderedQs = [...patientQs, ...aiQs];

  if (orderedQs.length > 0) {
    lines.push('QUESTIONS & CONCERNS:');
    orderedQs.forEach((q, i) => lines.push(`${i + 1}. ${q.text}`));
    lines.push('');
  }

  if (prep.refills_needed.length > 0) {
    lines.push('REFILLS NEEDED:');
    prep.refills_needed.forEach((r) => lines.push(`- ${r.medication}`));
    lines.push('');
  }

  lines.push('CURRENT MEDICATIONS:');
  if (medications.length === 0) {
    lines.push('- (none on file)');
  } else {
    medications.forEach((f) => lines.push(formatMedicationLine(f)));
  }
  lines.push('');

  lines.push(
    `ALLERGIES: ${
      allergies.length === 0
        ? 'None on file'
        : allergies.map(formatAllergyLine).join('; ')
    }`,
  );
  lines.push('');

  if (conditions.length > 0) {
    lines.push('ACTIVE CONDITIONS:');
    conditions.forEach((f) => lines.push(formatConditionLine(f)));
    lines.push('');
  }

  if (insurance.length > 0) {
    lines.push(`INSURANCE: ${insurance.map(formatInsuranceLine).join('; ')}`);
    lines.push('');
  }

  if (prep.logistics.depart_by) {
    const depart = new Date(prep.logistics.depart_by);
    if (!Number.isNaN(depart.getTime())) {
      lines.push(
        `LEAVE BY: ${depart.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
        })}`,
      );
    }
  }
  if (prep.logistics.driver) {
    lines.push(`RIDE: ${prep.logistics.driver.name}`);
  }
  if (prep.special_needs && prep.special_needs.length > 0) {
    lines.push(`SPECIAL NEEDS: ${prep.special_needs.join(', ')}`);
  }

  lines.push('');
  lines.push('— Prepared with CareLead');
  return lines.join('\n');
}


/**
 * Generate the Visit Packet for an appointment, persist it into prep_json,
 * and return both the formatted text and the updated prep.
 */
export async function generateVisitPacket(
  appointmentId: string,
  profileId: string,
): Promise<ServiceResult<PacketResult>> {
  const { data: appointment, error: aptError } = await supabase
    .from('apt_appointments')
    .select('*')
    .eq('id', appointmentId)
    .single();

  if (aptError || !appointment) {
    return { success: false, error: aptError?.message ?? 'Appointment not found' };
  }

  if (!appointment.prep_json) {
    return { success: false, error: 'Visit prep has not been generated yet' };
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', profileId)
    .single();

  if (profileError || !profile) {
    return { success: false, error: profileError?.message ?? 'Profile not found' };
  }

  const { data: facts, error: factsError } = await supabase
    .from('profile_facts')
    .select('*')
    .eq('profile_id', profileId)
    .is('deleted_at', null);

  if (factsError) {
    return { success: false, error: factsError.message };
  }

  const prep = appointment.prep_json as VisitPrep;
  const packet = buildPacketText(
    profile as Profile,
    (facts ?? []) as ProfileFact[],
    appointment as Appointment,
    prep,
  );

  const updatedPrep: VisitPrep = {
    ...prep,
    packet_generated: true,
    packet_content: packet,
  };

  const { error: updateError } = await supabase
    .from('apt_appointments')
    .update({ prep_json: updatedPrep })
    .eq('id', appointmentId);

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  return { success: true, data: { packet, prep: updatedPrep } };
}
