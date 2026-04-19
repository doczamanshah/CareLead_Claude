/**
 * Normalizes condition names and matches them against trigger keywords used
 * by preventive rules. Patients record conditions in many different ways
 * ("Type 2 DM", "T2DM", "diabetes mellitus type 2"), but preventive rules
 * use a single canonical term ("diabetes"). This utility bridges the two.
 */

type CanonicalKey =
  | 'diabetes'
  | 'type 1 diabetes'
  | 'type 2 diabetes'
  | 'prediabetes'
  | 'hypertension'
  | 'high cholesterol'
  | 'heart disease'
  | 'ckd'
  | 'copd'
  | 'obesity'
  | 'overweight'
  | 'smoking'
  | 'tobacco use'
  | 'former smoker';

// Each entry lists synonyms (lowercase, trimmed) that collapse into the key.
const SYNONYM_GROUPS: Record<CanonicalKey, string[]> = {
  diabetes: [
    'diabetes',
    'diabetes mellitus',
    'dm',
    'type 2 diabetes',
    'type 2 dm',
    't2dm',
    'type ii diabetes',
    'diabetes mellitus type 2',
    'type 1 diabetes',
    'type 1 dm',
    't1dm',
    'type i diabetes',
    'diabetes mellitus type 1',
  ],
  'type 1 diabetes': [
    'type 1 diabetes',
    'type 1 dm',
    't1dm',
    'type i diabetes',
    'diabetes mellitus type 1',
  ],
  'type 2 diabetes': [
    'type 2 diabetes',
    'type 2 dm',
    't2dm',
    'type ii diabetes',
    'diabetes mellitus type 2',
    // Plain 'diabetes' most commonly means type 2 clinically.
    'diabetes',
    'diabetes mellitus',
    'dm',
  ],
  prediabetes: ['prediabetes', 'pre-diabetes', 'pre diabetes', 'impaired glucose tolerance', 'igt'],
  hypertension: [
    'hypertension',
    'high blood pressure',
    'htn',
    'elevated blood pressure',
  ],
  'high cholesterol': [
    'high cholesterol',
    'hyperlipidemia',
    'dyslipidemia',
    'elevated cholesterol',
  ],
  'heart disease': [
    'heart disease',
    'cardiovascular disease',
    'cvd',
    'coronary artery disease',
    'cad',
    'ischemic heart disease',
    'atherosclerotic cardiovascular disease',
    'ascvd',
  ],
  ckd: [
    'ckd',
    'chronic kidney disease',
    'renal disease',
    'kidney disease',
    'chronic renal insufficiency',
  ],
  copd: ['copd', 'chronic obstructive pulmonary disease', 'emphysema', 'chronic bronchitis'],
  obesity: ['obesity', 'obese', 'morbid obesity'],
  overweight: ['overweight'],
  smoking: [
    'smoking',
    'smoker',
    'tobacco use',
    'active smoker',
    'current smoker',
    'former smoker',
    'ex-smoker',
    'ex smoker',
    'past smoker',
  ],
  'tobacco use': [
    'tobacco use',
    'smoking',
    'smoker',
    'current smoker',
    'active smoker',
  ],
  'former smoker': [
    'former smoker',
    'ex-smoker',
    'ex smoker',
    'past smoker',
    'quit smoking',
  ],
};

function normalize(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, ' ');
}

function expandTrigger(trigger: string): Set<string> {
  const norm = normalize(trigger);
  const matched = SYNONYM_GROUPS[norm as CanonicalKey];
  if (matched) return new Set(matched.map(normalize));
  return new Set([norm]);
}

/**
 * True when any patient condition matches any of the rule's trigger keywords,
 * accounting for common synonyms.
 */
export function matchesCondition(
  patientConditions: string[],
  triggers: string[],
): boolean {
  if (!triggers || triggers.length === 0) return false;
  if (!patientConditions || patientConditions.length === 0) return false;

  const patientSet = new Set(patientConditions.map(normalize));

  for (const trigger of triggers) {
    const candidates = expandTrigger(trigger);
    for (const candidate of candidates) {
      if (patientSet.has(candidate)) return true;
      // Also match if any patient condition contains the candidate as a
      // substring — catches free-text entries like "type 2 diabetes, diet-
      // controlled" matching trigger "type 2 diabetes".
      for (const pc of patientSet) {
        if (pc.includes(candidate) || candidate.includes(pc)) return true;
      }
    }
  }
  return false;
}
