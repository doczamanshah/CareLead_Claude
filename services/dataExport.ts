/**
 * Comprehensive data export.
 *
 * HIPAA gives patients the right to access a copy of their health data.
 * This service builds a plain-text dump of everything CareLead has on
 * file for a profile — medications, conditions, allergies, care team,
 * insurance, results, appointments, preventive care, tasks, bills, and
 * patient priorities — and shares it via the system Share sheet.
 *
 * Mirrors the `preventive report` / `wellness visit packet` pattern so
 * there's one predictable way to ship patient data off device.
 *
 * Document binaries (photos, PDFs) are NOT included — those are large and
 * already retrievable one at a time from each module. The export covers
 * the structured data layer only.
 */

import { Share } from 'react-native';
import { supabase } from '@/lib/supabase';
import { safeError } from '@/lib/utils/safeLog';
import type { ProfileFact, ProfileFactCategory } from '@/lib/types/profile';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface DataExport {
  title: string;
  text: string;
  generatedAt: string;
}

interface FetchRow {
  created_at?: string;
  [key: string]: unknown;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function section(title: string, body: string[]): string {
  if (body.length === 0) {
    return `${title}\n${'─'.repeat(title.length)}\n(none on file)\n`;
  }
  return `${title}\n${'─'.repeat(title.length)}\n${body.join('\n')}\n`;
}

function factSummary(fact: ProfileFact): string {
  const value = fact.value_json as Record<string, unknown> | null;
  const parts: string[] = [];
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (v === null || v === undefined || v === '') continue;
      parts.push(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
    }
  }
  const statusBits: string[] = [];
  if (fact.verification_status) statusBits.push(`verified=${fact.verification_status}`);
  if (fact.created_at) statusBits.push(`added ${formatDate(fact.created_at)}`);
  const status = statusBits.length > 0 ? ` [${statusBits.join(', ')}]` : '';
  return `• ${parts.join(' | ') || '(empty)'}${status}`;
}

function groupFacts(
  facts: ProfileFact[],
): Record<ProfileFactCategory, ProfileFact[]> {
  const buckets: Record<string, ProfileFact[]> = {};
  for (const f of facts) {
    const cat = f.category as ProfileFactCategory;
    if (!buckets[cat]) buckets[cat] = [];
    buckets[cat].push(f);
  }
  return buckets as Record<ProfileFactCategory, ProfileFact[]>;
}

async function fetchTable<T = FetchRow>(
  table: string,
  profileId: string,
): Promise<T[]> {
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq('profile_id', profileId);
  if (error) {
    safeError(`[dataExport] fetch ${table} failed`, error);
    return [];
  }
  return (data ?? []) as T[];
}

/**
 * Build a plain-text comprehensive export for a single profile.
 */
export async function exportAllData(
  profileId: string,
  householdId: string,
): Promise<ServiceResult<DataExport>> {
  try {
    const [
      profileRes,
      factsRes,
      medsRes,
      appointmentsRes,
      tasksRes,
      resultsRes,
      preventiveRes,
      billingRes,
      prioritiesRes,
    ] = await Promise.all([
      supabase
        .from('profiles')
        .select('*')
        .eq('id', profileId)
        .is('deleted_at', null)
        .single(),
      supabase
        .from('profile_facts')
        .select('*')
        .eq('profile_id', profileId)
        .is('deleted_at', null)
        .order('category')
        .order('created_at', { ascending: false }),
      supabase
        .from('med_medications')
        .select('*, med_medication_sigs(*), med_medication_supply(*)')
        .eq('profile_id', profileId)
        .is('deleted_at', null),
      supabase
        .from('apt_appointments')
        .select('*')
        .eq('profile_id', profileId)
        .is('deleted_at', null)
        .order('start_time', { ascending: false }),
      supabase
        .from('tasks')
        .select('*')
        .eq('profile_id', profileId)
        .is('deleted_at', null)
        .order('due_date', { ascending: false }),
      supabase
        .from('result_items')
        .select('*')
        .eq('profile_id', profileId)
        .order('performed_at', { ascending: false, nullsFirst: false }),
      supabase
        .from('preventive_items')
        .select('*, preventive_rules(title)')
        .eq('profile_id', profileId),
      supabase
        .from('billing_cases')
        .select('*')
        .eq('profile_id', profileId),
      supabase
        .from('patient_priorities')
        .select('*')
        .eq('profile_id', profileId)
        .maybeSingle(),
    ]);

    if (profileRes.error || !profileRes.data) {
      return { success: false, error: 'Could not load profile for export.' };
    }

    const profile = profileRes.data as {
      display_name: string;
      date_of_birth: string | null;
      gender: string | null;
      relationship: string;
    };
    const facts = (factsRes.data ?? []) as ProfileFact[];
    const meds = (medsRes.data ?? []) as Array<Record<string, unknown>>;
    const appointments = (appointmentsRes.data ?? []) as Array<Record<string, unknown>>;
    const tasks = (tasksRes.data ?? []) as Array<Record<string, unknown>>;
    const results = (resultsRes.data ?? []) as Array<Record<string, unknown>>;
    const preventive = (preventiveRes.data ?? []) as Array<Record<string, unknown>>;
    const billing = (billingRes.data ?? []) as Array<Record<string, unknown>>;
    const priorities = prioritiesRes.data as Record<string, unknown> | null;

    const generatedAt = new Date();
    const lines: string[] = [];

    // Header
    lines.push(`CareLead Data Export`);
    lines.push(`Generated ${formatDateTime(generatedAt.toISOString())}`);
    lines.push('');
    lines.push(`Profile: ${profile.display_name}`);
    if (profile.date_of_birth) lines.push(`Date of birth: ${formatDate(profile.date_of_birth)}`);
    if (profile.gender) lines.push(`Sex: ${profile.gender}`);
    lines.push(`Relationship: ${profile.relationship}`);
    lines.push(`Profile ID: ${profileId}`);
    lines.push(`Household ID: ${householdId}`);
    lines.push('');
    lines.push('='.repeat(60));
    lines.push('');

    // Profile facts grouped by category
    const buckets = groupFacts(facts);
    const categoryOrder: ProfileFactCategory[] = [
      'condition',
      'allergy',
      'medication',
      'surgery',
      'family_history',
      'insurance',
      'care_team',
      'pharmacy',
    ];
    const categoryLabels: Record<string, string> = {
      condition: 'Conditions',
      allergy: 'Allergies',
      medication: 'Medications (profile facts)',
      surgery: 'Surgeries & Procedures',
      family_history: 'Family History',
      insurance: 'Insurance',
      care_team: 'Care Team',
      pharmacy: 'Pharmacies',
    };
    for (const cat of categoryOrder) {
      const bucket = buckets[cat] ?? [];
      lines.push(section(
        categoryLabels[cat] ?? cat,
        bucket.map(factSummary),
      ));
    }
    // Any remaining categories we didn't enumerate.
    for (const [cat, bucket] of Object.entries(buckets)) {
      if ((categoryOrder as string[]).includes(cat)) continue;
      lines.push(section(categoryLabels[cat] ?? cat, bucket.map(factSummary)));
    }

    // Medications (dedicated table)
    const medLines = meds.map((m) => {
      const sigs = (m.med_medication_sigs as Array<Record<string, unknown>>) ?? [];
      const supply = (m.med_medication_supply as Array<Record<string, unknown>>) ?? [];
      const sig = sigs[0];
      const supplyRow = supply[0];
      const dose = sig?.dose_text ?? '';
      const freq = sig?.frequency_text ?? '';
      const status = m.status ?? '';
      const pharmacy = supplyRow?.pharmacy_name ?? '';
      const prescriber = supplyRow?.prescriber_name ?? '';
      const refills = supplyRow?.refills_remaining != null
        ? `refills=${supplyRow.refills_remaining}`
        : '';
      return `• ${m.drug_name}${m.strength ? ` ${m.strength}` : ''}${m.form ? ` ${m.form}` : ''}`
        + ` | ${dose} ${freq}`.trim()
        + ` | status=${status}`
        + (pharmacy ? ` | pharmacy=${pharmacy}` : '')
        + (prescriber ? ` | prescriber=${prescriber}` : '')
        + (refills ? ` | ${refills}` : '');
    });
    lines.push(section('Medications', medLines));

    // Appointments
    const apptLines = appointments.map((a) => {
      const when = a.start_time ? formatDateTime(String(a.start_time)) : 'TBD';
      return `• ${when} — ${a.title ?? '(untitled)'} `
        + (a.provider_name ? `with ${a.provider_name}` : '')
        + (a.appointment_type ? ` [${a.appointment_type}]` : '')
        + (a.status ? ` status=${a.status}` : '');
    });
    lines.push(section('Appointments', apptLines));

    // Tasks
    const taskLines = tasks.map((t) => {
      const due = t.due_date ? formatDate(String(t.due_date)) : 'no due date';
      return `• [${t.status}] ${t.title}`
        + (t.priority ? ` (priority=${t.priority})` : '')
        + ` — due ${due}`;
    });
    lines.push(section('Tasks & Reminders', taskLines));

    // Results
    const resultLines = results.map((r) => {
      const date = r.performed_at
        ? formatDate(String(r.performed_at))
        : r.reported_at
          ? formatDate(String(r.reported_at))
          : '';
      return `• ${date} — ${r.test_name ?? '(unnamed)'} [${r.result_type}]`
        + (r.status ? ` status=${r.status}` : '');
    });
    lines.push(section('Results', resultLines));

    // Preventive care
    const preventiveLines = preventive.map((p) => {
      const rule = p.preventive_rules as { title?: string } | null;
      const label = rule?.title ?? '(preventive item)';
      return `• ${label} — status=${p.status ?? ''}`
        + (p.next_due_date ? ` | next due ${formatDate(String(p.next_due_date))}` : '')
        + (p.last_done_date ? ` | last ${formatDate(String(p.last_done_date))}` : '');
    });
    lines.push(section('Preventive Care', preventiveLines));

    // Billing
    const billingLines = billing.map((b) => {
      return `• ${b.title ?? '(case)'} — status=${b.status ?? ''}`
        + (b.total_billed != null ? ` | billed=$${b.total_billed}` : '')
        + (b.total_patient_responsibility != null
          ? ` | you owe=$${b.total_patient_responsibility}`
          : '')
        + (b.service_date_start
          ? ` | service date ${formatDate(String(b.service_date_start))}`
          : '');
    });
    lines.push(section('Bills & EOBs', billingLines));

    // Priorities
    if (priorities) {
      const priLines: string[] = [];
      const healthPriorities = (priorities.health_priorities as Array<Record<string, unknown>>) ?? [];
      for (const hp of healthPriorities) {
        priLines.push(`• ${hp.topic}${hp.reason ? ` — ${hp.reason}` : ''}`);
      }
      const conds = (priorities.conditions_of_focus as string[]) ?? [];
      if (conds.length > 0) priLines.push(`Conditions of focus: ${conds.join(', ')}`);
      lines.push(section('What Matters to You', priLines));
    } else {
      lines.push(section('What Matters to You', []));
    }

    // Footer
    lines.push('');
    lines.push('='.repeat(60));
    lines.push(
      'This export reflects the data stored in CareLead at the time of'
      + ' generation. It is not a medical record and should not replace'
      + ' documentation from your healthcare providers.',
    );

    const text = lines.join('\n');
    const title = `CareLead export — ${profile.display_name}`;
    return {
      success: true,
      data: { title, text, generatedAt: generatedAt.toISOString() },
    };
  } catch (err) {
    safeError('[dataExport] failed', err);
    return { success: false, error: 'Could not generate export.' };
  }
}

/**
 * Build and open the system Share sheet with the comprehensive export.
 */
export async function shareAllData(
  profileId: string,
  householdId: string,
): Promise<ServiceResult<DataExport>> {
  const result = await exportAllData(profileId, householdId);
  if (!result.success) return result;
  try {
    await Share.share({ title: result.data.title, message: result.data.text });
    return result;
  } catch (err) {
    safeError('[dataExport] share failed', err);
    return { success: false, error: 'Share was cancelled or failed.' };
  }
}
