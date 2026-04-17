/**
 * Billing timeline — merges events from multiple billing tables into a single
 * chronological list for the case detail screen. Derived from existing data,
 * no separate timeline table.
 */

import { supabase } from '@/lib/supabase';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

export type TimelineEventType =
  | 'status'
  | 'document'
  | 'extraction'
  | 'finding'
  | 'action'
  | 'call'
  | 'payment'
  | 'denial'
  | 'appeal';

export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  timestamp: string;
  description: string;
  subtext?: string;
}

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  in_review: 'In Review',
  action_plan: 'Action Plan',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  closed: 'Closed',
};

const DOC_TYPE_LABELS: Record<string, string> = {
  bill: 'Bill',
  eob: 'EOB',
  itemized_bill: 'Itemized Bill',
  denial: 'Denial Letter',
  other: 'Document',
};

const DENIAL_CATEGORY_LABELS: Record<string, string> = {
  prior_auth: 'Prior Authorization',
  medical_necessity: 'Medical Necessity',
  not_covered: 'Not Covered',
  timely_filing: 'Timely Filing',
  coding_error: 'Coding Error',
  duplicate: 'Duplicate Claim',
  other: 'Other',
};

export async function fetchBillingTimeline(
  caseId: string,
): Promise<ServiceResult<TimelineEvent[]>> {
  const [
    statusRes,
    docsRes,
    jobsRes,
    findingsRes,
    actionsRes,
    callsRes,
    paymentsRes,
    denialsRes,
    appealsRes,
  ] = await Promise.all([
    supabase
      .from('billing_case_status_events')
      .select('id, from_status, to_status, created_at')
      .eq('billing_case_id', caseId),
    supabase
      .from('billing_documents')
      .select('id, file_name, doc_type, created_at')
      .eq('billing_case_id', caseId),
    supabase
      .from('billing_extract_jobs')
      .select('id, status, created_at, completed_at')
      .eq('billing_case_id', caseId),
    supabase
      .from('billing_case_findings')
      .select('id, message, severity, created_at, resolved_at, is_resolved')
      .eq('billing_case_id', caseId),
    supabase
      .from('billing_case_actions')
      .select('id, title, status, created_at, activated_at, completed_at')
      .eq('billing_case_id', caseId),
    supabase
      .from('billing_case_call_logs')
      .select('id, party, party_name, outcome, called_at')
      .eq('billing_case_id', caseId),
    supabase
      .from('billing_case_payments')
      .select('id, kind, amount, created_at')
      .eq('billing_case_id', caseId),
    supabase
      .from('billing_denial_records')
      .select('id, category, denial_reason, created_at')
      .eq('billing_case_id', caseId),
    supabase
      .from('billing_appeal_packets')
      .select('id, status, created_at, submitted_at')
      .eq('billing_case_id', caseId),
  ]);

  for (const res of [
    statusRes, docsRes, jobsRes, findingsRes, actionsRes,
    callsRes, paymentsRes, denialsRes, appealsRes,
  ]) {
    if (res.error) {
      return { success: false, error: res.error.message, code: res.error.code };
    }
  }

  const events: TimelineEvent[] = [];

  for (const row of statusRes.data ?? []) {
    const toLabel = STATUS_LABELS[row.to_status] ?? row.to_status;
    const fromLabel = row.from_status ? STATUS_LABELS[row.from_status] ?? row.from_status : null;
    events.push({
      id: `status:${row.id}`,
      type: 'status',
      timestamp: row.created_at,
      description: fromLabel
        ? `Case status changed to ${toLabel}`
        : `Case created as ${toLabel}`,
      subtext: fromLabel ? `from ${fromLabel}` : undefined,
    });
  }

  for (const row of docsRes.data ?? []) {
    const typeLabel = DOC_TYPE_LABELS[row.doc_type] ?? row.doc_type;
    const name = row.file_name ?? 'Untitled document';
    events.push({
      id: `doc:${row.id}`,
      type: 'document',
      timestamp: row.created_at,
      description: `Document uploaded: ${name}`,
      subtext: typeLabel,
    });
  }

  for (const row of jobsRes.data ?? []) {
    events.push({
      id: `job-start:${row.id}`,
      type: 'extraction',
      timestamp: row.created_at,
      description: 'Extraction started',
    });
    if (row.completed_at) {
      events.push({
        id: `job-end:${row.id}`,
        type: 'extraction',
        timestamp: row.completed_at,
        description:
          row.status === 'failed' ? 'Extraction failed' : 'Extraction completed',
      });
    }
  }

  for (const row of findingsRes.data ?? []) {
    events.push({
      id: `finding-new:${row.id}`,
      type: 'finding',
      timestamp: row.created_at,
      description: `Finding detected: ${row.message}`,
      subtext: row.severity,
    });
    if (row.resolved_at && row.is_resolved) {
      events.push({
        id: `finding-resolved:${row.id}`,
        type: 'finding',
        timestamp: row.resolved_at,
        description: `Finding resolved: ${row.message}`,
      });
    }
  }

  for (const row of actionsRes.data ?? []) {
    events.push({
      id: `action-new:${row.id}`,
      type: 'action',
      timestamp: row.created_at,
      description: `Action proposed: ${row.title}`,
    });
    if (row.activated_at) {
      events.push({
        id: `action-active:${row.id}`,
        type: 'action',
        timestamp: row.activated_at,
        description: `Action activated: ${row.title}`,
      });
    }
    if (row.completed_at) {
      events.push({
        id: `action-done:${row.id}`,
        type: 'action',
        timestamp: row.completed_at,
        description: `Action completed: ${row.title}`,
      });
    }
  }

  for (const row of callsRes.data ?? []) {
    const partyLabel = row.party_name ?? row.party ?? 'contact';
    const outcomeSnippet = row.outcome
      ? row.outcome.length > 80
        ? row.outcome.slice(0, 80).trim() + '…'
        : row.outcome
      : null;
    events.push({
      id: `call:${row.id}`,
      type: 'call',
      timestamp: row.called_at,
      description: `Called ${partyLabel}${outcomeSnippet ? `: ${outcomeSnippet}` : ''}`,
    });
  }

  for (const row of paymentsRes.data ?? []) {
    const amount = Number(row.amount).toFixed(2);
    const label = row.kind === 'refund' ? 'Refund recorded' : 'Payment recorded';
    events.push({
      id: `payment:${row.id}`,
      type: 'payment',
      timestamp: row.created_at,
      description: `${label}: $${amount}`,
    });
  }

  for (const row of denialsRes.data ?? []) {
    const categoryLabel = row.category
      ? DENIAL_CATEGORY_LABELS[row.category] ?? row.category
      : 'Unclassified';
    events.push({
      id: `denial:${row.id}`,
      type: 'denial',
      timestamp: row.created_at,
      description: `Denial detected: ${categoryLabel}`,
      subtext: row.denial_reason ?? undefined,
    });
  }

  for (const row of appealsRes.data ?? []) {
    events.push({
      id: `appeal-new:${row.id}`,
      type: 'appeal',
      timestamp: row.created_at,
      description: 'Appeal packet created',
    });
    if (row.submitted_at) {
      events.push({
        id: `appeal-submitted:${row.id}`,
        type: 'appeal',
        timestamp: row.submitted_at,
        description: 'Appeal submitted',
      });
    }
  }

  events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return { success: true, data: events };
}
