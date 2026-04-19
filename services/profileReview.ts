/**
 * Quarterly Profile Review service.
 *
 * Surfaces a gentle, opt-in check-in that walks the patient through their
 * saved profile and asks "is this still correct?" The goal: catch stale data
 * (stopped meds, former providers, resolved conditions) before it propagates
 * downstream into visit prep, billing, or Ask answers.
 *
 * State is kept small:
 *   • Per-profile "last completed review" — stored in SecureStore so it
 *     survives reinstall of the app on the same device (the canonical
 *     timestamp for "profile was reviewed"). We don't persist it server-side
 *     because the signal doesn't need to travel across devices — the next
 *     device will just nudge the patient to review again, which is the
 *     intent.
 *   • Per-profile "last briefing dismissal" — also SecureStore, 7-day cooldown.
 *   • Per-user "review frequency" preference — SecureStore.
 *
 * All writes to the underlying records (profile_facts, med_medications) go
 * through existing services so audit events + invalidation are consistent.
 */

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { supabase } from '@/lib/supabase';
import { formatProfileFact } from '@/lib/utils/formatProfileFact';
import type {
  ProfileFact,
  ProfileReviewCategory,
  ProfileReviewItem,
  ProfileReviewResult,
  ProfileReviewSection,
  ReviewFrequency,
} from '@/lib/types/profile';
import type {
  Medication,
  MedicationSig,
} from '@/lib/types/medications';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

// ── Constants ──────────────────────────────────────────────────────────────

const MS_PER_DAY = 1000 * 60 * 60 * 24;

const FREQUENCY_DAYS: Record<ReviewFrequency, number | null> = {
  quarterly: 90,
  biannual: 180,
  never: null,
};

/** Minimum profile age before we'll nudge for a review. */
const MIN_PROFILE_AGE_DAYS = 30;
/** Cooldown after a briefing dismissal before re-surfacing. */
const DISMISSAL_COOLDOWN_DAYS = 7;

/** Per-category staleness thresholds (days). */
const STALE_DAYS: Record<ProfileReviewCategory, number> = {
  medications: 180,
  conditions: 365,
  allergies: 730,
  care_team: 365,
  insurance: 180,
  emergency_contact: 365,
};

// ── SecureStore helpers ───────────────────────────────────────────────────

function keyLastReviewed(profileId: string): string {
  return `profile_review.last_reviewed.${profileId}`;
}

function keyLastDismissed(profileId: string): string {
  return `profile_review.last_dismissed.${profileId}`;
}

const KEY_REVIEW_FREQUENCY = 'profile_review.frequency.v1';

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

// ── Public API: timestamps ────────────────────────────────────────────────

export async function getLastReviewedAt(profileId: string): Promise<string | null> {
  return readString(keyLastReviewed(profileId));
}

export async function markReviewCompleted(profileId: string): Promise<void> {
  await writeString(keyLastReviewed(profileId), new Date().toISOString());
}

export async function getLastDismissedAt(profileId: string): Promise<string | null> {
  return readString(keyLastDismissed(profileId));
}

export async function markBriefingDismissed(profileId: string): Promise<void> {
  await writeString(keyLastDismissed(profileId), new Date().toISOString());
}

export async function getReviewFrequency(): Promise<ReviewFrequency> {
  const raw = await readString(KEY_REVIEW_FREQUENCY);
  if (raw === 'quarterly' || raw === 'biannual' || raw === 'never') return raw;
  return 'quarterly';
}

export async function setReviewFrequency(freq: ReviewFrequency): Promise<void> {
  await writeString(KEY_REVIEW_FREQUENCY, freq);
}

// ── Public API: due check ─────────────────────────────────────────────────

/**
 * Should the quarterly review nudge surface for this profile right now?
 *
 * Returns false if:
 *   • The user set `frequency = never`.
 *   • The profile was created < 30 days ago (too early to meaningfully review).
 *   • The review was completed within the current window.
 *   • The briefing was dismissed within the last 7 days.
 */
export async function shouldShowProfileReview(
  profileId: string,
): Promise<boolean> {
  const frequency = await getReviewFrequency();
  const windowDays = FREQUENCY_DAYS[frequency];
  if (windowDays === null) return false;

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('created_at')
    .eq('id', profileId)
    .maybeSingle();
  if (error || !profile) return false;

  const profileAgeDays =
    (Date.now() - new Date(profile.created_at).getTime()) / MS_PER_DAY;
  if (profileAgeDays < MIN_PROFILE_AGE_DAYS) return false;

  const lastReviewed = await getLastReviewedAt(profileId);
  if (lastReviewed) {
    const ageDays = (Date.now() - new Date(lastReviewed).getTime()) / MS_PER_DAY;
    if (ageDays < windowDays) return false;
  }

  const lastDismissed = await getLastDismissedAt(profileId);
  if (lastDismissed) {
    const ageDays = (Date.now() - new Date(lastDismissed).getTime()) / MS_PER_DAY;
    if (ageDays < DISMISSAL_COOLDOWN_DAYS) return false;
  }

  return true;
}

// ── Public API: review generation ─────────────────────────────────────────

interface GenerateReviewParams {
  profileId: string;
  householdId: string;
}

/**
 * Fetch all categories in parallel and build a ProfileReviewResult. The
 * result is a snapshot — the UI iterates sections one at a time and calls
 * back into this service to confirm/update/remove individual items.
 */
export async function generateProfileReview(
  params: GenerateReviewParams,
): Promise<ServiceResult<ProfileReviewResult>> {
  const { profileId } = params;

  const [medsRes, factsRes, lastReviewedAt] = await Promise.all([
    supabase
      .from('med_medications')
      .select('*')
      .eq('profile_id', profileId)
      .is('deleted_at', null)
      .eq('status', 'active')
      .order('drug_name', { ascending: true }),
    supabase
      .from('profile_facts')
      .select('*')
      .eq('profile_id', profileId)
      .is('deleted_at', null),
    getLastReviewedAt(profileId),
  ]);

  if (medsRes.error) {
    return { success: false, error: medsRes.error.message, code: medsRes.error.code };
  }
  if (factsRes.error) {
    return { success: false, error: factsRes.error.message, code: factsRes.error.code };
  }

  const medications = (medsRes.data ?? []) as Medication[];
  const facts = (factsRes.data ?? []) as ProfileFact[];

  // Fetch the latest sig per medication so we can label dose + frequency.
  let sigsByMed = new Map<string, MedicationSig>();
  if (medications.length > 0) {
    const medIds = medications.map((m) => m.id);
    const { data: sigs } = await supabase
      .from('med_medication_sigs')
      .select('*')
      .in('medication_id', medIds)
      .order('created_at', { ascending: false });
    for (const sig of (sigs ?? []) as MedicationSig[]) {
      if (!sigsByMed.has(sig.medication_id)) {
        sigsByMed.set(sig.medication_id, sig);
      }
    }
  }

  const sections: ProfileReviewSection[] = [
    buildMedicationsSection(medications, sigsByMed),
    buildFactSection(
      'conditions',
      'Conditions',
      'pulse',
      facts.filter((f) => f.category === 'condition'),
    ),
    buildFactSection(
      'allergies',
      'Allergies',
      'alert-circle-outline',
      facts.filter((f) => f.category === 'allergy'),
    ),
    buildFactSection(
      'care_team',
      'Care Team',
      'people-outline',
      facts.filter((f) => f.category === 'care_team'),
    ),
    buildFactSection(
      'insurance',
      'Insurance',
      'shield-outline',
      facts.filter((f) => f.category === 'insurance'),
    ),
    buildFactSection(
      'emergency_contact',
      'Emergency Contacts',
      'call-outline',
      facts.filter((f) => f.category === 'emergency_contact'),
    ),
  ];

  const totalItems = sections.reduce((sum, s) => sum + s.items.length, 0);
  const staleItems = sections.reduce(
    (sum, s) => sum + s.items.filter((i) => i.isStale).length,
    0,
  );

  return {
    success: true,
    data: { sections, totalItems, staleItems, lastReviewedAt },
  };
}

// ── Section builders ──────────────────────────────────────────────────────

function buildMedicationsSection(
  medications: Medication[],
  sigsByMed: Map<string, MedicationSig>,
): ProfileReviewSection {
  const items: ProfileReviewItem[] = medications.map((med) => {
    const sig = sigsByMed.get(med.id);
    const namePart = [med.drug_name, med.strength].filter(Boolean).join(' ');
    const sigPart = sig?.dose_text
      ? sig.frequency_text
        ? `${sig.dose_text} — ${sig.frequency_text}`
        : sig.dose_text
      : sig?.frequency_text ?? '';
    const label = [namePart, sigPart].filter(Boolean).join(' — ');
    return {
      id: `med:${med.id}`,
      label: label || med.drug_name,
      detail: describeAge(med.updated_at),
      lastUpdated: med.updated_at,
      isStale: daysSince(med.updated_at) > STALE_DAYS.medications,
      sourceType: 'medication',
      sourceId: med.id,
    };
  });

  return {
    category: 'medications',
    title: 'Medications',
    icon: 'medkit-outline',
    items,
    isEmpty: items.length === 0,
  };
}

function buildFactSection(
  category: ProfileReviewCategory,
  title: string,
  icon: string,
  facts: ProfileFact[],
): ProfileReviewSection {
  const items: ProfileReviewItem[] = facts.map((fact) => {
    const formatted = formatProfileFact(fact);
    // For stale detection we prefer verified_at (set by prior reviews) and
    // fall back to updated_at. If the patient has never verified the fact,
    // we use the created_at implicitly via updated_at.
    const lastConfirmed = fact.verified_at ?? fact.updated_at;
    return {
      id: `fact:${fact.id}`,
      label: formatted.title,
      detail: describeAge(lastConfirmed),
      lastUpdated: lastConfirmed,
      isStale: daysSince(lastConfirmed) > STALE_DAYS[category],
      sourceType: 'profile_fact',
      sourceId: fact.id,
    };
  });

  return {
    category,
    title,
    icon,
    items,
    isEmpty: items.length === 0,
  };
}

// ── Public API: confirm / remove ──────────────────────────────────────────

/**
 * Mark a single review item as "still correct". For profile facts this bumps
 * verification_status → verified and sets verified_at. For medications we
 * touch updated_at so freshness indicators downstream reflect the review.
 */
export async function confirmReviewItem(
  item: ProfileReviewItem,
  userId: string,
): Promise<ServiceResult<null>> {
  if (item.sourceType === 'profile_fact') {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('profile_facts')
      .update({
        verification_status: 'verified',
        verified_at: now,
        verified_by: userId,
      })
      .eq('id', item.sourceId);
    if (error) return { success: false, error: error.message, code: error.code };
    return { success: true, data: null };
  }

  if (item.sourceType === 'medication') {
    // Touch updated_at by re-writing a no-op (status same) — the row's
    // trigger will bump updated_at. We use status=active explicitly so the
    // update resolves to a single row.
    const { data: existing, error: fetchError } = await supabase
      .from('med_medications')
      .select('status')
      .eq('id', item.sourceId)
      .maybeSingle();
    if (fetchError) {
      return { success: false, error: fetchError.message, code: fetchError.code };
    }
    if (!existing) return { success: false, error: 'Medication not found' };

    const { error } = await supabase
      .from('med_medications')
      .update({ status: existing.status, updated_at: new Date().toISOString() })
      .eq('id', item.sourceId);
    if (error) return { success: false, error: error.message, code: error.code };
    return { success: true, data: null };
  }

  return { success: false, error: 'Unknown source type' };
}

/**
 * Batch-confirm every item in a section. Used by the "All correct" fast path.
 */
export async function confirmSection(
  section: ProfileReviewSection,
  userId: string,
): Promise<ServiceResult<{ confirmed: number }>> {
  let confirmed = 0;
  for (const item of section.items) {
    const res = await confirmReviewItem(item, userId);
    if (res.success) confirmed++;
  }
  return { success: true, data: { confirmed } };
}

/**
 * Remove an item from the patient's active profile.
 *   • Medication → status = stopped (preserves history).
 *   • Profile fact → soft-delete (deleted_at).
 *
 * Every removal logs an audit event so the change is reviewable in the
 * audit trail.
 */
export async function removeReviewItem(
  item: ProfileReviewItem,
  profileId: string,
  userId: string,
): Promise<ServiceResult<null>> {
  if (item.sourceType === 'medication') {
    const { error } = await supabase
      .from('med_medications')
      .update({ status: 'stopped' })
      .eq('id', item.sourceId);
    if (error) return { success: false, error: error.message, code: error.code };

    await supabase.from('audit_events').insert({
      profile_id: profileId,
      actor_id: userId,
      event_type: 'medication.stopped',
      metadata: {
        medication_id: item.sourceId,
        new_status: 'stopped',
        trigger: 'profile_review',
      },
    });
    return { success: true, data: null };
  }

  if (item.sourceType === 'profile_fact') {
    const { error } = await supabase
      .from('profile_facts')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', item.sourceId);
    if (error) return { success: false, error: error.message, code: error.code };

    await supabase.from('audit_events').insert({
      profile_id: profileId,
      actor_id: userId,
      event_type: 'profile_fact.archived',
      metadata: {
        fact_id: item.sourceId,
        trigger: 'profile_review',
      },
    });
    return { success: true, data: null };
  }

  return { success: false, error: 'Unknown source type' };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / MS_PER_DAY);
}

function describeAge(iso: string): string {
  const days = daysSince(iso);
  if (days <= 0) return 'Updated today';
  if (days === 1) return 'Updated yesterday';
  if (days < 30) return `Updated ${days} days ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return 'Updated 1 month ago';
  if (months < 12) return `Updated ${months} months ago`;
  const years = Math.floor(months / 12);
  return years === 1 ? 'Updated 1 year ago' : `Updated ${years} years ago`;
}
