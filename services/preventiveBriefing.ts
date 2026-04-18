/**
 * Preventive briefing — aggregates preventive_items signals into a small,
 * prioritized list of items for the Home screen's Today's Briefing and the
 * Today Detail screen. Keeps queries scoped to the active profile.
 */

import { supabase } from '@/lib/supabase';
import type {
  PreventiveMissingDataEntry,
  PreventiveStatus,
} from '@/lib/types/preventive';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

export type PreventiveBriefingKind =
  | 'due_single'
  | 'due_multi'
  | 'due_soon_single'
  | 'needs_review_multi'
  | 'recently_completed';

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
 * Produce up to `max` preventive briefing items for a profile, prioritized:
 *   1. Overdue (due) — single or aggregated multi
 *   2. Due soon — single (only when no due items)
 *   3. Needs review with missing data — aggregated
 *   4. Recently completed (last 7 days) — single, positive reinforcement
 */
export async function fetchPreventiveBriefingItems(
  profileId: string,
  max: number = 3,
): Promise<ServiceResult<PreventiveBriefingItem[]>> {
  const { data, error } = await supabase
    .from('preventive_items')
    .select(
      `
      id,
      status,
      missing_data,
      updated_at,
      rule:preventive_rules!rule_id (
        title
      )
    `,
    )
    .eq('profile_id', profileId)
    .in('status', ['due', 'due_soon', 'needs_review', 'completed', 'up_to_date'])
    .order('updated_at', { ascending: false });

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  interface BriefingRow {
    id: string;
    status: PreventiveStatus;
    missing_data: PreventiveMissingDataEntry[] | null;
    updated_at: string;
    rule: { title: string } | { title: string }[] | null;
  }

  const rows = (data ?? []) as BriefingRow[];

  const getRuleTitle = (raw: BriefingRow['rule']): string => {
    if (!raw) return 'screening';
    if (Array.isArray(raw)) return raw[0]?.title ?? 'screening';
    return raw.title;
  };

  const items: PreventiveBriefingItem[] = [];

  // a) Overdue (due)
  const due = rows.filter((r) => r.status === 'due');
  if (due.length === 1) {
    const r = due[0];
    items.push({
      key: `due:${r.id}`,
      kind: 'due_single',
      itemId: r.id,
      message: `Your ${getRuleTitle(r.rule)} is due`,
      icon: 'alert-circle',
      color: 'critical',
      sortRank: 0,
    });
  } else if (due.length > 1) {
    items.push({
      key: 'due:multi',
      kind: 'due_multi',
      itemId: null,
      message: `You have ${due.length} preventive screenings due`,
      icon: 'alert-circle',
      color: 'critical',
      sortRank: 0,
    });
  }

  // b) Due soon — only surface when no `due` items to avoid flooding
  if (due.length === 0) {
    const dueSoon = rows.filter((r) => r.status === 'due_soon');
    if (dueSoon.length > 0) {
      const r = dueSoon[0];
      items.push({
        key: `duesoon:${r.id}`,
        kind: 'due_soon_single',
        itemId: r.id,
        message: `${getRuleTitle(r.rule)} is coming up`,
        icon: 'time-outline',
        color: 'warning',
        sortRank: 1,
      });
    }
  }

  // c) Needs review with missing data
  const needsReviewWithGaps = rows.filter(
    (r) => r.status === 'needs_review' && (r.missing_data ?? []).length > 0,
  );
  if (needsReviewWithGaps.length > 0) {
    items.push({
      key: 'needsreview:multi',
      kind: 'needs_review_multi',
      itemId: null,
      message: `Complete your preventive care profile — ${needsReviewWithGaps.length} ${
        needsReviewWithGaps.length === 1 ? 'item needs' : 'items need'
      } info`,
      icon: 'help-circle-outline',
      color: 'info',
      sortRank: 2,
    });
  }

  // d) Recently completed — single most recent within 7-day window.
  // The eligibility engine may flip a freshly-completed item from 'completed'
  // to 'up_to_date' on rescan, so accept either.
  const now = Date.now();
  const recentlyCompleted = rows.find(
    (r) =>
      (r.status === 'completed' || r.status === 'up_to_date') &&
      now - new Date(r.updated_at).getTime() <= RECENT_COMPLETION_WINDOW_MS,
  );
  if (recentlyCompleted) {
    items.push({
      key: `done:${recentlyCompleted.id}`,
      kind: 'recently_completed',
      itemId: recentlyCompleted.id,
      message: `Nice work! ${getRuleTitle(recentlyCompleted.rule)} is done`,
      icon: 'checkmark-circle',
      color: 'success',
      sortRank: 3,
    });
  }

  items.sort((a, b) => {
    if (a.sortRank !== b.sortRank) return a.sortRank - b.sortRank;
    return a.key.localeCompare(b.key);
  });

  return { success: true, data: items.slice(0, max) };
}
