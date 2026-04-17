/**
 * Billing reconciliation engine — pure, deterministic checks that run
 * client-side (no Edge Function). Produces findings sorted by severity.
 */

import type {
  BillingCase,
  BillingDocument,
  BillingLedgerLine,
  BillingCasePayment,
  BillingDenialRecord,
  ReconciliationFinding,
  FindingSeverity,
} from '@/lib/types/billing';

const SEVERITY_ORDER: Record<FindingSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

export interface ReconcileParams {
  billingCase: BillingCase;
  documents: BillingDocument[];
  ledgerLines: BillingLedgerLine[];
  payments: BillingCasePayment[];
  denialRecords: BillingDenialRecord[];
}

export function reconcileBillingCase(
  params: ReconcileParams,
): ReconciliationFinding[] {
  const { billingCase, documents, ledgerLines, payments, denialRecords } = params;
  const findings: ReconciliationFinding[] = [];

  const hasBill = documents.some((d) => d.doc_type === 'bill' || d.doc_type === 'itemized_bill');
  const hasEob = documents.some((d) => d.doc_type === 'eob');

  // CHECK 1: missing_bill
  if (!hasBill) {
    findings.push({
      code: 'missing_bill',
      severity: 'warning',
      message:
        'No bill uploaded yet. Adding the bill helps CareLead verify charges and identify discrepancies.',
      recommended_actions: ['other'],
    });
  }

  // CHECK 2: missing_eob (only if a bill exists)
  if (hasBill && !hasEob) {
    findings.push({
      code: 'missing_eob',
      severity: 'warning',
      message:
        'No EOB uploaded. Adding your insurance Explanation of Benefits lets CareLead compare what was billed vs. what insurance processed.',
      recommended_actions: ['upload_eob'],
    });
  }

  // CHECK 3: low_doc_quality
  const lowQualityDocs = documents.filter(
    (d) => d.quality_score !== null && d.quality_score < 0.5,
  );
  if (lowQualityDocs.length > 0) {
    findings.push({
      code: 'low_doc_quality',
      severity: 'warning',
      message:
        'One or more documents may be hard to read. Consider uploading a clearer copy for more accurate extraction.',
      evidence: {
        documentIds: lowQualityDocs.map((d) => d.id),
        scores: lowQualityDocs.map((d) => d.quality_score),
      },
    });
  }

  // CHECK 4: low_confidence on totals
  if (
    billingCase.totals_confidence !== null &&
    billingCase.totals_confidence < 0.6
  ) {
    findings.push({
      code: 'low_confidence',
      severity: 'warning',
      message:
        'Some extracted amounts have low confidence. Review the totals above and correct any that look wrong.',
      recommended_actions: ['other'],
    });
  }

  // CHECK 5: total_mismatch — bill vs EOB patient responsibility
  const totalLines = ledgerLines.filter((l) => l.line_kind === 'total');
  const billTotal = findPatientTotalForDocType(totalLines, documents, 'bill');
  const eobTotal = findPatientTotalForDocType(totalLines, documents, 'eob');
  if (billTotal !== null && eobTotal !== null) {
    const diff = Math.abs(billTotal - eobTotal);
    if (diff > 1) {
      findings.push({
        code: 'total_mismatch',
        severity: 'critical',
        message: `The bill shows patient responsibility of $${billTotal.toFixed(
          2,
        )} but the EOB shows $${eobTotal.toFixed(
          2,
        )}. This $${diff.toFixed(2)} difference may indicate a billing error.`,
        evidence: {
          bill_amount: billTotal,
          eob_amount: eobTotal,
          difference: Number(diff.toFixed(2)),
        },
        recommended_actions: ['call_provider_billing', 'call_insurer'],
      });
    }
  }

  // CHECK 6: denial_detected
  if (denialRecords.length > 0) {
    const first = denialRecords[0];
    const label = first.denial_reason ?? humanizeCategory(first.category);
    findings.push({
      code: 'denial_detected',
      severity: 'critical',
      message: `A denial was detected: ${label}. You may be able to appeal this.`,
      evidence: {
        category: first.category,
        reason: first.denial_reason,
        deadline: first.deadline,
      },
      recommended_actions: ['appeal_denial'],
    });
  }

  // CHECK 7: possible_overpayment
  if (payments.length > 0 && billingCase.total_patient_responsibility !== null) {
    const totalPaid = payments
      .filter((p) => p.kind === 'payment')
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const totalRefunded = payments
      .filter((p) => p.kind === 'refund')
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const netPaid = totalPaid - totalRefunded;
    const responsibility = billingCase.total_patient_responsibility;
    if (netPaid > responsibility + 0.01) {
      const over = netPaid - responsibility;
      findings.push({
        code: 'possible_overpayment',
        severity: 'critical',
        message: `You may have overpaid by $${over.toFixed(
          2,
        )}. Recorded payments ($${netPaid.toFixed(
          2,
        )}) exceed the patient responsibility ($${responsibility.toFixed(2)}).`,
        evidence: {
          total_paid: Number(netPaid.toFixed(2)),
          patient_responsibility: responsibility,
          overpayment_amount: Number(over.toFixed(2)),
        },
        recommended_actions: ['request_refund'],
      });
    }
  }

  // CHECK 8: missing_provider
  if (!billingCase.provider_name || billingCase.provider_name.trim() === '') {
    findings.push({
      code: 'missing_provider',
      severity: 'info',
      message:
        'Adding the provider name helps CareLead generate call scripts and keep your cases organized.',
    });
  }

  // CHECK 9: missing_payer
  if (!billingCase.payer_name || billingCase.payer_name.trim() === '') {
    findings.push({
      code: 'missing_payer',
      severity: 'info',
      message:
        'Adding your insurance company enables call scripts and helps match bills to EOBs.',
    });
  }

  // CHECK 10: no_service_dates
  if (!billingCase.service_date_start) {
    findings.push({
      code: 'no_service_dates',
      severity: 'info',
      message:
        'Adding service dates helps track filing deadlines and match documents.',
    });
  }

  return findings.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
}

function findPatientTotalForDocType(
  totalLines: BillingLedgerLine[],
  documents: BillingDocument[],
  docType: 'bill' | 'eob',
): number | null {
  const docIds = new Set(
    documents
      .filter((d) =>
        docType === 'bill'
          ? d.doc_type === 'bill' || d.doc_type === 'itemized_bill'
          : d.doc_type === 'eob',
      )
      .map((d) => d.id),
  );
  const match = totalLines.find(
    (l) =>
      l.billing_document_id !== null &&
      docIds.has(l.billing_document_id) &&
      l.amount_patient !== null,
  );
  return match?.amount_patient ?? null;
}

function humanizeCategory(category: string | null): string {
  if (!category) return 'denial';
  const map: Record<string, string> = {
    prior_auth: 'prior authorization required',
    medical_necessity: 'medical necessity',
    not_covered: 'not covered by plan',
    timely_filing: 'timely filing',
    coding_error: 'coding error',
    duplicate: 'duplicate claim',
    other: 'denial',
  };
  return map[category] ?? category;
}
