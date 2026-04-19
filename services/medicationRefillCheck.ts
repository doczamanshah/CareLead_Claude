/**
 * Medication refill change-detection service.
 *
 * After a user marks a medication as refilled, we briefly ask "Did anything
 * change?" so dose adjustments, pharmacy switches, and discontinuations
 * captured at the pharmacy counter don't slip through the cracks between
 * doctor visits.
 *
 * Two responsibilities live here:
 *
 * 1. Cooldown tracking — `last_change_check_at` is stored per-medication in
 *    SecureStore (device-local, no schema change needed) so users on weekly
 *    refills aren't asked the same question every 7 days. The 30-day
 *    cooldown only blocks the *prompt* — explicit edits via the detail
 *    screen always go through.
 *
 * 2. Change application — typed wrappers over the existing medication
 *    services that stamp `source: 'refill_check'` provenance on every
 *    audit event. The wrappers exist so screens don't have to remember
 *    to log audit events for each branch of the change-detection sheet.
 */

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';
import {
  createMedication,
  updateMedicationStatus,
  updateSig,
  updateSupply,
} from '@/services/medications';
import type {
  CreateMedicationParams,
  Medication,
  MedicationFrequency,
  MedicationSig,
  MedicationSupply,
} from '@/lib/types/medications';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

// ── Cooldown (SecureStore) ────────────────────────────────────────────────

/** Minimum gap between change-detection prompts for the same medication. */
const CHANGE_CHECK_COOLDOWN_DAYS = 30;

function cooldownKey(medicationId: string): string {
  return `med_change_check.${medicationId}`;
}

function readChangeCheckAt(medicationId: string): number | null {
  try {
    const key = cooldownKey(medicationId);
    const raw =
      Platform.OS === 'web'
        ? typeof localStorage !== 'undefined'
          ? localStorage.getItem(key)
          : null
        : SecureStore.getItem(key);
    if (!raw) return null;
    const ms = Number.parseInt(raw, 10);
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

function writeChangeCheckAt(medicationId: string, ts: number): void {
  try {
    const key = cooldownKey(medicationId);
    const value = String(ts);
    if (Platform.OS === 'web') {
      if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
      return;
    }
    SecureStore.setItem(key, value);
  } catch {
    // Cooldown is best-effort — write failure means we may re-prompt sooner,
    // which is the safer direction (we'd rather over-ask than miss changes).
  }
}

/** True if enough time has passed (or it's never been asked) to prompt again. */
export function shouldPromptChangeCheck(medicationId: string): boolean {
  const last = readChangeCheckAt(medicationId);
  if (last === null) return true;
  const ageMs = Date.now() - last;
  return ageMs >= CHANGE_CHECK_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
}

// ── Mark refilled ─────────────────────────────────────────────────────────

/**
 * Record that the user picked up a refill — bumps `last_fill_date` to today
 * and decrements `refills_remaining` (clamped at zero) on the supply row.
 * Idempotent at the column level (subsequent calls just bump the date again).
 */
export async function markMedicationRefilled(
  medicationId: string,
  userId: string,
): Promise<ServiceResult<MedicationSupply>> {
  // We need the current refills_remaining to decrement.
  const { data: existing } = await supabase
    .from('med_medication_supply')
    .select('refills_remaining')
    .eq('medication_id', medicationId)
    .limit(1)
    .maybeSingle();

  const today = new Date().toISOString().slice(0, 10);
  const nextRefills =
    existing?.refills_remaining != null
      ? Math.max(0, Number(existing.refills_remaining) - 1)
      : null;

  const result = await updateSupply(
    medicationId,
    {
      last_fill_date: today,
      ...(nextRefills !== null ? { refills_remaining: nextRefills } : {}),
    },
    userId,
  );
  if (!result.success) return result;

  // Audit — separate from the supply update so it carries refill provenance.
  await supabase.from('audit_events').insert({
    profile_id: result.data.profile_id,
    actor_id: userId,
    event_type: 'medication.refilled',
    metadata: {
      medication_id: medicationId,
      last_fill_date: today,
      refills_remaining: nextRefills,
      source: 'refill_check',
    },
  });

  return { success: true, data: result.data };
}

// ── Stop / switch medication ──────────────────────────────────────────────

/**
 * Stop a medication. Optional reason is stored in metadata (not the medication
 * row — there's no `stop_reason` column today and adding one isn't worth a
 * migration just for this).
 */
export async function stopMedication(
  medicationId: string,
  reason: string | undefined,
  userId: string,
  source: 'refill_check' | 'manual' = 'manual',
): Promise<ServiceResult<Medication>> {
  const result = await updateMedicationStatus(medicationId, 'stopped', userId);
  if (!result.success) return result;

  if (reason || source !== 'manual') {
    await supabase.from('audit_events').insert({
      profile_id: result.data.profile_id,
      actor_id: userId,
      event_type: 'medication.stop_reason',
      metadata: {
        medication_id: medicationId,
        reason: reason ?? null,
        source,
      },
    });
  }

  return result;
}

/**
 * Switch one medication for another at the pharmacy/refill counter:
 * stop the old, create the new with the same provenance, link them via
 * audit metadata so reports can trace the substitution.
 */
export async function switchMedication(
  oldMedicationId: string,
  newMedParams: {
    drug_name: string;
    dose_text?: string;
    frequency?: MedicationFrequency;
    frequency_text?: string;
  },
  profileId: string,
  userId: string,
): Promise<ServiceResult<{ stopped: Medication; created: Medication }>> {
  const stopResult = await stopMedication(
    oldMedicationId,
    `Switched to ${newMedParams.drug_name}`,
    userId,
    'refill_check',
  );
  if (!stopResult.success) return stopResult;

  const createParams: CreateMedicationParams = {
    profile_id: profileId,
    drug_name: newMedParams.drug_name,
    dose_text: newMedParams.dose_text,
    frequency_text: newMedParams.frequency_text ?? frequencyTextFor(newMedParams.frequency),
    prn_flag: newMedParams.frequency === 'as_needed',
  };
  const createResult = await createMedication(createParams, userId);
  if (!createResult.success) return createResult;

  // Stamp the new med with refill_check provenance + reverse link.
  await supabase
    .from('med_medications')
    .update({ source_type: 'refill_check', source_ref: oldMedicationId })
    .eq('id', createResult.data.id);

  await supabase.from('audit_events').insert({
    profile_id: profileId,
    actor_id: userId,
    event_type: 'medication.switched',
    metadata: {
      old_medication_id: oldMedicationId,
      new_medication_id: createResult.data.id,
      new_drug_name: newMedParams.drug_name,
      source: 'refill_check',
    },
  });

  return {
    success: true,
    data: { stopped: stopResult.data, created: createResult.data },
  };
}

function frequencyTextFor(freq: MedicationFrequency | undefined): string | undefined {
  if (!freq) return undefined;
  switch (freq) {
    case 'once_daily':
      return 'once daily';
    case 'twice_daily':
      return 'twice daily';
    case 'three_times_daily':
      return 'three times daily';
    case 'four_times_daily':
      return 'four times daily';
    case 'every_morning':
      return 'every morning';
    case 'every_evening':
      return 'every evening';
    case 'at_bedtime':
      return 'at bedtime';
    case 'as_needed':
      return 'as needed';
    case 'other':
      return undefined;
  }
}

// ── Change-check responses ────────────────────────────────────────────────

export type RefillChangeType =
  | 'no_change'
  | 'dose_change'
  | 'pharmacy_change'
  | 'switched'
  | 'added'
  | 'stopped'
  | 'other';

export interface RefillChangeDetails {
  /** New dose text — required when changeType is 'dose_change'. */
  newDose?: string;
  newFrequencyText?: string;
  /** New pharmacy name — required when changeType is 'pharmacy_change'. */
  newPharmacyName?: string;
  newPharmacyPhone?: string;
  /** For 'switched' / 'added'. */
  newMedication?: {
    drug_name: string;
    dose_text?: string;
    frequency?: MedicationFrequency;
    frequency_text?: string;
  };
  /** For 'stopped'. */
  stopReason?: string;
  /** For 'other' / freeform note. */
  note?: string;
}

export interface RefillChangeCheckResult {
  changeType: RefillChangeType;
  /** Domain side-effects that were applied (or empty for no_change/note). */
  applied: {
    sigUpdated?: MedicationSig | null;
    supplyUpdated?: MedicationSupply | null;
    medicationStopped?: Medication | null;
    medicationCreated?: Medication | null;
  };
}

/**
 * Apply the user's response to the change-detection prompt and bump the
 * cooldown timestamp. Always returns success when the user picked
 * `no_change` (no work to do); other branches return whatever the underlying
 * domain mutation produced.
 *
 * The cooldown is bumped whether or not changes were applied, so the user
 * isn't re-asked at the next refill within 30 days.
 */
export async function recordRefillChangeCheck(
  params: {
    medicationId: string;
    profileId: string;
    changeType: RefillChangeType;
    details?: RefillChangeDetails;
  },
  userId: string,
): Promise<ServiceResult<RefillChangeCheckResult>> {
  const { medicationId, profileId, changeType, details } = params;

  const result: RefillChangeCheckResult = { changeType, applied: {} };

  switch (changeType) {
    case 'no_change': {
      // Nothing to mutate — just record the check happened.
      break;
    }
    case 'dose_change': {
      if (!details?.newDose && !details?.newFrequencyText) {
        return { success: false, error: 'Dose change requires a new dose or frequency.' };
      }
      const sigResult = await updateSig(
        medicationId,
        {
          ...(details.newDose ? { dose_text: details.newDose.trim() } : {}),
          ...(details.newFrequencyText
            ? { frequency_text: details.newFrequencyText.trim() }
            : {}),
        },
        userId,
      );
      if (!sigResult.success) return sigResult;
      result.applied.sigUpdated = sigResult.data;
      await logChangeAudit(profileId, userId, medicationId, 'dose_change', {
        new_dose: details.newDose ?? null,
        new_frequency: details.newFrequencyText ?? null,
      });
      break;
    }
    case 'pharmacy_change': {
      const name = details?.newPharmacyName?.trim();
      if (!name) {
        return { success: false, error: 'Pharmacy change requires a pharmacy name.' };
      }
      const supplyResult = await updateSupply(
        medicationId,
        {
          pharmacy_name: name,
          pharmacy_phone: details?.newPharmacyPhone?.trim() || null,
        },
        userId,
      );
      if (!supplyResult.success) return supplyResult;
      result.applied.supplyUpdated = supplyResult.data;
      await logChangeAudit(profileId, userId, medicationId, 'pharmacy_change', {
        new_pharmacy_name: name,
      });
      break;
    }
    case 'switched': {
      if (!details?.newMedication?.drug_name) {
        return { success: false, error: 'Switch requires a new medication name.' };
      }
      const switchResult = await switchMedication(
        medicationId,
        details.newMedication,
        profileId,
        userId,
      );
      if (!switchResult.success) return switchResult;
      result.applied.medicationStopped = switchResult.data.stopped;
      result.applied.medicationCreated = switchResult.data.created;
      break;
    }
    case 'added': {
      if (!details?.newMedication?.drug_name) {
        return { success: false, error: 'Add requires a new medication name.' };
      }
      const newParams: CreateMedicationParams = {
        profile_id: profileId,
        drug_name: details.newMedication.drug_name,
        dose_text: details.newMedication.dose_text,
        frequency_text:
          details.newMedication.frequency_text ??
          frequencyTextFor(details.newMedication.frequency),
        prn_flag: details.newMedication.frequency === 'as_needed',
      };
      const createResult = await createMedication(newParams, userId);
      if (!createResult.success) return createResult;
      // Tag the new med with refill_check provenance + reverse-link.
      await supabase
        .from('med_medications')
        .update({ source_type: 'refill_check', source_ref: medicationId })
        .eq('id', createResult.data.id);
      result.applied.medicationCreated = createResult.data;
      await logChangeAudit(profileId, userId, medicationId, 'added', {
        new_medication_id: createResult.data.id,
        new_drug_name: newParams.drug_name,
      });
      break;
    }
    case 'stopped': {
      const stopResult = await stopMedication(
        medicationId,
        details?.stopReason,
        userId,
        'refill_check',
      );
      if (!stopResult.success) return stopResult;
      result.applied.medicationStopped = stopResult.data;
      break;
    }
    case 'other': {
      // Save freeform note onto the medication row's notes field, append-style.
      if (details?.note?.trim()) {
        const note = details.note.trim();
        const stamp = new Date().toISOString().slice(0, 10);
        const { data: med } = await supabase
          .from('med_medications')
          .select('notes')
          .eq('id', medicationId)
          .single();
        const existingNotes = (med?.notes as string | null) ?? '';
        const merged = existingNotes
          ? `${existingNotes}\n\n[${stamp} refill] ${note}`
          : `[${stamp} refill] ${note}`;
        await supabase
          .from('med_medications')
          .update({ notes: merged })
          .eq('id', medicationId);
        await logChangeAudit(profileId, userId, medicationId, 'other', {
          note_length: note.length,
        });
      }
      break;
    }
  }

  // Bump cooldown regardless — we asked, they answered, don't ask again
  // for 30 days.
  writeChangeCheckAt(medicationId, Date.now());

  // Always log a check-completed event so the audit trail records that the
  // user was asked and responded (even on no_change).
  await supabase.from('audit_events').insert({
    profile_id: profileId,
    actor_id: userId,
    event_type: 'medication.refill_change_check',
    metadata: {
      medication_id: medicationId,
      change_type: changeType,
      source: 'refill_check',
    },
  });

  return { success: true, data: result };
}

async function logChangeAudit(
  profileId: string,
  userId: string,
  medicationId: string,
  changeType: RefillChangeType,
  detail: Record<string, unknown>,
): Promise<void> {
  await supabase.from('audit_events').insert({
    profile_id: profileId,
    actor_id: userId,
    event_type: `medication.${changeType}`,
    metadata: {
      medication_id: medicationId,
      source: 'refill_check',
      ...detail,
    },
  });
}

// ── Skip-reason logging ───────────────────────────────────────────────────

export type SkipReason =
  | 'forgot'
  | 'ran_out'
  | 'doctor_stop'
  | 'side_effects'
  | 'other';

/**
 * Annotate the most recent skip event with a structured reason. Lightweight
 * — fired from the optional skip-reason sheet after the skip itself is
 * already logged. Failure to find a recent skip is a no-op (the user may
 * have changed their mind to "Take" before the sheet rendered).
 */
export async function logSkipReason(
  medicationId: string,
  reason: SkipReason,
  userId: string,
  freeformNote?: string,
): Promise<ServiceResult<void>> {
  // Find the latest skip event today and patch its notes.
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { data: latestSkip } = await supabase
    .from('med_adherence_events')
    .select('id, profile_id, notes')
    .eq('medication_id', medicationId)
    .eq('event_type', 'skipped')
    .gte('recorded_at', todayStart.toISOString())
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestSkip) {
    const noteSuffix = freeformNote?.trim() ? ` — ${freeformNote.trim()}` : '';
    await supabase
      .from('med_adherence_events')
      .update({ notes: `[reason: ${reason}]${noteSuffix}` })
      .eq('id', latestSkip.id);

    await supabase.from('audit_events').insert({
      profile_id: latestSkip.profile_id,
      actor_id: userId,
      event_type: 'medication.skip_reason',
      metadata: {
        medication_id: medicationId,
        reason,
        adherence_event_id: latestSkip.id,
      },
    });
  }

  return { success: true, data: undefined };
}
