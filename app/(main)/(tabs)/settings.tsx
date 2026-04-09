import { View, Text, Alert, StyleSheet, TouchableOpacity, Switch } from 'react-native';
import { ScreenLayout } from '@/components/ui/ScreenLayout';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { supabase } from '@/lib/supabase';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import { useCareGuidanceLevel, useWeeklyDigest } from '@/hooks/usePreferences';
import type { CareGuidanceLevel } from '@/services/commit';

const GUIDANCE_OPTIONS: {
  key: CareGuidanceLevel;
  label: string;
  description: string;
}[] = [
  {
    key: 'essentials',
    label: 'Just the essentials',
    description: 'Only critical tasks — for experienced patients/caregivers who know the drill.',
  },
  {
    key: 'balanced',
    label: 'Balanced',
    description: 'Critical + important tasks. The recommended default.',
  },
  {
    key: 'comprehensive',
    label: 'Comprehensive',
    description: 'All tasks including helpful suggestions like research and organizing.',
  },
];

export default function SettingsScreen() {
  const { level, setLevel, isUpdating } = useCareGuidanceLevel();
  const { enabled: weeklyDigestEnabled, setEnabled: setWeeklyDigest } = useWeeklyDigest();

  async function handleSignOut() {
    const { error } = await supabase.auth.signOut();
    if (error) {
      Alert.alert('Error', error.message);
    }
  }

  return (
    <ScreenLayout title="Settings">
      {/* Care Guidance Section */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Care Guidance</Text>
        <Text style={styles.sectionDescription}>
          Control how many follow-up tasks are auto-generated when you capture health documents.
        </Text>
        {GUIDANCE_OPTIONS.map((option) => {
          const isSelected = level === option.key;
          return (
            <TouchableOpacity
              key={option.key}
              style={[styles.optionCard, isSelected && styles.optionCardSelected]}
              onPress={() => setLevel(option.key)}
              disabled={isUpdating}
              activeOpacity={0.7}
            >
              <View style={styles.optionRow}>
                <View
                  style={[
                    styles.radio,
                    isSelected && styles.radioSelected,
                  ]}
                >
                  {isSelected && <View style={styles.radioDot} />}
                </View>
                <View style={styles.optionContent}>
                  <Text
                    style={[
                      styles.optionLabel,
                      isSelected && styles.optionLabelSelected,
                    ]}
                  >
                    {option.label}
                  </Text>
                  <Text style={styles.optionDescription}>{option.description}</Text>
                </View>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Weekly Summary Section */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Weekly Summary</Text>
        <Card>
          <View style={styles.toggleRow}>
            <View style={styles.toggleContent}>
              <Text style={styles.toggleLabel}>Weekly overview</Text>
              <Text style={styles.toggleDescription}>
                Get a weekly overview of your care tasks and progress every Monday.
              </Text>
            </View>
            <Switch
              value={weeklyDigestEnabled}
              onValueChange={setWeeklyDigest}
              trackColor={{ false: COLORS.border.dark, true: COLORS.primary.light }}
              thumbColor={weeklyDigestEnabled ? COLORS.primary.DEFAULT : COLORS.surface.DEFAULT}
            />
          </View>
        </Card>
      </View>

      {/* Account Section */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Account</Text>
        <Button
          title="Sign Out"
          onPress={handleSignOut}
          variant="outline"
        />
      </View>
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 32,
  },
  sectionLabel: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  sectionDescription: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    lineHeight: 20,
    marginBottom: 12,
  },
  optionCard: {
    backgroundColor: COLORS.surface.DEFAULT,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 2,
    borderColor: COLORS.border.light,
  },
  optionCardSelected: {
    borderColor: COLORS.primary.DEFAULT,
    backgroundColor: COLORS.primary.DEFAULT + '08',
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: COLORS.border.dark,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    marginTop: 2,
  },
  radioSelected: {
    borderColor: COLORS.primary.DEFAULT,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.primary.DEFAULT,
  },
  optionContent: {
    flex: 1,
  },
  optionLabel: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    marginBottom: 2,
  },
  optionLabelSelected: {
    color: COLORS.primary.DEFAULT,
  },
  optionDescription: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    lineHeight: 18,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  toggleContent: {
    flex: 1,
    marginRight: 12,
  },
  toggleLabel: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    marginBottom: 2,
  },
  toggleDescription: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    lineHeight: 18,
  },
});
