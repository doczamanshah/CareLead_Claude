/**
 * Caregiver enrichment service.
 *
 * When a caregiver is viewing a profile they help manage, surface a small
 * set of gentle prompts asking for information they likely have that the
 * patient hasn't entered yet — medications, allergies, insurance, etc.
 *
 * Rules the service enforces:
 *   • Only runs for profiles where the current user is a caregiver (not the
 *     owner). Owner-side gaps are handled by the Strengthen Profile flow.
 *   • Max 2 prompts per Home visit (caller slices). Safety-critical prompts
 *     (allergies, medications) come first.
 *   • 14-day cooldown per-prompt after dismissal (SecureStore keyed).
 *   • `caregiver_onboarded_[profileId]` flag suppresses prompts until the
 *     caregiver has seen the contribute screen at least once.
 */

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { supabase } from '@/lib/supabase';
import type {
  CaregiverEnrichmentKind,
  CaregiverEnrichmentPrompt,
} from '@/lib/types/caregivers';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const DISMISSAL_COOLDOWN_DAYS = 14;
const MED_STALE_DAYS = 90;
const RECENT_APPOINTMENT_HOURS = 48;

// ── SecureStore helpers ───────────────────────────────────────────────────

function keyOnboarded(caregiverUserId: string, profileId: string): string {
  return `caregiver_onboarded.${caregiverUserId}.${profileId}`;
}

function keyDismissed(caregiverUserId: string, promptKind: CaregiverEnrichmentKind, profileId: string): string {
  return `caregiver_enrichment_dismissed.${caregiverUserId}.${profileId}.${promptKind}`;
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

// ── Onboarding flag ───────────────────────────────────────────────────────

export async function isCaregiverOnboarded(
  caregiverUserId: string,
  profileId: string,
): Promise<boolean> {
  const raw = await readString(keyOnboarded(caregiverUserId, profileId));
  return raw === 'true';
}

export async function markCaregiverOnboarded(
  caregiverUserId: string,
  profileId: string,
): Promise<void> {
  await writeString(keyOnboarded(caregiverUserId, profileId), 'true');
}

// ── Dismissal cooldown ────────────────────────────────────────────────────

async function isPromptOnCooldown(
  caregiverUserId: string,
  kind: CaregiverEnrichmentKind,
  profileId: string,
): Promise<boolean> {
  const raw = await readString(keyDismissed(caregiverUserId, kind, profileId));
  if (!raw) return false;
  const dismissedAt = new Date(raw).getTime();
  if (Number.isNaN(dismissedAt)) return false;
  const daysSince = (Date.now() - dismissedAt) / MS_PER_DAY;
  return daysSince < DISMISSAL_COOLDOWN_DAYS;
}

export async function dismissCaregiverPrompt(
  caregiverUserId: string,
  kind: CaregiverEnrichmentKind,
  profileId: string,
): Promise<void> {
  await writeString(
    keyDismissed(caregiverUserId, kind, profileId),
    new Date().toISOString(),
  );
}

// ── Role detection ────────────────────────────────────────────────────────

/**
 * Is the current user acting as a caregiver for this profile (not the
 * owner/patient)?
 *
 * A profile's owner is the user whose `user_id` matches the profile row; any
 * other user with an active access grant is a caregiver.
 */
export async function isCaregiverForProfile(
  userId: string,
  profileId: string,
): Promise<ServiceResult<boolean>> {
  const [profileRes, grantRes] = await Promise.all([
    supabase.from('profiles').select('user_id').eq('id', profileId).maybeSingle(),
    supabase
      .from('profile_access_grants')
      .select('id')
      .eq('profile_id', profileId)
      .eq('grantee_user_id', userId)
      .eq('status', 'active')
      .limit(1),
  ]);

  if (profileRes.error) {
    return { success: false, error: profileRes.error.message, code: profileRes.error.code };
  }
  if (grantRes.error) {
    return { success: false, error: grantRes.error.message, code: grantRes.error.code };
  }

  const isOwner = profileRes.data?.user_id === userId;
  const hasGrant = (grantRes.data ?? []).length > 0;
  return { success: true, data: !isOwner && hasGrant };
}

// ── Prompt generation ─────────────────────────────────────────────────────

interface EnrichmentParams {
  caregiverId: string;
  profileId: string;
  householdId: string;
}

/**
 * Produce up to N caregiver-enrichment prompts for a profile, filtered by
 * the 14-day dismissal cooldown and sorted with safety-critical items first.
 */
export async function getCaregiverEnrichmentPrompts(
  params: EnrichmentParams,
  max: number = 2,
): Promise<ServiceResult<CaregiverEnrichmentPrompt[]>> {
  const { caregiverId, profileId } = params;

  const [profileRes, factsRes, medsRes, appointmentsRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('display_name')
      .eq('id', profileId)
      .maybeSingle(),
    supabase
      .from('profile_facts')
      .select('category, updated_at')
      .eq('profile_id', profileId)
      .is('deleted_at', null),
    supabase
      .from('med_medications')
      .select('id, status, updated_at')
      .eq('profile_id', profileId)
      .is('deleted_at', null),
    supabase
      .from('apt_appointments')
      .select('id, start_time, status, post_visit_captured')
      .eq('profile_id', profileId)
      .is('deleted_at', null)
      .lte('start_time', new Date().toISOString())
      .gte(
        'start_time',
        new Date(Date.now() - RECENT_APPOINTMENT_HOURS * 60 * 60 * 1000).toISOString(),
      )
      .order('start_time', { ascending: false })
      .limit(3),
  ]);

  if (profileRes.error) {
    return { success: false, error: profileRes.error.message, code: profileRes.error.code };
  }
  if (factsRes.error) {
    return { success: false, error: factsRes.error.message, code: factsRes.error.code };
  }
  if (medsRes.error) {
    return { success: false, error: medsRes.error.message, code: medsRes.error.code };
  }

  const patientName = profileRes.data?.display_name?.trim() || 'your loved one';
  const facts = (factsRes.data ?? []) as { category: string; updated_at: string }[];
  const meds = (medsRes.data ?? []) as {
    id: string;
    status: string;
    updated_at: string;
  }[];
  const recentAppointments = (appointmentsRes.data ?? []) as {
    id: string;
    start_time: string;
    status: string;
    post_visit_captured: boolean;
  }[];

  const hasMedications = meds.some((m) => m.status === 'active');
  const hasAllergies = facts.some((f) => f.category === 'allergy');
  const hasConditions = facts.some((f) => f.category === 'condition');
  const hasInsurance = facts.some((f) => f.category === 'insurance');

  const latestMedUpdate = meds.reduce<string | null>((latest, m) => {
    if (m.status !== 'active') return latest;
    if (!latest) return m.updated_at;
    return m.updated_at > latest ? m.updated_at : latest;
  }, null);
  const daysSinceMedUpdate = latestMedUpdate
    ? (Date.now() - new Date(latestMedUpdate).getTime()) / MS_PER_DAY
    : Number.POSITIVE_INFINITY;

  const uncapturedRecent = recentAppointments.find(
    (apt) =>
      !apt.post_visit_captured &&
      apt.status !== 'cancelled' &&
      apt.status !== 'rescheduled',
  );

  const candidates: CaregiverEnrichmentPrompt[] = [];

  // Safety-critical first.
  if (!hasAllergies) {
    candidates.push({
      id: `caregiver_enrich.add_allergies.${profileId}`,
      kind: 'add_allergies',
      profileId,
      patientName,
      title: `Does ${patientName} have any allergies?`,
      detail: 'This is critical safety information for every provider they see.',
      actionLabel: 'Add allergies',
      actionRoute: `/(main)/profile/${profileId}/add-fact`,
      actionParams: { category: 'allergy' },
      priority: 'high',
    });
  }

  if (!hasMedications) {
    candidates.push({
      id: `caregiver_enrich.add_medications.${profileId}`,
      kind: 'add_medications',
      profileId,
      patientName,
      title: `Does ${patientName} take any medications?`,
      detail: 'Adding them helps track refills, doses, and interactions.',
      actionLabel: 'Add medications',
      actionRoute: '/(main)/medications/create',
      priority: 'high',
    });
  }

  if (!hasInsurance) {
    candidates.push({
      id: `caregiver_enrich.add_insurance.${profileId}`,
      kind: 'add_insurance',
      profileId,
      patientName,
      title: `Does ${patientName} have insurance?`,
      detail: 'Snap their card to save plan details for appointments and bills.',
      actionLabel: 'Snap insurance',
      actionRoute: '/(main)/capture/camera',
      priority: 'medium',
    });
  }

  if (!hasConditions && hasMedications) {
    candidates.push({
      id: `caregiver_enrich.link_conditions.${profileId}`,
      kind: 'link_conditions_to_meds',
      profileId,
      patientName,
      title: `What conditions is ${patientName} being treated for?`,
      detail: 'Linking conditions to their meds helps with visit prep and refills.',
      actionLabel: 'Add conditions',
      actionRoute: `/(main)/profile/${profileId}/add-fact`,
      actionParams: { category: 'condition' },
      priority: 'medium',
    });
  }

  if (uncapturedRecent) {
    candidates.push({
      id: `caregiver_enrich.capture_visit.${profileId}.${uncapturedRecent.id}`,
      kind: 'capture_recent_visit',
      profileId,
      patientName,
      title: `Did ${patientName} see a doctor recently?`,
      detail: 'Capture what happened while it\u2019s fresh — meds, referrals, follow-ups.',
      actionLabel: 'Capture visit',
      actionRoute: `/(main)/appointments/${uncapturedRecent.id}/post-visit-capture`,
      priority: 'medium',
    });
  }

  if (hasMedications && daysSinceMedUpdate > MED_STALE_DAYS) {
    candidates.push({
      id: `caregiver_enrich.refresh_meds.${profileId}`,
      kind: 'refresh_medications',
      profileId,
      patientName,
      title: `${patientName}'s medication list hasn\u2019t been updated in a while.`,
      detail: 'Is it still accurate? A quick review keeps everyone on the same page.',
      actionLabel: 'Review meds',
      actionRoute: '/(main)/medications',
      priority: 'low',
    });
  }

  // Filter by dismissal cooldown — check each candidate's kind in parallel.
  const cooldownChecks = await Promise.all(
    candidates.map((c) => isPromptOnCooldown(caregiverId, c.kind, profileId)),
  );
  const live = candidates.filter((_, i) => !cooldownChecks[i]);

  const priorityOrder: Record<CaregiverEnrichmentPrompt['priority'], number> = {
    high: 0,
    medium: 1,
    low: 2,
  };
  live.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return { success: true, data: live.slice(0, max) };
}
