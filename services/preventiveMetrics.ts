/**
 * Preventive care metrics — pure calculation layer for the dashboard score
 * card and for the shareable report. No database access; the caller passes
 * in the items it already has.
 */

import { PREVENTIVE_CATEGORY_LABELS } from '@/lib/types/preventive';
import type {
  PreventiveCategoryStat,
  PreventiveItemWithRule,
  PreventiveMetrics,
} from '@/lib/types/preventive';

interface CalcParams {
  profileId: string;
  items: PreventiveItemWithRule[];
  /** Override "now" for deterministic tests. Defaults to current time. */
  now?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function calculatePreventiveMetrics(
  params: CalcParams,
): PreventiveMetrics {
  const { items } = params;
  const now = params.now ?? Date.now();

  // Declined/deferred items don't count toward compliance — they reflect
  // patient choice and we shouldn't penalize the score for respecting it.
  const relevant = items.filter(
    (i) => i.status !== 'declined' && i.status !== 'deferred',
  );

  const totalMeasures = relevant.length;
  const upToDate = relevant.filter(
    (i) => i.status === 'up_to_date' || i.status === 'completed',
  ).length;
  const gaps = relevant.filter(
    (i) =>
      i.status === 'due' || i.status === 'due_soon' || i.status === 'needs_review',
  ).length;

  const complianceRate =
    totalMeasures === 0 ? 0 : Math.round((upToDate / totalMeasures) * 100);

  // Gap closure — look at items that have gap_closed_at timestamps.
  const closed30: number[] = [];
  const closed90: number[] = [];
  const closureDurations: number[] = [];
  for (const item of items) {
    const closedAt = item.gap_closed_at
      ? new Date(item.gap_closed_at).getTime()
      : null;
    if (closedAt === null || isNaN(closedAt)) continue;

    const sinceClose = now - closedAt;
    if (sinceClose <= 30 * DAY_MS) closed30.push(closedAt);
    if (sinceClose <= 90 * DAY_MS) closed90.push(closedAt);

    const openedAt = item.gap_identified_at
      ? new Date(item.gap_identified_at).getTime()
      : null;
    if (openedAt !== null && !isNaN(openedAt) && closedAt > openedAt) {
      closureDurations.push((closedAt - openedAt) / DAY_MS);
    }
  }

  const averageTimeToClosureDays =
    closureDurations.length === 0
      ? null
      : Math.round(
          closureDurations.reduce((acc, n) => acc + n, 0) /
            closureDurations.length,
        );

  // HEDIS compliance — per-measure boolean. A measure is compliant if at
  // least one item with that HEDIS code is currently up_to_date/completed.
  // A measure is a gap if any item with that code exists but is not closed.
  const hedisCompliance: Record<string, boolean> = {};
  for (const item of items) {
    const code = item.hedis_measure_code ?? item.rule.hedis_measure_code;
    if (!code) continue;
    const isCurrent =
      item.status === 'up_to_date' || item.status === 'completed';
    if (isCurrent) {
      hedisCompliance[code] = true;
    } else if (!(code in hedisCompliance)) {
      hedisCompliance[code] = false;
    }
  }

  // By-category rollup
  const byCategory: Record<string, PreventiveCategoryStat> = {};
  for (const item of relevant) {
    const label =
      PREVENTIVE_CATEGORY_LABELS[item.rule.category] ?? item.rule.category;
    if (!byCategory[label]) byCategory[label] = { total: 0, upToDate: 0 };
    byCategory[label].total += 1;
    if (item.status === 'up_to_date' || item.status === 'completed') {
      byCategory[label].upToDate += 1;
    }
  }

  return {
    totalMeasures,
    upToDate,
    gaps,
    complianceRate,
    gapsClosed30Days: closed30.length,
    gapsClosed90Days: closed90.length,
    averageTimeToClosureDays,
    hedisCompliance,
    byCategory,
  };
}

/**
 * Color-band classification for the dashboard score card.
 * >=80 green, 60-79 amber, <60 red.
 */
export function complianceBand(
  rate: number,
): 'green' | 'amber' | 'red' {
  if (rate >= 80) return 'green';
  if (rate >= 60) return 'amber';
  return 'red';
}
