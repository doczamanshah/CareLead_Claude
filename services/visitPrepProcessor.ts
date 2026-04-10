/**
 * Visit Prep processor — turns the patient's free-text input into a
 * structured VisitPrep by gathering profile context and calling the
 * `process-visit-prep` Edge Function.
 *
 * This is the entry point for the Patient-Voice-First flow. The patient's
 * own words are extracted as questions/concerns first; AI suggestions
 * (based on profile context) are added separately and clearly marked.
 */

import { supabase } from '@/lib/supabase';
import type {
  Appointment,
  VisitPrep,
  VisitPrepConcern,
  VisitPrepDriver,
  VisitPrepLogistics,
  VisitPrepQuestion,
  VisitPrepRefill,
} from '@/lib/types/appointments';
import type { ProfileFact } from '@/lib/types/profile';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

interface AIProcessedPrep {
  questions_and_concerns: Array<{ text: string; source: 'patient' }>;
  logistics: {
    notes: string[];
    needs_driver: boolean;
    special_needs: string[];
  };
  refills_needed: Array<{ medication: string; reason?: string }>;
  ai_suggestions: Array<{ text: string; source: 'ai_suggested'; reason: string }>;
}

const DEPART_BUFFER_MINUTES = 30;

function makeQuestionId(prefix: string, index: number): string {
  return `${prefix}-${Date.now()}-${index}`;
}

/**
 * Strip the heavy fields off profile facts so we don't ship a giant payload
 * to the Edge Function. Cap at 50 facts to keep prompt size sane.
 */
function summarizeFactsForAI(facts: ProfileFact[]) {
  return facts.slice(0, 50).map((f) => ({
    category: f.category,
    value: f.value_json,
  }));
}

function buildLogistics(
  appointment: Pick<Appointment, 'start_time'>,
  ai: AIProcessedPrep,
  existing?: VisitPrepLogistics,
): VisitPrepLogistics {
  const departBy =
    existing?.depart_by ?? buildDepartBy(appointment.start_time);

  const what_to_bring =
    existing?.what_to_bring && existing.what_to_bring.length > 0
      ? existing.what_to_bring
      : Array.from(new Set(ai.logistics?.notes ?? []));

  return {
    depart_by: departBy,
    driver: existing?.driver ?? null,
    what_to_bring,
  };
}

function buildDepartBy(startTime: string): string | null {
  const start = new Date(startTime);
  if (Number.isNaN(start.getTime())) return null;
  start.setMinutes(start.getMinutes() - DEPART_BUFFER_MINUTES);
  return start.toISOString();
}

/**
 * Call the process-visit-prep Edge Function with the raw patient input
 * plus profile context, and assemble the result into a VisitPrep object.
 */
async function callProcessor(
  patientInput: string,
  profileId: string,
  appointment: Appointment,
): Promise<ServiceResult<AIProcessedPrep>> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('id', profileId)
    .single();

  const { data: facts, error: factsError } = await supabase
    .from('profile_facts')
    .select('*')
    .eq('profile_id', profileId)
    .is('deleted_at', null);

  if (factsError) {
    return { success: false, error: factsError.message, code: factsError.code };
  }

  const { data, error } = await supabase.functions.invoke(
    'process-visit-prep',
    {
      body: {
        patientInput,
        profileContext: {
          display_name: profile?.display_name ?? null,
          facts: summarizeFactsForAI((facts ?? []) as ProfileFact[]),
        },
        appointmentDetails: {
          title: appointment.title,
          appointment_type: appointment.appointment_type,
          provider_name: appointment.provider_name,
          start_time: appointment.start_time,
          purpose: appointment.purpose,
        },
      },
    },
  );

  if (error) {
    return { success: false, error: error.message ?? 'Processing failed' };
  }

  return { success: true, data: data as AIProcessedPrep };
}

/**
 * Build a fresh VisitPrep from a single round of patient input.
 *
 * Patient questions land first (source: 'patient'), AI suggestions follow
 * (source: 'ai_suggested', ai_suggested: true) so the UI can render them
 * differently.
 */
export async function processVisitPrepInput(
  appointmentId: string,
  patientInput: string,
  profileId: string,
): Promise<ServiceResult<VisitPrep>> {
  const { data: appointment, error: aptError } = await supabase
    .from('apt_appointments')
    .select('*')
    .eq('id', appointmentId)
    .single();

  if (aptError || !appointment) {
    return {
      success: false,
      error: aptError?.message ?? 'Appointment not found',
    };
  }

  const aiResult = await callProcessor(
    patientInput,
    profileId,
    appointment as Appointment,
  );
  if (!aiResult.success) return aiResult;

  const ai = aiResult.data;
  let priority = 1;

  const patientQuestions: VisitPrepQuestion[] = (
    ai.questions_and_concerns ?? []
  ).map((q, i) => ({
    id: makeQuestionId('p', i),
    text: q.text,
    source: 'patient' as const,
    priority: priority++,
  }));

  const aiQuestions: VisitPrepQuestion[] = (ai.ai_suggestions ?? []).map(
    (s, i) => ({
      id: makeQuestionId('ai', i),
      text: s.text,
      source: 'ai_suggested' as const,
      priority: priority++,
      ai_suggested: true,
    }),
  );

  const refills: VisitPrepRefill[] = (ai.refills_needed ?? []).map((r) => ({
    medication: r.medication,
    reason: r.reason ?? 'Mentioned by patient',
  }));

  const concerns: VisitPrepConcern[] = [];

  const prep: VisitPrep = {
    purpose_summary:
      appointment.purpose && appointment.purpose.trim().length > 0
        ? appointment.purpose.trim()
        : '',
    questions: [...patientQuestions, ...aiQuestions],
    refills_needed: refills,
    concerns,
    logistics: buildLogistics(appointment as Appointment, ai),
    packet_generated: false,
    patient_input_history: [patientInput.trim()],
    special_needs: ai.logistics?.special_needs ?? [],
  };

  return { success: true, data: prep };
}

/**
 * Merge a new round of patient input into an existing prep without
 * losing what's already there. New patient items are appended; AI
 * suggestions from this round are appended too.
 */
export async function mergeAdditionalInput(
  appointmentId: string,
  existingPrep: VisitPrep,
  additionalInput: string,
  profileId: string,
): Promise<ServiceResult<VisitPrep>> {
  const { data: appointment, error: aptError } = await supabase
    .from('apt_appointments')
    .select('*')
    .eq('id', appointmentId)
    .single();

  if (aptError || !appointment) {
    return {
      success: false,
      error: aptError?.message ?? 'Appointment not found',
    };
  }

  const aiResult = await callProcessor(
    additionalInput,
    profileId,
    appointment as Appointment,
  );
  if (!aiResult.success) return aiResult;

  const ai = aiResult.data;
  const existingTexts = new Set(
    existingPrep.questions.map((q) => q.text.toLowerCase().trim()),
  );

  const startPriority =
    existingPrep.questions.reduce((m, q) => Math.max(m, q.priority), 0) + 1;
  let priority = startPriority;

  const newPatientQs: VisitPrepQuestion[] = (ai.questions_and_concerns ?? [])
    .filter((q) => !existingTexts.has(q.text.toLowerCase().trim()))
    .map((q, i) => ({
      id: makeQuestionId('p', i + startPriority),
      text: q.text,
      source: 'patient' as const,
      priority: priority++,
    }));

  const newAiQs: VisitPrepQuestion[] = (ai.ai_suggestions ?? [])
    .filter((q) => !existingTexts.has(q.text.toLowerCase().trim()))
    .map((q, i) => ({
      id: makeQuestionId('ai', i + startPriority),
      text: q.text,
      source: 'ai_suggested' as const,
      priority: priority++,
      ai_suggested: true,
    }));

  const existingMeds = new Set(
    existingPrep.refills_needed.map((r) => r.medication.toLowerCase()),
  );
  const newRefills: VisitPrepRefill[] = (ai.refills_needed ?? [])
    .filter((r) => !existingMeds.has(r.medication.toLowerCase()))
    .map((r) => ({
      medication: r.medication,
      reason: r.reason ?? 'Mentioned by patient',
    }));

  const merged: VisitPrep = {
    ...existingPrep,
    questions: [...existingPrep.questions, ...newPatientQs, ...newAiQs],
    refills_needed: [...existingPrep.refills_needed, ...newRefills],
    logistics: {
      ...existingPrep.logistics,
      what_to_bring: Array.from(
        new Set([
          ...existingPrep.logistics.what_to_bring,
          ...(ai.logistics?.notes ?? []),
        ]),
      ),
    },
    patient_input_history: [
      ...(existingPrep.patient_input_history ?? []),
      additionalInput.trim(),
    ],
    special_needs: Array.from(
      new Set([
        ...(existingPrep.special_needs ?? []),
        ...(ai.logistics?.special_needs ?? []),
      ]),
    ),
    // New input invalidates the existing packet
    packet_generated: false,
    packet_content: undefined,
  };

  return { success: true, data: merged };
}

/** Reference exports kept for ergonomics in tests. */
export type { VisitPrepDriver };
