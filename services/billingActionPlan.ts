/**
 * Billing action plan generator — pure function that converts findings
 * into proposed actions, deduplicating against already-existing actions.
 */

import type {
  BillingCaseAction,
  BillingCaseFinding,
  BillingDocument,
  FindingCode,
  ProposedAction,
} from '@/lib/types/billing';

export interface GenerateActionPlanParams {
  caseId: string;
  profileId: string;
  householdId: string;
  findings: BillingCaseFinding[];
  existingActions: BillingCaseAction[];
}

export function generateActionPlan(
  params: GenerateActionPlanParams,
): ProposedAction[] {
  const { findings, existingActions } = params;

  const existingTypes = new Set<string>(
    existingActions.map((a) => a.action_type),
  );

  const proposed: ProposedAction[] = [];
  const seenInBatch = new Set<string>();

  const add = (candidate: ProposedAction) => {
    if (existingTypes.has(candidate.action_type)) return;
    if (seenInBatch.has(candidate.action_type)) return;
    seenInBatch.add(candidate.action_type);
    proposed.push(candidate);
  };

  for (const finding of findings) {
    switch (finding.code) {
      case 'missing_eob':
        add({
          action_type: 'upload_eob',
          title: 'Upload your EOB',
          description:
            'Upload the Explanation of Benefits from your insurance company. This lets CareLead compare what was billed against what insurance processed.',
          source_finding_code: finding.code,
          source_finding_severity: finding.severity,
        });
        break;

      case 'missing_bill':
        add({
          action_type: 'other',
          title: 'Upload your bill',
          description:
            'Upload the bill or statement from your provider so CareLead can extract charges and identify any issues.',
          source_finding_code: finding.code,
          source_finding_severity: finding.severity,
        });
        break;

      case 'total_mismatch':
        add({
          action_type: 'call_provider_billing',
          title: 'Call provider billing',
          description:
            "Call the provider's billing department to verify the charges. Ask them to confirm the total and explain any discrepancy with your EOB.",
          source_finding_code: finding.code,
          source_finding_severity: finding.severity,
        });
        add({
          action_type: 'call_insurer',
          title: 'Call your insurance company',
          description:
            'Call your insurer to verify what was processed and why the amounts differ from the bill.',
          source_finding_code: finding.code,
          source_finding_severity: finding.severity,
        });
        break;

      case 'denial_detected':
        add({
          action_type: 'appeal_denial',
          title: 'Consider appealing the denial',
          description:
            'Your claim was denied. CareLead can help you organize an appeal packet with the required documents and a draft letter.',
          source_finding_code: finding.code,
          source_finding_severity: finding.severity,
        });
        break;

      case 'possible_overpayment':
        add({
          action_type: 'request_refund',
          title: 'Request a refund',
          description:
            "Based on your payment records, you may have overpaid. Contact the provider's billing department to request a refund.",
          source_finding_code: finding.code,
          source_finding_severity: finding.severity,
        });
        break;

      case 'low_doc_quality':
        add({
          action_type: 'other',
          title: 'Upload a clearer document',
          description:
            'One or more of your documents is hard to read. Try uploading a clearer photo or a PDF version for better extraction results.',
          source_finding_code: finding.code,
          source_finding_severity: finding.severity,
        });
        break;

      // low_confidence, missing_provider, missing_payer, no_service_dates
      // are handled by "Strengthen Your Case" suggestions — no action.
      default:
        break;
    }
  }

  return proposed;
}

// ── Auto-complete / Auto-dismiss ──────────────────────────────────────────

export interface AutoCompleteActionsParams {
  documents: BillingDocument[];
  actions: BillingCaseAction[];
}

/**
 * Returns IDs of actions whose underlying condition has been satisfied and
 * can be marked 'done' without user intervention.
 */
export function autoCompleteActions(
  params: AutoCompleteActionsParams,
): string[] {
  const { documents, actions } = params;

  const hasEob = documents.some((d) => d.doc_type === 'eob');
  const hasBill = documents.some(
    (d) => d.doc_type === 'bill' || d.doc_type === 'itemized_bill',
  );

  const toComplete: string[] = [];
  for (const action of actions) {
    if (action.status !== 'proposed' && action.status !== 'active') continue;

    if (action.action_type === 'upload_eob' && hasEob) {
      toComplete.push(action.id);
      continue;
    }

    if (
      action.action_type === 'other' &&
      action.title.includes('Upload your bill') &&
      hasBill
    ) {
      toComplete.push(action.id);
    }
  }

  return toComplete;
}

function findingCodeForAction(
  action: BillingCaseAction,
): FindingCode | null {
  switch (action.action_type) {
    case 'upload_eob':
      return 'missing_eob';
    case 'call_provider_billing':
    case 'call_insurer':
      return 'total_mismatch';
    case 'appeal_denial':
      return 'denial_detected';
    case 'request_refund':
      return 'possible_overpayment';
    case 'other':
      if (action.title.includes('Upload your bill')) return 'missing_bill';
      if (action.title.includes('Upload a clearer document'))
        return 'low_doc_quality';
      return null;
    default:
      return null;
  }
}

export interface AutoDismissResolvedActionsParams {
  findings: BillingCaseFinding[];
  actions: BillingCaseAction[];
}

/**
 * Returns IDs of proposed actions whose source finding is no longer present
 * in the unresolved findings list (i.e., the finding was resolved).
 *
 * `findings` should be the current unresolved findings for the case.
 */
export function autoDismissResolvedActions(
  params: AutoDismissResolvedActionsParams,
): string[] {
  const { findings, actions } = params;

  const unresolvedCodes = new Set<string>(
    findings.filter((f) => !f.is_resolved).map((f) => f.code),
  );

  const toDismiss: string[] = [];
  for (const action of actions) {
    if (action.status !== 'proposed') continue;
    const code = findingCodeForAction(action);
    if (!code) continue;
    if (!unresolvedCodes.has(code)) {
      toDismiss.push(action.id);
    }
  }

  return toDismiss;
}
