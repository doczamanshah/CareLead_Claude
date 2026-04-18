/**
 * Results briefing — aggregates result item signals into a small, prioritized
 * list of items for the Home screen's Today's Briefing and the Today Detail
 * screen. Keeps queries scoped to the active profile.
 */

import { supabase } from '@/lib/supabase';
import type {
  ResultItem,
  ResultExtractJob,
  ResultStatus,
} from '@/lib/types/results';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

export type ResultsBriefingKind =
  | 'needs_review'
  | 'needs_review_multi'
  | 'recent_ready'
  | 'processing';

export interface ResultsBriefingItem {
  key: string;
  kind: ResultsBriefingKind;
  resultId: string | null;
  testName: string;
  message: string;
  icon: string;
  color: 'warning' | 'info' | 'primary';
  sortRank: number;
}

const RECENT_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * Produce up to `max` results briefing items for a profile, prioritized:
 *   1. Needs-review results (aggregated if multiple)
 *   2. Processing results
 *   3. Recently-ready results (last 48h, single most recent)
 */
export async function fetchResultsBriefingItems(
  profileId: string,
  max: number = 3,
): Promise<ServiceResult<ResultsBriefingItem[]>> {
  const { data: resultsData, error: resultsError } = await supabase
    .from('result_items')
    .select('id, test_name, status, created_at, updated_at, result_type')
    .eq('profile_id', profileId)
    .neq('status', 'archived')
    .order('updated_at', { ascending: false });

  if (resultsError) {
    return { success: false, error: resultsError.message, code: resultsError.code };
  }

  const results = (resultsData ?? []) as Pick<
    ResultItem,
    'id' | 'test_name' | 'status' | 'created_at' | 'updated_at' | 'result_type'
  >[];

  if (results.length === 0) {
    return { success: true, data: [] };
  }

  const items: ResultsBriefingItem[] = [];

  // a) Needs-review
  const needsReview = results.filter((r) => r.status === 'needs_review');
  if (needsReview.length === 1) {
    const r = needsReview[0];
    items.push({
      key: `review:${r.id}`,
      kind: 'needs_review',
      resultId: r.id,
      testName: r.test_name,
      message: `Your ${r.test_name} results need review`,
      icon: 'document-text-outline',
      color: 'warning',
      sortRank: 0,
    });
  } else if (needsReview.length > 1) {
    items.push({
      key: 'review:multi',
      kind: 'needs_review_multi',
      resultId: null,
      testName: '',
      message: `You have ${needsReview.length} results to review`,
      icon: 'document-text-outline',
      color: 'warning',
      sortRank: 0,
    });
  }

  // c) Processing — aggregate by active extraction jobs for this profile
  const ids = results.map((r) => r.id);
  const { data: jobsData } = await supabase
    .from('result_extract_jobs')
    .select('result_id, status')
    .in('result_id', ids)
    .in('status', ['queued', 'processing']);

  const processingJobs = (jobsData ?? []) as Pick<
    ResultExtractJob,
    'result_id' | 'status'
  >[];

  const processingIds = new Set(processingJobs.map((j) => j.result_id));
  if (processingIds.size > 0) {
    const processingResults = results.filter((r) => processingIds.has(r.id));
    const first = processingResults[0];
    if (first) {
      items.push({
        key: `processing:${first.id}`,
        kind: 'processing',
        resultId: first.id,
        testName: first.test_name,
        message:
          processingResults.length === 1
            ? `Processing your ${first.test_name} results...`
            : `Processing ${processingResults.length} results...`,
        icon: 'hourglass-outline',
        color: 'info',
        sortRank: 1,
      });
    }
  }

  // b) Recent ready — single most recent within window, skip if already showing
  const now = Date.now();
  const recentReady = results.find(
    (r) =>
      r.status === 'ready' &&
      now - new Date(r.created_at).getTime() <= RECENT_WINDOW_MS,
  );
  if (recentReady) {
    items.push({
      key: `ready:${recentReady.id}`,
      kind: 'recent_ready',
      resultId: recentReady.id,
      testName: recentReady.test_name,
      message: `New result: ${recentReady.test_name} is ready to view`,
      icon: 'flask-outline',
      color: 'primary',
      sortRank: 2,
    });
  }

  items.sort((a, b) => {
    if (a.sortRank !== b.sortRank) return a.sortRank - b.sortRank;
    return a.key.localeCompare(b.key);
  });

  return { success: true, data: items.slice(0, max) };
}

/** Count of results in needs_review status (used for module badge). */
export async function fetchResultsNeedsReviewCount(
  profileId: string,
): Promise<ServiceResult<number>> {
  const { count, error } = await supabase
    .from('result_items')
    .select('id', { count: 'exact', head: true })
    .eq('profile_id', profileId)
    .eq('status', 'needs_review' satisfies ResultStatus);

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data: count ?? 0 };
}
