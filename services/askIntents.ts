/**
 * Voice Retrieval ("Ask Profile") — Intent Library
 *
 * Deterministic intent definitions used by the intent router to classify
 * natural-language questions into known query types. Keep this file pure
 * data — no imports from the runtime.
 */

import type { FactDomain } from '@/lib/types/ask';

export type AskQueryType =
  | 'list_all'
  | 'get_latest'
  | 'get_specific'
  | 'get_count'
  | 'get_history';

export type AskEntityDomain =
  | 'medication_name'
  | 'lab_name'
  | 'condition_name'
  | 'provider_name'
  | 'imaging_type';

export type AskAttribute =
  | 'dose'
  | 'prescriber'
  | 'pharmacy'
  | 'last_appointment'
  | 'next_appointment';

export interface AskIntent {
  id: string;
  patterns: string[];
  domain: FactDomain;
  queryType: AskQueryType;
  entityRequired: boolean;
  entityDomain: AskEntityDomain | null;
  /** Attribute hint for get_specific intents. */
  attribute?: AskAttribute;
  /** Direction hint for appointment intents. */
  direction?: 'upcoming' | 'past';
  /** For list/latest intents that also want to narrow by sub-type (e.g. imaging). */
  resultTypeFilter?: 'lab' | 'imaging' | 'other';
}

export const ASK_INTENTS: AskIntent[] = [
  // ── Medications ─────────────────────────────────────────────────────────
  {
    id: 'GET_MED_DOSE',
    patterns: [
      'dose of',
      'dosage of',
      'how much do i take',
      'what dose',
      'what is the dose',
    ],
    domain: 'medications',
    queryType: 'get_specific',
    entityRequired: true,
    entityDomain: 'medication_name',
    attribute: 'dose',
  },
  {
    id: 'GET_MED_PRESCRIBER',
    patterns: ['who prescribed', 'prescriber of', 'prescribing doctor', 'prescribed by'],
    domain: 'medications',
    queryType: 'get_specific',
    entityRequired: true,
    entityDomain: 'medication_name',
    attribute: 'prescriber',
  },
  {
    id: 'GET_ACTIVE_MEDS',
    patterns: [
      'what meds',
      'what medications',
      'medication list',
      'med list',
      'what am i taking',
      'current medications',
      'my meds',
      'my medications',
      'list my meds',
      'list of meds',
    ],
    domain: 'medications',
    queryType: 'list_all',
    entityRequired: false,
    entityDomain: null,
  },

  // ── Labs / Results ──────────────────────────────────────────────────────
  {
    id: 'GET_LAB_HISTORY',
    patterns: [
      'history',
      'trend',
      'over time',
      'all my',
      'show my',
      'how has my',
      'how has',
      'how s my',
      'how s',
      'been over',
      'been doing',
      'been lately',
      'changes in',
      'track my',
      'show trend',
      'over the last',
      'over the past',
      'progression',
      'progress of',
    ],
    domain: 'labs',
    queryType: 'get_history',
    entityRequired: true,
    entityDomain: 'lab_name',
  },
  {
    id: 'GET_LATEST_LAB',
    patterns: [
      'last a1c',
      'latest a1c',
      'recent a1c',
      'last cholesterol',
      'latest lab',
      'my a1c',
      'what was my',
      'most recent',
      'latest',
      'last',
    ],
    domain: 'labs',
    queryType: 'get_latest',
    entityRequired: true,
    entityDomain: 'lab_name',
  },
  {
    id: 'GET_IMAGING',
    patterns: ['imaging', 'x-ray', 'xray', 'ct scan', 'mri', 'ultrasound', 'radiology'],
    domain: 'results',
    queryType: 'list_all',
    entityRequired: false,
    entityDomain: null,
    resultTypeFilter: 'imaging',
  },
  {
    id: 'GET_ALL_RESULTS',
    patterns: [
      'all results',
      'all labs',
      'lab results',
      'test results',
      'recent results',
      'latest labs',
      'latest results',
      'recent labs',
      'my labs',
      'my results',
      'cmp',
      'bmp',
      'cbc',
      'lipid panel',
      'metabolic panel',
      'basic metabolic',
      'comprehensive metabolic',
      'complete blood count',
      'my cmp',
      'my bmp',
      'my cbc',
    ],
    domain: 'labs',
    queryType: 'list_all',
    entityRequired: false,
    entityDomain: null,
  },

  // ── Allergies ───────────────────────────────────────────────────────────
  {
    id: 'GET_ALLERGIES',
    patterns: ['allergies', 'allergic to', 'drug allergies', 'allergy list', 'any allergies'],
    domain: 'allergies',
    queryType: 'list_all',
    entityRequired: false,
    entityDomain: null,
  },

  // ── Conditions ──────────────────────────────────────────────────────────
  {
    id: 'GET_CONDITIONS',
    patterns: [
      'conditions',
      'diagnoses',
      'diagnosis',
      'problems',
      'what conditions',
      'problem list',
      'medical history',
    ],
    domain: 'conditions',
    queryType: 'list_all',
    entityRequired: false,
    entityDomain: null,
  },

  // ── Appointments ────────────────────────────────────────────────────────
  {
    id: 'GET_APPOINTMENTS',
    patterns: [
      'my appointments',
      'appointments',
      'all my appointments',
      'list my appointments',
      'my visits',
      'doctor visits',
      'upcoming visits',
      'past appointments',
      'past visits',
      'appointment history',
    ],
    domain: 'appointments',
    queryType: 'list_all',
    entityRequired: false,
    entityDomain: null,
  },
  {
    id: 'GET_NEXT_APPOINTMENT',
    patterns: [
      'next appointment',
      'next visit',
      'upcoming appointment',
      'upcoming visit',
      'when is my next',
      'next doctor',
    ],
    domain: 'appointments',
    queryType: 'get_latest',
    entityRequired: false,
    entityDomain: null,
    direction: 'upcoming',
    attribute: 'next_appointment',
  },
  {
    id: 'GET_LAST_APPOINTMENT',
    patterns: [
      'last appointment',
      'last visit',
      'previous appointment',
      'when was my last',
      'most recent appointment',
    ],
    domain: 'appointments',
    queryType: 'get_latest',
    entityRequired: false,
    entityDomain: null,
    direction: 'past',
    attribute: 'last_appointment',
  },

  // ── Insurance ───────────────────────────────────────────────────────────
  {
    id: 'GET_INSURANCE',
    patterns: [
      'insurance',
      'member id',
      'insurance card',
      'payer',
      'coverage',
      'plan name',
      'group number',
    ],
    domain: 'insurance',
    queryType: 'list_all',
    entityRequired: false,
    entityDomain: null,
  },

  // ── Care Team ───────────────────────────────────────────────────────────
  {
    id: 'GET_CARE_TEAM',
    patterns: [
      'care team',
      'my doctors',
      'my providers',
      'who is my doctor',
      'specialist',
      'pharmacy',
    ],
    domain: 'care_team',
    queryType: 'list_all',
    entityRequired: false,
    entityDomain: null,
  },

  // ── Surgeries ───────────────────────────────────────────────────────────
  {
    id: 'GET_SURGERIES',
    patterns: ['surgeries', 'operations', 'procedures', 'surgical history'],
    domain: 'surgeries',
    queryType: 'list_all',
    entityRequired: false,
    entityDomain: null,
  },

  // ── Preventive ──────────────────────────────────────────────────────────
  {
    id: 'GET_PREVENTIVE_STATUS',
    patterns: [
      'screenings',
      'preventive',
      'what screenings',
      'due for',
      'overdue',
      'vaccinations',
      'immunizations',
    ],
    domain: 'preventive',
    queryType: 'list_all',
    entityRequired: false,
    entityDomain: null,
  },

  // ── Billing ─────────────────────────────────────────────────────────────
  {
    id: 'GET_BILLING',
    patterns: ['bills', 'billing', 'what do i owe', 'outstanding bills', 'medical bills'],
    domain: 'billing',
    queryType: 'list_all',
    entityRequired: false,
    entityDomain: null,
  },
];

/**
 * History-signal keywords. When any of these appear alongside a lab entity,
 * the router should prefer GET_LAB_HISTORY over GET_LATEST_LAB so the user
 * gets a trend/comparison view instead of a single most-recent value.
 * Apostrophes are stripped by the router's normalizer, so "how's" appears as
 * "how s" here.
 */
export const LAB_HISTORY_KEYWORDS = [
  'history',
  'trend',
  'over time',
  'over the last',
  'over the past',
  'how has',
  'how s',
  'been over',
  'been doing',
  'been lately',
  'changes in',
  'track my',
  'progression',
  'progress of',
];

/**
 * Well-known lab analyte keywords. Used by the router to extract lab entities
 * even when the profile has no prior observations.
 */
export const KNOWN_LAB_ANALYTES = [
  'a1c',
  'hba1c',
  'ldl',
  'hdl',
  'cholesterol',
  'triglycerides',
  'glucose',
  'creatinine',
  'tsh',
  'potassium',
  'sodium',
  'calcium',
  'hemoglobin',
  'hematocrit',
  'platelets',
  'wbc',
  'rbc',
  'alt',
  'ast',
  'egfr',
  'bun',
  'psa',
  'vitamin d',
  'b12',
  'iron',
  'ferritin',
];
