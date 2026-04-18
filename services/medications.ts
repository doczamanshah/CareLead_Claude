import { supabase } from '@/lib/supabase';
import type {
  Medication,
  MedicationSig,
  MedicationSupply,
  MedicationWithDetails,
  MedicationDetail,
  AdherenceEvent,
  AdherenceEventType,
  CreateMedicationParams,
  UpdateMedicationParams,
  UpdateSupplyParams,
  UpdateSigParams,
  RefillInfo,
  RefillStatus,
  TodaysDose,
  MedicationStatus,
} from '@/lib/types/medications';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

/**
 * Fetch all active medications for a profile with their current sig and supply.
 */
export async function fetchMedications(
  profileId: string,
): Promise<ServiceResult<MedicationWithDetails[]>> {
  const { data: meds, error: medsError } = await supabase
    .from('med_medications')
    .select('*')
    .eq('profile_id', profileId)
    .is('deleted_at', null)
    .order('status', { ascending: true })
    .order('drug_name', { ascending: true });

  if (medsError) {
    return { success: false, error: medsError.message, code: medsError.code };
  }

  if (!meds || meds.length === 0) {
    return { success: true, data: [] };
  }

  const medIds = meds.map((m) => m.id);

  const [sigsResult, supplyResult] = await Promise.all([
    supabase
      .from('med_medication_sigs')
      .select('*')
      .in('medication_id', medIds)
      .order('created_at', { ascending: false }),
    supabase
      .from('med_medication_supply')
      .select('*')
      .in('medication_id', medIds)
      .order('created_at', { ascending: false }),
  ]);

  const sigsByMed = new Map<string, MedicationSig>();
  for (const sig of (sigsResult.data ?? []) as MedicationSig[]) {
    if (!sigsByMed.has(sig.medication_id)) {
      sigsByMed.set(sig.medication_id, sig);
    }
  }

  const supplyByMed = new Map<string, MedicationSupply>();
  for (const supply of (supplyResult.data ?? []) as MedicationSupply[]) {
    if (!supplyByMed.has(supply.medication_id)) {
      supplyByMed.set(supply.medication_id, supply);
    }
  }

  const result: MedicationWithDetails[] = (meds as Medication[]).map((med) => ({
    ...med,
    sig: sigsByMed.get(med.id) ?? null,
    supply: supplyByMed.get(med.id) ?? null,
  }));

  return { success: true, data: result };
}

/**
 * Fetch full medication detail with sig, supply, and recent adherence events.
 */
export async function fetchMedicationDetail(
  medicationId: string,
): Promise<ServiceResult<MedicationDetail>> {
  const { data: med, error: medError } = await supabase
    .from('med_medications')
    .select('*')
    .eq('id', medicationId)
    .is('deleted_at', null)
    .single();

  if (medError || !med) {
    return { success: false, error: medError?.message ?? 'Medication not found' };
  }

  const [sigResult, supplyResult, adherenceResult] = await Promise.all([
    supabase
      .from('med_medication_sigs')
      .select('*')
      .eq('medication_id', medicationId)
      .order('created_at', { ascending: false })
      .limit(1),
    supabase
      .from('med_medication_supply')
      .select('*')
      .eq('medication_id', medicationId)
      .order('created_at', { ascending: false })
      .limit(1),
    supabase
      .from('med_adherence_events')
      .select('*')
      .eq('medication_id', medicationId)
      .order('recorded_at', { ascending: false })
      .limit(50),
  ]);

  return {
    success: true,
    data: {
      ...(med as Medication),
      sig: ((sigResult.data ?? []) as MedicationSig[])[0] ?? null,
      supply: ((supplyResult.data ?? []) as MedicationSupply[])[0] ?? null,
      recentAdherence: (adherenceResult.data ?? []) as AdherenceEvent[],
    },
  };
}

/**
 * Normalize a drug name for duplicate detection. Strips common form suffixes
 * (tablet/capsule/etc.), pulls out the first word, and lowercases. The goal is
 * to catch accidental duplicates — e.g. "Lisinopril 10mg" vs "lisinopril" —
 * without being overly aggressive on genuinely-distinct prescriptions.
 */
function normalizeDrugName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\b(tablet|tablets|capsule|capsules|pill|pills|cap|caps|tab|tabs)\b/g, '')
    .replace(/[^a-z0-9\s\-]/g, ' ')
    .trim()
    .split(/\s+/)[0] ?? '';
}

export interface DuplicateMedicationMatch {
  id: string;
  name: string;
  dose: string;
}

/**
 * Check whether an active medication matching the given name already exists
 * for this profile. Matches on the normalized first token of the drug name.
 */
export async function checkForDuplicateMedication(
  profileId: string,
  medicationName: string,
): Promise<
  ServiceResult<{ isDuplicate: boolean; existingMed: DuplicateMedicationMatch | null }>
> {
  const normalized = normalizeDrugName(medicationName);
  if (!normalized) {
    return { success: true, data: { isDuplicate: false, existingMed: null } };
  }

  const medsResult = await fetchMedications(profileId);
  if (!medsResult.success) {
    return medsResult;
  }

  const match = medsResult.data.find(
    (m) => m.status === 'active' && normalizeDrugName(m.drug_name) === normalized,
  );

  if (!match) {
    return { success: true, data: { isDuplicate: false, existingMed: null } };
  }

  const dose = [match.strength, match.sig?.frequency_text]
    .filter(Boolean)
    .join(' — ');

  return {
    success: true,
    data: {
      isDuplicate: true,
      existingMed: {
        id: match.id,
        name: match.drug_name,
        dose: dose || 'no dose on file',
      },
    },
  };
}

/**
 * Create a medication with sig and optional supply atomically.
 */
export async function createMedication(
  params: CreateMedicationParams,
  userId: string,
): Promise<ServiceResult<MedicationWithDetails>> {
  const { data: med, error: medError } = await supabase
    .from('med_medications')
    .insert({
      profile_id: params.profile_id,
      drug_name: params.drug_name,
      strength: params.strength ?? null,
      form: params.form ?? null,
      route: params.route ?? null,
      prn_flag: params.prn_flag ?? false,
      notes: params.notes ?? null,
      source_type: 'manual',
      created_by: userId,
    })
    .select()
    .single();

  if (medError || !med) {
    return { success: false, error: medError?.message ?? 'Failed to create medication' };
  }

  const medication = med as Medication;

  // Create sig
  let sig: MedicationSig | null = null;
  if (params.dose_text || params.frequency_text || params.timing_json || params.instructions) {
    const { data: sigData, error: sigError } = await supabase
      .from('med_medication_sigs')
      .insert({
        medication_id: medication.id,
        profile_id: params.profile_id,
        dose_text: params.dose_text ?? null,
        frequency_text: params.frequency_text ?? null,
        timing_json: params.timing_json ?? null,
        instructions: params.instructions ?? null,
        source_type: 'manual',
      })
      .select()
      .single();

    if (!sigError && sigData) {
      sig = sigData as MedicationSig;
    }
  }

  // Create supply if any supply fields provided
  let supply: MedicationSupply | null = null;
  const hasSupply = params.last_fill_date || params.days_supply != null ||
    params.refills_remaining != null || params.pharmacy_name || params.prescriber_name;

  if (hasSupply) {
    const { data: supplyData, error: supplyError } = await supabase
      .from('med_medication_supply')
      .insert({
        medication_id: medication.id,
        profile_id: params.profile_id,
        last_fill_date: params.last_fill_date ?? null,
        days_supply: params.days_supply ?? null,
        refills_remaining: params.refills_remaining ?? null,
        pharmacy_name: params.pharmacy_name ?? null,
        pharmacy_phone: params.pharmacy_phone ?? null,
        prescriber_name: params.prescriber_name ?? null,
        prescriber_phone: params.prescriber_phone ?? null,
      })
      .select()
      .single();

    if (!supplyError && supplyData) {
      supply = supplyData as MedicationSupply;
    }
  }

  // Audit event
  await supabase.from('audit_events').insert({
    profile_id: params.profile_id,
    actor_id: userId,
    event_type: 'medication.created',
    metadata: {
      medication_id: medication.id,
      drug_name: medication.drug_name,
      source: 'manual',
    },
  });

  return {
    success: true,
    data: { ...medication, sig, supply },
  };
}

/**
 * Update medication details.
 */
export async function updateMedication(
  medicationId: string,
  params: UpdateMedicationParams,
  userId: string,
): Promise<ServiceResult<Medication>> {
  const { data, error } = await supabase
    .from('med_medications')
    .update(params)
    .eq('id', medicationId)
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  await supabase.from('audit_events').insert({
    profile_id: data.profile_id,
    actor_id: userId,
    event_type: 'medication.updated',
    metadata: {
      medication_id: medicationId,
      updated_fields: Object.keys(params),
    },
  });

  return { success: true, data: data as Medication };
}

/**
 * Update medication status (pause/resume/stop).
 */
export async function updateMedicationStatus(
  medicationId: string,
  status: MedicationStatus,
  userId: string,
): Promise<ServiceResult<Medication>> {
  const { data, error } = await supabase
    .from('med_medications')
    .update({ status })
    .eq('id', medicationId)
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  await supabase.from('audit_events').insert({
    profile_id: data.profile_id,
    actor_id: userId,
    event_type: `medication.${status}`,
    metadata: {
      medication_id: medicationId,
      new_status: status,
    },
  });

  return { success: true, data: data as Medication };
}

/**
 * Update supply/refill info for a medication.
 */
export async function updateSupply(
  medicationId: string,
  params: UpdateSupplyParams,
  userId: string,
): Promise<ServiceResult<MedicationSupply>> {
  // Check if supply row exists
  const { data: existing } = await supabase
    .from('med_medication_supply')
    .select('id, profile_id')
    .eq('medication_id', medicationId)
    .limit(1)
    .single();

  if (existing) {
    const { data, error } = await supabase
      .from('med_medication_supply')
      .update(params)
      .eq('id', existing.id)
      .select()
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: data as MedicationSupply };
  }

  // Need profile_id for insert — get it from the medication
  const { data: med } = await supabase
    .from('med_medications')
    .select('profile_id')
    .eq('id', medicationId)
    .single();

  if (!med) {
    return { success: false, error: 'Medication not found' };
  }

  const { data, error } = await supabase
    .from('med_medication_supply')
    .insert({
      medication_id: medicationId,
      profile_id: med.profile_id,
      ...params,
    })
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, data: data as MedicationSupply };
}

/**
 * Update sig (dose/frequency/instructions) for a medication.
 * Creates a new sig row if none exists (upsert pattern matching updateSupply).
 */
export async function updateSig(
  medicationId: string,
  params: UpdateSigParams,
  userId: string,
): Promise<ServiceResult<MedicationSig>> {
  // Check if sig row exists
  const { data: existing } = await supabase
    .from('med_medication_sigs')
    .select('id, profile_id')
    .eq('medication_id', medicationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (existing) {
    const { data, error } = await supabase
      .from('med_medication_sigs')
      .update(params)
      .eq('id', existing.id)
      .select()
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: data as MedicationSig };
  }

  // Need profile_id for insert — get it from the medication
  const { data: med } = await supabase
    .from('med_medications')
    .select('profile_id')
    .eq('id', medicationId)
    .single();

  if (!med) {
    return { success: false, error: 'Medication not found' };
  }

  const { data, error } = await supabase
    .from('med_medication_sigs')
    .insert({
      medication_id: medicationId,
      profile_id: med.profile_id,
      source_type: 'manual',
      ...params,
    })
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, data: data as MedicationSig };
}

/**
 * Log an adherence event (taken/skipped/snoozed).
 */
export async function logAdherence(
  medicationId: string,
  eventType: AdherenceEventType,
  profileId: string,
  scheduledTime?: string,
  notes?: string,
): Promise<ServiceResult<AdherenceEvent>> {
  const { data, error } = await supabase
    .from('med_adherence_events')
    .insert({
      medication_id: medicationId,
      profile_id: profileId,
      event_type: eventType,
      scheduled_time: scheduledTime ?? null,
      notes: notes ?? null,
    })
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, data: data as AdherenceEvent };
}

/**
 * Get today's doses — active medications with scheduled times and today's adherence.
 */
export async function fetchTodaysDoses(
  profileId: string,
): Promise<ServiceResult<TodaysDose[]>> {
  const medsResult = await fetchMedications(profileId);
  if (!medsResult.success) return medsResult as ServiceResult<TodaysDose[]>;

  const activeMeds = medsResult.data.filter((m) => m.status === 'active');
  if (activeMeds.length === 0) return { success: true, data: [] };

  // Get today's adherence events
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const { data: events } = await supabase
    .from('med_adherence_events')
    .select('*')
    .eq('profile_id', profileId)
    .gte('recorded_at', todayStart.toISOString())
    .lte('recorded_at', todayEnd.toISOString());

  const eventsByMed = new Map<string, AdherenceEvent[]>();
  for (const evt of (events ?? []) as AdherenceEvent[]) {
    const existing = eventsByMed.get(evt.medication_id) ?? [];
    existing.push(evt);
    eventsByMed.set(evt.medication_id, existing);
  }

  const doses: TodaysDose[] = [];

  for (const med of activeMeds) {
    const todayEvents = eventsByMed.get(med.id) ?? [];
    const timings = med.sig?.timing_json ?? [];

    if (med.prn_flag) {
      // PRN meds have no schedule — show as available with latest event
      const latestEvent = todayEvents.length > 0 ? todayEvents[0].event_type : null;
      doses.push({ medication: med, scheduledTime: null, adherenceToday: latestEvent });
    } else if (timings.length > 0) {
      // One dose per scheduled time
      for (const time of timings) {
        const matchingEvent = todayEvents.find((e) => e.scheduled_time?.includes(time));
        doses.push({
          medication: med,
          scheduledTime: time,
          adherenceToday: matchingEvent?.event_type ?? null,
        });
      }
    } else {
      // No timing — show as single dose
      const latestEvent = todayEvents.length > 0 ? todayEvents[0].event_type : null;
      doses.push({ medication: med, scheduledTime: null, adherenceToday: latestEvent });
    }
  }

  return { success: true, data: doses };
}

/**
 * Check refill status for all active medications in a profile.
 */
export async function checkRefillStatus(
  profileId: string,
): Promise<ServiceResult<RefillInfo[]>> {
  const medsResult = await fetchMedications(profileId);
  if (!medsResult.success) return medsResult as ServiceResult<RefillInfo[]>;

  const activeMeds = medsResult.data.filter((m) => m.status === 'active' && !m.prn_flag);
  const results: RefillInfo[] = [];

  for (const med of activeMeds) {
    const supply = med.supply;
    let status: RefillStatus = 'needs_info';
    let daysRemaining: number | null = null;

    if (supply?.last_fill_date && supply?.days_supply) {
      const fillDate = new Date(supply.last_fill_date);
      const runOutDate = new Date(fillDate);
      runOutDate.setDate(runOutDate.getDate() + supply.days_supply);
      daysRemaining = Math.ceil((runOutDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

      if (daysRemaining < 0) {
        status = 'overdue';
      } else if (daysRemaining <= 7) {
        status = 'due_soon';
      } else {
        status = 'ok';
      }
    }

    results.push({
      medicationId: med.id,
      drugName: med.drug_name,
      strength: med.strength,
      status,
      daysRemaining,
      lastFillDate: supply?.last_fill_date ?? null,
      daysSupply: supply?.days_supply ?? null,
      refillsRemaining: supply?.refills_remaining ?? null,
      pharmacyName: supply?.pharmacy_name ?? null,
      pharmacyPhone: supply?.pharmacy_phone ?? null,
      prescriberName: supply?.prescriber_name ?? null,
      prescriberPhone: supply?.prescriber_phone ?? null,
    });
  }

  return { success: true, data: results };
}
