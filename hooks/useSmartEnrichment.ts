import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useProfileDetail } from './useProfileDetail';
import { useMedications } from './useMedications';
import { useResults } from './useResults';
import { useAppointments } from './useAppointments';
import { usePreventiveItems } from './usePreventive';
import { useBillingCases } from './useBilling';
import {
  addEarnedMilestones,
  dismissNudge as dismissNudgeStore,
  getDismissals,
  getEarnedMilestones,
  getLastOpenedAt,
  getViewedMilestones,
  markMilestonesViewed,
  markOpenedNow,
} from '@/services/enrichmentPersistence';
import {
  computeCategoryBreakdown,
  computeEarnedMilestones,
  computeStrengthTier,
  generateSmartNudges,
  MILESTONE_CATALOG,
  type CategoryBreakdown,
  type MilestoneId,
  type SmartNudge,
  type StrengthTierInfo,
} from '@/services/smartEnrichment';

interface UseSmartEnrichmentResult {
  nudges: SmartNudge[];
  topNudge: SmartNudge | null;
  nonMilestoneNudges: SmartNudge[];
  milestoneNudges: SmartNudge[];
  tierInfo: StrengthTierInfo | null;
  categoryBreakdown: CategoryBreakdown[];
  earnedMilestones: MilestoneId[];
  unseenMilestones: MilestoneId[];
  totalFacts: number;
  isLoading: boolean;
  /** Record a dismissal for a nudge (14-day cooldown). */
  dismiss: (nudgeId: string) => Promise<void>;
  /** Mark milestones as seen so they stop surfacing in briefing. */
  markSeen: (ids: MilestoneId[]) => Promise<void>;
  /** Force a re-evaluation after data changes. */
  refresh: () => void;
}

/**
 * Main hook: aggregates profile + module data, runs the enrichment engine,
 * and returns nudges ordered by effective score, plus milestone/tier info.
 */
export function useSmartEnrichment(
  profileId: string | null,
  householdId: string | null,
): UseSmartEnrichmentResult {
  const { data: profile } = useProfileDetail(profileId);
  const { data: medications } = useMedications(profileId);
  const { data: results } = useResults(profileId);
  const { data: appointments } = useAppointments(profileId);
  const { data: preventiveItems } = usePreventiveItems(profileId);
  const { data: billingCases } = useBillingCases(profileId);

  const queryClient = useQueryClient();

  // Per-profile persisted state (dismissals / milestones / last opened)
  const {
    data: persisted,
    refetch: refetchPersisted,
    isLoading: persistedLoading,
  } = useQuery({
    queryKey: ['enrichment', 'persisted', profileId],
    queryFn: async () => {
      if (!profileId) {
        return {
          dismissedAt: {} as Record<string, string>,
          earnedMilestones: [] as MilestoneId[],
          viewedMilestones: [] as MilestoneId[],
          lastOpenedAt: null as string | null,
        };
      }
      const [dismissedAt, earnedMilestones, viewedMilestones, lastOpenedAt] =
        await Promise.all([
          getDismissals(profileId),
          getEarnedMilestones(profileId),
          getViewedMilestones(profileId),
          getLastOpenedAt(profileId),
        ]);
      return { dismissedAt, earnedMilestones, viewedMilestones, lastOpenedAt };
    },
    enabled: !!profileId,
    staleTime: 60 * 1000,
  });

  // Mark "last opened" once per profile mount so the welcome-back nudge
  // doesn't fire every render for the current session.
  const openedMarkedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!profileId) return;
    if (openedMarkedRef.current === profileId) return;
    openedMarkedRef.current = profileId;
    void markOpenedNow(profileId);
  }, [profileId]);

  // Persist newly-earned milestones eagerly so they don't re-emit on refetch.
  const [newlyEarnedVersion, setNewlyEarnedVersion] = useState(0);
  const earnedPersistRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!profileId) return;
    if (!profile || !medications || !results || !preventiveItems) return;

    const earnedNow = computeEarnedMilestones({
      profileFacts: profile.facts,
      medications,
      results,
      preventiveItems,
    });
    const already = persisted?.earnedMilestones ?? [];
    const toPersist = earnedNow.filter(
      (id) => !already.includes(id) && !earnedPersistRef.current.has(`${profileId}:${id}`),
    );
    if (toPersist.length === 0) return;
    toPersist.forEach((id) => earnedPersistRef.current.add(`${profileId}:${id}`));
    void addEarnedMilestones(profileId, toPersist).then(() => {
      setNewlyEarnedVersion((v) => v + 1);
      queryClient.invalidateQueries({ queryKey: ['enrichment', 'persisted', profileId] });
    });
  }, [profileId, profile, medications, results, preventiveItems, persisted?.earnedMilestones, queryClient]);

  const nudges = useMemo<SmartNudge[]>(() => {
    if (!profileId || !householdId || !profile) return [];
    return generateSmartNudges({
      profileId,
      householdId,
      profile: {
        id: profile.id,
        date_of_birth: profile.date_of_birth,
        gender: profile.gender,
        created_at: profile.created_at,
        display_name: profile.display_name,
      },
      profileFacts: profile.facts,
      medications: medications ?? [],
      results: results ?? [],
      appointments: appointments ?? [],
      preventiveItems: preventiveItems ?? [],
      billingCases: billingCases ?? [],
      dismissedAt: persisted?.dismissedAt,
      earnedMilestones: persisted?.earnedMilestones ?? [],
      lastOpenedAt: persisted?.lastOpenedAt,
    });
    // newlyEarnedVersion forces recompute after we persist a milestone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    profileId,
    householdId,
    profile,
    medications,
    results,
    appointments,
    preventiveItems,
    billingCases,
    persisted,
    newlyEarnedVersion,
  ]);

  const tierInfo = useMemo<StrengthTierInfo | null>(() => {
    if (!profile) return null;
    return computeStrengthTier(profile.facts.length);
  }, [profile]);

  const categoryBreakdown = useMemo<CategoryBreakdown[]>(() => {
    if (!profile) return [];
    return computeCategoryBreakdown(
      profile.facts,
      medications?.length ?? 0,
      results?.length ?? 0,
      preventiveItems ?? [],
    );
  }, [profile, medications, results, preventiveItems]);

  const earnedMilestones = persisted?.earnedMilestones ?? [];
  const viewedMilestones = persisted?.viewedMilestones ?? [];
  const unseenMilestones = useMemo(
    () => earnedMilestones.filter((id) => !viewedMilestones.includes(id)),
    [earnedMilestones, viewedMilestones],
  );

  const nonMilestoneNudges = useMemo(
    () => nudges.filter((n) => n.type !== 'milestone'),
    [nudges],
  );
  const milestoneNudges = useMemo(
    () => nudges.filter((n) => n.type === 'milestone'),
    [nudges],
  );

  const topNudge = nonMilestoneNudges[0] ?? null;

  const dismiss = async (nudgeId: string) => {
    if (!profileId) return;
    await dismissNudgeStore(profileId, nudgeId);
    await refetchPersisted();
  };

  const markSeen = async (ids: MilestoneId[]) => {
    if (!profileId || ids.length === 0) return;
    await markMilestonesViewed(profileId, ids);
    await refetchPersisted();
  };

  const refresh = () => {
    void refetchPersisted();
  };

  return {
    nudges,
    topNudge,
    nonMilestoneNudges,
    milestoneNudges,
    tierInfo,
    categoryBreakdown,
    earnedMilestones,
    unseenMilestones,
    totalFacts: profile?.facts.length ?? 0,
    isLoading: persistedLoading || !profile,
    dismiss,
    markSeen,
    refresh,
  };
}

/** Convenience: look up the catalog entry for a milestone. */
export function getMilestone(id: MilestoneId) {
  return MILESTONE_CATALOG[id];
}
