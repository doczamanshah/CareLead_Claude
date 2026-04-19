/**
 * Data Quality briefing — surface a single low-priority "some items are
 * over a year old" nudge on the Home screen, no more than once per month.
 *
 * Cooldown state lives in SecureStore (per-profile) — the same pattern as
 * `profileReview.ts`, since the signal is intentionally device-local.
 */

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { DataQualityReport } from '@/lib/types/dataQuality';

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const DISMISSAL_COOLDOWN_DAYS = 30;

export interface DataQualityBriefingItem {
  key: string;
  message: string;
  icon: string;
  color: 'info' | 'warning';
  veryStaleCount: number;
}

function keyLastDismissed(profileId: string): string {
  return `data_quality_briefing.last_dismissed.${profileId}`;
}

async function readString(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    } catch {
      return null;
    }
  }
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function writeString(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
    } catch {
      // best-effort
    }
    return;
  }
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    // best-effort
  }
}

export async function shouldShowDataQualityBriefing(profileId: string): Promise<boolean> {
  const last = await readString(keyLastDismissed(profileId));
  if (!last) return true;
  const ageDays = (Date.now() - new Date(last).getTime()) / MS_PER_DAY;
  return ageDays >= DISMISSAL_COOLDOWN_DAYS;
}

export async function markDataQualityBriefingDismissed(profileId: string): Promise<void> {
  await writeString(keyLastDismissed(profileId), new Date().toISOString());
}

/**
 * Derive a briefing item (or null) from an already-built DataQualityReport.
 * Caller is responsible for checking `shouldShowDataQualityBriefing` first.
 */
export function deriveDataQualityBriefingItem(
  report: DataQualityReport | null | undefined,
): DataQualityBriefingItem | null {
  if (!report) return null;
  const veryStale = report.staleItems.filter((s) => s.staleness === 'very_stale');
  if (veryStale.length === 0) return null;
  return {
    key: 'data_quality:very_stale',
    message:
      veryStale.length === 1
        ? 'A profile item hasn\u2019t been updated in over a year'
        : `${veryStale.length} profile items haven\u2019t been updated in over a year`,
    icon: 'time-outline',
    color: 'info',
    veryStaleCount: veryStale.length,
  };
}
