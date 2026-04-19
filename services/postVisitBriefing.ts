/**
 * Post-visit briefing — surfaces past appointments that haven't been captured
 * yet (within a short look-back window) as high-priority "How did it go?"
 * prompts on the Home screen's Today's Briefing.
 *
 * The capture window is short on purpose: details fade fast after a visit,
 * and an old prompt that lingers for weeks turns into noise. After the
 * look-back window, the prompt is dropped silently.
 */

import {
  fetchUncapturedPastAppointments,
} from '@/services/postVisitCapture';
import type { Appointment } from '@/lib/types/appointments';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface PostVisitBriefingItem {
  key: string;
  appointmentId: string;
  /** "How did your visit with Dr. Chen go?" or fallback wording. */
  message: string;
  /** Used by the briefing renderer to tint icon/sortRank. */
  color: 'critical' | 'warning' | 'info';
  /** Lower = higher priority. */
  sortRank: number;
}

/** Look-back is short — the spec calls for the 24h golden window. */
const PRIMARY_WINDOW_HOURS = 24;
/** A second tier (24-48h) still surfaces but at lower priority. */
const SECONDARY_WINDOW_HOURS = 48;

function hoursSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60);
}

function buildItem(apt: Appointment): PostVisitBriefingItem {
  const hours = hoursSince(apt.start_time);
  const inPrimary = hours <= PRIMARY_WINDOW_HOURS;
  const provider = apt.provider_name?.trim();
  const message = provider
    ? `How did your visit with ${provider} go?`
    : `How did your ${apt.title} visit go?`;
  return {
    key: `post_visit_${apt.id}`,
    appointmentId: apt.id,
    message,
    // Primary-window prompts are high-priority — golden recall window.
    color: inPrimary ? 'critical' : 'warning',
    sortRank: inPrimary ? 5 : 15,
  };
}

export async function fetchPostVisitBriefing(
  profileId: string,
  limit: number = 3,
): Promise<ServiceResult<PostVisitBriefingItem[]>> {
  const result = await fetchUncapturedPastAppointments(profileId, SECONDARY_WINDOW_HOURS);
  if (!result.success) return result;

  const items = result.data.map(buildItem).sort((a, b) => a.sortRank - b.sortRank);
  return { success: true, data: items.slice(0, limit) };
}
