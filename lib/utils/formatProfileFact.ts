import type { ProfileFact, ProfileFactCategory } from '@/lib/types/profile';

/**
 * Human-readable labels for common sub-field keys within structured profile fact values.
 */
const SUB_FIELD_LABELS: Record<string, string> = {
  drug_name: 'Medication',
  generic_name: 'Generic',
  dose: 'Dose',
  frequency: 'Frequency',
  quantity: 'Quantity',
  refills_remaining: 'Refills',
  prescriber: 'Prescriber',
  pharmacy_name: 'Pharmacy',
  pharmacy_phone: 'Pharmacy Phone',
  rx_number: 'Rx #',
  date_filled: 'Date Filled',
  expiration_date: 'Expires',
  instructions: 'Instructions',
  substance: 'Substance',
  reaction: 'Reaction',
  severity: 'Severity',
  name: 'Name',
  status: 'Status',
  diagnosed_date: 'Diagnosed',
  notes: 'Notes',
  payer_name: 'Insurance Provider',
  member_id: 'Member ID',
  group_number: 'Group #',
  rx_bin: 'Rx BIN',
  rx_pcn: 'Rx PCN',
  plan_type: 'Plan Type',
  phone_member_services: 'Member Services',
  phone_provider: 'Provider Line',
  copay_primary: 'Primary Copay',
  copay_specialist: 'Specialist Copay',
  copay_emergency: 'ER Copay',
  deductible: 'Deductible',
  specialty: 'Specialty',
  phone: 'Phone',
  address: 'Address',
  fax: 'Fax',
  date: 'Date',
  hospital: 'Hospital',
  surgeon: 'Surgeon',
  condition: 'Condition',
  relative: 'Relative',
  relationship: 'Relationship',
  provider: 'Provider',
  plan: 'Plan',
  test_name: 'Test',
  result_value: 'Result',
  units: 'Units',
  reference_range: 'Reference Range',
};

function labelForKey(key: string): string {
  return SUB_FIELD_LABELS[key] ?? key
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Extracts the inner data object, unwrapping the {value: ...} wrapper if present. */
function unwrapValue(valueJson: Record<string, unknown>): Record<string, unknown> {
  // If the object has a single "value" key that is itself an object, unwrap it
  if (
    Object.keys(valueJson).length === 1 &&
    'value' in valueJson &&
    typeof valueJson.value === 'object' &&
    valueJson.value !== null
  ) {
    return valueJson.value as Record<string, unknown>;
  }
  return valueJson;
}

export interface FormattedFact {
  /** Primary display line (e.g., "Lisinopril 25mg - Once daily") */
  title: string;
  /** Optional secondary details as labeled key-value pairs */
  details: { label: string; value: string }[];
}

/**
 * Format a profile fact for display based on its category.
 * Returns a title line and optional labeled detail rows.
 */
export function formatProfileFact(fact: ProfileFact): FormattedFact {
  const val = unwrapValue(fact.value_json);

  switch (fact.category) {
    case 'medication':
      return formatMedication(val);
    case 'allergy':
      return formatAllergy(val);
    case 'condition':
      return formatCondition(val);
    case 'insurance':
      return formatInsurance(val);
    case 'care_team':
      return formatCareTeam(val);
    case 'pharmacy':
      return formatPharmacy(val);
    case 'surgery':
      return formatSurgery(val);
    case 'family_history':
      return formatFamilyHistory(val);
    case 'emergency_contact':
      return formatEmergencyContact(val);
    default:
      return formatGeneric(val);
  }
}

function str(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  return String(v);
}

function formatMedication(val: Record<string, unknown>): FormattedFact {
  const name = str(val.drug_name) ?? str(val.name) ?? str(val.value) ?? 'Unknown medication';
  const parts = [name];
  if (str(val.dose)) parts.push(str(val.dose)!);
  const title = parts.join(' ');

  const details: { label: string; value: string }[] = [];
  if (str(val.frequency)) details.push({ label: 'Frequency', value: str(val.frequency)! });
  if (str(val.prescriber)) details.push({ label: 'Prescriber', value: str(val.prescriber)! });
  if (str(val.instructions)) details.push({ label: 'Instructions', value: str(val.instructions)! });
  if (str(val.refills_remaining)) details.push({ label: 'Refills', value: str(val.refills_remaining)! });
  if (str(val.pharmacy_name)) details.push({ label: 'Pharmacy', value: str(val.pharmacy_name)! });

  return { title, details };
}

function formatAllergy(val: Record<string, unknown>): FormattedFact {
  const substance = str(val.substance) ?? str(val.name) ?? str(val.value) ?? 'Unknown allergen';
  const reaction = str(val.reaction);
  const severity = str(val.severity);

  let title = substance;
  if (reaction) title += ` — ${reaction}`;

  const details: { label: string; value: string }[] = [];
  if (severity) details.push({ label: 'Severity', value: severity });
  if (str(val.notes)) details.push({ label: 'Notes', value: str(val.notes)! });

  return { title, details };
}

function formatCondition(val: Record<string, unknown>): FormattedFact {
  const name = str(val.name) ?? str(val.condition) ?? str(val.value) ?? 'Unknown condition';
  const details: { label: string; value: string }[] = [];
  if (str(val.status)) details.push({ label: 'Status', value: str(val.status)! });
  if (str(val.diagnosed_date)) details.push({ label: 'Diagnosed', value: str(val.diagnosed_date)! });
  if (str(val.notes)) details.push({ label: 'Notes', value: str(val.notes)! });
  return { title: name, details };
}

function formatInsurance(val: Record<string, unknown>): FormattedFact {
  const name = str(val.payer_name) ?? str(val.provider) ?? str(val.value) ?? 'Insurance';
  const details: { label: string; value: string }[] = [];
  const fields: [string, string][] = [
    ['plan_type', 'Plan Type'],
    ['member_id', 'Member ID'],
    ['group_number', 'Group #'],
    ['rx_bin', 'Rx BIN'],
    ['rx_pcn', 'Rx PCN'],
    ['phone_member_services', 'Member Services'],
    ['phone_provider', 'Provider Line'],
    ['copay_primary', 'Primary Copay'],
    ['copay_specialist', 'Specialist Copay'],
    ['copay_emergency', 'ER Copay'],
    ['deductible', 'Deductible'],
    ['phone', 'Phone'],
    ['plan', 'Plan'],
  ];
  for (const [key, label] of fields) {
    if (str(val[key])) details.push({ label, value: str(val[key])! });
  }
  return { title: name, details };
}

function formatCareTeam(val: Record<string, unknown>): FormattedFact {
  const name = str(val.name) ?? str(val.provider) ?? str(val.value) ?? 'Provider';
  const details: { label: string; value: string }[] = [];
  if (str(val.specialty)) details.push({ label: 'Specialty', value: str(val.specialty)! });
  if (str(val.phone)) details.push({ label: 'Phone', value: str(val.phone)! });
  if (str(val.address)) details.push({ label: 'Address', value: str(val.address)! });
  if (str(val.fax)) details.push({ label: 'Fax', value: str(val.fax)! });
  if (str(val.notes)) details.push({ label: 'Notes', value: str(val.notes)! });
  return { title: name, details };
}

function formatPharmacy(val: Record<string, unknown>): FormattedFact {
  const name = str(val.name) ?? str(val.value) ?? 'Pharmacy';
  const details: { label: string; value: string }[] = [];
  if (str(val.phone)) details.push({ label: 'Phone', value: str(val.phone)! });
  if (str(val.address)) details.push({ label: 'Address', value: str(val.address)! });
  return { title: name, details };
}

function formatSurgery(val: Record<string, unknown>): FormattedFact {
  const name = str(val.name) ?? str(val.value) ?? 'Procedure';
  const details: { label: string; value: string }[] = [];
  if (str(val.date)) details.push({ label: 'Date', value: str(val.date)! });
  if (str(val.hospital)) details.push({ label: 'Hospital', value: str(val.hospital)! });
  if (str(val.surgeon)) details.push({ label: 'Surgeon', value: str(val.surgeon)! });
  if (str(val.notes)) details.push({ label: 'Notes', value: str(val.notes)! });
  return { title: name, details };
}

function formatFamilyHistory(val: Record<string, unknown>): FormattedFact {
  const condition = str(val.condition) ?? str(val.value) ?? 'Unknown';
  const relative = str(val.relative);
  const title = relative ? `${condition} (${relative})` : condition;
  const details: { label: string; value: string }[] = [];
  if (str(val.notes)) details.push({ label: 'Notes', value: str(val.notes)! });
  return { title, details };
}

function formatEmergencyContact(val: Record<string, unknown>): FormattedFact {
  const name = str(val.name) ?? str(val.value) ?? 'Contact';
  const details: { label: string; value: string }[] = [];
  if (str(val.relationship)) details.push({ label: 'Relationship', value: str(val.relationship)! });
  if (str(val.phone)) details.push({ label: 'Phone', value: str(val.phone)! });
  return { title: name, details };
}

function formatGeneric(val: Record<string, unknown>): FormattedFact {
  // For unknown categories, try to find a primary display value
  const primary = str(val.name) ?? str(val.value) ?? str(val.description);
  if (primary) {
    const details: { label: string; value: string }[] = [];
    for (const [key, v] of Object.entries(val)) {
      if (['name', 'value', 'description'].includes(key)) continue;
      if (str(v)) details.push({ label: labelForKey(key), value: str(v)! });
    }
    return { title: primary, details };
  }

  // Fallback: show all fields as details
  const entries = Object.entries(val).filter(([, v]) => str(v) !== null);
  if (entries.length === 0) return { title: 'No data', details: [] };

  const [firstKey, firstVal] = entries[0];
  const details = entries.slice(1).map(([k, v]) => ({ label: labelForKey(k), value: str(v)! }));
  return { title: `${labelForKey(firstKey)}: ${str(firstVal)}`, details };
}
