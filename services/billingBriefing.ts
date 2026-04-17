/**
 * Billing briefing — aggregates billing-case signals into a small, prioritized
 * list of items for the Home screen's Today's Briefing and the Today Detail
 * screen. Keeps queries scoped to the active profile.
 */

import { supabase } from '@/lib/supabase';
import type {
  BillingCase,
  BillingCaseFinding,
  BillingCaseAction,
  BillingCaseCallLog,
  BillingExtractJob,
  BillingDenialRecord,
} from '@/lib/types/billing';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

export type BillingBriefingKind =
  | 'critical_finding'
  | 'appeal_deadline'
  | 'call_follow_up'
  | 'processing'
  | 'pending_actions'
  | 'strengthen_nudge';

export interface BillingBriefingItem {
  key: string;
  kind: BillingBriefingKind;
  caseId: string;
  caseTitle: string;
  message: string;
  icon: string;
  color: 'critical' | 'warning' | 'info' | 'primary';
  sortRank: number;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / MS_PER_DAY);
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / MS_PER_DAY);
}

interface CaseBundle {
  billingCase: BillingCase;
  findings: BillingCaseFinding[];
  actions: BillingCaseAction[];
  callLogs: BillingCaseCallLog[];
  extractJobs: BillingExtractJob[];
  denials: BillingDenialRecord[];
}

async function fetchCaseBundles(profileId: string): Promise<ServiceResult<CaseBundle[]>> {
  const { data: cases, error: casesError } = await supabase
    .from('billing_cases')
    .select('*')
    .eq('profile_id', profileId)
    .in('status', ['open', 'in_review', 'action_plan', 'in_progress']);

  if (casesError) {
    return { success: false, error: casesError.message, code: casesError.code };
  }
  if (!cases || cases.length === 0) {
    return { success: true, data: [] };
  }

  const caseIds = cases.map((c) => c.id);

  const [findingsRes, actionsRes, callsRes, jobsRes, denialsRes] = await Promise.all([
    supabase
      .from('billing_case_findings')
      .select('*')
      .in('billing_case_id', caseIds)
      .eq('is_resolved', false),
    supabase
      .from('billing_case_actions')
      .select('*')
      .in('billing_case_id', caseIds),
    supabase
      .from('billing_case_call_logs')
      .select('*')
      .in('billing_case_id', caseIds),
    supabase
      .from('billing_extract_jobs')
      .select('*')
      .in('billing_case_id', caseIds),
    supabase
      .from('billing_denial_records')
      .select('*')
      .in('billing_case_id', caseIds),
  ]);

  const findingsByCase = new Map<string, BillingCaseFinding[]>();
  for (const row of (findingsRes.data ?? []) as BillingCaseFinding[]) {
    const list = findingsByCase.get(row.billing_case_id) ?? [];
    list.push(row);
    findingsByCase.set(row.billing_case_id, list);
  }

  const actionsByCase = new Map<string, BillingCaseAction[]>();
  for (const row of (actionsRes.data ?? []) as BillingCaseAction[]) {
    const list = actionsByCase.get(row.billing_case_id) ?? [];
    list.push(row);
    actionsByCase.set(row.billing_case_id, list);
  }

  const callsByCase = new Map<string, BillingCaseCallLog[]>();
  for (const row of (callsRes.data ?? []) as BillingCaseCallLog[]) {
    const list = callsByCase.get(row.billing_case_id) ?? [];
    list.push(row);
    callsByCase.set(row.billing_case_id, list);
  }

  const jobsByCase = new Map<string, BillingExtractJob[]>();
  for (const row of (jobsRes.data ?? []) as BillingExtractJob[]) {
    const list = jobsByCase.get(row.billing_case_id) ?? [];
    list.push(row);
    jobsByCase.set(row.billing_case_id, list);
  }

  const denialsByCase = new Map<string, BillingDenialRecord[]>();
  for (const row of (denialsRes.data ?? []) as BillingDenialRecord[]) {
    const list = denialsByCase.get(row.billing_case_id) ?? [];
    list.push(row);
    denialsByCase.set(row.billing_case_id, list);
  }

  const bundles: CaseBundle[] = (cases as BillingCase[]).map((billingCase) => ({
    billingCase,
    findings: findingsByCase.get(billingCase.id) ?? [],
    actions: actionsByCase.get(billingCase.id) ?? [],
    callLogs: callsByCase.get(billingCase.id) ?? [],
    extractJobs: jobsByCase.get(billingCase.id) ?? [],
    denials: denialsByCase.get(billingCase.id) ?? [],
  }));

  return { success: true, data: bundles };
}

/** Produce up to `max` billing briefing items for a profile, prioritized. */
export async function fetchBillingBriefingItems(
  profileId: string,
  max: number = 3,
): Promise<ServiceResult<BillingBriefingItem[]>> {
  const res = await fetchCaseBundles(profileId);
  if (!res.success) return res;

  const items: BillingBriefingItem[] = [];
  let nudgeCandidate: BillingBriefingItem | null = null;

  for (const bundle of res.data) {
    const { billingCase, findings, actions, callLogs, extractJobs, denials } = bundle;
    const title = billingCase.title;

    // a) Critical findings
    const criticalCount = findings.filter((f) => f.severity === 'critical').length;
    if (criticalCount > 0) {
      items.push({
        key: `critical:${billingCase.id}`,
        kind: 'critical_finding',
        caseId: billingCase.id,
        caseTitle: title,
        message: `"${title}" has ${criticalCount === 1 ? 'an issue' : `${criticalCount} issues`} that ${criticalCount === 1 ? 'needs' : 'need'} attention`,
        icon: 'alert-circle',
        color: 'critical',
        sortRank: 0,
      });
    }

    // b) Appeal deadlines within 14 days
    for (const denial of denials) {
      if (!denial.deadline) continue;
      const days = daysUntil(denial.deadline);
      if (days > 14) continue;
      const msg =
        days < 0 ? `"${title}": Appeal deadline passed ${Math.abs(days)}d ago`
        : days === 0 ? `"${title}": Appeal deadline is today`
        : `"${title}": Appeal deadline in ${days}d`;
      items.push({
        key: `appeal:${denial.id}`,
        kind: 'appeal_deadline',
        caseId: billingCase.id,
        caseTitle: title,
        message: msg,
        icon: 'time-outline',
        color: days < 7 ? 'critical' : 'warning',
        sortRank: days < 7 ? 1 : 2,
      });
    }

    // b) Call follow-ups due today or overdue
    for (const log of callLogs) {
      if (!log.follow_up_due || log.created_task_id) continue;
      const days = daysUntil(log.follow_up_due);
      if (days > 0) continue;
      const party = log.party_name ?? log.party;
      items.push({
        key: `callfu:${log.id}`,
        kind: 'call_follow_up',
        caseId: billingCase.id,
        caseTitle: title,
        message:
          days < 0
            ? `"${title}": Overdue follow-up on call to ${party}`
            : `"${title}": Follow up on call to ${party}`,
        icon: 'call-outline',
        color: days < 0 ? 'critical' : 'warning',
        sortRank: days < 0 ? 1 : 2,
      });
    }

    // c) Processing extractions
    const processingCount = extractJobs.filter((j) => j.status === 'processing').length;
    if (processingCount > 0) {
      items.push({
        key: `processing:${billingCase.id}`,
        kind: 'processing',
        caseId: billingCase.id,
        caseTitle: title,
        message: `Processing your documents for "${title}"...`,
        icon: 'hourglass-outline',
        color: 'info',
        sortRank: 4,
      });
    }

    // d) Pending actions (active but not yet started / in progress)
    const pendingActionCount = actions.filter(
      (a) => a.status === 'active' || a.status === 'in_progress',
    ).length;
    if (pendingActionCount > 0) {
      items.push({
        key: `actions:${billingCase.id}`,
        kind: 'pending_actions',
        caseId: billingCase.id,
        caseTitle: title,
        message: `"${title}": ${pendingActionCount} pending ${pendingActionCount === 1 ? 'action' : 'actions'} in your plan`,
        icon: 'list-outline',
        color: 'primary',
        sortRank: 3,
      });
    }

    // e) Strengthen nudge — single candidate, selected later
    const hasWarningAged =
      findings.some((f) => f.severity === 'warning') &&
      daysSince(billingCase.updated_at) >= 3;
    if (hasWarningAged && !nudgeCandidate) {
      nudgeCandidate = {
        key: `nudge:${billingCase.id}`,
        kind: 'strengthen_nudge',
        caseId: billingCase.id,
        caseTitle: title,
        message: `"${title}" could use more info — add an EOB or provider details`,
        icon: 'bulb-outline',
        color: 'warning',
        sortRank: 5,
      };
    }
  }

  // Sort by rank ascending, stable by key
  items.sort((a, b) => {
    if (a.sortRank !== b.sortRank) return a.sortRank - b.sortRank;
    return a.key.localeCompare(b.key);
  });

  // Add nudge if we still have budget, then cap.
  const capped = items.slice(0, max);
  if (nudgeCandidate && capped.length < max && !capped.some((i) => i.caseId === nudgeCandidate!.caseId)) {
    capped.push(nudgeCandidate);
  }

  return { success: true, data: capped };
}

/** Count of active cases that have at least one critical finding. */
export async function fetchBillingActiveCriticalCount(
  profileId: string,
): Promise<ServiceResult<number>> {
  const { data: cases, error: casesError } = await supabase
    .from('billing_cases')
    .select('id')
    .eq('profile_id', profileId)
    .in('status', ['open', 'in_review', 'action_plan', 'in_progress']);

  if (casesError) {
    return { success: false, error: casesError.message, code: casesError.code };
  }
  if (!cases || cases.length === 0) {
    return { success: true, data: 0 };
  }

  const caseIds = cases.map((c) => c.id);
  const { data: findings, error: findingsError } = await supabase
    .from('billing_case_findings')
    .select('billing_case_id')
    .in('billing_case_id', caseIds)
    .eq('is_resolved', false)
    .eq('severity', 'critical');

  if (findingsError) {
    return { success: false, error: findingsError.message, code: findingsError.code };
  }

  const affected = new Set((findings ?? []).map((f) => f.billing_case_id as string));
  return { success: true, data: affected.size };
}
