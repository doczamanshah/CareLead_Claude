import { useState, useEffect } from 'react';
import { View, Text, Alert, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScreenLayout } from '@/components/ui/ScreenLayout';
import { Input } from '@/components/ui/Input';
import { DatePicker } from '@/components/ui/DatePicker';
import { Button } from '@/components/ui/Button';
import { useProfileDetail, useUpdateProfile } from '@/hooks/useProfileDetail';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import { sanitizeErrorMessage } from '@/lib/utils/sanitizeError';

const GENDER_OPTIONS = ['Male', 'Female', 'Non-binary', 'Prefer not to say'];

export default function EditProfileScreen() {
  const { profileId } = useLocalSearchParams<{ profileId: string }>();
  const { data: profile, isLoading } = useProfileDetail(profileId ?? null);
  const updateMutation = useUpdateProfile(profileId!);
  const router = useRouter();

  const [displayName, setDisplayName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState<Date | null>(null);
  const [gender, setGender] = useState('');

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.display_name);
      setDateOfBirth(profile.date_of_birth ? new Date(profile.date_of_birth) : null);
      setGender(profile.gender ?? '');
    }
  }, [profile]);

  if (isLoading) return <ScreenLayout loading />;

  async function handleSave() {
    if (!displayName.trim()) {
      Alert.alert('Required', 'Please enter a display name.');
      return;
    }

    const dob = dateOfBirth ? dateOfBirth.toISOString().split('T')[0] : null;

    updateMutation.mutate(
      {
        display_name: displayName.trim(),
        date_of_birth: dob,
        gender: gender.trim() || null,
      },
      {
        onSuccess: () => {
          router.back();
        },
        onError: (err) => {
          Alert.alert('Could not save', sanitizeErrorMessage(err));
        },
      },
    );
  }

  return (
    <ScreenLayout>
      <View style={styles.container}>
        <Input
          label="Display Name"
          placeholder="e.g. John Smith"
          value={displayName}
          onChangeText={setDisplayName}
          autoCapitalize="words"
        />

        <DatePicker
          label="Date of Birth"
          placeholder="Select date of birth"
          value={dateOfBirth}
          onChange={setDateOfBirth}
          mode="date"
          maximumDate={new Date()}
        />

        <View style={styles.genderSection}>
          <Text style={styles.label}>Gender</Text>
          <View style={styles.genderOptions}>
            {GENDER_OPTIONS.map((option) => (
              <View key={option} style={styles.genderButtonWrap}>
                <Button
                  title={option}
                  variant={gender === option ? 'primary' : 'outline'}
                  size="sm"
                  onPress={() => setGender(gender === option ? '' : option)}
                />
              </View>
            ))}
          </View>
        </View>

        <View style={styles.saveButton}>
          <Button
            title="Save Changes"
            onPress={handleSave}
            loading={updateMutation.isPending}
          />
        </View>
      </View>
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 16,
  },
  genderSection: {
    marginBottom: 16,
  },
  label: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.DEFAULT,
    marginBottom: 8,
  },
  genderOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  genderButtonWrap: {
    marginBottom: 4,
  },
  saveButton: {
    marginTop: 16,
  },
});
