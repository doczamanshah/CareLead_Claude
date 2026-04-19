/**
 * Life-event trigger detection.
 *
 * Given "something just changed" (new medication, new provider, etc.), this
 * service returns zero or more short follow-up prompts the UI can surface.
 *
 * The function is pure and synchronous — callers pre-fetch the profile facts
 * they're going to pass in. This keeps the store rehydration path (which runs
 * after a mutation's onSuccess) fast and easy to reason about.
 *
 * Design notes:
 *   • Prompts are stable-ID'd (`<event>.<subject>.<profileId>`) so a prompt
 *     dismissed once never reappears for the same subject.
 *   • Dedup is the caller's responsibility via the life-event store — the
 *     service returns the raw candidate set.
 *   • We never invent medical knowledge. Medication→condition inference uses
 *     the tightly-scoped map in `lib/data/medConditionMap.ts`.
 */

import { inferConditionFromMedication } from '@/lib/data/medConditionMap';
import type { ProfileFact } from '@/lib/types/profile';
import type {
  LifeEventAction,
  LifeEventPrompt,
  LifeEventType,
} from '@/lib/types/lifeEvents';

// ── Public API ────────────────────────────────────────────────────────────

export interface MedicationEventData {
  medicationId: string;
  drugName: string;
  prescriberName?: string | null;
  condition?: string | null;
  /** For stopped: condition fact ID the med was linked to, if known. */
  linkedConditionFactId?: string | null;
}

export interface ProviderEventData {
  providerName: string;
  specialty?: string | null;
  factId?: string | null;
  appointmentId?: string | null;
}

export interface InsuranceEventData {
  factId: string;
  payerName?: string | null;
}

export interface ConditionEventData {
  conditionName: string;
  factId: string;
}

export interface AppointmentEventData {
  appointmentId: string;
  providerName?: string | null;
  facilityName?: string | null;
}

export interface CaregiverEventData {
  caregiverName: string;
  inviteId?: string | null;
  shareUrl?: string | null;
}

export type LifeEventDataFor<T extends LifeEventType> =
  T extends 'medication_added' | 'medication_stopped' ? MedicationEventData
  : T extends 'provider_added' ? ProviderEventData
  : T extends 'insurance_added' | 'insurance_updated' ? InsuranceEventData
  : T extends 'condition_added' ? ConditionEventData
  : T extends 'appointment_created' ? AppointmentEventData
  : T extends 'caregiver_added' ? CaregiverEventData
  : Record<string, unknown>;

export interface DetectTriggersParams<T extends LifeEventType> {
  eventType: T;
  eventData: LifeEventDataFor<T>;
  profileId: string;
  householdId: string;
  existingProfileFacts: ProfileFact[];
}

export function detectLifeEventTriggers<T extends LifeEventType>(
  params: DetectTriggersParams<T>,
): LifeEventPrompt[] {
  switch (params.eventType) {
    case 'insurance_added':
    case 'insurance_updated':
      return insurancePrompts(params as DetectTriggersParams<'insurance_added'>);
    case 'provider_added':
      return providerPrompts(params as DetectTriggersParams<'provider_added'>);
    case 'medication_added':
      return medicationAddedPrompts(
        params as DetectTriggersParams<'medication_added'>,
      );
    case 'medication_stopped':
      return medicationStoppedPrompts(
        params as DetectTriggersParams<'medication_stopped'>,
      );
    case 'condition_added':
      return conditionAddedPrompts(
        params as DetectTriggersParams<'condition_added'>,
      );
    case 'appointment_created':
      return appointmentCreatedPrompts(
        params as DetectTriggersParams<'appointment_created'>,
      );
    case 'caregiver_added':
      return caregiverAddedPrompts(
        params as DetectTriggersParams<'caregiver_added'>,
      );
    default:
      return [];
  }
}

// ── Rule implementations ──────────────────────────────────────────────────

function insurancePrompts(
  params: DetectTriggersParams<'insurance_added'>,
): LifeEventPrompt[] {
  const now = new Date().toISOString();
  const pharmacyPrompt: LifeEventPrompt = {
    id: `insurance_added.pharmacy.${params.profileId}.${params.eventData.factId}`,
    triggerEvent: 'insurance_added',
    profileId: params.profileId,
    title: 'Update your pharmacy?',
    detail:
      'Your new insurance may have a different preferred pharmacy or formulary.',
    priority: 'high',
    actions: [
      {
        label: 'Update pharmacy',
        route: `/(main)/profile/${params.profileId}/add-fact`,
        params: { category: 'pharmacy' },
        primary: true,
      },
      { label: 'No change needed', quickAction: 'dismiss' },
    ],
    createdAt: now,
  };

  const hasMedications = params.existingProfileFacts.some(
    (f) => f.category === 'medication',
  );
  const prompts: LifeEventPrompt[] = [pharmacyPrompt];
  if (hasMedications) {
    prompts.push({
      id: `insurance_added.review_meds.${params.profileId}.${params.eventData.factId}`,
      triggerEvent: 'insurance_added',
      profileId: params.profileId,
      title: 'Review your medications?',
      detail:
        'Some medications may need prior authorization under your new plan.',
      priority: 'medium',
      actions: [
        { label: 'Review meds', route: '/(main)/medications', primary: true },
        { label: 'All good', quickAction: 'dismiss' },
      ],
      createdAt: now,
    });
  }

  return prompts;
}

function providerPrompts(
  params: DetectTriggersParams<'provider_added'>,
): LifeEventPrompt[] {
  const now = new Date().toISOString();
  const { providerName, specialty, factId } = params.eventData;
  const prompts: LifeEventPrompt[] = [];

  if (!specialty?.trim() && factId) {
    prompts.push({
      id: `provider_added.specialty.${params.profileId}.${factId}`,
      triggerEvent: 'provider_added',
      profileId: params.profileId,
      title: `What type of doctor is ${providerName}?`,
      detail: 'Adding their specialty helps CareLead prepare for visits.',
      priority: 'high',
      actions: [
        {
          label: 'Add specialty',
          route: `/(main)/profile/${params.profileId}`,
          primary: true,
        },
        { label: 'Skip', quickAction: 'dismiss' },
      ],
      createdAt: now,
    });
  }

  prompts.push({
    id: `provider_added.reason.${params.profileId}.${factId ?? providerName}`,
    triggerEvent: 'provider_added',
    profileId: params.profileId,
    title: `What are you seeing ${providerName} for?`,
    detail: 'This helps CareLead suggest relevant questions for your visit.',
    priority: 'medium',
    actions: [
      {
        label: 'Add condition/reason',
        route: `/(main)/profile/${params.profileId}/add-fact`,
        params: { category: 'condition' },
        primary: true,
      },
      { label: 'Skip', quickAction: 'dismiss' },
    ],
    createdAt: now,
  });

  return prompts;
}

function medicationAddedPrompts(
  params: DetectTriggersParams<'medication_added'>,
): LifeEventPrompt[] {
  const now = new Date().toISOString();
  const { medicationId, drugName, prescriberName } = params.eventData;
  const prompts: LifeEventPrompt[] = [];

  const impliedCondition = inferConditionFromMedication(drugName);
  if (impliedCondition && !hasCondition(params.existingProfileFacts, impliedCondition)) {
    prompts.push({
      id: `medication_added.condition.${params.profileId}.${medicationId}`,
      triggerEvent: 'medication_added',
      profileId: params.profileId,
      title: `Do you have ${impliedCondition}?`,
      detail: `You're taking ${drugName}, which is commonly used for ${impliedCondition}.`,
      priority: 'high',
      actions: [
        {
          label: 'Yes, add it',
          handler: 'add_condition',
          handlerPayload: { conditionName: impliedCondition },
          primary: true,
        },
        { label: 'No', quickAction: 'dismiss' },
        { label: 'Not sure', quickAction: 'dismiss' },
      ],
      createdAt: now,
    });
  }

  if (!prescriberName?.trim()) {
    prompts.push({
      id: `medication_added.prescriber.${params.profileId}.${medicationId}`,
      triggerEvent: 'medication_added',
      profileId: params.profileId,
      title: `Who prescribed ${drugName}?`,
      detail:
        'Tracking the prescriber helps connect medications to your care team.',
      priority: 'medium',
      actions: [
        {
          label: 'Add prescriber',
          route: `/(main)/medications/${medicationId}`,
          primary: true,
        },
        { label: 'Skip', quickAction: 'dismiss' },
      ],
      createdAt: now,
    });
  }

  return prompts;
}

function medicationStoppedPrompts(
  params: DetectTriggersParams<'medication_stopped'>,
): LifeEventPrompt[] {
  const now = new Date().toISOString();
  const { medicationId, drugName, condition, linkedConditionFactId } =
    params.eventData;
  const prompts: LifeEventPrompt[] = [];

  prompts.push({
    id: `medication_stopped.replacement.${params.profileId}.${medicationId}`,
    triggerEvent: 'medication_stopped',
    profileId: params.profileId,
    title: `Was ${drugName} replaced with something else?`,
    detail: 'If you switched medications, we can add the new one for you.',
    priority: 'high',
    actions: [
      {
        label: 'Yes, add new medication',
        route: '/(main)/medications/create',
        params: { replacingMedication: drugName },
        primary: true,
      },
      { label: 'No, just stopped', quickAction: 'dismiss' },
    ],
    createdAt: now,
  });

  if (condition && linkedConditionFactId) {
    prompts.push({
      id: `medication_stopped.condition.${params.profileId}.${medicationId}`,
      triggerEvent: 'medication_stopped',
      profileId: params.profileId,
      title: `Is ${condition} still active?`,
      detail: `${drugName} was associated with ${condition}. If it's resolved, we can archive it.`,
      priority: 'medium',
      actions: [
        { label: 'Yes', quickAction: 'dismiss' },
        {
          label: "It's resolved",
          handler: 'archive_condition',
          handlerPayload: { factId: linkedConditionFactId },
          primary: true,
        },
      ],
      createdAt: now,
    });
  }

  return prompts;
}

function conditionAddedPrompts(
  params: DetectTriggersParams<'condition_added'>,
): LifeEventPrompt[] {
  const now = new Date().toISOString();
  const { conditionName, factId } = params.eventData;

  return [
    {
      id: `condition_added.med.${params.profileId}.${factId}`,
      triggerEvent: 'condition_added',
      profileId: params.profileId,
      title: `Are you taking any medications for ${conditionName}?`,
      detail: 'Linking meds to conditions helps with visit prep and refill checks.',
      priority: 'high',
      actions: [
        {
          label: 'Add medication',
          route: '/(main)/medications/create',
          primary: true,
        },
        { label: 'Not yet', quickAction: 'dismiss' },
      ],
      createdAt: now,
    },
    {
      id: `condition_added.specialist.${params.profileId}.${factId}`,
      triggerEvent: 'condition_added',
      profileId: params.profileId,
      title: `Do you see a specialist for ${conditionName}?`,
      detail: 'We can keep their info handy for your next visit.',
      priority: 'medium',
      actions: [
        {
          label: 'Add specialist',
          route: `/(main)/profile/${params.profileId}/add-fact`,
          params: { category: 'care_team' },
          primary: true,
        },
        { label: 'No', quickAction: 'dismiss' },
      ],
      createdAt: now,
    },
  ];
}

function appointmentCreatedPrompts(
  params: DetectTriggersParams<'appointment_created'>,
): LifeEventPrompt[] {
  const now = new Date().toISOString();
  const { appointmentId, providerName } = params.eventData;
  if (!providerName?.trim()) return [];

  const providerInTeam = params.existingProfileFacts.some((f) => {
    if (f.category !== 'care_team') return false;
    const val = (f.value_json ?? {}) as Record<string, unknown>;
    const name =
      typeof val.name === 'string'
        ? val.name
        : typeof val.provider === 'string'
          ? (val.provider as string)
          : null;
    return !!name && name.toLowerCase().includes(providerName.toLowerCase());
  });
  if (providerInTeam) return [];

  const actions: LifeEventAction[] = [
    {
      label: 'Yes',
      handler: 'add_care_team_from_appointment',
      handlerPayload: { providerName },
      primary: true,
    },
    { label: 'No', quickAction: 'dismiss' },
  ];

  return [
    {
      id: `appointment_created.care_team.${params.profileId}.${appointmentId}`,
      triggerEvent: 'appointment_created',
      profileId: params.profileId,
      title: `Add ${providerName} to your care team?`,
      detail: 'This keeps their contact info handy for future visits.',
      priority: 'medium',
      actions,
      createdAt: now,
    },
  ];
}

function caregiverAddedPrompts(
  params: DetectTriggersParams<'caregiver_added'>,
): LifeEventPrompt[] {
  const now = new Date().toISOString();
  const { caregiverName, inviteId, shareUrl } = params.eventData;
  return [
    {
      id: `caregiver_added.help.${params.profileId}.${inviteId ?? caregiverName}`,
      triggerEvent: 'caregiver_added',
      profileId: params.profileId,
      title: `Would you like ${caregiverName} to help build your profile?`,
      detail:
        'Caregivers can add medications, upload documents, and help keep your profile current.',
      priority: 'medium',
      actions: [
        {
          label: 'Send them a reminder',
          handler: 'caregiver_open_share',
          handlerPayload: shareUrl ? { shareUrl } : {},
          primary: true,
        },
        { label: "They'll do it themselves", quickAction: 'dismiss' },
      ],
      createdAt: now,
    },
  ];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function hasCondition(facts: ProfileFact[], conditionName: string): boolean {
  const needle = conditionName.toLowerCase();
  return facts.some((f) => {
    if (f.category !== 'condition') return false;
    const val = (f.value_json ?? {}) as Record<string, unknown>;
    const candidate =
      typeof val.name === 'string'
        ? val.name
        : typeof val.condition === 'string'
          ? (val.condition as string)
          : null;
    if (!candidate) return false;
    const hay = candidate.toLowerCase();
    // Direct match or shared leading token ("Type 2 Diabetes" / "Diabetes").
    if (hay === needle) return true;
    if (hay.includes(needle) || needle.includes(hay)) return true;
    return false;
  });
}
