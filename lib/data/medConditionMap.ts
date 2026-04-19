/**
 * Medication → Implied Condition map.
 *
 * Used by the life-event trigger service to prompt: "You're taking X, which
 * is commonly used for Y — do you have Y?" when the user adds a medication
 * but no matching condition is present on their profile.
 *
 * Scope is intentionally conservative. Only well-known, primary-indication
 * associations — nothing off-label, nothing ambiguous. We match on the
 * medication's canonical drug_name or generic name, lowercase, with common
 * brand/generic pairings surfaced together.
 */

export const MED_CONDITION_MAP: Record<string, string> = {
  // Diabetes
  metformin: 'Type 2 Diabetes',
  jardiance: 'Type 2 Diabetes',
  empagliflozin: 'Type 2 Diabetes',
  farxiga: 'Type 2 Diabetes',
  dapagliflozin: 'Type 2 Diabetes',
  glipizide: 'Type 2 Diabetes',
  glyburide: 'Type 2 Diabetes',
  glimepiride: 'Type 2 Diabetes',
  insulin: 'Diabetes',
  lantus: 'Diabetes',
  humalog: 'Diabetes',
  novolog: 'Diabetes',

  // Hypertension
  lisinopril: 'Hypertension',
  losartan: 'Hypertension',
  amlodipine: 'Hypertension',
  hydrochlorothiazide: 'Hypertension',
  metoprolol: 'Hypertension',
  valsartan: 'Hypertension',
  carvedilol: 'Hypertension',
  enalapril: 'Hypertension',

  // Cholesterol
  atorvastatin: 'High Cholesterol',
  rosuvastatin: 'High Cholesterol',
  simvastatin: 'High Cholesterol',
  pravastatin: 'High Cholesterol',
  lipitor: 'High Cholesterol',
  crestor: 'High Cholesterol',

  // Thyroid
  levothyroxine: 'Hypothyroidism',
  synthroid: 'Hypothyroidism',

  // Asthma / respiratory
  albuterol: 'Asthma',
  montelukast: 'Asthma',
  singulair: 'Asthma',
  fluticasone: 'Asthma',
  advair: 'Asthma',
  symbicort: 'Asthma',

  // GERD
  omeprazole: 'GERD',
  pantoprazole: 'GERD',
  esomeprazole: 'GERD',
  nexium: 'GERD',
  prilosec: 'GERD',

  // Depression / anxiety
  sertraline: 'Depression/Anxiety',
  zoloft: 'Depression/Anxiety',
  escitalopram: 'Depression/Anxiety',
  lexapro: 'Depression/Anxiety',
  fluoxetine: 'Depression/Anxiety',
  prozac: 'Depression/Anxiety',
  citalopram: 'Depression/Anxiety',

  // Neuropathy / pain
  gabapentin: 'Neuropathy/Pain',
  pregabalin: 'Neuropathy/Pain',
  lyrica: 'Neuropathy/Pain',
};

/**
 * Look up the implied condition for a medication name. Tries the full name
 * first, then the first word (handles "Lisinopril 10mg" → "lisinopril").
 */
export function inferConditionFromMedication(drugName: string): string | null {
  if (!drugName) return null;
  const normalized = drugName.toLowerCase().trim();
  if (MED_CONDITION_MAP[normalized]) return MED_CONDITION_MAP[normalized];

  const firstToken = normalized.split(/\s+/)[0];
  if (firstToken && MED_CONDITION_MAP[firstToken]) {
    return MED_CONDITION_MAP[firstToken];
  }

  return null;
}
