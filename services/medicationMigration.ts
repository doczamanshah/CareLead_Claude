import { supabase } from '@/lib/supabase';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

interface MigrationResult {
  migrated: number;
  skipped: number;
}

/**
 * Migrate medication profile_facts into dedicated med_medications table.
 * Runs once when the user first opens the Medications screen and has
 * medication profile_facts but no med_medications.
 *
 * Does NOT delete original profile_facts — marks them as superseded via
 * source_ref pointing to the new medication ID.
 */
export async function migrateMedicationFacts(
  profileId: string,
  userId: string,
): Promise<ServiceResult<MigrationResult>> {
  // Check if migration is needed
  const { data: existingMeds } = await supabase
    .from('med_medications')
    .select('id')
    .eq('profile_id', profileId)
    .is('deleted_at', null)
    .limit(1);

  if (existingMeds && existingMeds.length > 0) {
    return { success: true, data: { migrated: 0, skipped: 0 } };
  }

  // Get all medication profile_facts
  const { data: facts, error: factsError } = await supabase
    .from('profile_facts')
    .select('*')
    .eq('profile_id', profileId)
    .eq('category', 'medication')
    .is('deleted_at', null);

  if (factsError) {
    return { success: false, error: factsError.message };
  }

  if (!facts || facts.length === 0) {
    return { success: true, data: { migrated: 0, skipped: 0 } };
  }

  let migrated = 0;
  let skipped = 0;

  for (const fact of facts) {
    const value = (fact.value_json ?? {}) as Record<string, unknown>;
    const drugName =
      (value.drug_name as string) ||
      (value.name as string) ||
      (value.medication_name as string);

    if (!drugName) {
      skipped++;
      continue;
    }

    // Create medication
    const { data: med, error: medError } = await supabase
      .from('med_medications')
      .insert({
        profile_id: profileId,
        drug_name: drugName,
        strength: (value.strength as string) || (value.dose as string) || null,
        form: null,
        route: (value.route as string) || null,
        status: 'active',
        prn_flag: false,
        notes: (value.notes as string) || null,
        source_type: fact.source_type,
        source_ref: fact.id,
        created_by: userId,
      })
      .select('id')
      .single();

    if (medError || !med) {
      skipped++;
      continue;
    }

    // Create sig from available data
    const doseText = (value.dose as string) || (value.dosage as string) || null;
    const frequencyText = (value.frequency as string) || null;
    const instructions = (value.instructions as string) || null;

    if (doseText || frequencyText || instructions) {
      await supabase.from('med_medication_sigs').insert({
        medication_id: med.id,
        profile_id: profileId,
        dose_text: doseText,
        frequency_text: frequencyText,
        instructions,
        source_type: fact.source_type,
        source_ref: fact.id,
      });
    }

    // Create supply if pharmacy/prescriber info exists
    const pharmacyName = (value.pharmacy_name as string) || (value.pharmacy as string) || null;
    const prescriberName = (value.prescriber as string) || (value.prescriber_name as string) || null;

    if (pharmacyName || prescriberName) {
      await supabase.from('med_medication_supply').insert({
        medication_id: med.id,
        profile_id: profileId,
        pharmacy_name: pharmacyName,
        pharmacy_phone: (value.pharmacy_phone as string) || null,
        prescriber_name: prescriberName,
        prescriber_phone: (value.prescriber_phone as string) || null,
      });
    }

    // Mark the original profile_fact as superseded
    await supabase
      .from('profile_facts')
      .update({
        source_ref: `migrated_to_med:${med.id}`,
        updated_at: new Date().toISOString(),
      })
      .eq('id', fact.id);

    migrated++;
  }

  // Audit event
  if (migrated > 0) {
    await supabase.from('audit_events').insert({
      profile_id: profileId,
      actor_id: userId,
      event_type: 'medication.migration',
      metadata: {
        migrated,
        skipped,
        source: 'profile_facts',
      },
    });
  }

  return { success: true, data: { migrated, skipped } };
}

/**
 * Check if migration is needed for a profile.
 */
export async function needsMedicationMigration(
  profileId: string,
): Promise<boolean> {
  // Has medication profile_facts?
  const { data: facts } = await supabase
    .from('profile_facts')
    .select('id')
    .eq('profile_id', profileId)
    .eq('category', 'medication')
    .is('deleted_at', null)
    .not('source_ref', 'like', 'migrated_to_med:%')
    .limit(1);

  if (!facts || facts.length === 0) return false;

  // Has any med_medications already?
  const { data: meds } = await supabase
    .from('med_medications')
    .select('id')
    .eq('profile_id', profileId)
    .is('deleted_at', null)
    .limit(1);

  return !meds || meds.length === 0;
}
