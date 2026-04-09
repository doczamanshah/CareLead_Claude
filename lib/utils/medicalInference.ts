/**
 * Common medical knowledge for data entry assistance.
 * NOT medical advice — just pre-filling common values to save time.
 */

interface MedicationDefaults {
  route: string;
  commonFrequencies: string[];
  commonDoses: string[];
}

interface ConditionDefaults {
  subtypes: string[];
  commonSpecialists: string[];
}

/**
 * Common medication data for pre-filling form fields.
 * Keyed by lowercase drug name.
 */
const MEDICATION_DEFAULTS: Record<string, MedicationDefaults> = {
  lisinopril: {
    route: 'oral tablet',
    commonFrequencies: ['once daily'],
    commonDoses: ['5mg', '10mg', '20mg', '40mg'],
  },
  metformin: {
    route: 'oral tablet',
    commonFrequencies: ['twice daily', 'once daily'],
    commonDoses: ['500mg', '850mg', '1000mg'],
  },
  atorvastatin: {
    route: 'oral tablet',
    commonFrequencies: ['once daily'],
    commonDoses: ['10mg', '20mg', '40mg', '80mg'],
  },
  amlodipine: {
    route: 'oral tablet',
    commonFrequencies: ['once daily'],
    commonDoses: ['2.5mg', '5mg', '10mg'],
  },
  metoprolol: {
    route: 'oral tablet',
    commonFrequencies: ['twice daily', 'once daily'],
    commonDoses: ['25mg', '50mg', '100mg', '200mg'],
  },
  omeprazole: {
    route: 'oral capsule',
    commonFrequencies: ['once daily'],
    commonDoses: ['20mg', '40mg'],
  },
  levothyroxine: {
    route: 'oral tablet',
    commonFrequencies: ['once daily'],
    commonDoses: ['25mcg', '50mcg', '75mcg', '88mcg', '100mcg', '112mcg', '125mcg', '150mcg'],
  },
  losartan: {
    route: 'oral tablet',
    commonFrequencies: ['once daily'],
    commonDoses: ['25mg', '50mg', '100mg'],
  },
  hydrochlorothiazide: {
    route: 'oral tablet',
    commonFrequencies: ['once daily'],
    commonDoses: ['12.5mg', '25mg', '50mg'],
  },
  gabapentin: {
    route: 'oral capsule',
    commonFrequencies: ['three times daily'],
    commonDoses: ['100mg', '300mg', '400mg', '600mg', '800mg'],
  },
  sertraline: {
    route: 'oral tablet',
    commonFrequencies: ['once daily'],
    commonDoses: ['25mg', '50mg', '100mg', '150mg', '200mg'],
  },
  acetaminophen: {
    route: 'oral tablet',
    commonFrequencies: ['every 4-6 hours as needed'],
    commonDoses: ['325mg', '500mg', '1000mg'],
  },
  ibuprofen: {
    route: 'oral tablet',
    commonFrequencies: ['every 6-8 hours as needed'],
    commonDoses: ['200mg', '400mg', '600mg', '800mg'],
  },
  prednisone: {
    route: 'oral tablet',
    commonFrequencies: ['once daily', 'as directed'],
    commonDoses: ['5mg', '10mg', '20mg', '40mg'],
  },
  insulin: {
    route: 'subcutaneous injection',
    commonFrequencies: ['once daily', 'twice daily', 'with meals'],
    commonDoses: ['10 units', '20 units', '30 units'],
  },
  albuterol: {
    route: 'inhaler',
    commonFrequencies: ['every 4-6 hours as needed'],
    commonDoses: ['90mcg/actuation'],
  },
};

const DEFAULT_MEDICATION: MedicationDefaults = {
  route: 'oral',
  commonFrequencies: ['once daily', 'twice daily', 'three times daily', 'as needed'],
  commonDoses: [],
};

/**
 * Infer common medication defaults from the drug name.
 * Returns likely route, frequencies, and dose ranges.
 */
export function inferMedicationDefaults(drugName: string): MedicationDefaults {
  const lower = drugName.toLowerCase().trim();

  // Exact match
  if (MEDICATION_DEFAULTS[lower]) {
    return MEDICATION_DEFAULTS[lower];
  }

  // Partial match (e.g., "lisinopril 10mg" → "lisinopril")
  for (const [key, defaults] of Object.entries(MEDICATION_DEFAULTS)) {
    if (lower.startsWith(key) || lower.includes(key)) {
      return defaults;
    }
  }

  // Infer route from name patterns
  if (lower.includes('cream') || lower.includes('ointment') || lower.includes('gel')) {
    return { route: 'topical', commonFrequencies: ['twice daily', 'as directed'], commonDoses: [] };
  }
  if (lower.includes('drops') || lower.includes('ophthalmic')) {
    return { route: 'ophthalmic drops', commonFrequencies: ['twice daily', 'as directed'], commonDoses: [] };
  }
  if (lower.includes('inhaler') || lower.includes('nebulizer')) {
    return { route: 'inhaler', commonFrequencies: ['twice daily', 'as needed'], commonDoses: [] };
  }
  if (lower.includes('patch')) {
    return { route: 'transdermal patch', commonFrequencies: ['once daily', 'weekly'], commonDoses: [] };
  }
  if (lower.includes('injection') || lower.includes('syringe')) {
    return { route: 'injection', commonFrequencies: ['as directed'], commonDoses: [] };
  }

  return DEFAULT_MEDICATION;
}

/**
 * Common condition data for type inference.
 */
const CONDITION_DEFAULTS: Record<string, ConditionDefaults> = {
  diabetes: {
    subtypes: ['Type 1', 'Type 2', 'Gestational', 'Prediabetes'],
    commonSpecialists: ['Endocrinologist'],
  },
  hypertension: {
    subtypes: ['Essential', 'Secondary', 'Resistant'],
    commonSpecialists: ['Cardiologist'],
  },
  asthma: {
    subtypes: ['Intermittent', 'Mild persistent', 'Moderate persistent', 'Severe persistent'],
    commonSpecialists: ['Pulmonologist', 'Allergist'],
  },
  depression: {
    subtypes: ['Major depressive disorder', 'Persistent depressive disorder', 'Seasonal'],
    commonSpecialists: ['Psychiatrist', 'Psychologist'],
  },
  anxiety: {
    subtypes: ['Generalized anxiety disorder', 'Social anxiety', 'Panic disorder'],
    commonSpecialists: ['Psychiatrist', 'Psychologist'],
  },
  arthritis: {
    subtypes: ['Osteoarthritis', 'Rheumatoid', 'Psoriatic'],
    commonSpecialists: ['Rheumatologist'],
  },
  'heart failure': {
    subtypes: ['HFrEF', 'HFpEF'],
    commonSpecialists: ['Cardiologist'],
  },
  copd: {
    subtypes: ['Emphysema', 'Chronic bronchitis'],
    commonSpecialists: ['Pulmonologist'],
  },
  thyroid: {
    subtypes: ['Hypothyroidism', 'Hyperthyroidism', "Hashimoto's", "Graves' disease"],
    commonSpecialists: ['Endocrinologist'],
  },
};

const DEFAULT_CONDITION: ConditionDefaults = {
  subtypes: [],
  commonSpecialists: [],
};

/**
 * Infer condition subtypes and common specialists from a condition name.
 */
export function inferConditionType(conditionName: string): ConditionDefaults {
  const lower = conditionName.toLowerCase().trim();

  for (const [key, defaults] of Object.entries(CONDITION_DEFAULTS)) {
    if (lower.includes(key)) {
      return defaults;
    }
  }

  return DEFAULT_CONDITION;
}

/**
 * Frequency display labels for picker UI.
 */
export const FREQUENCY_OPTIONS = [
  { label: 'Once daily', value: 'once daily' },
  { label: 'Twice daily', value: 'twice daily' },
  { label: 'Three times daily', value: 'three times daily' },
  { label: 'Four times daily', value: 'four times daily' },
  { label: 'As needed', value: 'as needed' },
  { label: 'Every other day', value: 'every other day' },
  { label: 'Weekly', value: 'weekly' },
  { label: 'Other', value: 'other' },
] as const;
