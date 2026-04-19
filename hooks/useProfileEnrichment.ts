/**
 * useProfileEnrichment
 *
 * Glue between the per-source extraction (billing/result/document) and the
 * ProfileEnrichmentCard. Detects suggestions, syncs them into the global
 * enrichment store, and exposes the accept/dismiss handlers used by the
 * card. Logs an audit event on every accept (PHI-safe metadata only —
 * suggestion id + category + source).
 */

import { useEffect, useMemo, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from './useAuth';
import { useEnrichmentStore } from '@/stores/enrichmentStore';
import {
  detectProfileEnrichment,
  type DetectProfileEnrichmentParams,
} from '@/services/profileEnrichment';
import { createProfileFactFromEnrichment } from '@/services/profiles';
import type { ProfileFact } from '@/lib/types/profile';
import type {
  EnrichmentSourceType,
  ProfileEnrichmentSuggestion,
} from '@/lib/types/enrichment';

interface UseProfileEnrichmentParams {
  profileId: string | null | undefined;
  householdId: string | null | undefined;
  sourceType: EnrichmentSourceType;
  /** Stable ID for the source (billing case ID, result ID). */
  sourceId: string | null | undefined;
  /** Human-readable source descriptor for the card subtitle. */
  sourceLabel: string;
  /** The merged extraction result to scan. Pass null while still extracting. */
  extractionResult: Record<string, unknown> | null | undefined;
  /** Current profile facts — used for duplicate detection. */
  existingFacts: ProfileFact[] | undefined;
  /** Set false while extraction is in flight to skip detection. */
  enabled: boolean;
}

export function useProfileEnrichment(params: UseProfileEnrichmentParams) {
  const {
    profileId,
    householdId,
    sourceType,
    sourceId,
    sourceLabel,
    extractionResult,
    existingFacts,
    enabled,
  } = params;

  const { user } = useAuth();
  const queryClient = useQueryClient();
  const setSuggestionsForSource = useEnrichmentStore(
    (s) => s.setSuggestionsForSource,
  );
  const dismissSuggestion = useEnrichmentStore((s) => s.dismissSuggestion);
  const dismissAllForSource = useEnrichmentStore((s) => s.dismissAllForSource);
  const acceptSuggestionInStore = useEnrichmentStore((s) => s.acceptSuggestion);
  const suggestions = useEnrichmentStore((s) =>
    sourceId ? s.suggestions[sourceId] ?? [] : [],
  );

  // Re-detect when extraction or facts change. Detection is pure — no I/O —
  // so running it on each render is cheap. We still gate on `enabled` so we
  // don't surface partial extractions while a job is mid-flight.
  const detected = useMemo<ProfileEnrichmentSuggestion[]>(() => {
    if (!enabled || !profileId || !householdId || !sourceId) return [];
    if (!extractionResult || !existingFacts) return [];
    const detectParams: DetectProfileEnrichmentParams = {
      profileId,
      householdId,
      extractionResult,
      sourceType,
      sourceId,
      sourceLabel,
      existingProfileFacts: existingFacts,
    };
    return detectProfileEnrichment(detectParams);
  }, [
    enabled,
    profileId,
    householdId,
    sourceId,
    sourceLabel,
    sourceType,
    extractionResult,
    existingFacts,
  ]);

  // Push detection results into the store (which filters out dismissed IDs).
  useEffect(() => {
    if (!sourceId) return;
    setSuggestionsForSource(sourceId, detected);
  }, [sourceId, detected, setSuggestionsForSource]);

  const onAccept = useCallback(
    async (s: ProfileEnrichmentSuggestion) => {
      if (!profileId || !user?.id || !sourceId) return;
      const result = await createProfileFactFromEnrichment(profileId, user.id, {
        category: s.category,
        field_key: s.factKey,
        value_json: s.valueJson,
        source_ref: s.source,
      });
      if (!result.success) return;

      // Audit — IDs and category only, never the value payload (which may
      // contain PHI like provider names or member IDs).
      void supabase.from('audit_events').insert({
        profile_id: profileId,
        actor_id: user.id,
        event_type: 'profile_fact.enrichment_accepted',
        metadata: {
          suggestion_id: s.id,
          category: s.category,
          source_type: sourceType,
          source_ref: s.source,
          field_key: s.factKey,
        },
      });

      acceptSuggestionInStore(sourceId, s.id);
      queryClient.invalidateQueries({ queryKey: ['profile', 'detail', profileId] });
    },
    [profileId, user?.id, sourceId, sourceType, acceptSuggestionInStore, queryClient],
  );

  const onDismiss = useCallback(
    (s: ProfileEnrichmentSuggestion) => {
      if (!sourceId) return;
      dismissSuggestion(sourceId, s.id);
    },
    [sourceId, dismissSuggestion],
  );

  const onDismissAll = useCallback(() => {
    if (!sourceId) return;
    dismissAllForSource(sourceId);
  }, [sourceId, dismissAllForSource]);

  return {
    suggestions,
    onAccept,
    onDismiss,
    onDismissAll,
  };
}
