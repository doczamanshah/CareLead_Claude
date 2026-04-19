/**
 * Preventive reminder preferences and per-item snooze / last-shown tracking.
 *
 * Stored in SecureStore so the preference survives app restarts and never
 * leaves the device. The reminder mode is scoped per profile because a
 * household member may want different cadence for different profiles
 * (e.g. quiet for a dependent, active for themselves).
 */

import * as SecureStore from 'expo-secure-store';
import {
  DEFAULT_PREVENTIVE_REMINDER_MODE,
  type PreventiveReminderMode,
} from '@/lib/types/preventive';

const MODE_PREFIX = 'preventive_reminder_mode_';
const LAST_SHOWN_PREFIX = 'preventive_briefing_last_shown_';
const DISMISSED_PREFIX = 'preventive_briefing_dismissed_';
const APPT_SNOOZE_PREFIX = 'preventive_briefing_until_appt_';

function modeKey(profileId: string): string {
  return `${MODE_PREFIX}${profileId}`;
}

export async function getReminderMode(
  profileId: string,
): Promise<PreventiveReminderMode> {
  try {
    const raw = await SecureStore.getItemAsync(modeKey(profileId));
    if (raw === 'active' || raw === 'visit_only' || raw === 'quiet') {
      return raw;
    }
  } catch {
    // SecureStore can fail on simulator edge cases — fall back to default.
  }
  return DEFAULT_PREVENTIVE_REMINDER_MODE;
}

export async function setReminderMode(
  profileId: string,
  mode: PreventiveReminderMode,
): Promise<void> {
  await SecureStore.setItemAsync(modeKey(profileId), mode);
}

// ── Per-item last-shown tracking ──────────────────────────────────────────

export async function getLastShownAt(itemId: string): Promise<number | null> {
  try {
    const raw = await SecureStore.getItemAsync(`${LAST_SHOWN_PREFIX}${itemId}`);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export async function markShownNow(itemId: string): Promise<void> {
  await SecureStore.setItemAsync(
    `${LAST_SHOWN_PREFIX}${itemId}`,
    String(Date.now()),
  );
}

// ── Per-item dismiss cooldown (30 days) ───────────────────────────────────

export async function getDismissedAt(itemId: string): Promise<number | null> {
  try {
    const raw = await SecureStore.getItemAsync(`${DISMISSED_PREFIX}${itemId}`);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export async function markDismissedNow(itemId: string): Promise<void> {
  await SecureStore.setItemAsync(
    `${DISMISSED_PREFIX}${itemId}`,
    String(Date.now()),
  );
}

// ── Snooze until appointment ─────────────────────────────────────────────
// Used by the "Discuss at my next visit" action: silences briefing nudges
// for this item until after the given appointment date.

export async function getSnoozeUntilAppointment(
  itemId: string,
): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(`${APPT_SNOOZE_PREFIX}${itemId}`);
  } catch {
    return null;
  }
}

export async function setSnoozeUntilAppointment(
  itemId: string,
  appointmentDateIso: string,
): Promise<void> {
  await SecureStore.setItemAsync(
    `${APPT_SNOOZE_PREFIX}${itemId}`,
    appointmentDateIso,
  );
}

export async function clearSnoozeUntilAppointment(itemId: string): Promise<void> {
  await SecureStore.deleteItemAsync(`${APPT_SNOOZE_PREFIX}${itemId}`);
}

// ── Constants exposed to consumers ───────────────────────────────────────

export const REMINDER_COOLDOWN_DAYS = 30;
export const REMINDER_COOLDOWN_MS = REMINDER_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
