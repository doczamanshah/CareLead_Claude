/**
 * Smart Enrichment Engine — context-aware profile enrichment nudges.
 *
 * Replaces the static "Strengthen Your Profile" checklist with a dynamic,
 * prioritized set of SmartNudges that adapt to what's actually happening in
 * the user's care (upcoming appointments, stale med list, missing pharmacy,
 * etc.) and celebrate genuine milestones.
 *
 * Pure function: takes a snapshot of profile data and returns nudges sorted
 * by effective score. Persistence of dismissals and earned milestones is
 * handled by services/enrichmentPersistence.ts.
 */

import type { ProfileFact } from '@/lib/types/profile';
import type { Medication } from '@/lib/types/medications';
import type { ResultItem } from '@/lib/types/results';
import type { Appointment } from '@/lib/types/appointments';
import type { PreventiveItem, PreventiveItemWithRule } from '@/lib/types/preventive';
import type { BillingCase, BillingCaseWithDocCount } from '@/lib/types/billing';

// ── Types ─────────────────────────────────────────────────────────────────

export type NudgeType = 'contextual' | 'gap' | 'micro' | 'milestone';

export type EnrichmentCategory =
  | 'safety'
  | 'care_coordination'
  | 'daily_management'
  | 'financial'
  | 'completeness';

export type EffortLevel = 'instant' | 'quick' | 'moderate';

export type QuickActionType =
  | 'confirm_meds'
  | 'confirm_allergies'
  | 'add_single_med'
  | 'add_allergy'
  | 'snap_insurance'
  | 'set_dob'
  | 'set_sex'
  | 'add_pharmacy'
  | 'add_emergency_contact';

export interface SmartNudge {
  id: string;
  type: NudgeType;
  priority: number;
  title: string;
  detail: string;
  icon: string;
  iconColor: string;
  actionLabel: string;
  actionRoute?: string;
  actionParams?: Record<string, string>;
  quickAction?: QuickActionType;
  dismissable: boolean;
  category: EnrichmentCategory;
  impactScore: number;
  effortLevel: EffortLevel;
  expiresAt?: string;
}

export type MilestoneId =
  | 'facts_10'
  | 'facts_25'
  | 'facts_50'
  | 'first_medication'
  | 'first_result'
  | 'first_preventive_complete'
  | 'allergies_confirmed'
  | 'preventive_all_up_to_date'
  | 'profile_reviewed';

export interface Milestone {
  id: MilestoneId;
  title: string;
  detail: string;
  icon: string;
}

export const MILESTONE_CATALOG: Record<MilestoneId, Milestone> = {
  facts_10: {
    id: 'facts_10',
    title: 'Your profile is growing',
    detail: '10 health facts and counting.',
    icon: 'leaf-outline',
  },
  facts_25: {
    id: 'facts_25',
    title: 'Impressive progress',
    detail: '25 facts make your profile more useful than most.',
    icon: 'trending-up',
  },
  facts_50: {
    id: 'facts_50',
    title: 'Comprehensive profile',
    detail: "50+ facts — that's rare and valuable.",
    icon: 'ribbon',
  },
  first_medication: {
    id: 'first_medication',
    title: 'First medication tracked',
    detail: 'CareLead can now help with refills and interactions.',
    icon: 'medkit',
  },
  first_result: {
    id: 'first_result',
    title: 'First result recorded',
    detail: 'You can track trends over time.',
    icon: 'flask',
  },
  first_preventive_complete: {
    id: 'first_preventive_complete',
    title: 'Screening complete',
    detail: 'Staying on top of preventive care is powerful.',
    icon: 'shield-checkmark',
  },
  allergies_confirmed: {
    id: 'allergies_confirmed',
    title: 'Allergy status confirmed',
    detail: 'This keeps you safe.',
    icon: 'alert-circle',
  },
  preventive_all_up_to_date: {
    id: 'preventive_all_up_to_date',
    title: 'All screenings current',
    detail: "You're ahead of most patients.",
    icon: 'checkmark-done-circle',
  },
  profile_reviewed: {
    id: 'profile_reviewed',
    title: 'Profile review complete',
    detail: 'Everything is up to date.',
    icon: 'refresh-circle',
  },
};

// ── Input shape ───────────────────────────────────────────────────────────

export interface RecentActivityEntry {
  type: string;
  date: string;
}

export interface GenerateNudgesParams {
  profileId: string;
  householdId: string;
  profile: {
    id: string;
    date_of_birth: string | null;
    gender: string | null;
    created_at: string;
    display_name: string;
  };
  profileFacts: ProfileFact[];
  medications: Medication[];
  results: ResultItem[];
  appointments: Appointment[];
  preventiveItems: (PreventiveItem | PreventiveItemWithRule)[];
  billingCases: (BillingCase | BillingCaseWithDocCount)[];
  recentActivity?: RecentActivityEntry[];
  /** Last opened date (ISO). If older than 7 days we nudge a welcome-back. */
  lastOpenedAt?: string | null;
  /** Dismissal map: nudgeId → dismissedAt ISO string. */
  dismissedAt?: Record<string, string>;
  /** IDs of milestones already earned — never re-emitted. */
  earnedMilestones?: MilestoneId[];
}

// ── Helpers ───────────────────────────────────────────────────────────────

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const DISMISSAL_COOLDOWN_DAYS = 14;

function unwrapValue(
  valueJson: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!valueJson) return {};
  if (
    Object.keys(valueJson).length === 1 &&
    'value' in valueJson &&
    typeof valueJson.value === 'object' &&
    valueJson.value !== null
  ) {
    return valueJson.value as Record<string, unknown>;
  }
  return valueJson;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  return String(v);
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / MS_PER_DAY);
}

function daysAgo(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / MS_PER_DAY);
}

function isDismissalActive(
  nudgeId: string,
  dismissedAt: Record<string, string> | undefined,
): boolean {
  if (!dismissedAt) return false;
  const iso = dismissedAt[nudgeId];
  if (!iso) return false;
  const age = daysAgo(iso);
  return age !== null && age < DISMISSAL_COOLDOWN_DAYS;
}

function effortBonus(level: EffortLevel): number {
  if (level === 'instant') return 30;
  if (level === 'quick') return 20;
  return 10;
}

/** Combined score used to rank nudges. Higher = surfaces first. */
export function scoreNudge(n: SmartNudge): number {
  return n.priority * 0.6 + n.impactScore * 10 * 0.3 + effortBonus(n.effortLevel) * 0.1;
}

// ── Main engine ───────────────────────────────────────────────────────────

export function generateSmartNudges(params: GenerateNudgesParams): SmartNudge[] {
  const {
    profileId,
    profile,
    profileFacts,
    medications,
    results,
    appointments,
    preventiveItems,
    billingCases,
    lastOpenedAt,
    dismissedAt,
    earnedMilestones = [],
  } = params;

  const nudges: SmartNudge[] = [];

  const hasCategory = (cat: string) =>
    profileFacts.some((f) => f.category === cat);

  const factsInCategory = (cat: string) =>
    profileFacts.filter((f) => f.category === cat);

  const now = new Date();
  const nowIso = now.toISOString();

  // ── SAFETY CRITICAL ─────────────────────────────────────────────────────

  // No allergies on file (includes "NKDA" as having allergies confirmed)
  const allergyFacts = factsInCategory('allergy');
  if (allergyFacts.length === 0) {
    nudges.push({
      id: 'safety.allergies.none',
      type: 'micro',
      priority: 98,
      title: 'Do you have any allergies?',
      detail:
        "Drug allergies are critical safety information. Even 'no known allergies' is important to record.",
      icon: 'alert-circle',
      iconColor: '#DC2626',
      actionLabel: 'Answer now',
      quickAction: 'confirm_allergies',
      dismissable: true,
      category: 'safety',
      impactScore: 10,
      effortLevel: 'instant',
    });
  }

  // No emergency contacts
  if (!hasCategory('emergency_contact')) {
    nudges.push({
      id: 'safety.emergency_contact.none',
      type: 'micro',
      priority: 92,
      title: 'Who should be contacted in an emergency?',
      detail: 'Add an emergency contact so help can reach the right people.',
      icon: 'call',
      iconColor: '#DC2626',
      actionLabel: 'Add contact',
      quickAction: 'add_emergency_contact',
      dismissable: true,
      category: 'safety',
      impactScore: 10,
      effortLevel: 'quick',
    });
  }

  // ── CARE COORDINATION ───────────────────────────────────────────────────

  const activeMeds = medications.filter((m) => m.status === 'active');
  const conditionFacts = factsInCategory('condition');

  // Has conditions but no medications
  if (conditionFacts.length > 0 && activeMeds.length === 0) {
    const firstCondition = unwrapValue(conditionFacts[0].value_json);
    const conditionName =
      str(firstCondition.name) ??
      str(firstCondition.condition_name) ??
      'your condition';
    nudges.push({
      id: 'care.meds_for_condition.missing',
      type: 'gap',
      priority: 85,
      title: `Are you taking any medications for ${conditionName}?`,
      detail: 'Tracking medications unlocks refill reminders and interaction checks.',
      icon: 'medkit-outline',
      iconColor: '#0C3B2E',
      actionLabel: 'Add medication',
      actionRoute: '/(main)/medications/create',
      dismissable: true,
      category: 'care_coordination',
      impactScore: 9,
      effortLevel: 'quick',
    });
  }

  // Upcoming appointment + stale med list (no med updates in 180 days)
  const upcomingAppointments = appointments
    .filter((a) =>
      (a.status === 'scheduled' || a.status === 'preparing' || a.status === 'ready') &&
      a.start_time >= nowIso,
    )
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  const nextAppointment = upcomingAppointments[0] ?? null;

  if (nextAppointment && activeMeds.length > 0) {
    const mostRecentMedUpdate = activeMeds.reduce((latest, m) => {
      const t = new Date(m.updated_at).getTime();
      return t > latest ? t : latest;
    }, 0);
    const daysSince = Math.floor((Date.now() - mostRecentMedUpdate) / MS_PER_DAY);
    const apptDate = new Date(nextAppointment.start_time);
    const daysUntil = daysBetween(now, apptDate);
    if (daysSince >= 180 && daysUntil >= 0 && daysUntil <= 14) {
      const provider = nextAppointment.provider_name ?? 'your provider';
      nudges.push({
        id: `care.stale_meds.${nextAppointment.id}`,
        type: 'contextual',
        priority: 88,
        title: `Appointment with ${provider} in ${daysUntil} ${daysUntil === 1 ? 'day' : 'days'}`,
        detail: 'Is your medication list still current? Confirm now to save time at the visit.',
        icon: 'medkit',
        iconColor: '#B46617',
        actionLabel: 'Confirm meds',
        quickAction: 'confirm_meds',
        dismissable: true,
        category: 'care_coordination',
        impactScore: 9,
        effortLevel: 'instant',
        expiresAt: nextAppointment.start_time,
      });
    }
  }

  // Has medications but no prescriber info
  const medsWithoutPrescriber = activeMeds.filter((m) => {
    const sourceFact = profileFacts.find(
      (f) => f.category === 'medication' && unwrapValue(f.value_json).drug_name === m.drug_name,
    );
    if (!sourceFact) return true;
    const val = unwrapValue(sourceFact.value_json);
    return !str(val.prescriber);
  });
  if (medsWithoutPrescriber.length > 0 && activeMeds.length > 0) {
    const firstMed = medsWithoutPrescriber[0];
    nudges.push({
      id: `care.prescriber_missing.${firstMed.id}`,
      type: 'gap',
      priority: 74,
      title: `Who prescribes your ${firstMed.drug_name}?`,
      detail: 'This helps with refill calls and provider-specific tasks.',
      icon: 'person-outline',
      iconColor: '#0C3B2E',
      actionLabel: 'Add prescriber',
      actionRoute: `/(main)/medications/${firstMed.id}`,
      dismissable: true,
      category: 'care_coordination',
      impactScore: 7,
      effortLevel: 'instant',
    });
  }

  // No insurance info
  if (!hasCategory('insurance')) {
    nudges.push({
      id: 'care.insurance.none',
      type: 'gap',
      priority: 78,
      title: 'Add your insurance info',
      detail: 'Snap a photo of your insurance card — CareLead will fill in the details.',
      icon: 'card-outline',
      iconColor: '#0C3B2E',
      actionLabel: 'Snap a photo',
      quickAction: 'snap_insurance',
      dismissable: true,
      category: 'care_coordination',
      impactScore: 8,
      effortLevel: 'quick',
    });
  }

  // Results needing review
  const needsReviewResults = results.filter((r) => r.status === 'needs_review');
  if (needsReviewResults.length > 0) {
    const r = needsReviewResults[0];
    nudges.push({
      id: `care.result_review.${r.id}`,
      type: 'contextual',
      priority: 72,
      title: `Your ${r.test_name} results are ready for review`,
      detail: 'Quick check keeps your trends accurate.',
      icon: 'flask',
      iconColor: '#B46617',
      actionLabel: 'Review',
      actionRoute: `/(main)/results/${r.id}/review`,
      dismissable: true,
      category: 'care_coordination',
      impactScore: 7,
      effortLevel: 'quick',
    });
  }

  // ── DAILY MANAGEMENT ────────────────────────────────────────────────────

  // Has meds but no pharmacy
  if (activeMeds.length > 0 && !hasCategory('pharmacy')) {
    nudges.push({
      id: 'daily.pharmacy.missing',
      type: 'micro',
      priority: 68,
      title: 'Where do you fill your prescriptions?',
      detail: 'Adding your pharmacy enables refill reminders.',
      icon: 'storefront-outline',
      iconColor: '#0C3B2E',
      actionLabel: 'Add pharmacy',
      quickAction: 'add_pharmacy',
      dismissable: true,
      category: 'daily_management',
      impactScore: 7,
      effortLevel: 'instant',
    });
  }

  // Has meds but no refill / last-fill dates — check medication_facts
  const medsWithoutRefillInfo = activeMeds.filter((m) => {
    const fact = profileFacts.find(
      (f) => f.category === 'medication' && unwrapValue(f.value_json).drug_name === m.drug_name,
    );
    if (!fact) return true;
    const v = unwrapValue(fact.value_json);
    return !str(v.last_fill_date) && !str(v.refills_remaining);
  });
  if (medsWithoutRefillInfo.length > 0 && activeMeds.length > 0 && hasCategory('pharmacy')) {
    const m = medsWithoutRefillInfo[0];
    nudges.push({
      id: `daily.refill_dates.${m.id}`,
      type: 'gap',
      priority: 60,
      title: `When was ${m.drug_name} last filled?`,
      detail: 'This helps CareLead track refills and avoid lapses.',
      icon: 'calendar-outline',
      iconColor: '#0C3B2E',
      actionLabel: 'Update',
      actionRoute: `/(main)/medications/${m.id}`,
      dismissable: true,
      category: 'daily_management',
      impactScore: 6,
      effortLevel: 'instant',
    });
  }

  // No conditions listed
  if (conditionFacts.length === 0) {
    nudges.push({
      id: 'daily.conditions.none',
      type: 'gap',
      priority: 58,
      title: 'Do you have any ongoing health conditions?',
      detail: 'Tracking conditions helps CareLead suggest relevant tasks and screenings.',
      icon: 'medical-outline',
      iconColor: '#0C3B2E',
      actionLabel: 'Add condition',
      actionRoute: `/(main)/profile/${profileId}/add-fact`,
      actionParams: { category: 'condition' },
      dismissable: true,
      category: 'daily_management',
      impactScore: 6,
      effortLevel: 'quick',
    });
  }

  // Has conditions but no care team
  if (conditionFacts.length > 0 && !hasCategory('care_team')) {
    const firstCondition = unwrapValue(conditionFacts[0].value_json);
    const conditionName =
      str(firstCondition.name) ??
      str(firstCondition.condition_name) ??
      'your condition';
    nudges.push({
      id: 'daily.care_team_for_condition.missing',
      type: 'gap',
      priority: 55,
      title: `Who manages your ${conditionName}?`,
      detail: "Adding your care team sets up provider-specific tasks.",
      icon: 'people-outline',
      iconColor: '#0C3B2E',
      actionLabel: 'Add provider',
      actionParams: { category: 'care_team' },
      actionRoute: `/(main)/profile/${profileId}/add-fact`,
      dismissable: true,
      category: 'daily_management',
      impactScore: 6,
      effortLevel: 'instant',
    });
  }

  // ── FINANCIAL ───────────────────────────────────────────────────────────

  // Appointments but no insurance
  if (upcomingAppointments.length > 0 && !hasCategory('insurance')) {
    nudges.push({
      id: 'financial.insurance_before_visit',
      type: 'contextual',
      priority: 48,
      title: 'Add insurance before your next visit',
      detail: 'Save time at check-in by having your insurance on file.',
      icon: 'card-outline',
      iconColor: '#B46617',
      actionLabel: 'Snap card',
      quickAction: 'snap_insurance',
      dismissable: true,
      category: 'financial',
      impactScore: 5,
      effortLevel: 'quick',
    });
  }

  // Active billing cases with missing info
  const activeBillingCases = billingCases.filter(
    (c) => c.status !== 'resolved' && c.status !== 'closed',
  );
  const billingCaseMissingInfo = activeBillingCases.find(
    (c) => !c.provider_name || !c.payer_name,
  );
  if (billingCaseMissingInfo) {
    nudges.push({
      id: `financial.billing_incomplete.${billingCaseMissingInfo.id}`,
      type: 'gap',
      priority: 42,
      title: `${billingCaseMissingInfo.title} needs more info`,
      detail: 'Provider or payer details are missing. Add them for better analysis.',
      icon: 'receipt-outline',
      iconColor: '#B46617',
      actionLabel: 'Update case',
      actionRoute: `/(main)/billing/${billingCaseMissingInfo.id}`,
      dismissable: true,
      category: 'financial',
      impactScore: 5,
      effortLevel: 'moderate',
    });
  }

  // ── COMPLETENESS ────────────────────────────────────────────────────────

  if (!profile.date_of_birth) {
    nudges.push({
      id: 'completeness.dob',
      type: 'micro',
      priority: 38,
      title: "What's your date of birth?",
      detail: 'This unlocks preventive care recommendations tailored to your age.',
      icon: 'calendar-number-outline',
      iconColor: '#0C3B2E',
      actionLabel: 'Set date',
      quickAction: 'set_dob',
      dismissable: true,
      category: 'completeness',
      impactScore: 4,
      effortLevel: 'instant',
    });
  }

  if (!profile.gender) {
    nudges.push({
      id: 'completeness.sex',
      type: 'micro',
      priority: 36,
      title: 'Adding your sex helps recommend the right screenings',
      detail: 'Preventive care recommendations depend on this.',
      icon: 'body-outline',
      iconColor: '#0C3B2E',
      actionLabel: 'Select',
      quickAction: 'set_sex',
      dismissable: true,
      category: 'completeness',
      impactScore: 4,
      effortLevel: 'instant',
    });
  }

  if (!hasCategory('family_history')) {
    nudges.push({
      id: 'completeness.family_history',
      type: 'gap',
      priority: 30,
      title: 'Any family history of major conditions?',
      detail: 'Helps with preventive care recommendations.',
      icon: 'git-network-outline',
      iconColor: '#0C3B2E',
      actionLabel: 'Add entry',
      actionRoute: `/(main)/profile/${profileId}/add-fact`,
      actionParams: { category: 'family_history' },
      dismissable: true,
      category: 'completeness',
      impactScore: 3,
      effortLevel: 'quick',
    });
  }

  if (!hasCategory('surgery')) {
    nudges.push({
      id: 'completeness.surgeries',
      type: 'gap',
      priority: 25,
      title: 'Have you had any surgeries or procedures?',
      detail: 'Procedure history improves care coordination and anesthesia planning.',
      icon: 'cut-outline',
      iconColor: '#0C3B2E',
      actionLabel: 'Add entry',
      actionRoute: `/(main)/profile/${profileId}/add-fact`,
      actionParams: { category: 'surgery' },
      dismissable: true,
      category: 'completeness',
      impactScore: 3,
      effortLevel: 'quick',
    });
  }

  // Profile created 30+ days ago with < 10 facts — catch up prompt
  const profileAgeDays = daysAgo(profile.created_at) ?? 0;
  if (profileAgeDays >= 30 && profileFacts.length < 10) {
    nudges.push({
      id: 'completeness.catch_up',
      type: 'gap',
      priority: 33,
      title: 'Your profile is still getting started',
      detail: 'Try the Catch Up flow to add several items at once.',
      icon: 'albums-outline',
      iconColor: '#0C3B2E',
      actionLabel: 'Start Catch Up',
      actionRoute: '/(main)/capture/catch-up',
      dismissable: true,
      category: 'completeness',
      impactScore: 4,
      effortLevel: 'moderate',
    });
  }

  // ── CONTEXTUAL (time-sensitive) ─────────────────────────────────────────

  // Appointment in 1-3 days — pre-appointment prep
  if (nextAppointment) {
    const apptDate = new Date(nextAppointment.start_time);
    const daysUntil = daysBetween(now, apptDate);
    if (daysUntil >= 1 && daysUntil <= 3) {
      // Only surface if there's something actionable — missing prep
      if (nextAppointment.plan_status !== 'committed') {
        const provider = nextAppointment.provider_name ?? 'your provider';
        nudges.push({
          id: `contextual.pre_appointment.${nextAppointment.id}`,
          type: 'contextual',
          priority: 86,
          title: `Visit with ${provider} in ${daysUntil} ${daysUntil === 1 ? 'day' : 'days'}`,
          detail: 'Prep your questions and concerns ahead of the appointment.',
          icon: 'calendar',
          iconColor: '#B46617',
          actionLabel: 'Open prep',
          actionRoute: `/(main)/appointments/${nextAppointment.id}/plan`,
          dismissable: true,
          category: 'care_coordination',
          impactScore: 9,
          effortLevel: 'moderate',
          expiresAt: nextAppointment.start_time,
        });
      }
    }
  }

  // Recently completed result — ask about it
  const recentReadyResult = results
    .filter((r) => r.status === 'ready')
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  if (recentReadyResult) {
    const updatedDaysAgo = daysAgo(recentReadyResult.updated_at) ?? 999;
    if (updatedDaysAgo <= 3) {
      nudges.push({
        id: `contextual.ask_about_result.${recentReadyResult.id}`,
        type: 'contextual',
        priority: 22,
        title: `Your ${recentReadyResult.test_name} is done`,
        detail: 'Ask CareLead about the results, or view trends.',
        icon: 'sparkles',
        iconColor: '#0C3B2E',
        actionLabel: 'Open Ask',
        actionRoute: '/(main)/ask',
        dismissable: true,
        category: 'care_coordination',
        impactScore: 4,
        effortLevel: 'quick',
      });
    }
  }

  // Preventive item just became due (within last 7 days)
  const newlyDuePreventive = preventiveItems.find((p) => {
    if (p.status !== 'due') return false;
    const updatedAge = daysAgo(p.updated_at) ?? 999;
    return updatedAge <= 7;
  });
  if (newlyDuePreventive) {
    const title =
      'rule' in newlyDuePreventive && newlyDuePreventive.rule
        ? newlyDuePreventive.rule.title
        : 'A screening';
    nudges.push({
      id: `contextual.preventive_due.${newlyDuePreventive.id}`,
      type: 'contextual',
      priority: 52,
      title: `${title} is due`,
      detail: 'Ready to schedule?',
      icon: 'shield-checkmark-outline',
      iconColor: '#B46617',
      actionLabel: 'View',
      actionRoute: `/(main)/preventive/${newlyDuePreventive.id}`,
      dismissable: true,
      category: 'care_coordination',
      impactScore: 6,
      effortLevel: 'moderate',
    });
  }

  // Haven't opened the app in 7+ days
  if (lastOpenedAt) {
    const awayDays = daysAgo(lastOpenedAt);
    if (awayDays !== null && awayDays >= 7) {
      nudges.push({
        id: 'contextual.welcome_back',
        type: 'contextual',
        priority: 20,
        title: 'Welcome back',
        detail: 'Anything new to add from the last week?',
        icon: 'happy-outline',
        iconColor: '#6D9773',
        actionLabel: 'Add now',
        actionRoute: '/(main)/capture/catch-up',
        dismissable: true,
        category: 'completeness',
        impactScore: 3,
        effortLevel: 'moderate',
      });
    }
  }

  // ── MILESTONE CELEBRATIONS ──────────────────────────────────────────────

  const earnedNow = computeEarnedMilestones({
    profileFacts,
    medications,
    results,
    preventiveItems,
  });

  for (const id of earnedNow) {
    if (earnedMilestones.includes(id)) continue;
    const m = MILESTONE_CATALOG[id];
    nudges.push({
      id: `milestone.${id}`,
      type: 'milestone',
      priority: 15,
      title: m.title,
      detail: m.detail,
      icon: m.icon,
      iconColor: '#6D9773',
      actionLabel: 'Nice!',
      dismissable: false,
      category: 'completeness',
      impactScore: 1,
      effortLevel: 'instant',
    });
  }

  // ── Filter dismissed + sort ─────────────────────────────────────────────

  const filtered = nudges.filter((n) => !isDismissalActive(n.id, dismissedAt));
  filtered.sort((a, b) => scoreNudge(b) - scoreNudge(a));

  // Max 5 with at most 1 milestone, milestone last as positive closer
  const nonMilestones = filtered.filter((n) => n.type !== 'milestone').slice(0, 4);
  const oneMilestone = filtered.find((n) => n.type === 'milestone');
  const result = oneMilestone ? [...nonMilestones, oneMilestone] : nonMilestones.slice(0, 5);

  return result;
}

// ── Milestone computation ─────────────────────────────────────────────────

interface MilestoneInputs {
  profileFacts: ProfileFact[];
  medications: Medication[];
  results: ResultItem[];
  preventiveItems: (PreventiveItem | PreventiveItemWithRule)[];
}

export function computeEarnedMilestones(
  inputs: MilestoneInputs,
): MilestoneId[] {
  const earned: MilestoneId[] = [];
  const factCount = inputs.profileFacts.length;

  if (factCount >= 10) earned.push('facts_10');
  if (factCount >= 25) earned.push('facts_25');
  if (factCount >= 50) earned.push('facts_50');

  if (inputs.medications.length > 0) earned.push('first_medication');
  if (inputs.results.length > 0) earned.push('first_result');

  const anyPreventiveCompleted = inputs.preventiveItems.some(
    (p) => p.status === 'completed' || p.status === 'up_to_date',
  );
  if (anyPreventiveCompleted) earned.push('first_preventive_complete');

  const allergyFacts = inputs.profileFacts.filter((f) => f.category === 'allergy');
  if (allergyFacts.length > 0) earned.push('allergies_confirmed');

  const preventiveNotDue = inputs.preventiveItems.filter(
    (p) => p.status !== 'due' && p.status !== 'due_soon' && p.status !== 'needs_review',
  );
  if (
    inputs.preventiveItems.length > 0 &&
    preventiveNotDue.length === inputs.preventiveItems.length
  ) {
    earned.push('preventive_all_up_to_date');
  }

  return earned;
}

// ── Profile strength tier ─────────────────────────────────────────────────

export type StrengthTier = 'getting_started' | 'growing' | 'strong' | 'comprehensive';

export interface StrengthTierInfo {
  tier: StrengthTier;
  label: string;
  icon: string;
  factCount: number;
  nextTier: StrengthTier | null;
  nextThreshold: number | null;
  remaining: number | null;
}

export function computeStrengthTier(factCount: number): StrengthTierInfo {
  if (factCount < 10) {
    return {
      tier: 'getting_started',
      label: 'Getting Started',
      icon: 'leaf-outline',
      factCount,
      nextTier: 'growing',
      nextThreshold: 10,
      remaining: 10 - factCount,
    };
  }
  if (factCount < 25) {
    return {
      tier: 'growing',
      label: 'Growing',
      icon: 'leaf',
      factCount,
      nextTier: 'strong',
      nextThreshold: 25,
      remaining: 25 - factCount,
    };
  }
  if (factCount < 50) {
    return {
      tier: 'strong',
      label: 'Strong',
      icon: 'trending-up',
      factCount,
      nextTier: 'comprehensive',
      nextThreshold: 50,
      remaining: 50 - factCount,
    };
  }
  return {
    tier: 'comprehensive',
    label: 'Comprehensive',
    icon: 'shield-checkmark',
    factCount,
    nextTier: null,
    nextThreshold: null,
    remaining: null,
  };
}

// ── Category health breakdown ─────────────────────────────────────────────

export type CategoryHealth = 'good' | 'sparse' | 'missing';

export interface CategoryBreakdown {
  key: string;
  label: string;
  icon: string;
  count: number;
  health: CategoryHealth;
  hint: string;
}

export function computeCategoryBreakdown(
  profileFacts: ProfileFact[],
  medicationCount: number,
  resultsCount: number,
  preventiveItems: (PreventiveItem | PreventiveItemWithRule)[],
): CategoryBreakdown[] {
  const countOf = (cat: string) =>
    profileFacts.filter((f) => f.category === cat).length;

  const allergyCount = countOf('allergy');
  const conditionCount = countOf('condition');
  const careTeamCount = countOf('care_team');
  const insuranceCount = countOf('insurance');
  const emergencyContactCount = countOf('emergency_contact');

  const preventiveUpToDate = preventiveItems.filter(
    (p) =>
      p.status !== 'due' &&
      p.status !== 'due_soon' &&
      p.status !== 'needs_review',
  ).length;

  return [
    {
      key: 'safety',
      label: 'Safety',
      icon: 'alert-circle-outline',
      count: allergyCount + emergencyContactCount,
      health:
        allergyCount > 0 && emergencyContactCount > 0
          ? 'good'
          : allergyCount > 0 || emergencyContactCount > 0
          ? 'sparse'
          : 'missing',
      hint:
        allergyCount === 0 && emergencyContactCount === 0
          ? 'Add allergies and emergency contact'
          : allergyCount === 0
          ? 'Add allergies'
          : emergencyContactCount === 0
          ? 'Add emergency contact'
          : `${allergyCount} allerg${allergyCount === 1 ? 'y' : 'ies'}, ${emergencyContactCount} contact${emergencyContactCount === 1 ? '' : 's'}`,
    },
    {
      key: 'medications',
      label: 'Medications',
      icon: 'medkit-outline',
      count: medicationCount,
      health: medicationCount >= 1 ? 'good' : 'missing',
      hint:
        medicationCount === 0
          ? 'None tracked'
          : `${medicationCount} active`,
    },
    {
      key: 'conditions',
      label: 'Conditions',
      icon: 'medical-outline',
      count: conditionCount,
      health: conditionCount >= 1 ? 'good' : 'sparse',
      hint:
        conditionCount === 0
          ? 'None listed'
          : `${conditionCount} listed`,
    },
    {
      key: 'care_team',
      label: 'Care Team',
      icon: 'people-outline',
      count: careTeamCount,
      health:
        careTeamCount >= 2 ? 'good' : careTeamCount === 1 ? 'sparse' : 'missing',
      hint:
        careTeamCount === 0
          ? 'No providers added'
          : `${careTeamCount} provider${careTeamCount === 1 ? '' : 's'}`,
    },
    {
      key: 'insurance',
      label: 'Insurance',
      icon: 'card-outline',
      count: insuranceCount,
      health: insuranceCount >= 1 ? 'good' : 'missing',
      hint:
        insuranceCount === 0
          ? 'Missing'
          : `${insuranceCount} on file`,
    },
    {
      key: 'results',
      label: 'Results',
      icon: 'flask-outline',
      count: resultsCount,
      health: resultsCount >= 1 ? 'good' : 'sparse',
      hint:
        resultsCount === 0
          ? 'None saved yet'
          : `${resultsCount} saved`,
    },
    {
      key: 'preventive',
      label: 'Preventive',
      icon: 'shield-checkmark-outline',
      count: preventiveUpToDate,
      health:
        preventiveItems.length === 0
          ? 'sparse'
          : preventiveUpToDate === preventiveItems.length
          ? 'good'
          : 'sparse',
      hint:
        preventiveItems.length === 0
          ? 'Run check'
          : `${preventiveUpToDate} of ${preventiveItems.length} up to date`,
    },
  ];
}
