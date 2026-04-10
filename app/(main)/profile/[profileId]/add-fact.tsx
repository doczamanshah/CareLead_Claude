import { useState, useMemo } from 'react';
import { View, Text, Alert, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScreenLayout } from '@/components/ui/ScreenLayout';
import { Input } from '@/components/ui/Input';
import { DatePicker } from '@/components/ui/DatePicker';
import { Button } from '@/components/ui/Button';
import { useAddProfileFact } from '@/hooks/useProfileDetail';
import { PROFILE_FACT_CATEGORIES } from '@/lib/types/profile';
import type { ProfileFactCategory } from '@/lib/types/profile';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

const DATE_FIELD_KEYS = new Set(['diagnosed_date', 'date', 'target_date']);

// Field definitions per category
const CATEGORY_FIELDS: Record<ProfileFactCategory, { key: string; label: string; placeholder: string }[]> = {
  condition: [
    { key: 'name', label: 'Condition Name', placeholder: 'e.g. Type 2 Diabetes' },
    { key: 'status', label: 'Status', placeholder: 'e.g. Active, Managed, Resolved' },
    { key: 'diagnosed_date', label: 'Date Diagnosed', placeholder: 'YYYY-MM-DD' },
    { key: 'notes', label: 'Notes', placeholder: 'Any additional details' },
  ],
  allergy: [
    { key: 'substance', label: 'Allergen', placeholder: 'e.g. Penicillin, Peanuts' },
    { key: 'reaction', label: 'Reaction', placeholder: 'e.g. Hives, Anaphylaxis' },
    { key: 'severity', label: 'Severity', placeholder: 'e.g. Mild, Moderate, Severe' },
    { key: 'notes', label: 'Notes', placeholder: 'Any additional details' },
  ],
  medication: [
    { key: 'name', label: 'Medication Name', placeholder: 'e.g. Metformin 500mg' },
    { key: 'dosage', label: 'Dosage', placeholder: 'e.g. 500mg twice daily' },
    { key: 'frequency', label: 'Frequency', placeholder: 'e.g. Twice daily' },
    { key: 'prescriber', label: 'Prescriber', placeholder: 'e.g. Dr. Smith' },
    { key: 'notes', label: 'Notes', placeholder: 'Any additional details' },
  ],
  surgery: [
    { key: 'name', label: 'Procedure', placeholder: 'e.g. Appendectomy' },
    { key: 'date', label: 'Date', placeholder: 'YYYY-MM-DD' },
    { key: 'hospital', label: 'Hospital/Facility', placeholder: 'e.g. General Hospital' },
    { key: 'notes', label: 'Notes', placeholder: 'Any additional details' },
  ],
  family_history: [
    { key: 'condition', label: 'Condition', placeholder: 'e.g. Heart Disease' },
    { key: 'relative', label: 'Relative', placeholder: 'e.g. Father, Mother' },
    { key: 'notes', label: 'Notes', placeholder: 'Any additional details' },
  ],
  insurance: [
    { key: 'provider', label: 'Insurance Provider', placeholder: 'e.g. Blue Cross' },
    { key: 'plan', label: 'Plan Name', placeholder: 'e.g. Gold PPO' },
    { key: 'member_id', label: 'Member ID', placeholder: 'Your member ID' },
    { key: 'group_number', label: 'Group Number', placeholder: 'Group number' },
    { key: 'phone', label: 'Phone Number', placeholder: '1-800-...' },
  ],
  care_team: [
    { key: 'name', label: 'Provider Name', placeholder: 'e.g. Dr. Jane Smith' },
    { key: 'specialty', label: 'Specialty', placeholder: 'e.g. Cardiology' },
    { key: 'phone', label: 'Phone', placeholder: 'Phone number' },
    { key: 'address', label: 'Address', placeholder: 'Office address' },
    { key: 'notes', label: 'Notes', placeholder: 'Any additional details' },
  ],
  pharmacy: [
    { key: 'name', label: 'Pharmacy Name', placeholder: 'e.g. CVS, Walgreens' },
    { key: 'phone', label: 'Phone', placeholder: 'Phone number' },
    { key: 'address', label: 'Address', placeholder: 'Pharmacy address' },
    { key: 'notes', label: 'Notes', placeholder: 'Any additional details' },
  ],
  emergency_contact: [
    { key: 'name', label: 'Contact Name', placeholder: 'e.g. Jane Doe' },
    { key: 'relationship', label: 'Relationship', placeholder: 'e.g. Spouse, Parent' },
    { key: 'phone', label: 'Phone', placeholder: 'Phone number' },
    { key: 'notes', label: 'Notes', placeholder: 'Any additional details' },
  ],
  goal: [
    { key: 'description', label: 'Goal', placeholder: 'e.g. Walk 30 min daily' },
    { key: 'target_date', label: 'Target Date', placeholder: 'YYYY-MM-DD' },
    { key: 'status', label: 'Status', placeholder: 'e.g. Active, Achieved' },
    { key: 'notes', label: 'Notes', placeholder: 'Any additional details' },
  ],
  measurement: [
    { key: 'name', label: 'Measurement', placeholder: 'e.g. Blood Pressure' },
    { key: 'value', label: 'Value', placeholder: 'e.g. 120/80 mmHg' },
    { key: 'date', label: 'Date', placeholder: 'YYYY-MM-DD' },
    { key: 'notes', label: 'Notes', placeholder: 'Any additional details' },
  ],
};

export default function AddFactScreen() {
  const { profileId, category } = useLocalSearchParams<{
    profileId: string;
    category: string;
  }>();
  const router = useRouter();
  const addMutation = useAddProfileFact(profileId!);

  const categoryKey = (category ?? 'condition') as ProfileFactCategory;
  const categoryMeta = PROFILE_FACT_CATEGORIES.find((c) => c.key === categoryKey);
  const fields = CATEGORY_FIELDS[categoryKey] ?? [];

  const [values, setValues] = useState<Record<string, string>>({});
  const [dateValues, setDateValues] = useState<Record<string, Date | null>>({});

  function updateField(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function updateDateField(key: string, date: Date | null) {
    setDateValues((prev) => ({ ...prev, [key]: date }));
  }

  // Get the primary field key for this category
  const primaryFieldKey = useMemo(() => {
    const first = fields[0];
    return first ? `${categoryKey}.${first.key}` : categoryKey;
  }, [categoryKey, fields]);

  function handleSave() {
    // Require at least the first field
    const firstField = fields[0];
    if (firstField && !values[firstField.key]?.trim()) {
      Alert.alert('Required', `Please enter the ${firstField.label.toLowerCase()}.`);
      return;
    }

    // Build value_json from non-empty fields
    const valueJson: Record<string, unknown> = {};
    for (const field of fields) {
      if (DATE_FIELD_KEYS.has(field.key)) {
        const dateVal = dateValues[field.key];
        if (dateVal) valueJson[field.key] = dateVal.toISOString().split('T')[0];
      } else {
        const val = values[field.key]?.trim();
        if (val) valueJson[field.key] = val;
      }
    }

    addMutation.mutate(
      {
        category: categoryKey,
        field_key: primaryFieldKey,
        value_json: valueJson,
      },
      {
        onSuccess: () => {
          router.back();
        },
        onError: (err) => {
          Alert.alert('Error', err.message);
        },
      },
    );
  }

  return (
    <ScreenLayout>
      <View style={styles.header}>
        <Text style={styles.headerIcon}>{categoryMeta?.icon ?? '📝'}</Text>
        <Text style={styles.headerTitle}>
          Add {categoryMeta?.label ?? 'Information'}
        </Text>
        <Text style={styles.headerDesc}>
          This will be saved as verified information on the profile.
        </Text>
      </View>

      {fields.map((field) =>
        DATE_FIELD_KEYS.has(field.key) ? (
          <DatePicker
            key={field.key}
            label={field.label}
            placeholder={`Select ${field.label.toLowerCase()}`}
            value={dateValues[field.key] ?? null}
            onChange={(date) => updateDateField(field.key, date)}
            mode="date"
            maximumDate={field.key === 'target_date' ? undefined : new Date()}
          />
        ) : (
          <Input
            key={field.key}
            label={field.label}
            placeholder={field.placeholder}
            value={values[field.key] ?? ''}
            onChangeText={(text) => updateField(field.key, text)}
            autoCapitalize={field.key === 'notes' ? 'sentences' : 'words'}
          />
        ),
      )}

      <View style={styles.saveButton}>
        <Button
          title="Save"
          onPress={handleSave}
          loading={addMutation.isPending}
        />
      </View>
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    paddingVertical: 20,
    marginBottom: 8,
  },
  headerIcon: {
    fontSize: 40,
    marginBottom: 8,
  },
  headerTitle: {
    fontSize: FONT_SIZES.xl,
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    marginBottom: 4,
  },
  headerDesc: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    textAlign: 'center',
  },
  saveButton: {
    marginTop: 8,
    marginBottom: 32,
  },
});
