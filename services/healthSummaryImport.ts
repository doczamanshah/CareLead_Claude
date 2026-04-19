/**
 * Health Summary Import service — handles uploading a CCD/CCDA/PDF/image
 * health summary, triggering the extract-health-summary Edge Function, and
 * importing selected items into the profile.
 *
 * Imports all go in as source_type: 'import', source_ref: artifactId so the
 * provenance survives. Items are created as unverified — the user can verify
 * later from the profile overview.
 */

import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '@/lib/supabase';
import { uploadArtifact } from '@/services/artifacts';
import { createMedication } from '@/services/medications';
import { createResult } from '@/services/results';
import type { ProfileFact } from '@/lib/types/profile';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

// ── Types ──────────────────────────────────────────────────────────────────

export interface ImportedMedication {
  name: string;
  dose: string | null;
  frequency: string | null;
  prescriber: string | null;
  start_date: string | null;
  status: 'active' | 'inactive' | null;
}

export interface ImportedAllergy {
  allergen: string;
  reaction: string | null;
  severity: string | null;
}

export interface ImportedCondition {
  name: string;
  onset_date: string | null;
  status: 'active' | 'resolved' | null;
}

export interface ImportedProcedure {
  name: string;
  date: string | null;
  provider: string | null;
}

export interface ImportedImmunization {
  name: string;
  date: string | null;
  site: string | null;
}

export interface ImportedLabObservation {
  analyte: string;
  value: string;
  unit: string | null;
  ref_range: string | null;
  flag: string | null;
}

export interface ImportedLabResult {
  test_name: string;
  date: string | null;
  results: ImportedLabObservation[];
}

export interface ImportedProvider {
  name: string;
  specialty: string | null;
  organization: string | null;
  phone: string | null;
}

export interface ImportedInsurance {
  payer: string;
  member_id: string | null;
  group_number: string | null;
  plan_name: string | null;
}

export interface ImportedEmergencyContact {
  name: string;
  relationship: string | null;
  phone: string | null;
}

export interface HealthSummaryExtraction {
  patient_name: string | null;
  date_of_birth: string | null;
  gender: string | null;
  medications: ImportedMedication[];
  allergies: ImportedAllergy[];
  conditions: ImportedCondition[];
  procedures: ImportedProcedure[];
  immunizations: ImportedImmunization[];
  lab_results: ImportedLabResult[];
  providers: ImportedProvider[];
  insurance: ImportedInsurance[];
  emergency_contacts: ImportedEmergencyContact[];
  overall_confidence: number;
  sections_found: string[];
}

export type ImportCategory =
  | 'medications'
  | 'allergies'
  | 'conditions'
  | 'procedures'
  | 'immunizations'
  | 'lab_results'
  | 'providers'
  | 'insurance'
  | 'emergency_contacts';

export interface ImportSelection {
  medications: Set<number>;
  allergies: Set<number>;
  conditions: Set<number>;
  procedures: Set<number>;
  immunizations: Set<number>;
  lab_results: Set<number>;
  providers: Set<number>;
  insurance: Set<number>;
  emergency_contacts: Set<number>;
}

export interface ImportCounts {
  medications: number;
  allergies: number;
  conditions: number;
  procedures: number;
  immunizations: number;
  lab_results: number;
  providers: number;
  insurance: number;
  emergency_contacts: number;
}

export interface DuplicateMap {
  medications: Set<number>;
  allergies: Set<number>;
  conditions: Set<number>;
  procedures: Set<number>;
  immunizations: Set<number>;
  providers: Set<number>;
  insurance: Set<number>;
  emergency_contacts: Set<number>;
}

// ── Upload + Extract ───────────────────────────────────────────────────────

export interface UploadHealthSummaryParams {
  profileId: string;
  fileName: string;
  fileUri: string;
  mimeType: string;
  fileSize: number;
  sourceChannel: 'camera' | 'upload';
}

/**
 * Upload a health summary file as an artifact, then call the Edge Function
 * to extract structured data. Returns the artifactId + extraction payload.
 */
export async function uploadAndExtractHealthSummary(
  params: UploadHealthSummaryParams,
): Promise<ServiceResult<{ artifactId: string; extraction: HealthSummaryExtraction }>> {
  const artifactRes = await uploadArtifact({
    profileId: params.profileId,
    fileName: params.fileName,
    fileUri: params.fileUri,
    mimeType: params.mimeType,
    artifactType: 'document',
    sourceChannel: params.sourceChannel,
    fileSizeBytes: params.fileSize,
  });

  if (!artifactRes.success) {
    return { success: false, error: artifactRes.error };
  }

  const { data, error } = await supabase.functions.invoke('extract-health-summary', {
    body: { artifactId: artifactRes.data.id, profileId: params.profileId },
  });

  if (error) {
    return { success: false, error: error.message ?? 'Extraction failed' };
  }
  if (!data?.summary) {
    return { success: false, error: 'No data extracted from the file' };
  }

  return {
    success: true,
    data: { artifactId: artifactRes.data.id, extraction: data.summary as HealthSummaryExtraction },
  };
}

// ── Duplicate detection ────────────────────────────────────────────────────

function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().trim();
}

function firstWord(s: string | null | undefined): string {
  return norm(s).split(/\s+/)[0] ?? '';
}

/**
 * Determine which items are already present in the profile so we can mark
 * them as duplicates in the review UI and skip them on import.
 */
export async function detectDuplicates(
  profileId: string,
  extraction: HealthSummaryExtraction,
): Promise<DuplicateMap> {
  const duplicates: DuplicateMap = {
    medications: new Set(),
    allergies: new Set(),
    conditions: new Set(),
    procedures: new Set(),
    immunizations: new Set(),
    providers: new Set(),
    insurance: new Set(),
    emergency_contacts: new Set(),
  };

  const [medsRes, factsRes] = await Promise.all([
    supabase
      .from('med_medications')
      .select('drug_name')
      .eq('profile_id', profileId)
      .is('deleted_at', null),
    supabase
      .from('profile_facts')
      .select('category, value_json')
      .eq('profile_id', profileId)
      .is('deleted_at', null),
  ]);

  const existingDrugs = new Set<string>(
    (medsRes.data ?? []).map((m: { drug_name: string }) => firstWord(m.drug_name)),
  );
  extraction.medications.forEach((med, idx) => {
    if (existingDrugs.has(firstWord(med.name))) duplicates.medications.add(idx);
  });

  const factsByCat: Record<string, Array<Record<string, unknown>>> = {};
  for (const fact of (factsRes.data ?? []) as Array<{ category: string; value_json: Record<string, unknown> }>) {
    if (!factsByCat[fact.category]) factsByCat[fact.category] = [];
    factsByCat[fact.category].push(fact.value_json ?? {});
  }

  const allergyNames = new Set(
    (factsByCat.allergy ?? []).map((v) => norm(v.substance as string | undefined)),
  );
  extraction.allergies.forEach((a, idx) => {
    if (allergyNames.has(norm(a.allergen))) duplicates.allergies.add(idx);
  });

  const conditionNames = new Set(
    (factsByCat.condition ?? []).map((v) => norm((v.condition_name ?? v.name) as string | undefined)),
  );
  extraction.conditions.forEach((c, idx) => {
    if (conditionNames.has(norm(c.name))) duplicates.conditions.add(idx);
  });

  const procedureNames = new Set(
    (factsByCat.surgery ?? []).map((v) => norm(v.name as string | undefined)),
  );
  extraction.procedures.forEach((p, idx) => {
    if (procedureNames.has(norm(p.name))) duplicates.procedures.add(idx);
  });

  const immuNames = new Set(
    (factsByCat.immunization ?? []).map((v) => norm(v.name as string | undefined)),
  );
  extraction.immunizations.forEach((i, idx) => {
    if (immuNames.has(norm(i.name))) duplicates.immunizations.add(idx);
  });

  const providerNames = new Set(
    (factsByCat.care_team ?? []).map((v) => norm(v.name as string | undefined)),
  );
  extraction.providers.forEach((p, idx) => {
    if (providerNames.has(norm(p.name))) duplicates.providers.add(idx);
  });

  const insurancePayers = new Set(
    (factsByCat.insurance ?? []).map((v) => norm((v.payer_name ?? v.payer) as string | undefined)),
  );
  extraction.insurance.forEach((i, idx) => {
    if (insurancePayers.has(norm(i.payer))) duplicates.insurance.add(idx);
  });

  const contactNames = new Set(
    (factsByCat.emergency_contact ?? []).map((v) => norm(v.name as string | undefined)),
  );
  extraction.emergency_contacts.forEach((c, idx) => {
    if (contactNames.has(norm(c.name))) duplicates.emergency_contacts.add(idx);
  });

  return duplicates;
}

// ── Commit imported items ──────────────────────────────────────────────────

export interface CommitImportParams {
  profileId: string;
  householdId: string;
  userId: string;
  artifactId: string;
  extraction: HealthSummaryExtraction;
  selection: ImportSelection;
}

export interface CommitImportResult {
  counts: ImportCounts;
  failures: string[];
}

async function insertProfileFact(
  profileId: string,
  userId: string,
  category: ProfileFact['category'],
  fieldKey: string,
  value: Record<string, unknown>,
  sourceRef: string,
): Promise<string | null> {
  const { error } = await supabase.from('profile_facts').insert({
    profile_id: profileId,
    category,
    field_key: fieldKey,
    value_json: value,
    source_type: 'import',
    source_ref: sourceRef,
    verification_status: 'unverified',
    actor_id: userId,
  });
  return error ? error.message : null;
}

async function matchAndCompletePreventive(
  profileId: string,
  userId: string,
  immunizationName: string,
  completionDate: string | null,
): Promise<void> {
  const needle = norm(immunizationName);
  if (!needle) return;

  const { data: items } = await supabase
    .from('preventive_items')
    .select('id, display_name, status, cadence_interval_months')
    .eq('profile_id', profileId);

  if (!items || items.length === 0) return;

  const match = items.find((it: { display_name: string }) =>
    norm(it.display_name).includes(needle) || needle.includes(norm(it.display_name)),
  );
  if (!match) return;

  const completedAt = completionDate ?? new Date().toISOString().slice(0, 10);
  const nextDue =
    match.cadence_interval_months && match.cadence_interval_months > 0
      ? addMonths(completedAt, match.cadence_interval_months)
      : null;

  await supabase
    .from('preventive_items')
    .update({
      status: 'completed',
      last_completed_at: completedAt,
      next_due_date: nextDue,
    })
    .eq('id', match.id);

  await supabase.from('preventive_item_events').insert({
    preventive_item_id: match.id,
    profile_id: profileId,
    event_type: 'completed',
    actor_id: userId,
    metadata: { source: 'health_summary_import', completed_at: completedAt },
  });
}

function addMonths(isoDate: string, months: number): string {
  const d = new Date(isoDate);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

export async function commitHealthSummaryImport(
  params: CommitImportParams,
): Promise<ServiceResult<CommitImportResult>> {
  const { profileId, householdId, userId, artifactId, extraction, selection } = params;
  const counts: ImportCounts = {
    medications: 0,
    allergies: 0,
    conditions: 0,
    procedures: 0,
    immunizations: 0,
    lab_results: 0,
    providers: 0,
    insurance: 0,
    emergency_contacts: 0,
  };
  const failures: string[] = [];

  // Medications → med_medications via service
  for (const idx of selection.medications) {
    const med = extraction.medications[idx];
    if (!med?.name) continue;
    const res = await createMedication(
      {
        profile_id: profileId,
        drug_name: med.name,
        strength: med.dose ?? undefined,
        dose_text: med.dose ?? undefined,
        frequency_text: med.frequency ?? undefined,
        prescriber_name: med.prescriber ?? undefined,
      },
      userId,
    );
    if (res.success) {
      counts.medications++;
    } else {
      failures.push(`Medication ${med.name}: ${res.error}`);
    }
  }

  // Allergies → profile_facts
  for (const idx of selection.allergies) {
    const a = extraction.allergies[idx];
    if (!a?.allergen) continue;
    const err = await insertProfileFact(
      profileId,
      userId,
      'allergy',
      'allergy.entry',
      {
        substance: a.allergen,
        reaction: a.reaction ?? undefined,
        severity: a.severity ?? undefined,
      },
      artifactId,
    );
    if (err) failures.push(`Allergy ${a.allergen}: ${err}`);
    else counts.allergies++;
  }

  // Conditions
  for (const idx of selection.conditions) {
    const c = extraction.conditions[idx];
    if (!c?.name) continue;
    const err = await insertProfileFact(
      profileId,
      userId,
      'condition',
      'condition.entry',
      {
        condition_name: c.name,
        name: c.name,
        diagnosed_date: c.onset_date ?? undefined,
        status: c.status ?? 'active',
      },
      artifactId,
    );
    if (err) failures.push(`Condition ${c.name}: ${err}`);
    else counts.conditions++;
  }

  // Procedures / surgeries
  for (const idx of selection.procedures) {
    const p = extraction.procedures[idx];
    if (!p?.name) continue;
    const err = await insertProfileFact(
      profileId,
      userId,
      'surgery',
      'surgery.entry',
      {
        name: p.name,
        date: p.date ?? undefined,
        surgeon: p.provider ?? undefined,
      },
      artifactId,
    );
    if (err) failures.push(`Procedure ${p.name}: ${err}`);
    else counts.procedures++;
  }

  // Immunizations (stored as profile_facts + preventive care link)
  for (const idx of selection.immunizations) {
    const i = extraction.immunizations[idx];
    if (!i?.name) continue;
    const err = await insertProfileFact(
      profileId,
      userId,
      'immunization',
      'immunization.entry',
      {
        name: i.name,
        date: i.date ?? undefined,
        site: i.site ?? undefined,
      },
      artifactId,
    );
    if (err) {
      failures.push(`Immunization ${i.name}: ${err}`);
    } else {
      counts.immunizations++;
      // Best-effort: if a matching preventive item exists, mark it complete
      try {
        await matchAndCompletePreventive(profileId, userId, i.name, i.date);
      } catch (e) {
        console.warn('preventive match failed', e);
      }
    }
  }

  // Lab results → result_items
  for (const idx of selection.lab_results) {
    const lab = extraction.lab_results[idx];
    if (!lab?.test_name) continue;
    const createRes = await createResult(
      {
        profileId,
        householdId,
        resultType: 'lab',
        testName: lab.test_name,
        performedAt: lab.date ?? null,
        sourceMethod: 'document',
      },
      userId,
    );
    if (!createRes.success) {
      failures.push(`Lab ${lab.test_name}: ${createRes.error}`);
      continue;
    }

    if (lab.results.length > 0) {
      const obsRows = lab.results.map((r) => ({
        result_id: createRes.data.id,
        profile_id: profileId,
        analyte_name: r.analyte,
        value: r.value ?? null,
        unit: r.unit ?? null,
        ref_range_text: r.ref_range ?? null,
        flag: r.flag ?? null,
      }));
      await supabase.from('result_lab_observations').insert(obsRows);
    }

    counts.lab_results++;
  }

  // Providers → care_team profile_facts
  for (const idx of selection.providers) {
    const p = extraction.providers[idx];
    if (!p?.name) continue;
    const err = await insertProfileFact(
      profileId,
      userId,
      'care_team',
      'care_team.entry',
      {
        name: p.name,
        specialty: p.specialty ?? undefined,
        organization: p.organization ?? undefined,
        phone: p.phone ?? undefined,
      },
      artifactId,
    );
    if (err) failures.push(`Provider ${p.name}: ${err}`);
    else counts.providers++;
  }

  // Insurance
  for (const idx of selection.insurance) {
    const i = extraction.insurance[idx];
    if (!i?.payer) continue;
    const err = await insertProfileFact(
      profileId,
      userId,
      'insurance',
      'insurance.entry',
      {
        payer_name: i.payer,
        member_id: i.member_id ?? undefined,
        group_number: i.group_number ?? undefined,
        plan_name: i.plan_name ?? undefined,
      },
      artifactId,
    );
    if (err) failures.push(`Insurance ${i.payer}: ${err}`);
    else counts.insurance++;
  }

  // Emergency contacts
  for (const idx of selection.emergency_contacts) {
    const c = extraction.emergency_contacts[idx];
    if (!c?.name) continue;
    const err = await insertProfileFact(
      profileId,
      userId,
      'emergency_contact',
      'emergency_contact.entry',
      {
        name: c.name,
        relationship: c.relationship ?? undefined,
        phone: c.phone ?? undefined,
      },
      artifactId,
    );
    if (err) failures.push(`Contact ${c.name}: ${err}`);
    else counts.emergency_contacts++;
  }

  // Single audit event for the whole import — metadata carries non-PHI counts
  await supabase.from('audit_events').insert({
    profile_id: profileId,
    actor_id: userId,
    event_type: 'health_summary.imported',
    metadata: {
      artifact_id: artifactId,
      counts,
      sections_found: extraction.sections_found,
    },
  });

  return { success: true, data: { counts, failures } };
}

export function makeEmptySelection(): ImportSelection {
  return {
    medications: new Set(),
    allergies: new Set(),
    conditions: new Set(),
    procedures: new Set(),
    immunizations: new Set(),
    lab_results: new Set(),
    providers: new Set(),
    insurance: new Set(),
    emergency_contacts: new Set(),
  };
}

export function totalSelected(selection: ImportSelection): number {
  return (
    selection.medications.size +
    selection.allergies.size +
    selection.conditions.size +
    selection.procedures.size +
    selection.immunizations.size +
    selection.lab_results.size +
    selection.providers.size +
    selection.insurance.size +
    selection.emergency_contacts.size
  );
}

/**
 * Pre-select every item that is NOT a duplicate. Duplicates start unchecked.
 */
export function defaultSelection(
  extraction: HealthSummaryExtraction,
  duplicates: DuplicateMap,
): ImportSelection {
  const sel = makeEmptySelection();
  extraction.medications.forEach((_, i) => {
    if (!duplicates.medications.has(i)) sel.medications.add(i);
  });
  extraction.allergies.forEach((_, i) => {
    if (!duplicates.allergies.has(i)) sel.allergies.add(i);
  });
  extraction.conditions.forEach((_, i) => {
    if (!duplicates.conditions.has(i)) sel.conditions.add(i);
  });
  extraction.procedures.forEach((_, i) => {
    if (!duplicates.procedures.has(i)) sel.procedures.add(i);
  });
  extraction.immunizations.forEach((_, i) => {
    if (!duplicates.immunizations.has(i)) sel.immunizations.add(i);
  });
  extraction.lab_results.forEach((_, i) => sel.lab_results.add(i));
  extraction.providers.forEach((_, i) => {
    if (!duplicates.providers.has(i)) sel.providers.add(i);
  });
  extraction.insurance.forEach((_, i) => {
    if (!duplicates.insurance.has(i)) sel.insurance.add(i);
  });
  extraction.emergency_contacts.forEach((_, i) => {
    if (!duplicates.emergency_contacts.has(i)) sel.emergency_contacts.add(i);
  });
  return sel;
}
