/**
 * Profile Index Service — Voice Retrieval ("Ask Profile") Step 1
 *
 * Builds a READ-ONLY, unified view of a profile's data by reading from the
 * canonical domain tables (profile_facts, med_medications, result_items,
 * apt_appointments, billing_cases, preventive_items, …) and projecting
 * every row into the `CanonicalFact` shape used by the retrieval engine.
 *
 * Never writes to the database. Never duplicates storage. The retrieval
 * engine (Step 2) ranks and filters against the index returned here.
 */

import { supabase } from '@/lib/supabase';
import type {
  CanonicalFact,
  FactDomain,
  FactFreshness,
  FactProvenance,
  FactProvenanceSource,
  FactStatus,
  PreComputedAnswers,
  ProfileIndex,
} from '@/lib/types/ask';
import { emptyFactCounts, emptyPreComputedAnswers } from '@/lib/types/ask';
import { formatLabValue } from '@/lib/utils/formatLabValue';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

// ── Limits (keep index comprehensive but not huge) ─────────────────────────

const MAX_LAB_OBSERVATIONS = 50;
const MAX_APPOINTMENTS = 20;
const MAX_RESULT_ITEMS = 40;
const MAX_BILLING_CASES = 20;

// ── Helpers ────────────────────────────────────────────────────────────────

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function computeFreshness(iso: string | null): FactFreshness {
  if (!iso) return 'unknown';
  const parsed = new Date(iso).getTime();
  if (Number.isNaN(parsed)) return 'unknown';
  const days = Math.floor((Date.now() - parsed) / MS_PER_DAY);
  if (days < 30) return 'current';
  if (days < 90) return 'recent';
  if (days < 365) return 'stale';
  return 'very_stale';
}

function normalizeKey(raw: string | null | undefined): string {
  if (!raw) return '';
  return String(raw).trim().toLowerCase().replace(/\s+/g, ' ');
}

function str(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  return String(v);
}

/** Unwrap `{ value: {...} }` wrappers that some intake paths still produce. */
function unwrapValue(valueJson: Record<string, unknown> | null): Record<string, unknown> {
  if (!valueJson) return {};
  if (
    Object.keys(valueJson).length === 1 &&
    'value' in valueJson &&
    typeof valueJson.value === 'object' &&
    valueJson.value !== null
  ) {
    return valueJson.value as Record<string, unknown>;
  }
  return valueJson;
}

/** Map profile_fact.source_type → canonical provenance. */
function provenanceFromFactSource(
  sourceType: string | null,
  verificationStatus: string | null,
  verifiedAt: string | null,
  verifiedBy: string | null,
): FactProvenance {
  let source: FactProvenanceSource = 'manual';
  let sourceLabel = 'You entered';

  switch (sourceType) {
    case 'manual':
      source = 'manual';
      sourceLabel = 'You entered';
      break;
    case 'voice':
      source = 'manual';
      sourceLabel = 'You dictated';
      break;
    case 'photo':
    case 'document':
      source = 'document';
      sourceLabel = 'From a document';
      break;
    case 'import':
      source = 'import';
      sourceLabel = 'Imported';
      break;
    default:
      source = 'extraction';
      sourceLabel = 'Extracted';
  }

  if (verificationStatus === 'verified' && source === 'extraction') {
    sourceLabel = 'Extracted, verified';
  }

  return {
    source,
    sourceLabel,
    verifiedBy,
    verifiedAt,
  };
}

function provenanceForSystem(label: string): FactProvenance {
  return {
    source: 'system',
    sourceLabel: label,
    verifiedBy: null,
    verifiedAt: null,
  };
}

function mapFactStatus(verificationStatus: string | null, deletedAt: string | null): FactStatus {
  if (deletedAt) return 'archived';
  if (verificationStatus === 'verified') return 'verified';
  if (verificationStatus === 'needs_review') return 'conflicted';
  return 'unverified';
}

// ── Builders — one per domain ──────────────────────────────────────────────

async function buildMedicationFacts(profileId: string): Promise<CanonicalFact[]> {
  const { data: meds, error } = await supabase
    .from('med_medications')
    .select('*')
    .eq('profile_id', profileId)
    .is('deleted_at', null)
    .eq('status', 'active');
  if (error || !meds || meds.length === 0) return [];

  const medIds = meds.map((m: { id: string }) => m.id);
  const [sigsResult, supplyResult] = await Promise.all([
    supabase.from('med_medication_sigs').select('*').in('medication_id', medIds),
    supabase.from('med_medication_supply').select('*').in('medication_id', medIds),
  ]);

  const sigsByMed = new Map<string, Record<string, unknown>>();
  for (const sig of (sigsResult.data ?? []) as Record<string, unknown>[]) {
    const mid = sig.medication_id as string;
    if (!sigsByMed.has(mid)) sigsByMed.set(mid, sig);
  }
  const supplyByMed = new Map<string, Record<string, unknown>>();
  for (const s of (supplyResult.data ?? []) as Record<string, unknown>[]) {
    const mid = s.medication_id as string;
    if (!supplyByMed.has(mid)) supplyByMed.set(mid, s);
  }

  return meds.map((med: Record<string, unknown>) => {
    const id = med.id as string;
    const sig = sigsByMed.get(id);
    const supply = supplyByMed.get(id);
    const drugName = (med.drug_name as string) ?? 'Medication';
    const strength = (med.strength as string | null) ?? null;
    const doseText = (sig?.dose_text as string | null) ?? null;
    const frequencyText = (sig?.frequency_text as string | null) ?? null;
    const sigText = [doseText, frequencyText].filter(Boolean).join(' — ') || null;
    const updatedAt = (med.updated_at as string) ?? (med.created_at as string);
    const dateRelevant = (supply?.last_fill_date as string | null) ?? (med.created_at as string) ?? null;

    const displayName = strength ? `${drugName} ${strength}` : drugName;

    return {
      id: `medication:${id}`,
      profileId,
      domain: 'medications' as FactDomain,
      factType: 'medication',
      factKey: normalizeKey(drugName),
      displayName,
      value: {
        drugName,
        strength,
        form: med.form ?? null,
        route: med.route ?? null,
        status: med.status ?? 'active',
        prn: med.prn_flag ?? false,
        dose: doseText,
        frequency: frequencyText,
        instructions: sig?.instructions ?? null,
        prescriberName: supply?.prescriber_name ?? null,
        prescriberPhone: supply?.prescriber_phone ?? null,
        pharmacyName: supply?.pharmacy_name ?? null,
        pharmacyPhone: supply?.pharmacy_phone ?? null,
        lastFillDate: supply?.last_fill_date ?? null,
        daysSupply: supply?.days_supply ?? null,
        refillsRemaining: supply?.refills_remaining ?? null,
      },
      secondaryValue: sigText,
      dateRelevant,
      status: 'active' as FactStatus,
      provenance: provenanceFromFactSource(
        (med.source_type as string | null) ?? null,
        'verified',
        null,
        null,
      ),
      sourceId: id,
      sourceType: 'med_medications',
      sourceDocumentId: null,
      freshness: computeFreshness(dateRelevant),
      updatedAt,
      conflictGroupId: null,
    } satisfies CanonicalFact;
  });
}

async function buildLabObservationFacts(profileId: string): Promise<CanonicalFact[]> {
  const { data: obs, error } = await supabase
    .from('result_lab_observations')
    .select('*')
    .eq('profile_id', profileId)
    .order('observed_at', { ascending: false, nullsFirst: false })
    .limit(MAX_LAB_OBSERVATIONS);
  if (error || !obs || obs.length === 0) return [];

  const resultIds = Array.from(
    new Set(obs.map((o: { result_id: string }) => o.result_id).filter(Boolean)),
  );
  let resultsById = new Map<string, Record<string, unknown>>();
  if (resultIds.length > 0) {
    const { data: items } = await supabase
      .from('result_items')
      .select('id, test_name, performed_at, reported_at, source_method, facility')
      .in('id', resultIds);
    for (const item of (items ?? []) as Record<string, unknown>[]) {
      resultsById.set(item.id as string, item);
    }
  }

  return (obs as Record<string, unknown>[]).map((o) => {
    const id = o.id as string;
    const analyte = (o.analyte_name as string) ?? 'Lab';
    const parentResultId = (o.result_id as string) ?? null;
    const parent = parentResultId ? resultsById.get(parentResultId) : undefined;
    const numeric = o.numeric_value as number | null;
    const valueText = (o.value_text as string | null) ?? (numeric !== null ? String(numeric) : null);
    const unit = (o.unit as string | null) ?? null;
    const primary = formatLabValue(valueText, unit);
    const refRangeText =
      (o.ref_range_text as string | null) ??
      (o.ref_range_low !== null && o.ref_range_high !== null
        ? `${o.ref_range_low}–${o.ref_range_high}`
        : null);
    const flag = (o.flag as string | null) ?? null;
    const secondaryBits: string[] = [];
    if (refRangeText) secondaryBits.push(`ref ${refRangeText}`);
    if (flag && flag !== 'normal') secondaryBits.push(flag);
    const secondaryValue = secondaryBits.length > 0 ? secondaryBits.join(' · ') : null;
    const dateRelevant = (o.observed_at as string | null) ?? null;

    const obsSource = (o.source as string) ?? 'extracted';
    const provenanceSource: FactProvenanceSource =
      obsSource === 'user_entered' ? 'manual'
      : obsSource === 'user_confirmed' ? 'manual'
      : 'extraction';
    const provenance: FactProvenance = {
      source: provenanceSource,
      sourceLabel:
        obsSource === 'user_entered' ? 'You entered'
        : obsSource === 'user_confirmed' ? 'You confirmed'
        : 'Extracted from report',
      verifiedBy: null,
      verifiedAt: obsSource === 'user_confirmed' ? (o.created_at as string) : null,
    };

    return {
      id: `lab_observation:${id}`,
      profileId,
      domain: 'labs' as FactDomain,
      factType: 'lab_result',
      factKey: normalizeKey(analyte),
      displayName: analyte,
      value: {
        numericValue: numeric,
        valueText,
        unit,
        refRangeLow: o.ref_range_low ?? null,
        refRangeHigh: o.ref_range_high ?? null,
        refRangeText,
        flag,
        parentTestName: parent?.test_name ?? null,
        parentFacility: parent?.facility ?? null,
      },
      secondaryValue: primary || secondaryValue,
      dateRelevant,
      status: 'verified' as FactStatus,
      provenance,
      sourceId: parentResultId,
      sourceType: 'result_items',
      sourceDocumentId: null,
      freshness: computeFreshness(dateRelevant),
      updatedAt: (o.created_at as string) ?? new Date().toISOString(),
      conflictGroupId: null,
    } satisfies CanonicalFact;
  });
}

async function buildImagingFacts(profileId: string): Promise<CanonicalFact[]> {
  const { data: items, error } = await supabase
    .from('result_items')
    .select('*')
    .eq('profile_id', profileId)
    .eq('result_type', 'imaging')
    .order('performed_at', { ascending: false, nullsFirst: false })
    .limit(MAX_RESULT_ITEMS);
  if (error || !items || items.length === 0) return [];

  return (items as Record<string, unknown>[]).map((item) => {
    const id = item.id as string;
    const testName = (item.test_name as string) ?? 'Imaging';
    const structured = (item.structured_data as Record<string, unknown> | null) ?? {};
    const corrections = (item.user_corrections as Record<string, unknown> | null) ?? {};
    const merged = { ...structured, ...corrections };
    const dateRelevant = (item.performed_at as string | null) ?? (item.reported_at as string | null) ?? null;
    const impression = (merged.impression as string | null) ?? null;
    const findings = (merged.findings as string | null) ?? null;
    const secondary = impression ?? findings ?? null;
    const sourceMethod = (item.source_method as string | null) ?? 'typed';
    const isExtracted = sourceMethod === 'document';

    return {
      id: `imaging:${id}`,
      profileId,
      domain: 'results' as FactDomain,
      factType: 'imaging_result',
      factKey: normalizeKey(testName),
      displayName: testName,
      value: {
        impression,
        findings,
        modality: merged.modality ?? null,
        bodyPart: merged.body_part ?? null,
        facility: item.facility ?? null,
        orderingClinician: item.ordering_clinician ?? null,
      },
      secondaryValue: secondary,
      dateRelevant,
      status: (item.status === 'ready' ? 'verified' : 'unverified') as FactStatus,
      provenance: {
        source: isExtracted ? 'extraction' : 'manual',
        sourceLabel: isExtracted ? 'From a document' : 'You entered',
        verifiedBy: null,
        verifiedAt: null,
      },
      sourceId: id,
      sourceType: 'result_items',
      sourceDocumentId: null,
      freshness: computeFreshness(dateRelevant),
      updatedAt: (item.updated_at as string) ?? (item.created_at as string),
      conflictGroupId: null,
    } satisfies CanonicalFact;
  });
}

/** Domain mapping for categories of profile_facts we project into the index. */
interface ProfileFactDomainMapping {
  domain: FactDomain;
  factType: string;
  keyFromValue: (v: Record<string, unknown>) => string;
  nameFromValue: (v: Record<string, unknown>) => string;
  secondaryFromValue: (v: Record<string, unknown>) => string | null;
}

const PROFILE_FACT_MAP: Record<string, ProfileFactDomainMapping> = {
  allergy: {
    domain: 'allergies',
    factType: 'allergy',
    keyFromValue: (v) => normalizeKey(str(v.substance) ?? str(v.allergen) ?? str(v.name) ?? str(v.value)),
    nameFromValue: (v) => str(v.substance) ?? str(v.allergen) ?? str(v.name) ?? str(v.value) ?? 'Allergy',
    secondaryFromValue: (v) => {
      const reaction = str(v.reaction);
      const severity = str(v.severity);
      return [reaction, severity].filter(Boolean).join(' · ') || null;
    },
  },
  condition: {
    domain: 'conditions',
    factType: 'condition',
    keyFromValue: (v) => normalizeKey(str(v.name) ?? str(v.condition) ?? str(v.value)),
    nameFromValue: (v) => str(v.name) ?? str(v.condition) ?? str(v.value) ?? 'Condition',
    secondaryFromValue: (v) => {
      const status = str(v.status);
      const onset = str(v.diagnosed_date) ?? str(v.onset);
      return [status, onset && `since ${onset}`].filter(Boolean).join(' · ') || null;
    },
  },
  surgery: {
    domain: 'surgeries',
    factType: 'surgery',
    keyFromValue: (v) => normalizeKey(str(v.name) ?? str(v.procedure) ?? str(v.value)),
    nameFromValue: (v) => str(v.name) ?? str(v.procedure) ?? str(v.value) ?? 'Surgery',
    secondaryFromValue: (v) => {
      const date = str(v.date);
      const hospital = str(v.hospital) ?? str(v.facility);
      return [date, hospital].filter(Boolean).join(' · ') || null;
    },
  },
  insurance: {
    domain: 'insurance',
    factType: 'insurance',
    keyFromValue: (v) => normalizeKey(str(v.payer_name) ?? str(v.provider) ?? str(v.plan) ?? str(v.value)),
    nameFromValue: (v) => str(v.payer_name) ?? str(v.provider) ?? str(v.plan) ?? 'Insurance',
    secondaryFromValue: (v) => {
      const memberId = str(v.member_id);
      const group = str(v.group_number);
      return [memberId && `Member ${memberId}`, group && `Group ${group}`].filter(Boolean).join(' · ') || null;
    },
  },
  care_team: {
    domain: 'care_team',
    factType: 'care_team',
    keyFromValue: (v) => normalizeKey(str(v.name) ?? str(v.provider) ?? str(v.value)),
    nameFromValue: (v) => str(v.name) ?? str(v.provider) ?? 'Provider',
    secondaryFromValue: (v) => {
      const specialty = str(v.specialty);
      const phone = str(v.phone);
      return [specialty, phone].filter(Boolean).join(' · ') || null;
    },
  },
  family_history: {
    domain: 'conditions',
    factType: 'family_history',
    keyFromValue: (v) => normalizeKey(str(v.condition) ?? str(v.value)),
    nameFromValue: (v) => {
      const condition = str(v.condition) ?? str(v.value) ?? 'Family history';
      const relative = str(v.relative);
      return relative ? `${condition} (${relative})` : condition;
    },
    secondaryFromValue: (v) => str(v.notes),
  },
};

async function buildProfileFactsByCategory(profileId: string): Promise<CanonicalFact[]> {
  const categories = Object.keys(PROFILE_FACT_MAP);
  const { data, error } = await supabase
    .from('profile_facts')
    .select('*')
    .eq('profile_id', profileId)
    .is('deleted_at', null)
    .in('category', categories);
  if (error || !data) return [];

  const out: CanonicalFact[] = [];
  for (const row of data as Record<string, unknown>[]) {
    const category = row.category as string;
    const mapping = PROFILE_FACT_MAP[category];
    if (!mapping) continue;

    const value = unwrapValue((row.value_json as Record<string, unknown> | null) ?? {});
    const displayName = mapping.nameFromValue(value);
    const factKey = mapping.keyFromValue(value);
    const updatedAt = (row.updated_at as string) ?? (row.created_at as string);

    out.push({
      id: `profile_fact:${row.id as string}`,
      profileId,
      domain: mapping.domain,
      factType: mapping.factType,
      factKey,
      displayName,
      value,
      secondaryValue: mapping.secondaryFromValue(value),
      dateRelevant: (str(value.diagnosed_date) ?? str(value.date) ?? null) as string | null,
      status: mapFactStatus(row.verification_status as string | null, row.deleted_at as string | null),
      provenance: provenanceFromFactSource(
        (row.source_type as string | null) ?? null,
        (row.verification_status as string | null) ?? null,
        (row.verified_at as string | null) ?? null,
        (row.verified_by as string | null) ?? null,
      ),
      sourceId: row.id as string,
      sourceType: 'profile_facts',
      sourceDocumentId: (row.source_ref as string | null) ?? null,
      freshness: computeFreshness(updatedAt),
      updatedAt,
      conflictGroupId: null,
    });
  }
  return out;
}

async function buildAppointmentFacts(profileId: string): Promise<CanonicalFact[]> {
  // Grab a window of recent past and all upcoming, capped at MAX_APPOINTMENTS each side.
  const ninetyDaysAgo = new Date(Date.now() - 90 * MS_PER_DAY).toISOString();

  const { data, error } = await supabase
    .from('apt_appointments')
    .select('*')
    .eq('profile_id', profileId)
    .is('deleted_at', null)
    .gte('start_time', ninetyDaysAgo)
    .order('start_time', { ascending: false })
    .limit(MAX_APPOINTMENTS);
  if (error || !data) return [];

  return (data as Record<string, unknown>[]).map((appt) => {
    const id = appt.id as string;
    const title = (appt.title as string) ?? 'Appointment';
    const providerName = (appt.provider_name as string | null) ?? null;
    const facility = (appt.facility_name as string | null) ?? null;
    const appointmentType = (appt.appointment_type as string) ?? 'other';
    const startTime = (appt.start_time as string) ?? null;
    const statusRaw = (appt.status as string) ?? 'scheduled';
    const factStatus: FactStatus = statusRaw === 'completed' ? 'verified' : 'active';
    const secondary = [providerName, facility].filter(Boolean).join(' · ') || null;

    return {
      id: `appointment:${id}`,
      profileId,
      domain: 'appointments' as FactDomain,
      factType: 'appointment',
      factKey: normalizeKey(providerName ?? appointmentType ?? title),
      displayName: title,
      value: {
        provider: providerName,
        facility,
        location: appt.location_text ?? null,
        startTime,
        endTime: appt.end_time ?? null,
        appointmentType,
        status: statusRaw,
        purpose: appt.purpose ?? null,
      },
      secondaryValue: secondary,
      dateRelevant: startTime,
      status: factStatus,
      provenance: provenanceForSystem('You scheduled'),
      sourceId: id,
      sourceType: 'apt_appointments',
      sourceDocumentId: null,
      freshness: computeFreshness(startTime),
      updatedAt: (appt.updated_at as string) ?? (appt.created_at as string),
      conflictGroupId: null,
    } satisfies CanonicalFact;
  });
}

async function buildPreventiveFacts(profileId: string): Promise<CanonicalFact[]> {
  const { data, error } = await supabase
    .from('preventive_items')
    .select('*, rule:preventive_rules(code, title, description, category, cadence_months)')
    .eq('profile_id', profileId);
  if (error || !data) return [];

  return (data as Record<string, unknown>[]).map((item) => {
    const id = item.id as string;
    const rule = (item.rule as Record<string, unknown> | null) ?? {};
    const ruleCode = (rule.code as string) ?? 'rule';
    const title = (rule.title as string) ?? 'Preventive care';
    const itemStatus = (item.status as string) ?? 'needs_review';
    const dueDate = (item.due_date as string | null) ?? null;
    const lastDone = (item.last_done_date as string | null) ?? null;
    const nextDue = (item.next_due_date as string | null) ?? null;
    const dateRelevant = dueDate ?? nextDue ?? lastDone ?? null;

    const factStatus: FactStatus =
      itemStatus === 'completed' || itemStatus === 'up_to_date' ? 'verified'
      : itemStatus === 'deferred' || itemStatus === 'declined' ? 'inactive'
      : 'active';

    return {
      id: `preventive:${id}`,
      profileId,
      domain: 'preventive' as FactDomain,
      factType: 'preventive',
      factKey: normalizeKey(ruleCode),
      displayName: title,
      value: {
        title,
        ruleCode,
        category: rule.category ?? null,
        cadenceMonths: rule.cadence_months ?? null,
        status: itemStatus,
        dueDate,
        lastDoneDate: lastDone,
        nextDueDate: nextDue,
        rationale: item.rationale ?? null,
      },
      secondaryValue: `${itemStatus.replace(/_/g, ' ')}${dueDate ? ` · due ${dueDate}` : ''}`,
      dateRelevant,
      status: factStatus,
      provenance: provenanceForSystem('Guideline-based'),
      sourceId: id,
      sourceType: 'preventive_items',
      sourceDocumentId: (item.last_done_evidence_id as string | null) ?? null,
      freshness: computeFreshness(dateRelevant),
      updatedAt: (item.updated_at as string) ?? (item.created_at as string),
      conflictGroupId: null,
    } satisfies CanonicalFact;
  });
}

async function buildBillingFacts(profileId: string): Promise<CanonicalFact[]> {
  const { data, error } = await supabase
    .from('billing_cases')
    .select('*')
    .eq('profile_id', profileId)
    .order('updated_at', { ascending: false })
    .limit(MAX_BILLING_CASES);
  if (error || !data) return [];

  return (data as Record<string, unknown>[]).map((c) => {
    const id = c.id as string;
    const title = (c.title as string) ?? 'Bill';
    const caseStatus = (c.status as string) ?? 'open';
    const provider = (c.provider_name as string | null) ?? null;
    const payer = (c.payer_name as string | null) ?? null;
    const patientResp = c.total_patient_responsibility as number | null;
    const secondary = [provider, payer, patientResp != null ? `$${patientResp} due` : null]
      .filter(Boolean)
      .join(' · ') || null;

    const factStatus: FactStatus =
      caseStatus === 'resolved' || caseStatus === 'closed' ? 'archived'
      : 'active';

    return {
      id: `billing:${id}`,
      profileId,
      domain: 'billing' as FactDomain,
      factType: 'billing_case',
      factKey: normalizeKey(title),
      displayName: title,
      value: {
        title,
        status: caseStatus,
        provider,
        payer,
        totalBilled: c.total_billed ?? null,
        totalAllowed: c.total_allowed ?? null,
        totalPlanPaid: c.total_plan_paid ?? null,
        patientResponsibility: patientResp,
        serviceDateStart: c.service_date_start ?? null,
        serviceDateEnd: c.service_date_end ?? null,
      },
      secondaryValue: secondary,
      dateRelevant: (c.service_date_start as string | null) ?? (c.updated_at as string | null) ?? null,
      status: factStatus,
      provenance: provenanceForSystem('Billing case'),
      sourceId: id,
      sourceType: 'billing_cases',
      sourceDocumentId: null,
      freshness: computeFreshness((c.updated_at as string) ?? null),
      updatedAt: (c.updated_at as string) ?? (c.created_at as string),
      conflictGroupId: null,
    } satisfies CanonicalFact;
  });
}

// ── Conflict detection ─────────────────────────────────────────────────────

function medicationConflictFingerprint(fact: CanonicalFact): string {
  const v = (fact.value as Record<string, unknown>) ?? {};
  const dose = normalizeKey(str(v.dose) ?? '');
  const frequency = normalizeKey(str(v.frequency) ?? '');
  const strength = normalizeKey(str(v.strength) ?? '');
  return `${dose}|${frequency}|${strength}`;
}

function labConflictFingerprint(fact: CanonicalFact): string {
  const v = (fact.value as Record<string, unknown>) ?? {};
  const numeric = v.numericValue;
  const valueText = normalizeKey(str(v.valueText) ?? '');
  const unit = normalizeKey(str(v.unit) ?? '');
  return `${numeric ?? ''}|${valueText}|${unit}`;
}

function profileFactConflictFingerprint(fact: CanonicalFact): string {
  const v = (fact.value as Record<string, unknown>) ?? {};
  if (fact.factType === 'allergy') {
    return `${normalizeKey(str(v.reaction) ?? '')}|${normalizeKey(str(v.severity) ?? '')}`;
  }
  if (fact.factType === 'condition') {
    // Conditions always conflict when duplicated by name — no sub-fingerprint.
    return '__any__';
  }
  return '__any__';
}

/**
 * Scan the built facts and annotate duplicates that genuinely conflict with a
 * shared `conflictGroupId`. Facts in the same group also get status='conflicted'.
 *
 * Rules:
 *  - medications: same normalized drug name (factKey) with different dose/freq/strength
 *  - lab observations: same analyte + same observed_at (dateRelevant) with different value
 *  - allergies: same substance with different reaction/severity
 *  - conditions: same condition appearing multiple times (any duplicate)
 */
function detectConflicts(facts: CanonicalFact[]): void {
  // Group by (domain, factType, factKey [+ dateRelevant for labs])
  const groups = new Map<string, CanonicalFact[]>();
  for (const f of facts) {
    if (!f.factKey) continue;
    let bucketKey: string | null = null;
    if (f.factType === 'medication' && f.status === 'active') {
      bucketKey = `medication::${f.factKey}`;
    } else if (f.factType === 'lab_result' && f.dateRelevant) {
      bucketKey = `lab::${f.factKey}::${f.dateRelevant}`;
    } else if (f.factType === 'allergy') {
      bucketKey = `allergy::${f.factKey}`;
    } else if (f.factType === 'condition') {
      bucketKey = `condition::${f.factKey}`;
    }
    if (!bucketKey) continue;
    const bucket = groups.get(bucketKey) ?? [];
    bucket.push(f);
    groups.set(bucketKey, bucket);
  }

  for (const [bucketKey, bucket] of groups) {
    if (bucket.length < 2) continue;

    // Sub-group by conflict fingerprint — only flag when values actually diverge.
    const fingerprints = new Set<string>();
    for (const f of bucket) {
      if (f.factType === 'medication') fingerprints.add(medicationConflictFingerprint(f));
      else if (f.factType === 'lab_result') fingerprints.add(labConflictFingerprint(f));
      else fingerprints.add(profileFactConflictFingerprint(f));
    }

    // Conditions: any duplicate is a conflict (single fingerprint '__any__').
    // Others: need 2+ distinct fingerprints for an actual divergence.
    const shouldFlag =
      bucket[0].factType === 'condition' ? true : fingerprints.size > 1;
    if (!shouldFlag) continue;

    const groupId = `conflict:${bucketKey}`;
    for (const f of bucket) {
      f.conflictGroupId = groupId;
      f.status = 'conflicted';
    }
  }
}

// ── Orchestrator ───────────────────────────────────────────────────────────

/**
 * Build a ProfileIndex for a profile by reading all domain tables in parallel.
 * Returns a ServiceResult. Domains with no data contribute zero facts — not
 * an error. A partial failure on a single domain logs a console warning and
 * contributes zero facts for that domain.
 */
export async function buildProfileIndex(
  profileId: string,
  _householdId: string,
): Promise<ServiceResult<ProfileIndex>> {
  if (!profileId) {
    return { success: false, error: 'profileId is required' };
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, display_name')
    .eq('id', profileId)
    .is('deleted_at', null)
    .single();
  if (profileError || !profile) {
    return { success: false, error: profileError?.message ?? 'Profile not found' };
  }

  const builders: Array<() => Promise<CanonicalFact[]>> = [
    () => buildMedicationFacts(profileId),
    () => buildLabObservationFacts(profileId),
    () => buildImagingFacts(profileId),
    () => buildProfileFactsByCategory(profileId),
    () => buildAppointmentFacts(profileId),
    () => buildPreventiveFacts(profileId),
    () => buildBillingFacts(profileId),
  ];

  const settled = await Promise.allSettled(builders.map((b) => b()));
  const facts: CanonicalFact[] = [];
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      facts.push(...result.value);
    } else {
      console.warn('[profileIndex] builder failed:', result.reason);
    }
  }

  detectConflicts(facts);

  const factCounts = emptyFactCounts();
  for (const f of facts) {
    factCounts[f.domain] = (factCounts[f.domain] ?? 0) + 1;
  }

  const preComputedAnswers = computePreComputedAnswers(facts);

  return {
    success: true,
    data: {
      profileId,
      profileName: (profile.display_name as string) ?? '',
      facts,
      lastBuilt: new Date().toISOString(),
      factCounts,
      preComputedAnswers,
    },
  };
}

// ── Pre-computed answers ───────────────────────────────────────────────────
//
// Walked once over the assembled fact list. Zero extra DB queries — we already
// fetched everything. Engine code uses these snapshots as a fast path for the
// most common queries while still being able to fall back to the full index.

function pickLatestLab(facts: CanonicalFact[], analyteKeys: string[]): CanonicalFact | null {
  const matches = facts.filter(
    (f) => f.domain === 'labs' && analyteKeys.includes(f.factKey),
  );
  if (matches.length === 0) return null;
  matches.sort((a, b) => {
    const aT = a.dateRelevant ? new Date(a.dateRelevant).getTime() : 0;
    const bT = b.dateRelevant ? new Date(b.dateRelevant).getTime() : 0;
    return bT - aT;
  });
  return matches[0];
}

function labDisplayValue(fact: CanonicalFact | null): string | null {
  if (!fact) return null;
  const v = (fact.value as Record<string, unknown>) ?? {};
  const valueText = (v.valueText as string | null) ?? null;
  const unit = (v.unit as string | null) ?? null;
  return formatLabValue(valueText, unit) || valueText || null;
}

function computePreComputedAnswers(facts: CanonicalFact[]): PreComputedAnswers {
  const out = emptyPreComputedAnswers();

  // ── Medications ────────────────────────────────────────────────────────
  const meds = facts.filter((f) => f.domain === 'medications' && f.status !== 'archived');
  out.activeMedCount = meds.length;
  out.activeMedNames = meds.map((m) => m.displayName).slice(0, 20);

  // ── Latest A1c ─────────────────────────────────────────────────────────
  const a1c = pickLatestLab(facts, ['a1c', 'hba1c', 'hemoglobin a1c']);
  const a1cDisplay = labDisplayValue(a1c);
  if (a1c && a1cDisplay) {
    out.latestA1c = { value: a1cDisplay, date: a1c.dateRelevant };
  }

  // ── Latest BP (look in vitals or lab observations) ────────────────────
  // BP isn't usually in result_lab_observations — but if it ever is, prefer
  // separate systolic/diastolic readings from the same observation date.
  const sys = pickLatestLab(facts, ['systolic', 'systolic bp', 'sbp']);
  const dia = pickLatestLab(facts, ['diastolic', 'diastolic bp', 'dbp']);
  if (sys && dia && sys.dateRelevant === dia.dateRelevant) {
    const sysVal = labDisplayValue(sys);
    const diaVal = labDisplayValue(dia);
    if (sysVal && diaVal) {
      out.latestBP = {
        systolic: sysVal,
        diastolic: diaVal,
        date: sys.dateRelevant,
      };
    }
  }

  // ── Latest lipids (group by LDL/HDL/Total/Triglycerides) ──────────────
  const ldl = pickLatestLab(facts, ['ldl', 'ldl cholesterol']);
  const hdl = pickLatestLab(facts, ['hdl', 'hdl cholesterol']);
  const total = pickLatestLab(facts, ['cholesterol', 'total cholesterol']);
  const trig = pickLatestLab(facts, ['triglycerides']);
  if (ldl || hdl || total || trig) {
    const candidateDates = [ldl, hdl, total, trig]
      .map((f) => f?.dateRelevant ?? null)
      .filter((d): d is string => !!d)
      .sort()
      .reverse();
    out.latestLipids = {
      ldl: labDisplayValue(ldl),
      hdl: labDisplayValue(hdl),
      total: labDisplayValue(total),
      triglycerides: labDisplayValue(trig),
      date: candidateDates[0] ?? null,
    };
  }

  // ── Appointments ──────────────────────────────────────────────────────
  const appts = facts.filter((f) => f.domain === 'appointments');
  const now = Date.now();
  const upcoming = appts
    .filter((a) => a.dateRelevant && new Date(a.dateRelevant).getTime() >= now)
    .sort((a, b) => {
      const aT = a.dateRelevant ? new Date(a.dateRelevant).getTime() : Infinity;
      const bT = b.dateRelevant ? new Date(b.dateRelevant).getTime() : Infinity;
      return aT - bT;
    });
  const past = appts
    .filter((a) => a.dateRelevant && new Date(a.dateRelevant).getTime() < now)
    .sort((a, b) => {
      const aT = a.dateRelevant ? new Date(a.dateRelevant).getTime() : 0;
      const bT = b.dateRelevant ? new Date(b.dateRelevant).getTime() : 0;
      return bT - aT;
    });
  if (upcoming[0]) {
    const v = (upcoming[0].value as Record<string, unknown>) ?? {};
    out.nextAppointment = {
      title: upcoming[0].displayName,
      provider: (v.provider as string | null) ?? null,
      date: upcoming[0].dateRelevant ?? '',
      sourceId: upcoming[0].sourceId,
    };
  }
  if (past[0]) {
    const v = (past[0].value as Record<string, unknown>) ?? {};
    out.lastAppointment = {
      title: past[0].displayName,
      provider: (v.provider as string | null) ?? null,
      date: past[0].dateRelevant ?? '',
      sourceId: past[0].sourceId,
    };
  }

  // ── Allergies ─────────────────────────────────────────────────────────
  const allergies = facts.filter((f) => f.domain === 'allergies' && f.status !== 'archived');
  if (allergies.length === 0) {
    out.allergySummary = 'No known allergies';
  } else {
    const names = allergies.map((a) => a.displayName);
    out.allergySummary = names.length <= 3
      ? names.join(', ')
      : `${names.slice(0, 3).join(', ')}, +${names.length - 3} more`;
  }

  // ── Conditions ────────────────────────────────────────────────────────
  const conditions = facts.filter(
    (f) => f.domain === 'conditions' && f.factType === 'condition' && f.status !== 'archived',
  );
  if (conditions.length === 0) {
    out.conditionSummary = 'None on file';
  } else {
    const names = conditions.map((c) => c.displayName);
    out.conditionSummary = names.length <= 3
      ? names.join(', ')
      : `${names.slice(0, 3).join(', ')}, +${names.length - 3} more`;
  }

  // ── Insurance ─────────────────────────────────────────────────────────
  const insurance = facts.filter((f) => f.domain === 'insurance' && f.status !== 'archived');
  if (insurance[0]) {
    const v = (insurance[0].value as Record<string, unknown>) ?? {};
    const memberId = (v.member_id as string | null) ?? null;
    out.insuranceSummary = memberId
      ? `${insurance[0].displayName}, Member ${memberId}`
      : insurance[0].displayName;
  }

  // ── Preventive ────────────────────────────────────────────────────────
  for (const p of facts.filter((f) => f.domain === 'preventive')) {
    const v = (p.value as Record<string, unknown>) ?? {};
    const status = (v.status as string | null) ?? null;
    if (status === 'due' || status === 'overdue') out.preventiveDueCount += 1;
    else if (status === 'due_soon') out.preventiveDueSoonCount += 1;
  }

  // ── Primary care provider (first care_team entry tagged primary care) ─
  const careTeam = facts.filter((f) => f.domain === 'care_team' && f.status !== 'archived');
  for (const c of careTeam) {
    const v = (c.value as Record<string, unknown>) ?? {};
    const specialty = ((v.specialty as string | null) ?? '').toLowerCase();
    if (specialty.includes('primary') || specialty === 'pcp' || specialty.includes('family')) {
      out.primaryCareProvider = c.displayName;
      break;
    }
  }
  if (!out.primaryCareProvider && careTeam[0]) {
    out.primaryCareProvider = careTeam[0].displayName;
  }

  // ── Primary pharmacy (first medication's pharmacy_name) ───────────────
  for (const m of meds) {
    const v = (m.value as Record<string, unknown>) ?? {};
    const pharmacy = (v.pharmacyName as string | null) ?? null;
    if (pharmacy) {
      out.primaryPharmacy = pharmacy;
      break;
    }
  }

  // ── Totals ────────────────────────────────────────────────────────────
  out.totalProfileFacts = facts.length;

  // ── Billing ───────────────────────────────────────────────────────────
  const bills = facts.filter((f) => f.domain === 'billing' && f.status !== 'archived');
  out.openBillCount = bills.length;
  let owed = 0;
  let owedSeen = false;
  for (const b of bills) {
    const v = (b.value as Record<string, unknown>) ?? {};
    const patient = v.patientResponsibility as number | null;
    if (typeof patient === 'number' && !Number.isNaN(patient)) {
      owed += patient;
      owedSeen = true;
    }
  }
  if (owedSeen) out.totalOwed = owed;

  return out;
}
