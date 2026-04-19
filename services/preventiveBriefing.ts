/**
 * Home-screen adapter for preventive briefing.
 *
 * Delegates to the strategy engine (services/preventiveBriefingStrategy.ts)
 * so the Home briefing honors the user's reminder mode, cooldowns, seasonal
 * awareness, and appointment anchoring — then maps its richer output to the
 * lightweight shape the Home screen already consumes.
 */

import { supabase } from '@/lib/supabase';
import { getReminderMode } from '@/services/preventiveReminderPrefs';
import { getPreventiveBriefingItems } from '@/services/preventiveBriefingStrategy';
import type {
  PreventiveItemWithRule,
  PreventiveBriefingStrategyItem,
} from '@/lib/types/preventive';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

export type PreventiveBriefingKind =
  | 'due_single'
  | 'due_multi'
  | 'due_soon_single'
  | 'needs_review_multi'
  | 'recently_completed'
  | 'appointment_prep'
  | 'pharmacy'
  | 'progress';

export interface PreventiveBriefingItem {
  key: string;
  kind: PreventiveBriefingKind;
  itemId: string | null;
  message: string;
  icon: string;
  color: 'critical' | 'warning' | 'info' | 'success';
  sortRank: number;
}

const RECENT_COMPLETION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Produce up to `max` preventive briefing items for the Home screen.
 * Ordering: strategy's high/medium/low priority first, then the
 * "recently completed" celebration last (positive reinforcement).
 */
export async function fetchPreventiveBriefingItems(
  profileId: string,
  max: number = 3,
): Promise<ServiceResult<PreventiveBriefingItem[]>> {
  const [itemsRes, apptsRes, mode] = await Promise.all([
    loadPreventiveItems(profileId),
    loadUpcomingAppointments(profileId),
    getReminderMode(profileId),
  ]);

  if (!itemsRes.success) return itemsRes;
  if (!apptsRes.success) return apptsRes;

  const strategyItems = await getPreventiveBriefingItems({
    profileId,
    reminderMode: mode,
    preventiveItems: itemsRes.data,
    upcomingAppointments: apptsRes.data,
  });

  const out: PreventiveBriefingItem[] = strategyItems.map((s, idx) =>
    mapStrategyItem(s, idx),
  );

  // Celebration bucket is separate from the cadence engine so quick wins
  // still surface even when nothing is due.
  const recent = findRecentlyCompleted(itemsRes.data);
  if (recent && out.length < max) {
    out.push({
      key: `done:${recent.id}`,
      kind: 'recently_completed',
      itemId: recent.id,
      message: `Nice work! ${recent.rule.title} is done`,
      icon: 'checkmark-circle',
      color: 'success',
      sortRank: 9,
    });
  }

  out.sort((a, b) => a.sortRank - b.sortRank);
  return { success: true, data: out.slice(0, max) };
}

// ── Loaders ──────────────────────────────────────────────────────────────

async function loadPreventiveItems(
  profileId: string,
): Promise<ServiceResult<PreventiveItemWithRule[]>> {
  const { data, error } = await supabase
    .from('preventive_items')
    .select(
      `
      *,
      rule:preventive_rules!rule_id (
        code,
        title,
        description,
        category,
        cadence_months,
        guideline_source,
        guideline_version,
        guideline_url,
        screening_methods,
        hedis_measure_code,
        condition_triggers,
        is_condition_dependent,
        seasonal_window,
        measure_type
      )
    `,
    )
    .eq('profile_id', profileId);

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }
  return { success: true, data: (data ?? []) as PreventiveItemWithRule[] };
}

async function loadUpcomingAppointments(
  profileId: string,
): Promise<
  ServiceResult<
    { id: string; title: string; provider_name: string | null; start_time: string }[]
  >
> {
  const now = new Date();
  const end = new Date();
  end.setDate(end.getDate() + 7);

  const { data, error } = await supabase
    .from('apt_appointments')
    .select('id, title, provider_name, start_time, status')
    .eq('profile_id', profileId)
    .is('deleted_at', null)
    .in('status', ['scheduled', 'preparing', 'ready'])
    .gte('start_time', now.toISOString())
    .lte('start_time', end.toISOString())
    .order('start_time', { ascending: true });

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }
  return {
    success: true,
    data: (data ?? []) as {
      id: string;
      title: string;
      provider_name: string | null;
      start_time: string;
    }[],
  };
}

// ── Mappers ──────────────────────────────────────────────────────────────

function mapStrategyItem(
  s: PreventiveBriefingStrategyItem,
  index: number,
): PreventiveBriefingItem {
  // Kind/color/icon derived from action + priority so the home screen can
  // keep its existing rendering branches.
  let kind: PreventiveBriefingKind;
  let icon: string;
  let color: PreventiveBriefingItem['color'];

  if (s.actionType === 'discuss_at_visit') {
    kind = 'appointment_prep';
    icon = 'clipboard-outline';
    color = s.priority === 'high' ? 'info' : 'info';
  } else if (s.actionType === 'get_at_pharmacy') {
    kind = 'pharmacy';
    icon = 'medkit-outline';
    color = 'warning';
  } else if (s.id.startsWith('progress_')) {
    kind = 'progress';
    icon = 'ribbon-outline';
    color = 'success';
  } else if (s.id.startsWith('standalone_')) {
    // Needs-review / standalone due — warning/critical based on priority.
    kind = 'due_single';
    icon = s.priority === 'high' ? 'alert-circle' : 'time-outline';
    color = s.priority === 'high' ? 'critical' : 'warning';
  } else {
    kind = 'due_single';
    icon = 'alert-circle';
    color = 'warning';
  }

  const sortRank =
    (s.priority === 'high' ? 0 : s.priority === 'medium' ? 2 : 4) + index * 0.1;

  return {
    key: s.id,
    kind,
    itemId: s.itemId,
    message: s.title,
    icon,
    color,
    sortRank,
  };
}

interface SimpleItemLike {
  id: string;
  status: string;
  updated_at: string;
  rule: { title: string };
}

function findRecentlyCompleted(
  items: PreventiveItemWithRule[],
): SimpleItemLike | null {
  const now = Date.now();
  for (const item of items) {
    if (item.status !== 'completed' && item.status !== 'up_to_date') continue;
    const t = new Date(item.updated_at).getTime();
    if (now - t <= RECENT_COMPLETION_WINDOW_MS) {
      return {
        id: item.id,
        status: item.status,
        updated_at: item.updated_at,
        rule: { title: item.rule.title },
      };
    }
  }
  return null;
}
