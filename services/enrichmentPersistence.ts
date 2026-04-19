/**
 * Enrichment persistence — SecureStore-backed state for smart nudges.
 *
 * Two kinds of state, both per-profile:
 *   • earned milestones — IDs of milestones already surfaced (never repeat)
 *   • nudge dismissals — nudgeId → dismissedAt ISO (14-day cooldown)
 *
 * Also tracks the "last opened" timestamp used by the welcome-back nudge.
 */

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { MilestoneId } from './smartEnrichment';

// ── Low-level helpers ─────────────────────────────────────────────────────

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

async function readJson<T>(key: string, fallback: T): Promise<T> {
  const raw = await readString(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson<T>(key: string, value: T): Promise<void> {
  try {
    await writeString(key, JSON.stringify(value));
  } catch {
    // best-effort
  }
}

// ── Key builders ──────────────────────────────────────────────────────────

function keyMilestones(profileId: string): string {
  return `enrichment.milestones_earned.${profileId}`;
}

function keyMilestonesViewed(profileId: string): string {
  return `enrichment.milestones_viewed.${profileId}`;
}

function keyDismissals(profileId: string): string {
  return `enrichment.nudge_dismissals.${profileId}`;
}

function keyLastOpened(profileId: string): string {
  return `enrichment.last_opened.${profileId}`;
}

// ── Milestones ────────────────────────────────────────────────────────────

export async function getEarnedMilestones(
  profileId: string,
): Promise<MilestoneId[]> {
  return readJson<MilestoneId[]>(keyMilestones(profileId), []);
}

export async function addEarnedMilestones(
  profileId: string,
  newIds: MilestoneId[],
): Promise<MilestoneId[]> {
  if (newIds.length === 0) return getEarnedMilestones(profileId);
  const current = await getEarnedMilestones(profileId);
  const merged = Array.from(new Set<MilestoneId>([...current, ...newIds]));
  await writeJson(keyMilestones(profileId), merged);
  return merged;
}

export async function getViewedMilestones(
  profileId: string,
): Promise<MilestoneId[]> {
  return readJson<MilestoneId[]>(keyMilestonesViewed(profileId), []);
}

export async function markMilestonesViewed(
  profileId: string,
  ids: MilestoneId[],
): Promise<void> {
  if (ids.length === 0) return;
  const current = await getViewedMilestones(profileId);
  const merged = Array.from(new Set<MilestoneId>([...current, ...ids]));
  await writeJson(keyMilestonesViewed(profileId), merged);
}

// ── Dismissals ────────────────────────────────────────────────────────────

export async function getDismissals(
  profileId: string,
): Promise<Record<string, string>> {
  return readJson<Record<string, string>>(keyDismissals(profileId), {});
}

export async function dismissNudge(
  profileId: string,
  nudgeId: string,
): Promise<void> {
  const current = await getDismissals(profileId);
  current[nudgeId] = new Date().toISOString();
  await writeJson(keyDismissals(profileId), current);
}

/** Remove a dismissal (e.g., after the user takes action on the nudge). */
export async function clearDismissal(
  profileId: string,
  nudgeId: string,
): Promise<void> {
  const current = await getDismissals(profileId);
  if (!(nudgeId in current)) return;
  delete current[nudgeId];
  await writeJson(keyDismissals(profileId), current);
}

// ── Last opened ──────────────────────────────────────────────────────────

export async function getLastOpenedAt(
  profileId: string,
): Promise<string | null> {
  return readString(keyLastOpened(profileId));
}

export async function markOpenedNow(profileId: string): Promise<void> {
  await writeString(keyLastOpened(profileId), new Date().toISOString());
}
