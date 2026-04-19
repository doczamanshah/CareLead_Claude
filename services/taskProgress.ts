import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { supabase } from '@/lib/supabase';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

export interface TaskProgressStats {
  completedToday: number;
  completedThisWeek: number;
  completedThisMonth: number;
  /** Consecutive days with ≥1 completed task, counting back from today. */
  streakDays: number;
  /** Most-completed source_type across the user's history, or null. */
  topCategory: string | null;
  totalCompleted: number;
}

export interface WeeklyHighlight {
  id: string;
  title: string;
  sourceType: string;
  completedAt: string;
}

export interface WeeklySummary {
  totalCount: number;
  highlights: WeeklyHighlight[];
  weekStartIso: string;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function startOfWeek(d: Date): Date {
  const c = startOfDay(d);
  // Sunday as week start (matches US convention)
  c.setDate(c.getDate() - c.getDay());
  return c;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/**
 * Aggregate task completion stats for a profile. Reads a lightweight
 * projection of the tasks table (id, status, source_type, completed_at,
 * updated_at) filtered to completed rows.
 */
export async function trackTaskCompletion(
  profileId: string,
): Promise<ServiceResult<TaskProgressStats>> {
  // Only fetch the last 90 days of completion activity — the streak
  // calculation only needs recent data, and 90 days is plenty for
  // week/month counts too.
  const since = new Date();
  since.setDate(since.getDate() - 90);

  const { data, error } = await supabase
    .from('tasks')
    .select('id, source_type, completed_at')
    .eq('profile_id', profileId)
    .eq('status', 'completed')
    .is('deleted_at', null)
    .gte('completed_at', since.toISOString());

  if (error) return { success: false, error: error.message, code: error.code };

  // Also need a total count — separate head-count query to avoid loading
  // every completed row since the beginning of time.
  const { count: totalCount, error: totalErr } = await supabase
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .eq('profile_id', profileId)
    .eq('status', 'completed')
    .is('deleted_at', null);

  if (totalErr) {
    return { success: false, error: totalErr.message, code: totalErr.code };
  }

  const now = new Date();
  const todayStart = startOfDay(now);
  const weekStart = startOfWeek(now);
  const monthStart = startOfMonth(now);

  let completedToday = 0;
  let completedThisWeek = 0;
  let completedThisMonth = 0;
  const categoryCounts = new Map<string, number>();
  const completedDays = new Set<string>();

  for (const row of (data ?? []) as Array<{
    source_type: string;
    completed_at: string | null;
  }>) {
    if (!row.completed_at) continue;
    const d = new Date(row.completed_at);
    if (Number.isNaN(d.getTime())) continue;

    if (d >= todayStart) completedToday += 1;
    if (d >= weekStart) completedThisWeek += 1;
    if (d >= monthStart) completedThisMonth += 1;

    categoryCounts.set(
      row.source_type,
      (categoryCounts.get(row.source_type) ?? 0) + 1,
    );

    const dayKey = startOfDay(d).toISOString();
    completedDays.add(dayKey);
  }

  // Streak: walk back from today
  let streakDays = 0;
  const cursor = new Date(todayStart);
  while (completedDays.has(cursor.toISOString())) {
    streakDays += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  let topCategory: string | null = null;
  let topCount = 0;
  for (const [cat, count] of categoryCounts) {
    if (count > topCount) {
      topCategory = cat;
      topCount = count;
    }
  }

  return {
    success: true,
    data: {
      completedToday,
      completedThisWeek,
      completedThisMonth,
      streakDays,
      topCategory,
      totalCompleted: totalCount ?? 0,
    },
  };
}

/**
 * Fetch last week's completed tasks as a shareable weekly summary. Returns
 * null if fewer than 2 tasks completed — we never show a summary that
 * would make the user feel bad.
 */
export async function buildWeeklySummary(
  profileId: string,
): Promise<ServiceResult<WeeklySummary | null>> {
  const now = new Date();
  const thisWeekStart = startOfWeek(now);
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);

  const { data, error } = await supabase
    .from('tasks')
    .select('id, title, source_type, completed_at')
    .eq('profile_id', profileId)
    .eq('status', 'completed')
    .is('deleted_at', null)
    .gte('completed_at', lastWeekStart.toISOString())
    .lt('completed_at', thisWeekStart.toISOString())
    .order('completed_at', { ascending: false });

  if (error) return { success: false, error: error.message, code: error.code };
  const rows = (data ?? []) as Array<{
    id: string;
    title: string;
    source_type: string;
    completed_at: string | null;
  }>;
  if (rows.length < 2) return { success: true, data: null };

  const highlights: WeeklyHighlight[] = rows.slice(0, 3).map((r) => ({
    id: r.id,
    title: r.title,
    sourceType: r.source_type,
    completedAt: r.completed_at ?? '',
  }));

  return {
    success: true,
    data: {
      totalCount: rows.length,
      highlights,
      weekStartIso: lastWeekStart.toISOString(),
    },
  };
}

// ── SecureStore gating for weekly summary display ───────────────────────

function keyWeeklyShown(userId: string): string {
  return `task_progress.weekly_shown.${userId}`;
}

function keyStreakAnnounced(userId: string): string {
  return `task_progress.streak_announced.${userId}`;
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
      /* best-effort */
    }
    return;
  }
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    /* best-effort */
  }
}

/**
 * Returns true if the weekly summary for the week starting at `weekStartIso`
 * has not yet been shown to the user (i.e. should surface now).
 */
export async function shouldShowWeeklySummary(
  userId: string,
  weekStartIso: string,
): Promise<boolean> {
  const stored = await readString(keyWeeklyShown(userId));
  return stored !== weekStartIso;
}

export async function markWeeklySummaryShown(
  userId: string,
  weekStartIso: string,
): Promise<void> {
  await writeString(keyWeeklyShown(userId), weekStartIso);
}

/**
 * Streak celebrations are announced once per threshold crossed. Returns
 * the threshold to celebrate (3, 7, 30) or null if none is due.
 */
export async function nextStreakCelebration(
  userId: string,
  streakDays: number,
): Promise<3 | 7 | 30 | null> {
  if (streakDays < 3) return null;
  const stored = await readString(keyStreakAnnounced(userId));
  const lastAnnounced = stored ? parseInt(stored, 10) : 0;

  if (streakDays >= 30 && lastAnnounced < 30) return 30;
  if (streakDays >= 7 && lastAnnounced < 7) return 7;
  if (streakDays >= 3 && lastAnnounced < 3) return 3;
  return null;
}

export async function markStreakAnnounced(
  userId: string,
  threshold: 3 | 7 | 30,
): Promise<void> {
  await writeString(keyStreakAnnounced(userId), String(threshold));
}

/**
 * Reset the announced threshold when a streak breaks (silently, no UI).
 */
export async function resetStreakAnnouncement(userId: string): Promise<void> {
  await writeString(keyStreakAnnounced(userId), '0');
}
