import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenLayout } from '@/components/ui/ScreenLayout';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { DatePicker } from '@/components/ui/DatePicker';
import { useAddFamilyMember } from '@/hooks/useProfiles';
import { useProfileStore } from '@/stores/profileStore';
import type { RelationshipLabel } from '@/lib/types/profile';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import { sanitizeErrorMessage } from '@/lib/utils/sanitizeError';

type Relationship = Exclude<RelationshipLabel, 'self'>;
type Sex = 'male' | 'female';

const RELATIONSHIP_OPTIONS: {
  value: Relationship;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { value: 'parent', label: 'Parent', icon: 'people-outline' },
  { value: 'spouse', label: 'Spouse / Partner', icon: 'heart-outline' },
  { value: 'child', label: 'Child', icon: 'happy-outline' },
  { value: 'sibling', label: 'Sibling', icon: 'people-circle-outline' },
  { value: 'grandparent', label: 'Grandparent', icon: 'flower-outline' },
  { value: 'other', label: 'Other', icon: 'person-outline' },
];

export default function AddMemberScreen() {
  const router = useRouter();
  const addMember = useAddFamilyMember();
  const switchProfile = useProfileStore((s) => s.switchProfile);

  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState<Relationship | null>(null);
  const [dob, setDob] = useState<Date | null>(null);
  const [sex, setSex] = useState<Sex | null>(null);
  const [nameError, setNameError] = useState<string | undefined>();
  const [relError, setRelError] = useState<string | undefined>();

  const today = new Date();
  const minDate = new Date(today.getFullYear() - 120, 0, 1);

  async function handleSubmit() {
    const trimmed = name.trim();
    let hasError = false;
    if (!trimmed) {
      setNameError('Please enter a name');
      hasError = true;
    }
    if (!relationship) {
      setRelError('Please pick a relationship');
      hasError = true;
    }
    if (hasError || !relationship) return;

    try {
      const result = await addMember.mutateAsync({
        name: trimmed,
        relationship,
        dateOfBirth: dob ? dob.toISOString().slice(0, 10) : undefined,
        gender: sex ?? undefined,
      });
      // Switch to the new profile immediately so the user lands on their data.
      switchProfile(result.profileId);

      Alert.alert(
        `${trimmed} added to your family`,
        `You're now managing ${trimmed}'s profile. You can switch back any time from the header.`,
        [
          {
            text: 'Got it',
            onPress: () => router.back(),
          },
        ],
      );
    } catch (err) {
      Alert.alert('Could not add member', sanitizeErrorMessage(err));
    }
  }

  const canSubmit = name.trim().length > 0 && relationship !== null && !addMember.isPending;

  return (
    <ScreenLayout>
      <Text style={styles.subtitle}>
        Add someone whose health you help manage.
      </Text>

      <View style={styles.field}>
        <Input
          label="Full name"
          placeholder="e.g., Margaret Smith"
          value={name}
          onChangeText={(v) => {
            setName(v);
            if (nameError) setNameError(undefined);
          }}
          autoCapitalize="words"
          autoFocus
          error={nameError}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Relationship</Text>
        <View style={styles.optionGrid}>
          {RELATIONSHIP_OPTIONS.map((opt) => {
            const selected = relationship === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[styles.optionCard, selected && styles.optionCardActive]}
                onPress={() => {
                  setRelationship(opt.value);
                  if (relError) setRelError(undefined);
                }}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={opt.icon}
                  size={22}
                  color={selected ? COLORS.primary.DEFAULT : COLORS.text.secondary}
                />
                <Text
                  style={[styles.optionText, selected && styles.optionTextActive]}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {relError ? <Text style={styles.error}>{relError}</Text> : null}
      </View>

      <View style={styles.field}>
        <DatePicker
          label="Date of birth (optional)"
          value={dob}
          onChange={setDob}
          mode="date"
          placeholder="Select date of birth"
          minimumDate={minDate}
          maximumDate={today}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Sex (optional)</Text>
        <View style={styles.sexRow}>
          {(['male', 'female'] as const).map((option) => {
            const selected = sex === option;
            return (
              <TouchableOpacity
                key={option}
                style={[styles.sexChip, selected && styles.sexChipActive]}
                onPress={() => setSex(option)}
                activeOpacity={0.7}
              >
                <Text
                  style={[styles.sexText, selected && styles.sexTextActive]}
                >
                  {option === 'male' ? 'Male' : 'Female'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={styles.submitWrap}>
        <Button
          title="Add Member"
          size="lg"
          onPress={handleSubmit}
          disabled={!canSubmit}
          loading={addMember.isPending}
        />
      </View>
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  subtitle: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginBottom: 20,
    lineHeight: 20,
  },
  field: {
    marginBottom: 20,
  },
  label: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.DEFAULT,
    marginBottom: 10,
  },
  optionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  optionCard: {
    flexBasis: '47%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    backgroundColor: COLORS.surface.DEFAULT,
  },
  optionCardActive: {
    borderColor: COLORS.primary.DEFAULT,
    backgroundColor: COLORS.primary.DEFAULT + '14',
  },
  optionText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
    flexShrink: 1,
  },
  optionTextActive: {
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  error: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.error.DEFAULT,
    marginTop: 6,
  },
  sexRow: {
    flexDirection: 'row',
    gap: 10,
  },
  sexChip: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    backgroundColor: COLORS.surface.DEFAULT,
    alignItems: 'center',
  },
  sexChipActive: {
    borderColor: COLORS.primary.DEFAULT,
    backgroundColor: COLORS.primary.DEFAULT + '14',
  },
  sexText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
  },
  sexTextActive: {
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  submitWrap: {
    marginTop: 12,
  },
});
