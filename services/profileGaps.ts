/**
 * Profile Intelligence — analyzes profile facts to identify missing data
 * that would unlock better functionality (task generation, reminders, etc.)
 */

import { supabase } from '@/lib/supabase';
import type { ProfileFact } from '@/lib/types/profile';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

export interface ProfileGap {
  id: string;
  category: string;
  field_key: string;
  prompt_text: string;
  impact_text: string;
  priority: 'high' | 'medium' | 'low';
  related_fact_id: string | null;
  /** The related fact's value_json, for context in the UI */
  related_fact_value: Record<string, unknown> | null;
}

/**
 * Unwrap the {value: ...} wrapper if present.
 */
function unwrapValue(valueJson: Record<string, unknown>): Record<string, unknown> {
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

function str(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  return String(v);
}

/**
 * Analyze all profile facts and identify missing associated data.
 */
export async function analyzeProfileGaps(
  profileId: string,
): Promise<ServiceResult<ProfileGap[]>> {
  const { data: facts, error } = await supabase
    .from('profile_facts')
    .select('*')
    .eq('profile_id', profileId)
    .is('deleted_at', null);

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  const typedFacts = (facts ?? []) as ProfileFact[];
  const gaps: ProfileGap[] = [];
  let gapIndex = 0;

  const makeId = () => `gap_${++gapIndex}`;

  // Check for category existence
  const hasCategory = (cat: string) =>
    typedFacts.some((f) => f.category === cat);

  const factsInCategory = (cat: string) =>
    typedFacts.filter((f) => f.category === cat);

  // ── Medication gaps ──
  for (const fact of factsInCategory('medication')) {
    const val = unwrapValue(fact.value_json);
    const drugName = str(val.drug_name) ?? str(val.name) ?? 'this medication';

    if (!str(val.dose)) {
      gaps.push({
        id: makeId(),
        category: 'medication',
        field_key: 'dose',
        prompt_text: `${drugName} -- Adding the dose helps CareLead set up accurate medication reminders`,
        impact_text: 'Unlocks: medication schedule reminders',
        priority: 'high',
        related_fact_id: fact.id,
        related_fact_value: val,
      });
    }
    if (!str(val.frequency)) {
      gaps.push({
        id: makeId(),
        category: 'medication',
        field_key: 'frequency',
        prompt_text: `${drugName} -- Adding how often you take it enables medication schedule reminders`,
        impact_text: 'Unlocks: medication schedule reminders',
        priority: 'high',
        related_fact_id: fact.id,
        related_fact_value: val,
      });
    }
    if (!str(val.pharmacy_name) && !hasCategory('pharmacy')) {
      gaps.push({
        id: makeId(),
        category: 'medication',
        field_key: 'pharmacy',
        prompt_text: `${drugName} -- Which pharmacy fills this? Enables refill reminders`,
        impact_text: 'Unlocks: refill reminders, insurance updates',
        priority: 'medium',
        related_fact_id: fact.id,
        related_fact_value: val,
      });
    }
    if (!str(val.prescriber)) {
      gaps.push({
        id: makeId(),
        category: 'medication',
        field_key: 'prescriber',
        prompt_text: `${drugName} -- Who prescribed this? Helps track which doctor to contact`,
        impact_text: 'Unlocks: provider-specific task context',
        priority: 'low',
        related_fact_id: fact.id,
        related_fact_value: val,
      });
    }
  }

  // ── Condition gaps ──
  for (const fact of factsInCategory('condition')) {
    const val = unwrapValue(fact.value_json);
    const conditionName = str(val.name) ?? str(val.condition_name) ?? 'this condition';

    if (!str(val.managing_provider) && !hasCategory('care_team')) {
      gaps.push({
        id: makeId(),
        category: 'condition',
        field_key: 'managing_provider',
        prompt_text: `${conditionName} -- Who manages this condition? Helps prepare for appointments`,
        impact_text: 'Unlocks: appointment prep, provider-specific tasks',
        priority: 'medium',
        related_fact_id: fact.id,
        related_fact_value: val,
      });
    }
    if (!str(val.status)) {
      gaps.push({
        id: makeId(),
        category: 'condition',
        field_key: 'status',
        prompt_text: `${conditionName} -- Is this condition active, managed, or resolved?`,
        impact_text: 'Helps prioritize follow-up tasks',
        priority: 'low',
        related_fact_id: fact.id,
        related_fact_value: val,
      });
    }
  }

  // ── Allergy gaps ──
  for (const fact of factsInCategory('allergy')) {
    const val = unwrapValue(fact.value_json);
    const substance = str(val.substance) ?? 'this allergen';

    if (!str(val.reaction)) {
      gaps.push({
        id: makeId(),
        category: 'allergy',
        field_key: 'reaction',
        prompt_text: `${substance} -- What reaction do you have? Important for providers to know`,
        impact_text: 'Improves provider communication',
        priority: 'medium',
        related_fact_id: fact.id,
        related_fact_value: val,
      });
    }
    if (!str(val.severity)) {
      gaps.push({
        id: makeId(),
        category: 'allergy',
        field_key: 'severity',
        prompt_text: `${substance} -- How severe is this allergy? (mild / moderate / severe)`,
        impact_text: 'Helps prioritize allergy alerts',
        priority: 'low',
        related_fact_id: fact.id,
        related_fact_value: val,
      });
    }
  }

  // ── Insurance gaps ──
  for (const fact of factsInCategory('insurance')) {
    const val = unwrapValue(fact.value_json);

    if (!hasCategory('care_team')) {
      gaps.push({
        id: makeId(),
        category: 'insurance',
        field_key: 'primary_care_provider',
        prompt_text: 'Who is your primary care doctor? Important for insurance referrals',
        impact_text: 'Unlocks: referral tracking, appointment prep',
        priority: 'high',
        related_fact_id: fact.id,
        related_fact_value: val,
      });
    }
  }

  // ── General gaps (profile-wide) ──
  if (!hasCategory('emergency_contact')) {
    gaps.push({
      id: makeId(),
      category: 'general',
      field_key: 'emergency_contact',
      prompt_text: 'Add an emergency contact for your health profile',
      impact_text: 'Essential for medical emergencies',
      priority: 'high',
      related_fact_id: null,
      related_fact_value: null,
    });
  }

  if (!hasCategory('care_team')) {
    gaps.push({
      id: makeId(),
      category: 'general',
      field_key: 'care_team',
      prompt_text: 'Add a healthcare provider to your care team',
      impact_text: 'Unlocks: provider notifications for allergies, appointment prep',
      priority: 'medium',
      related_fact_id: null,
      related_fact_value: null,
    });
  }

  if (!hasCategory('pharmacy') && hasCategory('medication')) {
    gaps.push({
      id: makeId(),
      category: 'general',
      field_key: 'pharmacy',
      prompt_text: 'Add your pharmacy for refill reminders and insurance updates',
      impact_text: 'Unlocks: refill reminders, insurance card updates',
      priority: 'high',
      related_fact_id: null,
      related_fact_value: null,
    });
  }

  // Sort by priority: high first
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  gaps.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return { success: true, data: gaps };
}

/**
 * Save a gap fill — update an existing profile fact with new data.
 */
export async function fillProfileGap(
  factId: string,
  fieldKey: string,
  value: string,
  userId: string,
): Promise<ServiceResult<{ factId: string; updatedFields: string[] }>> {
  // Fetch the existing fact
  const { data: fact, error: fetchError } = await supabase
    .from('profile_facts')
    .select('*')
    .eq('id', factId)
    .single();

  if (fetchError || !fact) {
    return { success: false, error: fetchError?.message ?? 'Fact not found' };
  }

  const currentValue = unwrapValue(fact.value_json as Record<string, unknown>);
  const updatedValue = { ...currentValue, [fieldKey]: value };

  const { error: updateError } = await supabase
    .from('profile_facts')
    .update({
      value_json: updatedValue,
      updated_at: new Date().toISOString(),
    })
    .eq('id', factId);

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  // Audit event
  await supabase.from('audit_events').insert({
    profile_id: fact.profile_id,
    actor_id: userId,
    event_type: 'profile_fact.updated',
    metadata: {
      profile_fact_id: factId,
      field_key: fieldKey,
      source: 'profile_gap_fill',
    },
  });

  return { success: true, data: { factId, updatedFields: [fieldKey] } };
}

/**
 * Create a new profile fact to fill a general gap (e.g., emergency contact, pharmacy).
 */
export async function fillGeneralGap(
  profileId: string,
  category: string,
  fieldKey: string,
  value: Record<string, unknown>,
  userId: string,
): Promise<ServiceResult<{ factId: string }>> {
  const { data, error } = await supabase
    .from('profile_facts')
    .insert({
      profile_id: profileId,
      category,
      field_key: `${category}.entry`,
      value_json: value,
      source_type: 'manual',
      verification_status: 'verified',
      verified_at: new Date().toISOString(),
      verified_by: userId,
      actor_id: userId,
    })
    .select('id')
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  await supabase.from('audit_events').insert({
    profile_id: profileId,
    actor_id: userId,
    event_type: 'profile_fact.created',
    metadata: {
      profile_fact_id: data.id,
      category,
      source: 'profile_gap_fill',
    },
  });

  return { success: true, data: { factId: data.id } };
}
