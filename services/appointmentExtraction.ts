/**
 * appointmentExtraction — wraps the extract-appointment Edge Function.
 *
 * Takes a patient's free-text description of an upcoming appointment
 * (typed or dictated) and returns structured fields the review screen
 * can pre-fill. Does NOT persist anything — the Review screen collects
 * edits and calls createAppointment when the patient confirms.
 */

import { supabase } from '@/lib/supabase';
import type { ExtractedAppointment } from '@/lib/types/appointments';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export async function extractAppointmentFromText(
  text: string,
  profileName?: string | null,
): Promise<ServiceResult<ExtractedAppointment>> {
  const trimmed = text.trim();
  if (!trimmed) {
    return { success: false, error: 'Please describe the appointment first.' };
  }

  const { data, error } = await supabase.functions.invoke(
    'extract-appointment',
    {
      body: {
        text: trimmed,
        profileName: profileName ?? null,
      },
    },
  );

  if (error) {
    return { success: false, error: error.message ?? 'Extraction failed' };
  }

  if (!data || typeof data !== 'object') {
    return { success: false, error: 'No extraction returned' };
  }

  if ('error' in data && typeof data.error === 'string') {
    return { success: false, error: data.error };
  }

  return { success: true, data: data as ExtractedAppointment };
}
