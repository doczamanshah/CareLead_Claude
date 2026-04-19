/**
 * Closeout service — post-visit closeout flow.
 *
 * Pipeline:
 *   1. startCloseout(appointmentId)        — create/return draft closeout
 *   2. updateCloseout(closeoutId, data)    — save quick-capture answers
 *   3. processCloseoutSummary(...)         — turn the patient's free-text
 *      summary into proposed apt_outcomes via the extract-document Edge
 *      Function (note artifact -> intent items -> outcomes).
 *   4. processCloseoutDocument(...)        — run extraction on an uploaded
 *      after-visit document and translate the results into outcomes.
 *   5. updateOutcomeStatus(...)            — accept / edit / reject each
 *      proposed outcome.
 *   6. finalizeCloseout(closeoutId)        — commit accepted outcomes:
 *        • profile facts for medication / diagnosis / allergy changes
 *        • tasks for followup_action / order / instruction
 *        • appointment.status = 'completed', closeout.status = 'finalized'
 *        • generate visit summary text on demand from current state
 *
 * The visit summary is generated live from closeout + appointment + outcomes
 * + tasks (no dedicated storage column on apt_closeouts).
 */

import { supabase } from '@/lib/supabase';
import { createNoteArtifact } from '@/services/artifacts';
import { triggerExtraction, fetchIntentItems } from '@/services/extraction';
import { createTask } from '@/services/tasks';
import { getCategoryFromFieldKey } from '@/lib/utils/fieldLabels';
import { findExistingProfileFact, describeFactChanges, getIdentifyingFieldForCategory } from '@/services/profileFactUpsert';
import type {
  Appointment,
  Closeout,
  Outcome,
  OutcomeStatus,
  OutcomeType,
} from '@/lib/types/appointments';
import type { IntentItem } from '@/lib/types/intent-sheet';
import type { ProfileFactCategory } from '@/lib/types/profile';
import type { Task } from '@/lib/types/tasks';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

// ── Timeframe parsing helpers ──────────────────────────────────────────────

/**
 * Parse a natural-language timeframe string into a number of days.
 * Handles: "2 weeks", "1 month", "3 months", "follow up in 2 weeks", etc.
 */
function parseTimeframeToDays(timeframe: string): number | null {
  const lower = timeframe.toLowerCase().trim();

  // Match patterns like "2 weeks", "1 month", "3 days", "6 months"
  const match = lower.match(/(\d+)\s*(day|week|month|year)s?/);
  if (!match) return null;

  const num = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 'day':
      return num;
    case 'week':
      return num * 7;
    case 'month':
      return num * 30;
    case 'year':
      return num * 365;
    default:
      return null;
  }
}

function addDaysFromNow(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(17, 0, 0, 0);
  return date.toISOString();
}

/**
 * Try to extract a due date from an outcome's proposed value or fall back
 * to the closeout's followup_timeframe.
 */
function parseDueDateFromOutcome(
  outcome: Outcome,
  closeoutTimeframe: string | null,
): string | undefined {
  const value = (outcome.edited_value ?? outcome.proposed_value ?? {}) as Record<string, unknown>;

  // Check for explicit timeframe in the outcome value
  const timeframeStr =
    (value.timeframe as string) ||
    (value.follow_up_timeframe as string) ||
    (value.when as string) ||
    null;

  if (timeframeStr) {
    const days = parseTimeframeToDays(timeframeStr);
    if (days !== null) return addDaysFromNow(days);
  }

  // Check the outcome description for timeframe patterns
  const descDays = parseTimeframeToDays(outcome.description);
  if (descDays !== null) return addDaysFromNow(descDays);

  // Fall back to closeout-level timeframe
  if (closeoutTimeframe) {
    const days = parseTimeframeToDays(closeoutTimeframe);
    if (days !== null) return addDaysFromNow(days);
  }

  // Default: 2 weeks for follow-up actions, 1 week for others
  if (outcome.outcome_type === 'followup_action') {
    return addDaysFromNow(14);
  }

  return undefined;
}

export interface CloseoutWithOutcomes extends Closeout {
  outcomes: Outcome[];
}

export interface UpdateCloseoutParams {
  visit_happened?: boolean | null;
  quick_summary?: string | null;
  followup_timeframe?: string | null;
  attendees?: string | null;
  status?: Closeout['status'];
}

export interface FinalizeCloseoutSummary {
  closeout: Closeout;
  appointment: Appointment;
  factsCreated: number;
  tasksCreated: number;
  createdTaskIds: string[];
  visitSummaryText: string;
}

// ── Closeout CRUD ───────────────────────────────────────────────────────────

/**
 * Start (or return existing) draft closeout for an appointment. Idempotent —
 * if a closeout already exists for this appointment, returns it as-is.
 */
export async function startCloseout(
  appointmentId: string,
  userId: string,
): Promise<ServiceResult<Closeout>> {
  // Check for existing closeout (the most recent for this appointment)
  const { data: existing } = await supabase
    .from('apt_closeouts')
    .select('*')
    .eq('appointment_id', appointmentId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    return { success: true, data: existing as Closeout };
  }

  // Need profile_id from appointment
  const { data: appointment, error: aptError } = await supabase
    .from('apt_appointments')
    .select('profile_id')
    .eq('id', appointmentId)
    .single();

  if (aptError || !appointment) {
    return {
      success: false,
      error: aptError?.message ?? 'Appointment not found',
    };
  }

  const { data, error } = await supabase
    .from('apt_closeouts')
    .insert({
      appointment_id: appointmentId,
      profile_id: appointment.profile_id,
      status: 'draft',
    })
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  await supabase.from('audit_events').insert({
    profile_id: appointment.profile_id,
    actor_id: userId,
    event_type: 'appointment.closeout_started',
    metadata: {
      appointment_id: appointmentId,
      closeout_id: data.id,
    },
  });

  return { success: true, data: data as Closeout };
}

/**
 * Save quick-capture progress on the closeout (visit_happened, quick_summary,
 * followup_timeframe, attendees). Bumps status to 'needs_review' when the
 * patient indicates the visit happened.
 */
export async function updateCloseout(
  closeoutId: string,
  params: UpdateCloseoutParams,
): Promise<ServiceResult<Closeout>> {
  const { data, error } = await supabase
    .from('apt_closeouts')
    .update(params)
    .eq('id', closeoutId)
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data: data as Closeout };
}

export async function fetchCloseoutForAppointment(
  appointmentId: string,
): Promise<ServiceResult<Closeout | null>> {
  const { data, error } = await supabase
    .from('apt_closeouts')
    .select('*')
    .eq('appointment_id', appointmentId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data: (data as Closeout | null) ?? null };
}

export async function fetchCloseoutWithOutcomes(
  closeoutId: string,
): Promise<ServiceResult<CloseoutWithOutcomes>> {
  const { data: closeout, error: coError } = await supabase
    .from('apt_closeouts')
    .select('*')
    .eq('id', closeoutId)
    .single();

  if (coError || !closeout) {
    return { success: false, error: coError?.message ?? 'Closeout not found' };
  }

  const { data: outcomes, error: outError } = await supabase
    .from('apt_outcomes')
    .select('*')
    .eq('closeout_id', closeoutId)
    .order('created_at', { ascending: true });

  if (outError) {
    return { success: false, error: outError.message, code: outError.code };
  }

  return {
    success: true,
    data: {
      ...(closeout as Closeout),
      outcomes: (outcomes ?? []) as Outcome[],
    },
  };
}

// ── Outcome generation from AI extraction ───────────────────────────────────

/**
 * Map an extracted intent item to an apt_outcomes row.
 */
function intentItemToOutcomeRow(
  item: IntentItem,
  closeoutId: string,
  profileId: string,
): {
  closeout_id: string;
  profile_id: string;
  outcome_type: OutcomeType;
  description: string;
  proposed_value: Record<string, unknown>;
  confidence: number | null;
  status: 'proposed';
} | null {
  const category = getCategoryFromFieldKey(item.field_key);
  if (!category) return null;

  const value = (item.proposed_value ?? {}) as Record<string, unknown>;

  let outcomeType: OutcomeType;
  let description: string;

  switch (category) {
    case 'medication': {
      outcomeType = 'medication_change';
      const drugName =
        (value.drug_name as string) || (value.name as string) || 'medication';
      const dose = (value.dose as string) || (value.dosage as string) || '';
      const frequency = (value.frequency as string) || '';
      description = [drugName, dose, frequency].filter(Boolean).join(' ').trim();
      break;
    }
    case 'condition': {
      outcomeType = 'diagnosis_change';
      const name =
        (value.condition_name as string) ||
        (value.name as string) ||
        'new condition';
      const status = (value.status as string) || '';
      description = status ? `${name} (${status})` : name;
      break;
    }
    case 'allergy': {
      outcomeType = 'allergy_change';
      const substance = (value.substance as string) || 'allergen';
      const reaction = (value.reaction as string) || '';
      description = reaction ? `${substance} — ${reaction}` : substance;
      break;
    }
    case 'followup': {
      const action = (value.action as string) || '';
      const desc = (value.description as string) || '';
      const timeframe = (value.timeframe as string) || '';
      const provider = (value.provider as string) || '';

      if (action.includes('lab') || action.includes('imaging')) {
        outcomeType = 'order';
        description = desc || `Complete ${action}`;
        if (timeframe) description += ` (${timeframe})`;
      } else {
        outcomeType = 'followup_action';
        if (provider && timeframe) {
          description = `Follow up with ${provider} in ${timeframe}`;
        } else if (timeframe) {
          description = desc || `Follow up in ${timeframe}`;
        } else {
          description = desc || 'Schedule follow-up appointment';
        }
      }
      break;
    }
    default: {
      outcomeType = 'instruction';
      // Best-effort flat description
      description =
        (value.text as string) ||
        (value.description as string) ||
        (value.name as string) ||
        Object.values(value).filter(Boolean).join(' ').trim() ||
        category;
      break;
    }
  }

  return {
    closeout_id: closeoutId,
    profile_id: profileId,
    outcome_type: outcomeType,
    description,
    proposed_value: value,
    confidence: item.confidence,
    status: 'proposed',
  };
}

async function insertOutcomesFromIntentSheet(
  intentSheetId: string,
  closeoutId: string,
  profileId: string,
): Promise<number> {
  if (!intentSheetId) return 0;

  const itemsResult = await fetchIntentItems(intentSheetId);
  if (!itemsResult.success) return 0;

  const rows = itemsResult.data
    .filter((item) => item.item_type !== 'task' && item.item_type !== 'reminder')
    .map((item) => intentItemToOutcomeRow(item, closeoutId, profileId))
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (rows.length === 0) return 0;

  const { error } = await supabase.from('apt_outcomes').insert(rows);
  if (error) return 0;

  return rows.length;
}

/**
 * Run the patient's free-text quick summary through AI extraction. Creates a
 * note artifact, invokes the extract-document Edge Function, then translates
 * the resulting intent items into proposed apt_outcomes attached to this
 * closeout.
 *
 * Returns the number of outcomes created. Zero is fine — the wizard will
 * skip the review step.
 */
export async function processCloseoutSummary(
  closeoutId: string,
  summaryText: string,
  profileId: string,
  userId: string,
): Promise<ServiceResult<{ outcomesCreated: number }>> {
  const trimmed = summaryText.trim();
  if (trimmed.length === 0) {
    return { success: true, data: { outcomesCreated: 0 } };
  }

  // 1. Note artifact carrying the summary text
  const artifactResult = await createNoteArtifact({
    profileId,
    title: `Visit closeout summary — ${new Date().toISOString().slice(0, 10)}`,
    text: trimmed,
    sourceChannel: 'voice',
  });
  if (!artifactResult.success) {
    return { success: false, error: artifactResult.error };
  }

  // 2. Trigger extraction
  const extractionResult = await triggerExtraction({
    artifactId: artifactResult.data.id,
    profileId,
  });
  if (!extractionResult.success) {
    return { success: false, error: extractionResult.error };
  }

  // 3. Translate intent items into outcomes
  const outcomesCreated = await insertOutcomesFromIntentSheet(
    extractionResult.data.intentSheetId,
    closeoutId,
    profileId,
  );

  // 4. Mark the underlying intent sheet as dismissed so it doesn't show up
  // in the patient's pending Intent Sheet review queue — closeout has its
  // own review step.
  if (extractionResult.data.intentSheetId) {
    await supabase
      .from('intent_sheets')
      .update({ status: 'dismissed' })
      .eq('id', extractionResult.data.intentSheetId);
  }

  await supabase.from('audit_events').insert({
    profile_id: profileId,
    actor_id: userId,
    event_type: 'appointment.closeout_summary_processed',
    metadata: {
      closeout_id: closeoutId,
      artifact_id: artifactResult.data.id,
      outcomes_created: outcomesCreated,
    },
  });

  return { success: true, data: { outcomesCreated } };
}

/**
 * Run AI extraction on a document the patient uploaded during closeout
 * (e.g., an after-visit summary). Translates the extracted intent items
 * into proposed outcomes attached to this closeout.
 */
export async function processCloseoutDocument(
  closeoutId: string,
  artifactId: string,
  profileId: string,
  userId: string,
): Promise<ServiceResult<{ outcomesCreated: number }>> {
  const extractionResult = await triggerExtraction({ artifactId, profileId });
  if (!extractionResult.success) {
    return { success: false, error: extractionResult.error };
  }

  const outcomesCreated = await insertOutcomesFromIntentSheet(
    extractionResult.data.intentSheetId,
    closeoutId,
    profileId,
  );

  if (extractionResult.data.intentSheetId) {
    await supabase
      .from('intent_sheets')
      .update({ status: 'dismissed' })
      .eq('id', extractionResult.data.intentSheetId);
  }

  await supabase.from('audit_events').insert({
    profile_id: profileId,
    actor_id: userId,
    event_type: 'appointment.closeout_document_processed',
    metadata: {
      closeout_id: closeoutId,
      artifact_id: artifactId,
      outcomes_created: outcomesCreated,
    },
  });

  return { success: true, data: { outcomesCreated } };
}

// ── Outcome review ──────────────────────────────────────────────────────────

export async function updateOutcomeStatus(
  outcomeId: string,
  status: OutcomeStatus,
  editedValue?: Record<string, unknown>,
): Promise<ServiceResult<Outcome>> {
  const updateData: Record<string, unknown> = { status };
  if (status === 'edited' && editedValue) {
    updateData.edited_value = editedValue;
  }

  const { data, error } = await supabase
    .from('apt_outcomes')
    .update(updateData)
    .eq('id', outcomeId)
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data: data as Outcome };
}

// ── Finalize ────────────────────────────────────────────────────────────────

const OUTCOME_TO_FACT_CATEGORY: Partial<Record<OutcomeType, ProfileFactCategory>> = {
  medication_change: 'medication',
  diagnosis_change: 'condition',
  allergy_change: 'allergy',
};

const OUTCOME_TO_FIELD_KEY: Partial<Record<OutcomeType, string>> = {
  medication_change: 'medication.entry',
  diagnosis_change: 'condition.entry',
  allergy_change: 'allergy.entry',
};

function outcomeFinalValue(o: Outcome): Record<string, unknown> {
  return (o.edited_value ?? o.proposed_value ?? {}) as Record<string, unknown>;
}

/**
 * Commit all accepted/edited outcomes:
 *   - profile facts for medication / diagnosis / allergy changes
 *   - tasks for followup_action / order / instruction
 *   - mark appointment status='completed'
 *   - mark closeout status='finalized'
 *   - generate visit summary text from current state
 */
export async function finalizeCloseout(
  closeoutId: string,
  userId: string,
): Promise<ServiceResult<FinalizeCloseoutSummary>> {
  const closeoutResult = await fetchCloseoutWithOutcomes(closeoutId);
  if (!closeoutResult.success) return closeoutResult;
  const closeout = closeoutResult.data;

  const { data: appointmentRow, error: aptError } = await supabase
    .from('apt_appointments')
    .select('*')
    .eq('id', closeout.appointment_id)
    .single();

  if (aptError || !appointmentRow) {
    return { success: false, error: aptError?.message ?? 'Appointment not found' };
  }

  const appointment = appointmentRow as Appointment;
  const acceptedOutcomes = closeout.outcomes.filter(
    (o) => o.status === 'accepted' || o.status === 'edited',
  );

  let factsCreated = 0;
  let tasksCreated = 0;
  let followupTaskCreated = false;
  const createdTaskIds: string[] = [];
  const now = new Date().toISOString();

  for (const outcome of acceptedOutcomes) {
    const factCategory = OUTCOME_TO_FACT_CATEGORY[outcome.outcome_type];
    const finalValue = outcomeFinalValue(outcome);

    if (factCategory) {
      // Check for existing fact with the same identifier before creating
      const existingFact = await findExistingProfileFact(
        closeout.profile_id,
        factCategory,
        finalValue,
      );

      if (existingFact) {
        // UPDATE existing fact — merge new values into existing
        const mergedValue = { ...existingFact.value_json, ...finalValue };
        const { error: updateError } = await supabase
          .from('profile_facts')
          .update({
            value_json: mergedValue,
            source_type: 'document',
            source_ref: closeout.appointment_id,
            verification_status: 'verified',
            verified_at: now,
            verified_by: userId,
            actor_id: userId,
            updated_at: now,
          })
          .eq('id', existingFact.id);

        if (!updateError) {
          factsCreated++;
          const identifyingField = getIdentifyingFieldForCategory(factCategory);
          const identifierName =
            identifyingField && finalValue[identifyingField]
              ? String(finalValue[identifyingField])
              : factCategory;

          await supabase.from('audit_events').insert({
            profile_id: closeout.profile_id,
            actor_id: userId,
            event_type: 'profile_fact.updated',
            metadata: {
              profile_fact_id: existingFact.id,
              category: factCategory,
              source: 'closeout_finalize',
              closeout_id: closeoutId,
              outcome_id: outcome.id,
              change_description: describeFactChanges(
                identifierName,
                existingFact.value_json,
                finalValue,
              ),
            },
          });
        }
      } else {
        // INSERT new fact
        const { data: factData, error: factError } = await supabase
          .from('profile_facts')
          .insert({
            profile_id: closeout.profile_id,
            category: factCategory,
            field_key:
              OUTCOME_TO_FIELD_KEY[outcome.outcome_type] ?? `${factCategory}.entry`,
            value_json: finalValue,
            source_type: 'document',
            source_ref: closeout.appointment_id,
            verification_status: 'verified',
            verified_at: now,
            verified_by: userId,
            actor_id: userId,
          })
          .select('id')
          .single();

        if (!factError && factData) {
          factsCreated++;
          await supabase.from('audit_events').insert({
            profile_id: closeout.profile_id,
            actor_id: userId,
            event_type: 'profile_fact.created',
            metadata: {
              profile_fact_id: factData.id,
              category: factCategory,
              source: 'closeout_finalize',
              closeout_id: closeoutId,
              outcome_id: outcome.id,
            },
          });
        }
      }
    } else {
      // Tasks for followup_action / order / instruction
      const isFollowup = outcome.outcome_type === 'followup_action';
      const isOrder = outcome.outcome_type === 'order';

      let title: string;
      if (isFollowup) {
        // If description doesn't already say "Schedule", add provider context
        const desc = outcome.description;
        title = desc.toLowerCase().startsWith('schedule')
          ? desc
          : `Schedule follow-up: ${desc}`;
      } else if (isOrder) {
        title = `Complete: ${outcome.description}`;
      } else {
        title = outcome.description;
      }

      // Calculate due date from the outcome's proposed value or closeout timeframe
      const dueDate = parseDueDateFromOutcome(outcome, closeout.followup_timeframe);

      const taskResult = await createTask(
        {
          profile_id: closeout.profile_id,
          title,
          description: `From your visit on ${new Date(
            appointment.start_time,
          ).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.`,
          priority: isFollowup || isOrder ? 'high' : 'medium',
          due_date: dueDate,
          source_type: 'appointment',
          source_ref: closeout.appointment_id,
          trigger_type: 'extraction',
          trigger_source: `Visit closeout — ${appointment.title}`,
        },
        userId,
      );
      if (taskResult.success) {
        tasksCreated++;
        createdTaskIds.push(taskResult.data.id);
        if (isFollowup) followupTaskCreated = true;
      }
    }
  }

  // If the closeout has a followup_timeframe but no follow-up task was created
  // from outcomes, create one from the timeframe field
  if (closeout.followup_timeframe && !followupTaskCreated) {
    const timeframeDays = parseTimeframeToDays(closeout.followup_timeframe);
    const dueDate = addDaysFromNow(timeframeDays ?? 14); // default 2 weeks

    const providerName = appointment.provider_name ?? 'your doctor';
    const taskResult = await createTask(
      {
        profile_id: closeout.profile_id,
        title: `Schedule follow-up with ${providerName}`,
        description: `${closeout.followup_timeframe}. From your visit on ${new Date(
          appointment.start_time,
        ).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.`,
        priority: 'high',
        due_date: dueDate,
        source_type: 'appointment',
        source_ref: closeout.appointment_id,
        trigger_type: 'extraction',
        trigger_source: `Visit closeout — ${appointment.title}`,
      },
      userId,
    );
    if (taskResult.success) {
      tasksCreated++;
      createdTaskIds.push(taskResult.data.id);
    }
  }

  // Mark closeout finalized
  const { data: finalizedRow, error: coError } = await supabase
    .from('apt_closeouts')
    .update({ status: 'finalized' })
    .eq('id', closeoutId)
    .select()
    .single();

  if (coError) {
    return { success: false, error: coError.message, code: coError.code };
  }

  // Mark appointment completed AND flip the post-visit captured flag so the
  // structured-capture briefing stops nagging the user. Both flows share
  // this single source of truth.
  const { data: completedAptRow, error: aptUpdateError } = await supabase
    .from('apt_appointments')
    .update({ status: 'completed', post_visit_captured: true })
    .eq('id', appointment.id)
    .select()
    .single();

  if (aptUpdateError) {
    return { success: false, error: aptUpdateError.message, code: aptUpdateError.code };
  }

  const completedAppointment = completedAptRow as Appointment;
  const finalizedCloseout = finalizedRow as Closeout;

  // Generate visit summary text from the current state
  const visitSummaryText = await generateVisitSummary(closeoutId);

  await supabase.from('audit_events').insert({
    profile_id: closeout.profile_id,
    actor_id: userId,
    event_type: 'appointment.closeout_finalized',
    metadata: {
      closeout_id: closeoutId,
      appointment_id: appointment.id,
      facts_created: factsCreated,
      tasks_created: tasksCreated,
      outcomes_committed: acceptedOutcomes.length,
    },
  });

  return {
    success: true,
    data: {
      closeout: finalizedCloseout,
      appointment: completedAppointment,
      factsCreated,
      tasksCreated,
      createdTaskIds,
      visitSummaryText,
    },
  };
}

// ── Visit summary text ──────────────────────────────────────────────────────

function formatVisitDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function describeOutcome(o: Outcome): string {
  const value = outcomeFinalValue(o);
  switch (o.outcome_type) {
    case 'medication_change': {
      const drug =
        (value.drug_name as string) || (value.name as string) || o.description;
      const dose = (value.dose as string) || (value.dosage as string) || '';
      const freq = (value.frequency as string) || '';
      return [drug, dose, freq].filter(Boolean).join(' ').trim();
    }
    case 'diagnosis_change': {
      const name =
        (value.condition_name as string) || (value.name as string) || o.description;
      const status = (value.status as string) || '';
      return status ? `${name} (${status})` : name;
    }
    case 'allergy_change': {
      const substance = (value.substance as string) || o.description;
      const reaction = (value.reaction as string) || '';
      return reaction ? `${substance} — ${reaction}` : substance;
    }
    default:
      return o.description;
  }
}

/**
 * Build a human-readable visit summary from closeout + appointment +
 * outcomes + tasks created from this closeout. Generated on demand from
 * current state — not stored.
 */
export async function generateVisitSummary(closeoutId: string): Promise<string> {
  const closeoutResult = await fetchCloseoutWithOutcomes(closeoutId);
  if (!closeoutResult.success) return '';
  const closeout = closeoutResult.data;

  const { data: appointmentRow } = await supabase
    .from('apt_appointments')
    .select('*')
    .eq('id', closeout.appointment_id)
    .single();

  if (!appointmentRow) return '';
  const appointment = appointmentRow as Appointment;

  // Tasks generated by closeout finalize use source_type='appointment',
  // source_ref=appointment_id and were created after closeout creation.
  const { data: taskRows } = await supabase
    .from('tasks')
    .select('*')
    .eq('profile_id', closeout.profile_id)
    .eq('source_type', 'appointment')
    .eq('source_ref', closeout.appointment_id)
    .gte('created_at', closeout.created_at)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });

  const tasks = (taskRows ?? []) as Task[];

  const accepted = closeout.outcomes.filter(
    (o) => o.status === 'accepted' || o.status === 'edited',
  );
  const meds = accepted.filter((o) => o.outcome_type === 'medication_change');
  const diagnoses = accepted.filter((o) => o.outcome_type === 'diagnosis_change');
  const allergies = accepted.filter((o) => o.outcome_type === 'allergy_change');
  const followups = accepted.filter(
    (o) =>
      o.outcome_type === 'followup_action' ||
      o.outcome_type === 'order' ||
      o.outcome_type === 'instruction',
  );

  const lines: string[] = [];
  lines.push(`Visit Summary — ${appointment.title}`);
  lines.push('');
  lines.push(`Date: ${formatVisitDate(appointment.start_time)}`);
  if (appointment.provider_name) lines.push(`Provider: ${appointment.provider_name}`);
  if (appointment.facility_name) lines.push(`Facility: ${appointment.facility_name}`);
  if (appointment.purpose) lines.push(`Purpose: ${appointment.purpose}`);
  if (closeout.attendees) lines.push(`Attended by: ${closeout.attendees}`);
  lines.push('');

  if (closeout.quick_summary) {
    lines.push('What happened');
    lines.push(closeout.quick_summary.trim());
    lines.push('');
  }

  if (meds.length > 0) {
    lines.push('Medication changes');
    meds.forEach((m) => lines.push(`  • ${describeOutcome(m)}`));
    lines.push('');
  }

  if (diagnoses.length > 0) {
    lines.push('Diagnosis changes');
    diagnoses.forEach((d) => lines.push(`  • ${describeOutcome(d)}`));
    lines.push('');
  }

  if (allergies.length > 0) {
    lines.push('Allergy updates');
    allergies.forEach((a) => lines.push(`  • ${describeOutcome(a)}`));
    lines.push('');
  }

  if (followups.length > 0 || closeout.followup_timeframe) {
    lines.push('Follow-up plan');
    if (closeout.followup_timeframe) {
      lines.push(`  • ${closeout.followup_timeframe}`);
    }
    followups.forEach((f) => lines.push(`  • ${describeOutcome(f)}`));
    lines.push('');
  }

  if (tasks.length > 0) {
    lines.push('Tasks created');
    tasks.forEach((t) => lines.push(`  • ${t.title}`));
    lines.push('');
  }

  lines.push('— Generated by CareLead');

  return lines.join('\n');
}
