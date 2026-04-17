/**
 * Call script generator — produces a context-aware phone script for a billing case.
 *
 * Pure function: takes case data + findings and returns a structured CallScript
 * the user can read from during a real phone call.
 */

import type {
  BillingCase,
  BillingCaseFinding,
  BillingDenialRecord,
  BillingCasePayment,
  BillingCaseParty,
  CallParty,
  CallScript,
  CallScriptQuestion,
  CallScriptReference,
} from '@/lib/types/billing';

function formatServiceDates(billingCase: BillingCase): string {
  const start = billingCase.service_date_start;
  const end = billingCase.service_date_end;
  if (!start) return '[service date]';
  const formatted = (s: string) =>
    new Date(s + 'T00:00:00').toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  if (end && end !== start) {
    return `${formatted(start)} to ${formatted(end)}`;
  }
  return formatted(start);
}

function formatCurrency(amount: number | null | undefined): string {
  if (amount == null) return '[amount]';
  return `$${amount.toFixed(2)}`;
}

function hasFinding(
  findings: BillingCaseFinding[],
  code: string,
): BillingCaseFinding | undefined {
  return findings.find((f) => f.code === code && !f.is_resolved);
}

function findingsRecommend(
  findings: BillingCaseFinding[],
  action: string,
): boolean {
  return findings.some(
    (f) =>
      !f.is_resolved &&
      Array.isArray(f.recommended_actions) &&
      (f.recommended_actions as string[]).includes(action),
  );
}

function eobAmount(finding: BillingCaseFinding | undefined): string {
  if (!finding || !finding.evidence) return '[EOB amount]';
  const ev = finding.evidence as Record<string, unknown>;
  const val =
    typeof ev.eob_patient_responsibility === 'number'
      ? ev.eob_patient_responsibility
      : typeof ev.eob_amount === 'number'
        ? ev.eob_amount
        : null;
  return formatCurrency(val);
}

function billAmount(
  finding: BillingCaseFinding | undefined,
  billingCase: BillingCase,
): string {
  if (finding && finding.evidence) {
    const ev = finding.evidence as Record<string, unknown>;
    const val =
      typeof ev.bill_amount === 'number'
        ? ev.bill_amount
        : typeof ev.patient_responsibility === 'number'
          ? ev.patient_responsibility
          : null;
    if (val != null) return formatCurrency(val);
  }
  return formatCurrency(billingCase.total_patient_responsibility);
}

function providerReferences(
  billingCase: BillingCase,
  caseParties: BillingCaseParty | null,
): CallScriptReference[] {
  const refs: CallScriptReference[] = [];
  if (caseParties?.claim_number) {
    refs.push({ label: 'Claim Number', value: caseParties.claim_number });
  }
  if (caseParties?.member_id) {
    refs.push({ label: 'Member ID', value: caseParties.member_id });
  }
  if (billingCase.external_ref) {
    refs.push({ label: 'Account Reference', value: billingCase.external_ref });
  }
  return refs;
}

function payerReferences(
  caseParties: BillingCaseParty | null,
): CallScriptReference[] {
  const refs: CallScriptReference[] = [];
  if (caseParties?.member_id) {
    refs.push({ label: 'Member ID', value: caseParties.member_id });
  }
  if (caseParties?.claim_number) {
    refs.push({ label: 'Claim Number', value: caseParties.claim_number });
  }
  if (caseParties?.group_number) {
    refs.push({ label: 'Group Number', value: caseParties.group_number });
  }
  if (caseParties?.plan_name) {
    refs.push({ label: 'Plan', value: caseParties.plan_name });
  }
  return refs;
}

function buildProviderScript(
  billingCase: BillingCase,
  findings: BillingCaseFinding[],
  caseParties: BillingCaseParty | null,
): CallScript {
  const providerName = billingCase.provider_name ?? 'Provider';
  const title = `Call ${providerName} Billing`;
  const serviceDates = formatServiceDates(billingCase);
  const accountClause = caseParties?.claim_number
    ? `, account or claim number ${caseParties.claim_number},`
    : ',';
  const introduction =
    `Hi, I'm calling about a bill I received. My name is [patient name]${accountClause} ` +
    `for services on ${serviceDates}.`;

  const questions: CallScriptQuestion[] = [];

  questions.push({
    question: 'Can you confirm the total amount I owe?',
    why: "Verify the bill matches what you've been told.",
  });

  const mismatch = hasFinding(findings, 'total_mismatch');
  if (mismatch) {
    questions.push({
      question: `My EOB shows a different patient responsibility amount of ${eobAmount(mismatch)}. Can you explain the difference?`,
      why: "The bill and EOB amounts don't match.",
    });
  }

  if (findingsRecommend(findings, 'request_itemized_bill')) {
    questions.push({
      question: 'Can I get an itemized bill with procedure codes and individual charges?',
      why: 'An itemized bill helps verify each charge.',
    });
  }

  if (hasFinding(findings, 'low_confidence')) {
    questions.push({
      question: 'Can you walk me through the charges? I want to make sure everything is correct.',
      why: "Some charges weren't clearly readable.",
    });
  }

  questions.push({
    question: 'Is there a payment plan available?',
    why: 'Good to know your options before committing to pay.',
  });

  questions.push({
    question: 'Can I get a reference number for this call?',
    why: 'Always get a reference number for your records.',
  });

  return {
    title,
    party: 'provider',
    phoneNumber: null,
    referenceNumbers: providerReferences(billingCase, caseParties),
    introduction,
    questions,
    tips: [
      'Write down the name of the person you speak with.',
      'Ask for a reference number before you hang up.',
      "Don't agree to pay until you've verified the charges match your EOB.",
      'You can request time to review before paying.',
    ],
  };
}

function buildPayerScript(
  billingCase: BillingCase,
  findings: BillingCaseFinding[],
  denialRecords: BillingDenialRecord[],
  caseParties: BillingCaseParty | null,
): CallScript {
  const payerName = billingCase.payer_name ?? 'Insurance Company';
  const title = `Call ${payerName}`;
  const serviceDates = formatServiceDates(billingCase);
  const memberIdText = caseParties?.member_id ? caseParties.member_id : '[member ID]';
  const claimText = caseParties?.claim_number
    ? caseParties.claim_number
    : '[claim number]';
  const providerClause = billingCase.provider_name
    ? ` at ${billingCase.provider_name}`
    : '';
  const introduction =
    `Hi, I'm calling about a claim. My member ID is ${memberIdText}, and the claim number is ${claimText}, ` +
    `for services on ${serviceDates}${providerClause}.`;

  const questions: CallScriptQuestion[] = [];

  questions.push({
    question: `What is the status of claim ${claimText}?`,
    why: 'Confirm the claim was received and processed.',
  });

  const mismatch = hasFinding(findings, 'total_mismatch');
  if (mismatch) {
    questions.push({
      question: `The provider is billing me ${billAmount(mismatch, billingCase)} but the EOB says my share is ${eobAmount(mismatch)}. Which is correct?`,
      why: 'Resolve the discrepancy.',
    });
  }

  const denialFinding = hasFinding(findings, 'denial_detected');
  if (denialFinding) {
    const reason =
      denialRecords[0]?.denial_reason ?? (denialFinding.message || 'the stated reason');
    questions.push({
      question: `My claim was denied for ${reason}. What exactly do I need to do to appeal?`,
      why: 'Get specific appeal instructions.',
    });
    questions.push({
      question: 'What is the deadline for filing an appeal?',
      why: "Don't miss the filing window.",
    });
  }

  questions.push({
    question: 'How much of my deductible have I met this year?',
    why: 'Verify your deductible status.',
  });

  questions.push({
    question: 'Can I get a reference number for this call?',
    why: 'Always document your calls.',
  });

  return {
    title,
    party: 'payer',
    phoneNumber: null,
    referenceNumbers: payerReferences(caseParties),
    introduction,
    questions,
    tips: [
      'Have your member ID and claim number ready before calling.',
      "Ask to speak with a claims specialist if the first rep can't help.",
      'Note the date, time, and rep name.',
      'Request written confirmation of anything they tell you.',
    ],
  };
}

function buildPharmacyScript(billingCase: BillingCase): CallScript {
  const serviceDates = formatServiceDates(billingCase);
  return {
    title: 'Call Pharmacy',
    party: 'pharmacy',
    phoneNumber: null,
    referenceNumbers: [],
    introduction:
      `Hi, I'm calling about a prescription charge from ${serviceDates}. My name is [patient name] and my date of birth is [DOB].`,
    questions: [
      {
        question: 'Can you confirm what was billed and what I paid out of pocket?',
        why: 'Make sure you understand the charge.',
      },
      {
        question: 'Was this run through my insurance?',
        why: 'Sometimes prescriptions are filled before insurance processes.',
      },
      {
        question: 'If not, can it be re-billed to my insurance?',
        why: 'You may be eligible for a refund or lower cost.',
      },
      {
        question: 'Can I get a reference number for this call?',
        why: 'Always get a reference number for your records.',
      },
    ],
    tips: [
      'Have the prescription number or fill date ready.',
      'Ask who you spoke with and note the time.',
      'If re-billing is possible, ask how long it takes to process.',
    ],
  };
}

function buildOtherScript(billingCase: BillingCase): CallScript {
  const serviceDates = formatServiceDates(billingCase);
  return {
    title: 'Call',
    party: 'other',
    phoneNumber: null,
    referenceNumbers: [],
    introduction:
      `Hi, I'm calling about a healthcare charge from ${serviceDates}. My name is [patient name].`,
    questions: [
      {
        question: 'Can you help me understand this charge?',
        why: 'Start with open-ended clarification.',
      },
      {
        question: 'What reference or confirmation number can I use to follow up?',
        why: 'Always document your calls.',
      },
    ],
    tips: [
      'Write down the name of the person you speak with.',
      'Ask for a reference number before you hang up.',
      'Keep notes on what was said and any promised follow-up.',
    ],
  };
}

export function generateCallScript(params: {
  party: CallParty;
  billingCase: BillingCase;
  findings: BillingCaseFinding[];
  denialRecords: BillingDenialRecord[];
  payments: BillingCasePayment[];
  caseParties: BillingCaseParty | null;
}): CallScript {
  const { party, billingCase, findings, denialRecords, caseParties } = params;
  // payments currently unused — kept in signature for future extensions
  void params.payments;

  switch (party) {
    case 'provider':
      return buildProviderScript(billingCase, findings, caseParties);
    case 'payer':
      return buildPayerScript(billingCase, findings, denialRecords, caseParties);
    case 'pharmacy':
      return buildPharmacyScript(billingCase);
    case 'other':
    default:
      return buildOtherScript(billingCase);
  }
}
