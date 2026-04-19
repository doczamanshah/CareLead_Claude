/**
 * Preventive briefing cadence strategy.
 *
 * Picks which preventive items deserve airtime in the Home briefing, shaped
 * by the user's reminder mode. The core rules:
 *   - quiet       → never surface here
 *   - visit_only  → surface only when an appointment is within 3 days
 *   - active      → surface first occurrence immediately, then throttle to
 *                   once every 30 days OR at the next appointment
 *
 * Positive framing always: opportunities, not obligations.
 */

import {
  getLastShownAt,
  getDismissedAt,
  getSnoozeUntilAppointment,
  REMINDER_COOLDOWN_MS,
} from '@/services/preventiveReminderPrefs';
import type {
  PreventiveBriefingStrategyItem,
  PreventiveItemWithRule,
  PreventiveReminderMode,
  PreventiveStatus,
  ScreeningMethod,
  SeasonalWindow,
} from '@/lib/types/preventive';

export interface UpcomingAppointmentInfo {
  id: string;
  title: string;
  provider_name: string | null;
  start_time: string;
}

export interface BriefingStrategyParams {
  profileId: string;
  reminderMode: PreventiveReminderMode;
  preventiveItems: PreventiveItemWithRule[];
  upcomingAppointments: UpcomingAppointmentInfo[];
  /** Defaults to Date.now() — injectable for testing. */
  now?: number;
}

const APPT_WINDOW_DAYS = 3;
const APPT_WINDOW_MS = APPT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const WELLNESS_HEAD_START_DAYS = 30;

// Categories that a pharmacy can handle without a provider visit.
const PHARMACY_OK_CODES = new Set(['flu_vaccine', 'covid_vaccine', 'shingles_vaccine', 'tdap_booster']);

const POSITIVE_GREETINGS = [
  'Great time to discuss',
  'Worth bringing up',
  'Opportunity to knock out',
];

/**
 * Build briefing items honoring reminder mode and per-item cooldowns.
 */
export async function getPreventiveBriefingItems(
  params: BriefingStrategyParams,
): Promise<PreventiveBriefingStrategyItem[]> {
  const { reminderMode, preventiveItems, upcomingAppointments } = params;

  if (reminderMode === 'quiet') return [];

  const now = params.now ?? Date.now();

  // Find the soonest upcoming appointment (if any) and whether it's within
  // the appointment-prep window.
  const nextAppointment = upcomingAppointments
    .filter((a) => new Date(a.start_time).getTime() >= now)
    .sort(
      (a, b) =>
        new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
    )[0];
  const appointmentSoon =
    nextAppointment !== undefined &&
    new Date(nextAppointment.start_time).getTime() - now <= APPT_WINDOW_MS;

  // Visit-only mode: only surface if there's an imminent appointment.
  if (reminderMode === 'visit_only') {
    if (!appointmentSoon || !nextAppointment) return [];
    return buildAppointmentPrepBriefing(preventiveItems, nextAppointment);
  }

  // Active mode
  const out: PreventiveBriefingStrategyItem[] = [];

  // 1. Appointment-anchored prompts (always shown, bypass cooldown)
  if (appointmentSoon && nextAppointment) {
    out.push(...buildAppointmentPrepBriefing(preventiveItems, nextAppointment));
  }

  // 2. Standalone reminders for due / due_soon / seasonal (cooldown-guarded)
  for (const item of preventiveItems) {
    if (out.some((o) => o.itemId === item.id)) continue; // covered by appointment block
    if (await itemOnCooldown(item.id, now)) continue;

    const entry = buildStandaloneEntry(item, now);
    if (entry) out.push(entry);
  }

  // 3. Celebratory "most current" bucket when ≥80% up-to-date (max one)
  const progressItem = buildProgressItem(preventiveItems);
  if (progressItem) out.push(progressItem);

  // Sort: high > medium > low, then item title for stability
  out.sort((a, b) => {
    const p: Record<'high' | 'medium' | 'low', number> = { high: 0, medium: 1, low: 2 };
    if (p[a.priority] !== p[b.priority]) return p[a.priority] - p[b.priority];
    return a.title.localeCompare(b.title);
  });

  return out.slice(0, 5);
}

// ── Appointment prep block ────────────────────────────────────────────────

function buildAppointmentPrepBriefing(
  preventiveItems: PreventiveItemWithRule[],
  appointment: UpcomingAppointmentInfo,
): PreventiveBriefingStrategyItem[] {
  const relevant = preventiveItems.filter(
    (i) => i.status === 'due' || i.status === 'due_soon',
  );
  if (relevant.length === 0) return [];

  const providerLabel =
    appointment.provider_name?.trim() || appointment.title || 'your provider';
  const whenLabel = describeVisitTiming(appointment.start_time);

  if (relevant.length === 1) {
    const item = relevant[0];
    return [
      {
        id: `apt_prep_${item.id}`,
        itemId: item.id,
        title: `Great visit to discuss ${friendlyName(item)}`,
        detail: `Your visit with ${providerLabel} is ${whenLabel}.`,
        priority: 'high',
        actionLabel: 'Add to my prep',
        actionType: 'discuss_at_visit',
      },
    ];
  }

  return [
    {
      id: `apt_prep_bundle_${appointment.id}`,
      itemId: relevant[0].id, // primary item for the default navigate target
      title: `${relevant.length} screenings to discuss with ${providerLabel}`,
      detail: `Your visit is ${whenLabel}. Tap to review the full list.`,
      priority: 'high',
      actionLabel: 'Plan my visit',
      actionType: 'discuss_at_visit',
    },
  ];
}

// ── Standalone reminder for a single item ────────────────────────────────

function buildStandaloneEntry(
  item: PreventiveItemWithRule,
  now: number,
): PreventiveBriefingStrategyItem | null {
  const status = item.status;
  if (status !== 'due' && status !== 'due_soon' && status !== 'needs_review')
    return null;

  const ruleCode = item.rule.code;
  const title = friendlyName(item);
  const isSeasonal = !!item.rule.seasonal_window;
  const inSeason = isSeasonal
    ? isInSeason(new Date(now), item.rule.seasonal_window as SeasonalWindow)
    : true;

  // Due-soon only surfaces at appointment prep, not standalone.
  if (status === 'due_soon' && !isSeasonal) return null;
  if (isSeasonal && !inSeason) return null;

  // Annual wellness visit — special 30-day head start
  if (ruleCode === 'annual_wellness_visit') {
    const headStart = WELLNESS_HEAD_START_DAYS * 24 * 60 * 60 * 1000;
    const anchorIso = item.next_due_date ?? item.due_date;
    if (anchorIso) {
      const anchor = new Date(anchorIso + 'T00:00:00').getTime();
      if (anchor - now > headStart) return null;
    }
  }

  const canPharmacy = PHARMACY_OK_CODES.has(ruleCode);
  const greeting =
    POSITIVE_GREETINGS[Math.floor(Math.random() * POSITIVE_GREETINGS.length)];

  if (status === 'needs_review') {
    return {
      id: `standalone_${item.id}`,
      itemId: item.id,
      title: `A quick question about your ${title}`,
      detail: 'Help us tailor your preventive care — tap to add the missing info.',
      priority: 'medium',
      actionLabel: 'Review',
      actionType: 'view_details',
    };
  }

  if (canPharmacy) {
    return {
      id: `standalone_${item.id}`,
      itemId: item.id,
      title: `${greeting} your ${title.toLowerCase()}`,
      detail: 'Most pharmacies can handle this — no doctor visit needed.',
      priority: 'medium',
      actionLabel: 'Get at pharmacy',
      actionType: 'get_at_pharmacy',
    };
  }

  return {
    id: `standalone_${item.id}`,
    itemId: item.id,
    title: `${greeting} ${title.toLowerCase()}`,
    detail: 'Add it to your next visit or tap to schedule.',
    priority: status === 'due' ? 'high' : 'medium',
    actionLabel: 'Discuss at my next visit',
    actionType: 'discuss_at_visit',
  };
}

// ── Progress/celebration item ────────────────────────────────────────────

function buildProgressItem(
  items: PreventiveItemWithRule[],
): PreventiveBriefingStrategyItem | null {
  if (items.length < 3) return null;
  const total = items.length;
  const done = items.filter(
    (i) => i.status === 'up_to_date' || i.status === 'completed',
  ).length;
  if (total === 0) return null;
  const ratio = done / total;
  if (ratio < 0.8) return null;

  // Anchor the celebratory message to the first up-to-date item so the UI
  // can still navigate somewhere.
  const anchor = items.find(
    (i) => i.status === 'up_to_date' || i.status === 'completed',
  );
  if (!anchor) return null;

  return {
    id: `progress_${Math.floor(ratio * 100)}`,
    itemId: anchor.id,
    title: `${done} of ${total} screenings are current. Nice work!`,
    detail: 'Stay on top of the remaining few when you get a chance.',
    priority: 'low',
    actionLabel: 'View all',
    actionType: 'view_details',
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────

function friendlyName(item: PreventiveItemWithRule): string {
  const methods = item.rule.screening_methods as ScreeningMethod[] | null;
  if (methods && item.selected_method) {
    const picked = methods.find((m) => m.method_id === item.selected_method);
    if (picked) return `${picked.name}`;
  }
  return item.rule.title;
}

function describeVisitTiming(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  const hours = ms / (1000 * 60 * 60);
  if (hours <= 24) return 'today';
  if (hours <= 48) return 'tomorrow';
  const days = Math.ceil(hours / 24);
  return `in ${days} days`;
}

function isInSeason(now: Date, window: SeasonalWindow): boolean {
  const month = now.getMonth() + 1;
  const { start_month, end_month } = window;
  if (start_month <= end_month) {
    return month >= start_month && month <= end_month;
  }
  return month >= start_month || month <= end_month;
}

async function itemOnCooldown(itemId: string, now: number): Promise<boolean> {
  const dismissed = await getDismissedAt(itemId);
  if (dismissed && now - dismissed < REMINDER_COOLDOWN_MS) return true;

  const lastShown = await getLastShownAt(itemId);
  if (lastShown && now - lastShown < REMINDER_COOLDOWN_MS) return true;

  const snoozeUntil = await getSnoozeUntilAppointment(itemId);
  if (snoozeUntil) {
    const t = new Date(snoozeUntil).getTime();
    if (!isNaN(t) && now < t) return true;
  }
  return false;
}

export async function ignoreCooldownForTesting(
  _itemId: string,
): Promise<void> {
  // no-op — exists so unit tests can spy
}

/**
 * Load upcoming (next 7 days) appointments for a profile in a lightweight
 * shape the strategy engine needs. Callers not already holding appointment
 * data can use this convenience loader.
 */
export type PreventiveStatusKey = PreventiveStatus;
