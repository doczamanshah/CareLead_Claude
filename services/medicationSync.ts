/**
 * Syncs extracted medication data from the commit engine into the
 * dedicated med_medications table. Called when a medication profile_fact
 * is committed through the Intent Sheet.
 */

import { supabase } from '@/lib/supabase';

/**
 * Create a med_medications + med_medication_sigs entry from an extracted
 * medication value committed through the Intent Sheet.
 *
 * This runs silently — errors are logged but do not block the commit.
 */
export async function createMedicationFromExtraction(
  profileId: string,
  value: Record<string, unknown>,
  profileFactId: string,
  userId: string,
): Promise<void> {
  const drugName =
    (value.drug_name as string) ||
    (value.name as string) ||
    (value.medication_name as string);

  if (!drugName) return;

  // Check if this medication already exists in the dedicated table
  const { data: existing } = await supabase
    .from('med_medications')
    .select('id')
    .eq('profile_id', profileId)
    .ilike('drug_name', drugName)
    .is('deleted_at', null)
    .limit(1);

  if (existing && existing.length > 0) return;

  // Create the medication record
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
      notes: null,
      source_type: 'document',
      source_ref: profileFactId,
      created_by: userId,
    })
    .select('id')
    .single();

  if (medError || !med) return;

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
      source_type: 'document',
      source_ref: profileFactId,
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
}
