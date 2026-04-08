/**
 * Maps intent item field_key strings to human-readable labels.
 * Used by the Intent Sheet review screen to display friendly names.
 */

const FIELD_LABELS: Record<string, string> = {
  // Structured entry keys (new format — one entry per logical item)
  'medication.entry': 'Medication',
  'allergy.entry': 'Allergy',
  'condition.entry': 'Condition',
  'insurance.entry': 'Insurance',
  'care_team.entry': 'Care Team Provider',
  'pharmacy.entry': 'Pharmacy',
  'surgery.entry': 'Surgical History',
  'family_history.entry': 'Family History',
  'emergency_contact.entry': 'Emergency Contact',
  'lab.entry': 'Lab Result',
  'goal.entry': 'Goal',
  'measurement.entry': 'Measurement',

  // Legacy individual field keys (for backwards compatibility with existing data)
  // Insurance
  'insurance.payer_name': 'Insurance Provider',
  'insurance.provider': 'Insurance Provider',
  'insurance.plan': 'Plan Name',
  'insurance.member_id': 'Member ID',
  'insurance.group_number': 'Group Number',
  'insurance.phone': 'Insurance Phone',
  'insurance.effective_date': 'Effective Date',
  'insurance.copay': 'Copay',
  'insurance.deductible': 'Deductible',

  // Medications
  'medication.name': 'Medication Name',
  'medication.drug_name': 'Medication Name',
  'medication.dosage': 'Dosage',
  'medication.dose': 'Dose',
  'medication.frequency': 'Frequency',
  'medication.prescriber': 'Prescribing Doctor',
  'medication.start_date': 'Start Date',
  'medication.refills': 'Refills Remaining',
  'medication.instructions': 'Instructions',
  'medication.notes': 'Medication Notes',

  // Allergies
  'allergy.substance': 'Allergy',
  'allergy.reaction': 'Reaction',
  'allergy.severity': 'Severity',
  'allergy.notes': 'Allergy Notes',

  // Conditions
  'condition.name': 'Condition',
  'condition.status': 'Condition Status',
  'condition.diagnosed_date': 'Diagnosed Date',
  'condition.notes': 'Condition Notes',

  // Care Team
  'care_team.name': 'Provider Name',
  'care_team.specialty': 'Specialty',
  'care_team.phone': 'Provider Phone',
  'care_team.address': 'Provider Address',
  'care_team.fax': 'Provider Fax',
  'care_team.notes': 'Provider Notes',

  // Pharmacy
  'pharmacy.name': 'Pharmacy Name',
  'pharmacy.phone': 'Pharmacy Phone',
  'pharmacy.address': 'Pharmacy Address',
  'pharmacy.notes': 'Pharmacy Notes',

  // Surgery
  'surgery.name': 'Procedure',
  'surgery.date': 'Procedure Date',
  'surgery.hospital': 'Hospital',
  'surgery.surgeon': 'Surgeon',
  'surgery.notes': 'Procedure Notes',

  // Family History
  'family_history.condition': 'Family Condition',
  'family_history.relative': 'Relative',
  'family_history.notes': 'Family History Notes',

  // Emergency Contact
  'emergency_contact.name': 'Emergency Contact',
  'emergency_contact.relationship': 'Relationship',
  'emergency_contact.phone': 'Contact Phone',
  'emergency_contact.notes': 'Contact Notes',

  // Goals
  'goal.description': 'Goal',
  'goal.target_date': 'Target Date',
  'goal.status': 'Goal Status',
  'goal.notes': 'Goal Notes',

  // Measurements
  'measurement.type': 'Measurement Type',
  'measurement.value': 'Value',
  'measurement.unit': 'Unit',
  'measurement.date': 'Measured Date',
};

/**
 * Get a human-readable label for a field_key.
 * Falls back to converting the key to Title Case if not found.
 */
export function getFieldLabel(fieldKey: string | null): string {
  if (!fieldKey) return 'Unknown Field';

  const label = FIELD_LABELS[fieldKey];
  if (label) return label;

  // Fallback: take the part after the dot (or the whole key) and convert to Title Case
  const parts = fieldKey.split('.');
  const raw = parts[parts.length - 1];
  return raw
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Extract the category from a field_key (the part before the dot).
 * e.g., "insurance.payer_name" → "insurance"
 */
export function getCategoryFromFieldKey(fieldKey: string | null): string | null {
  if (!fieldKey) return null;
  const dotIndex = fieldKey.indexOf('.');
  return dotIndex > 0 ? fieldKey.substring(0, dotIndex) : null;
}
