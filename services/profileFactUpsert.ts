/**
 * Shared helpers for profile fact upsert logic.
 *
 * When committing extracted data (from Intent Sheet or closeout), we need to
 * check whether a profile fact with the same identifying field already exists
 * (e.g., same drug_name for medications) and UPDATE it instead of creating a
 * duplicate.
 */

import { supabase } from '@/lib/supabase';

/**
 * Get the identifying field name for a category — the field that makes
 * two entries "the same thing" (e.g., same drug_name = same medication).
 */
export function getIdentifyingFieldForCategory(category: string): string | null {
  switch (category) {
    case 'medication':
      return 'drug_name';
    case 'allergy':
      return 'substance';
    case 'condition':
      return 'condition_name';
    case 'insurance':
      return 'payer_name';
    case 'care_team':
      return 'name';
    case 'pharmacy':
      return 'name';
    case 'surgery':
      return 'name';
    case 'emergency_contact':
      return 'name';
    default:
      return null;
  }
}

/** Aliases for identifying fields — e.g., "name" is an alias for "drug_name" in some extractions. */
const FIELD_ALIASES: Record<string, string[]> = {
  drug_name: ['drug_name', 'name'],
  condition_name: ['condition_name', 'name'],
  substance: ['substance'],
  payer_name: ['payer_name', 'plan_name'],
  name: ['name'],
};

/**
 * Find an existing profile fact that matches the new value by its identifying
 * field (e.g., same drug_name for medication). Returns the existing fact row
 * if found, null otherwise.
 */
export async function findExistingProfileFact(
  profileId: string,
  category: string,
  value: Record<string, unknown>,
): Promise<{ id: string; value_json: Record<string, unknown> } | null> {
  const identifyingField = getIdentifyingFieldForCategory(category);
  if (!identifyingField) return null;

  const fieldsToCheck = FIELD_ALIASES[identifyingField] ?? [identifyingField];
  let newIdentifier: string | null = null;

  for (const field of fieldsToCheck) {
    const val = value[field];
    if (val && typeof val === 'string' && val.trim()) {
      newIdentifier = val.trim().toLowerCase();
      break;
    }
  }

  if (!newIdentifier) return null;

  const { data: existingFacts } = await supabase
    .from('profile_facts')
    .select('id, value_json')
    .eq('profile_id', profileId)
    .eq('category', category)
    .is('deleted_at', null);

  if (!existingFacts || existingFacts.length === 0) return null;

  for (const fact of existingFacts) {
    const existingValue = (fact.value_json ?? {}) as Record<string, unknown>;
    for (const field of fieldsToCheck) {
      const existingVal = existingValue[field];
      if (
        existingVal &&
        typeof existingVal === 'string' &&
        existingVal.trim().toLowerCase() === newIdentifier
      ) {
        return { id: fact.id, value_json: existingValue };
      }
    }
  }

  return null;
}

/**
 * Build a human-readable description of what changed between old and new values.
 */
export function describeFactChanges(
  identifierName: string,
  oldValue: Record<string, unknown>,
  newValue: Record<string, unknown>,
): string {
  const changes: string[] = [];
  for (const key of Object.keys(newValue)) {
    const oldVal = oldValue[key];
    const newVal = newValue[key];
    if (oldVal !== newVal && newVal !== undefined && newVal !== null && newVal !== '') {
      if (oldVal !== undefined && oldVal !== null && oldVal !== '') {
        changes.push(`${key} changed from ${String(oldVal)} to ${String(newVal)}`);
      }
    }
  }
  return changes.length > 0
    ? `Updated ${identifierName}: ${changes.join(', ')}`
    : `Updated ${identifierName}`;
}
