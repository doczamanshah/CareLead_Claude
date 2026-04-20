/**
 * NeedsAttention aggregator — Home screen Zone 4 source of truth.
 *
 * Pure function. The caller fetches each source's items via the existing
 * briefing hooks and passes them in; this module ranks, normalizes, and
 * returns the top-N items as a single uniform list.
 *
 * Why a pure function rather than its own hook chain:
 * - Hooks already exist for each source (post-visit, pre-appointment,
 *   preventive briefing, smart enrichment, data quality, etc.). Re-fetching
 *   them inside this service would duplicate work and complicate caching.
 * - The aggregator's job is purely ranking + projection — no I/O.
 */

import type { CaregiverEnrichmentPrompt } from '@/lib/types/caregivers';
import type { LifeEventPrompt } from '@/lib/types/lifeEvents';
import type { PatientPriorities } from '@/lib/types/priorities';
import type { PostVisitBriefingItem } from '@/services/postVisitBriefing';
import type { PreAppointmentBriefingItem } from '@/services/preAppointmentCheck';
import type { PreventiveBriefingItem } from '@/services/preventiveBriefing';
import type { DataQualityBriefingItem } from '@/services/dataQualityBriefing';
import type { SmartNudge } from '@/services/smartEnrichment';
import type { RefillInfo } from '@/lib/types/medications';
import { COLORS } from '@/lib/constants/colors';

export type NeedsAttentionType =
  | 'post_visit'
  | 'pre_appointment'
  | 'preventive'
  | 'nudge'
  | 'data_quality'
  | 'caregiver'
  | 'refill'
  | 'life_event'
  | 'priorities';

export interface NeedsAttentionItem {
  id: string;
  type: NeedsAttentionType;
  /** Higher = more important. Used for sorting before slicing to maxItems. */
  priority: number;
  title: string;
  /** Ionicon name. */
  icon: string;
  /** Dot/accent color (red = critical, amber = warning, green = info/success). */
  color: string;
  actionLabel: string;
  /** Navigation route — passed verbatim to router.push. */
  route: string;
  routeParams?: Record<string, string>;
}

interface BuildParams {
  postVisit?: PostVisitBriefingItem[] | null;
  preAppointment?: PreAppointmentBriefingItem[] | null;
  preventive?: PreventiveBriefingItem[] | null;
  topNudge?: SmartNudge | null;
  dataQuality?: DataQualityBriefingItem | null;
  caregiverPrompts?: CaregiverEnrichmentPrompt[] | null;
  refills?: RefillInfo[] | null;
  lifeEventPrompts?: LifeEventPrompt[] | null;
  /** Active profile id — needed for some routes. */
  profileId: string;
  patientPriorities?: PatientPriorities | null;
  /** Open task count — used to gate the priorities prompt. */
  openTaskCount?: number;
  /** Whether the priorities prompt was dismissed within the cooldown. */
  prioritiesDismissed?: boolean;
}

// ── Color helpers ──────────────────────────────────────────────────────────

function colorForBriefing(c: 'critical' | 'warning' | 'info' | 'success'): string {
  if (c === 'critical') return COLORS.error.DEFAULT;
  if (c === 'warning') return COLORS.accent.dark;
  if (c === 'success') return COLORS.success.DEFAULT;
  return COLORS.primary.DEFAULT;
}

function priorityForBriefing(c: 'critical' | 'warning' | 'info' | 'success'): number {
  if (c === 'critical') return 5;
  if (c === 'warning') return 3;
  if (c === 'success') return 1;
  return 2;
}

// ── Per-source mapping ─────────────────────────────────────────────────────

function fromPostVisit(items: PostVisitBriefingItem[]): NeedsAttentionItem[] {
  // Highest priority — 24h golden window matters.
  return items.map((it) => ({
    id: `post_visit:${it.key}`,
    type: 'post_visit' as const,
    priority: 100 + priorityForBriefing(it.color),
    title: it.message,
    icon: 'sparkles',
    color: colorForBriefing(it.color),
    actionLabel: 'Capture',
    route: `/(main)/appointments/${it.appointmentId}/post-visit-capture`,
  }));
}

function fromPreAppointment(
  items: PreAppointmentBriefingItem[],
): NeedsAttentionItem[] {
  return items.map((it) => ({
    id: `pre_appointment:${it.key}`,
    type: 'pre_appointment' as const,
    priority: 90 + priorityForBriefing(it.color),
    title: it.message,
    icon: it.icon || 'calendar-outline',
    color: colorForBriefing(it.color),
    actionLabel: 'Review',
    route: `/(main)/appointments/${it.appointmentId}/pre-check`,
  }));
}

function fromPreventive(items: PreventiveBriefingItem[]): NeedsAttentionItem[] {
  return items
    .filter((it) => it.color !== 'success') // celebrations don't belong in attention
    .map((it) => ({
      id: `preventive:${it.key}`,
      type: 'preventive' as const,
      priority: 80 + priorityForBriefing(it.color),
      title: it.message,
      icon: it.icon || 'shield-checkmark-outline',
      color: colorForBriefing(it.color),
      actionLabel: 'Open',
      route: it.itemId
        ? `/(main)/preventive/${it.itemId}`
        : '/(main)/preventive',
    }));
}

function fromTopNudge(nudge: SmartNudge, profileId: string): NeedsAttentionItem {
  // Map normalized priority (0-100) into our 60-69 band.
  const norm = Math.max(0, Math.min(100, nudge.priority)) / 100;
  return {
    id: `nudge:${nudge.id}`,
    type: 'nudge',
    priority: 60 + norm * 9,
    title: nudge.title,
    icon: nudge.icon || 'sparkles-outline',
    color: COLORS.primary.DEFAULT,
    actionLabel: nudge.actionLabel || 'Add',
    route: nudge.actionRoute ?? `/(main)/profile/${profileId}/strengthen`,
    routeParams: nudge.actionParams,
  };
}

function fromDataQuality(
  item: DataQualityBriefingItem,
  profileId: string,
): NeedsAttentionItem {
  return {
    id: `data_quality:${item.key}`,
    type: 'data_quality',
    priority: 55,
    title: item.message,
    icon: item.icon || 'time-outline',
    color: item.color === 'warning' ? COLORS.accent.dark : COLORS.text.secondary,
    actionLabel: 'Review',
    route: `/(main)/profile/${profileId}/data-quality`,
  };
}

function fromCaregiverPrompts(
  items: CaregiverEnrichmentPrompt[],
): NeedsAttentionItem[] {
  return items.map((it) => ({
    id: `caregiver:${it.id}`,
    type: 'caregiver' as const,
    priority: it.priority === 'high' ? 52 : it.priority === 'medium' ? 50 : 48,
    title: it.title,
    icon: 'heart-outline',
    color:
      it.priority === 'high' ? COLORS.primary.DEFAULT : COLORS.text.secondary,
    actionLabel: it.actionLabel || 'Add',
    route: it.actionRoute,
    routeParams: it.actionParams,
  }));
}

function fromRefills(refills: RefillInfo[]): NeedsAttentionItem[] {
  // Surface only overdue/due_soon — silent on ok and needs_info (handled
  // elsewhere as data-quality nudges).
  return refills
    .filter((r) => r.status === 'overdue' || r.status === 'due_soon')
    .map((r) => {
      const overdue = r.status === 'overdue';
      const days = r.daysRemaining ?? 0;
      const detail = overdue
        ? `${r.drugName} refill is overdue`
        : days <= 0
          ? `${r.drugName} refill due today`
          : `${r.drugName} refill due in ${days}d`;
      return {
        id: `refill:${r.medicationId}`,
        type: 'refill' as const,
        priority: overdue ? 47 : 45,
        title: detail,
        icon: 'medkit-outline',
        color: overdue ? COLORS.error.DEFAULT : COLORS.accent.dark,
        actionLabel: 'Refill',
        route: `/(main)/medications/refill/${r.medicationId}`,
      };
    });
}

function fromLifeEvent(prompt: LifeEventPrompt): NeedsAttentionItem {
  const priorityNum =
    prompt.priority === 'high' ? 42 : prompt.priority === 'medium' ? 40 : 38;
  return {
    id: `life_event:${prompt.id}`,
    type: 'life_event',
    priority: priorityNum,
    title: prompt.title,
    icon: 'flag-outline',
    color: COLORS.text.secondary,
    actionLabel: prompt.actions[0]?.label || 'Open',
    // Life events are handled in-place on the Home screen with their own
    // action handlers. Route to today screen so taps still go somewhere
    // sensible if the prompt isn't dismissable inline.
    route: '/(main)/today',
  };
}

function fromPriorities(profileId: string): NeedsAttentionItem {
  return {
    id: 'priorities:invite',
    type: 'priorities',
    priority: 35,
    title: 'Tell us what matters most to you',
    icon: 'heart-outline',
    color: COLORS.text.secondary,
    actionLabel: 'Set',
    route: `/(main)/profile/${profileId}/priorities`,
  };
}

// ── Aggregator ─────────────────────────────────────────────────────────────

export function buildNeedsAttention(
  params: BuildParams,
  maxItems: number = 3,
): NeedsAttentionItem[] {
  const items: NeedsAttentionItem[] = [];

  if (params.postVisit?.length) {
    items.push(...fromPostVisit(params.postVisit));
  }
  if (params.preAppointment?.length) {
    items.push(...fromPreAppointment(params.preAppointment));
  }
  if (params.preventive?.length) {
    items.push(...fromPreventive(params.preventive));
  }
  if (params.topNudge) {
    items.push(fromTopNudge(params.topNudge, params.profileId));
  }
  if (params.dataQuality) {
    items.push(fromDataQuality(params.dataQuality, params.profileId));
  }
  if (params.caregiverPrompts?.length) {
    items.push(...fromCaregiverPrompts(params.caregiverPrompts));
  }
  if (params.refills?.length) {
    items.push(...fromRefills(params.refills));
  }
  if (params.lifeEventPrompts?.length) {
    // Only the most recent life-event prompt — they're chatty by nature.
    items.push(fromLifeEvent(params.lifeEventPrompts[0]));
  }

  // Priorities invite — only when there are enough open tasks to make it
  // worth asking, and the user hasn't dismissed it recently.
  const hasPriorities =
    !!params.patientPriorities &&
    (params.patientPriorities.health_priorities.length > 0 ||
      params.patientPriorities.friction_points.length > 0 ||
      params.patientPriorities.conditions_of_focus.length > 0);
  const shouldInvitePriorities =
    !hasPriorities &&
    !params.prioritiesDismissed &&
    (params.openTaskCount ?? 0) >= 5;
  if (shouldInvitePriorities) {
    items.push(fromPriorities(params.profileId));
  }

  // Stable sort: highest priority first, falling back to type ordering for
  // determinism within ties.
  const TYPE_ORDER: Record<NeedsAttentionType, number> = {
    post_visit: 0,
    pre_appointment: 1,
    preventive: 2,
    nudge: 3,
    data_quality: 4,
    caregiver: 5,
    refill: 6,
    life_event: 7,
    priorities: 8,
  };

  items.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return TYPE_ORDER[a.type] - TYPE_ORDER[b.type];
  });

  return items.slice(0, maxItems);
}

/**
 * Total count of all items the aggregator could surface (before slicing).
 * Used to render "View N more" in the UI.
 */
export function countNeedsAttention(params: BuildParams): number {
  // We rebuild without slicing. Cheap — the pieces are small arrays.
  return buildNeedsAttention(params, Number.MAX_SAFE_INTEGER).length;
}
