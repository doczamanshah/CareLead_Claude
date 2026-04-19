/**
 * Billing stage detection — pure functions that classify a billing case
 * into a UX stage based on its data. Used to drive progressive disclosure
 * on the case detail screen: only the content relevant to the case's
 * current stage is rendered.
 */

import type {
  BillingCase,
  BillingCaseFinding,
  BillingCaseAction,
  BillingCaseCallLog,
  BillingCasePayment,
  BillingLedgerLine,
  BillingExtractJob,
} from '@/lib/types/billing';

export type BillingStage =
  | 'just_started'
  | 'analyzed'
  | 'in_progress'
  | 'resolved';

export interface StageInputs {
  billingCase: BillingCase;
  findings: BillingCaseFinding[] | undefined;
  actions: BillingCaseAction[] | undefined;
  callLogs: BillingCaseCallLog[] | undefined;
  payments: BillingCasePayment[] | undefined;
  extractJobs: BillingExtractJob[] | undefined;
}

/**
 * Determine which UX stage a billing case is in based on its data.
 *
 * The ordering is important: resolved > in_progress > analyzed > just_started.
 * A case can be in multiple states conceptually; we pick the most advanced.
 */
export function determineBillingStage(inputs: StageInputs): BillingStage {
  const { billingCase, findings, actions, callLogs, payments, extractJobs } = inputs;

  if (billingCase.status === 'resolved' || billingCase.status === 'closed') {
    return 'resolved';
  }

  const hasActivatedAction = (actions ?? []).some(
    (a) => a.status === 'active' || a.status === 'in_progress' || a.status === 'done',
  );
  const hasCalls = (callLogs ?? []).length > 0;
  const hasPayments = (payments ?? []).length > 0;

  if (hasActivatedAction || hasCalls || hasPayments) {
    return 'in_progress';
  }

  const hasTotals =
    billingCase.total_billed != null ||
    billingCase.total_patient_responsibility != null ||
    billingCase.total_allowed != null ||
    billingCase.total_plan_paid != null;

  const extractionCompleted = billingCase.last_extracted_at !== null;
  const hasFindingsOrAllClear =
    billingCase.last_reconciled_at !== null && (findings !== undefined);

  if ((extractionCompleted || hasTotals) && hasFindingsOrAllClear) {
    return 'analyzed';
  }

  // Still waiting on extraction, or no documents yet
  return 'just_started';
}

/**
 * A "simple" bill is one that extracted cleanly with no issues worth
 * calling out — so we can show the user a single big number + three
 * actions instead of the full findings/actions view.
 */
export function isSimpleBill(inputs: {
  billingCase: BillingCase;
  findings: BillingCaseFinding[] | undefined;
  ledgerLines: BillingLedgerLine[] | undefined;
}): boolean {
  const { billingCase, findings, ledgerLines: _ledgerLines } = inputs;

  if (findings === undefined || billingCase.last_reconciled_at === null) return false;

  const critical = findings.filter((f) => f.severity === 'critical');
  if (critical.length > 0) return false;

  const warnings = findings.filter((f) => f.severity === 'warning');
  if (warnings.length > 1) return false;

  const confidence = billingCase.totals_confidence ?? 0;
  if (confidence < 0.7) return false;

  if (billingCase.total_patient_responsibility == null) return false;

  return true;
}

/**
 * Human-friendly label describing the current stage. Surface this
 * sparingly — the stage system should feel natural, not mechanical.
 */
export const BILLING_STAGE_LABELS: Record<BillingStage, string> = {
  just_started: 'Just started',
  analyzed: 'Analyzed',
  in_progress: 'In progress',
  resolved: 'Done',
};
