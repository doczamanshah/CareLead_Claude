/**
 * Visit Prep generator. Combines an appointment, profile facts, and caregiver
 * roster to produce a cohesive `VisitPrep` object — purpose & agenda,
 * logistics, and a (later-rendered) packet preview.
 *
 * Pure: takes inputs, returns a VisitPrep. No DB writes.
 */

import { APPOINTMENT_TEMPLATES } from '@/lib/constants/appointmentTemplates';
import type {
  Appointment,
  VisitPrep,
  VisitPrepConcern,
  VisitPrepDriver,
  VisitPrepLogistics,
  VisitPrepQuestion,
  VisitPrepRefill,
} from '@/lib/types/appointments';
import type { ProfileFact } from '@/lib/types/profile';

interface CaregiverOption {
  user_id: string | null;
  display_name: string;
  role: string;
}

interface GenerateVisitPrepInput {
  appointment: Pick<
    Appointment,
    'appointment_type' | 'purpose' | 'provider_name' | 'start_time'
  >;
  facts: ProfileFact[];
  caregivers: CaregiverOption[];
  /** Optional clock injection for tests; defaults to `Date.now()`. */
  now?: Date;
}

const REFILL_LOOKBACK_DAYS = 60;
const DEPART_BUFFER_MINUTES = 30;

function makeId(prefix: string, index: number): string {
  return `${prefix}${index + 1}`;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function getMedicationName(fact: ProfileFact): string | null {
  const v = fact.value_json as Record<string, unknown>;
  return (
    readString(v.drug_name) ??
    readString(v.name) ??
    readString(v['medication.name']) ??
    null
  );
}

function getMedicationDose(fact: ProfileFact): string | null {
  const v = fact.value_json as Record<string, unknown>;
  return (
    readString(v.dose) ??
    readString(v.dosage) ??
    readString(v['medication.dosage']) ??
    null
  );
}

function getConditionName(fact: ProfileFact): string | null {
  const v = fact.value_json as Record<string, unknown>;
  return (
    readString(v.condition_name) ??
    readString(v.name) ??
    readString(v['condition.name']) ??
    null
  );
}

function buildQuestions(
  appointmentType: Appointment['appointment_type'],
  facts: ProfileFact[],
): VisitPrepQuestion[] {
  const conditions = facts
    .filter((f) => f.category === 'condition')
    .map(getConditionName)
    .filter((n): n is string => n !== null);

  const medications = facts.filter((f) => f.category === 'medication');

  const questions: VisitPrepQuestion[] = [];
  let priority = 1;

  // Condition-driven questions
  for (const condition of conditions.slice(0, 2)) {
    const lower = condition.toLowerCase();
    if (lower.includes('diabetes')) {
      questions.push({
        id: makeId('q', questions.length),
        text: 'What is my current A1c, and is my medication still the right fit?',
        source: 'ai_suggested',
        priority: priority++,
      });
    } else if (lower.includes('hypertension') || lower.includes('blood pressure')) {
      questions.push({
        id: makeId('q', questions.length),
        text: 'Are my recent blood pressure readings on target?',
        source: 'ai_suggested',
        priority: priority++,
      });
    } else if (lower.includes('cholesterol') || lower.includes('lipid')) {
      questions.push({
        id: makeId('q', questions.length),
        text: 'Should we recheck my cholesterol panel at this visit?',
        source: 'ai_suggested',
        priority: priority++,
      });
    } else {
      questions.push({
        id: makeId('q', questions.length),
        text: `How is my ${condition} being managed, and is anything changing?`,
        source: 'ai_suggested',
        priority: priority++,
      });
    }
  }

  // Multi-medication interaction question
  if (medications.length >= 2) {
    questions.push({
      id: makeId('q', questions.length),
      text: 'Are there any interactions between my current medications I should know about?',
      source: 'ai_suggested',
      priority: priority++,
    });
  }

  // Type-specific question
  if (appointmentType === 'procedure') {
    questions.push({
      id: makeId('q', questions.length),
      text: 'Which medications should I take or hold the morning of the procedure?',
      source: 'ai_suggested',
      priority: priority++,
    });
  } else if (appointmentType === 'labs') {
    questions.push({
      id: makeId('q', questions.length),
      text: 'When and how will I see the lab results?',
      source: 'ai_suggested',
      priority: priority++,
    });
  } else if (appointmentType === 'imaging') {
    questions.push({
      id: makeId('q', questions.length),
      text: 'Will contrast be used, and is there any prep I need beforehand?',
      source: 'ai_suggested',
      priority: priority++,
    });
  }

  // If we still don't have at least 3 questions, fill from the template fallback.
  if (questions.length < 3) {
    const fallback = APPOINTMENT_TEMPLATES[appointmentType].fallback_questions;
    for (const text of fallback) {
      if (questions.length >= 5) break;
      questions.push({
        id: makeId('q', questions.length),
        text,
        source: 'ai_suggested',
        priority: priority++,
      });
    }
  }

  // Cap at 5
  return questions.slice(0, 5);
}

function buildRefillsNeeded(facts: ProfileFact[], now: Date): VisitPrepRefill[] {
  const refills: VisitPrepRefill[] = [];
  const cutoff = now.getTime() - REFILL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

  for (const fact of facts) {
    if (fact.category !== 'medication') continue;

    const created = new Date(fact.created_at).getTime();
    if (Number.isNaN(created) || created > cutoff) continue;

    const name = getMedicationName(fact);
    if (!name) continue;

    const dose = getMedicationDose(fact);
    refills.push({
      medication: dose ? `${name} ${dose}` : name,
      reason: 'No refill tracked in 60+ days',
    });
  }

  return refills;
}

function buildConcerns(facts: ProfileFact[]): VisitPrepConcern[] {
  const concerns: VisitPrepConcern[] = [];

  for (const fact of facts) {
    if (fact.category !== 'measurement') continue;
    const v = fact.value_json as Record<string, unknown>;
    const flagged = v.flagged === true || v.status === 'elevated' || v.status === 'abnormal';
    const label = readString(v.label) ?? readString(v.name);
    if (flagged && label) {
      concerns.push({
        text: `Recent ${label} reading was flagged`,
        source: 'profile',
      });
    }
  }

  return concerns.slice(0, 3);
}

function buildDriver(caregivers: CaregiverOption[]): VisitPrepDriver | null {
  // Prefer a non-owner caregiver (someone other than the patient themselves).
  const candidate =
    caregivers.find((c) => c.role === 'caregiver' || c.role === 'admin') ??
    caregivers[0];

  if (!candidate) return null;

  return {
    name: candidate.display_name,
    user_id: candidate.user_id,
    notified: false,
  };
}

function buildWhatToBring(
  appointment: Pick<Appointment, 'provider_name'>,
  facts: ProfileFact[],
): string[] {
  const items: string[] = [];

  // Insurance card: only if the provider isn't already in the care team.
  const careTeamNames = facts
    .filter((f) => f.category === 'care_team')
    .map((f) => {
      const v = f.value_json as Record<string, unknown>;
      return readString(v.name) ?? readString(v['care_team.name']);
    })
    .filter((n): n is string => n !== null)
    .map((n) => n.toLowerCase());

  const providerKnown =
    !!appointment.provider_name &&
    careTeamNames.some((n) => n.includes(appointment.provider_name!.toLowerCase()));

  const hasInsurance = facts.some((f) => f.category === 'insurance');
  if (hasInsurance && !providerKnown) {
    items.push('Insurance card');
  }

  // Photo ID is reasonable for any first-time provider visit
  if (!providerKnown) {
    items.push('Photo ID');
  }

  // Medication list is always relevant — CareLead can generate it from the Visit Packet.
  if (facts.some((f) => f.category === 'medication')) {
    items.push('Medication list (in your Visit Packet)');
  }

  return items;
}

function buildDepartBy(startTime: string): string | null {
  const start = new Date(startTime);
  if (Number.isNaN(start.getTime())) return null;
  start.setMinutes(start.getMinutes() - DEPART_BUFFER_MINUTES);
  return start.toISOString();
}

function buildLogistics(
  appointment: Pick<Appointment, 'start_time' | 'provider_name'>,
  facts: ProfileFact[],
  caregivers: CaregiverOption[],
): VisitPrepLogistics {
  return {
    depart_by: buildDepartBy(appointment.start_time),
    driver: buildDriver(caregivers),
    what_to_bring: buildWhatToBring(appointment, facts),
  };
}

/**
 * Generate a structured Visit Prep object from an appointment + profile context.
 * Returns a fresh prep object the caller can persist on the appointment.
 */
export function generateVisitPrep(input: GenerateVisitPrepInput): VisitPrep {
  const { appointment, facts, caregivers } = input;
  const now = input.now ?? new Date();

  const purpose_summary =
    appointment.purpose && appointment.purpose.trim().length > 0
      ? appointment.purpose.trim()
      : APPOINTMENT_TEMPLATES[appointment.appointment_type].default_purpose;

  return {
    purpose_summary,
    questions: buildQuestions(appointment.appointment_type, facts),
    refills_needed: buildRefillsNeeded(facts, now),
    concerns: buildConcerns(facts),
    logistics: buildLogistics(appointment, facts, caregivers),
    packet_generated: false,
  };
}
