import { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  StyleSheet,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScreenLayout } from '@/components/ui/ScreenLayout';
import { useProfileGaps, useFillProfileGap, useFillGeneralGap } from '@/hooks/useProfileGaps';
import { inferMedicationDefaults, FREQUENCY_OPTIONS } from '@/lib/utils/medicalInference';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import type { ProfileGap } from '@/services/profileGaps';

const CATEGORY_ICONS: Record<string, string> = {
  medication: '💊',
  condition: '🩺',
  allergy: '⚠️',
  insurance: '🛡️',
  general: '📋',
};

function groupGapsByCategory(gaps: ProfileGap[]): Record<string, ProfileGap[]> {
  const grouped: Record<string, ProfileGap[]> = {};
  for (const gap of gaps) {
    if (!grouped[gap.category]) grouped[gap.category] = [];
    grouped[gap.category].push(gap);
  }
  return grouped;
}

function categoryLabel(cat: string): string {
  const labels: Record<string, string> = {
    medication: 'Medications',
    condition: 'Conditions',
    allergy: 'Allergies',
    insurance: 'Insurance',
    general: 'General',
  };
  return labels[cat] ?? cat.charAt(0).toUpperCase() + cat.slice(1);
}

export default function StrengthenProfileScreen() {
  const { profileId } = useLocalSearchParams<{ profileId: string }>();
  const router = useRouter();
  const { data: gaps, isLoading, error } = useProfileGaps(profileId);
  const fillGap = useFillProfileGap();
  const fillGeneral = useFillGeneralGap();

  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [completedGaps, setCompletedGaps] = useState<Set<string>>(new Set());

  const activeGaps = useMemo(
    () => (gaps ?? []).filter((g) => !completedGaps.has(g.id)),
    [gaps, completedGaps],
  );

  const totalGaps = gaps?.length ?? 0;
  const filledCount = completedGaps.size;
  const strengthPercent = totalGaps > 0 ? Math.round(((totalGaps - activeGaps.length) / totalGaps) * 100) : 100;

  const grouped = useMemo(() => groupGapsByCategory(activeGaps), [activeGaps]);

  const getSmartDefault = useCallback((gap: ProfileGap): string => {
    if (gap.category === 'medication' && gap.field_key === 'frequency' && gap.related_fact_value) {
      const drugName = (gap.related_fact_value.drug_name as string) || '';
      if (drugName) {
        const defaults = inferMedicationDefaults(drugName);
        return defaults.commonFrequencies[0] || '';
      }
    }
    if (gap.category === 'medication' && gap.field_key === 'dose' && gap.related_fact_value) {
      const drugName = (gap.related_fact_value.drug_name as string) || '';
      if (drugName) {
        const defaults = inferMedicationDefaults(drugName);
        return defaults.commonDoses[0] || '';
      }
    }
    return '';
  }, []);

  const handleSave = useCallback(async (gap: ProfileGap) => {
    const value = fieldValues[gap.id]?.trim();
    if (!value) {
      Alert.alert('Required', 'Please enter a value');
      return;
    }

    try {
      if (gap.related_fact_id) {
        await fillGap.mutateAsync({
          factId: gap.related_fact_id,
          fieldKey: gap.field_key,
          value,
        });
      } else if (profileId) {
        // General gap — create a new fact
        const category = gap.field_key === 'emergency_contact' ? 'emergency_contact'
          : gap.field_key === 'care_team' ? 'care_team'
          : gap.field_key === 'pharmacy' ? 'pharmacy'
          : gap.category;

        const valueObj: Record<string, unknown> = {};
        if (category === 'emergency_contact') {
          valueObj.name = value;
        } else if (category === 'care_team') {
          valueObj.name = value;
        } else if (category === 'pharmacy') {
          valueObj.name = value;
        } else {
          valueObj.value = value;
        }

        await fillGeneral.mutateAsync({
          profileId,
          category,
          fieldKey: gap.field_key,
          value: valueObj,
        });
      }

      setCompletedGaps((prev) => new Set(prev).add(gap.id));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save';
      Alert.alert('Error', msg);
    }
  }, [fieldValues, fillGap, fillGeneral, profileId]);

  const handleSkip = useCallback((gapId: string) => {
    setCompletedGaps((prev) => new Set(prev).add(gapId));
  }, []);

  if (isLoading) return <ScreenLayout loading />;
  if (error) return <ScreenLayout error={error as Error} />;

  if (activeGaps.length === 0) {
    return (
      <ScreenLayout>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>✓</Text>
          <Text style={styles.emptyTitle}>Your profile is looking great!</Text>
          <Text style={styles.emptySubtitle}>
            CareLead has everything it needs to work well for you.
          </Text>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.back()}
          >
            <Text style={styles.backBtnText}>Back to Profile</Text>
          </TouchableOpacity>
        </View>
      </ScreenLayout>
    );
  }

  return (
    <ScreenLayout>
      {/* Progress indicator */}
      <View style={styles.progressContainer}>
        <View style={styles.progressBar}>
          <View
            style={[styles.progressFill, { width: `${strengthPercent}%` }]}
          />
        </View>
        <Text style={styles.progressText}>
          Profile strength: {strengthPercent}%
        </Text>
        {filledCount > 0 && (
          <Text style={styles.progressDetail}>
            {filledCount} item{filledCount === 1 ? '' : 's'} completed this session
          </Text>
        )}
      </View>

      {/* Gap cards grouped by category */}
      {Object.entries(grouped).map(([cat, catGaps]) => (
        <View key={cat} style={styles.categorySection}>
          <View style={styles.categoryHeader}>
            <Text style={styles.categoryIcon}>
              {CATEGORY_ICONS[cat] || '📋'}
            </Text>
            <Text style={styles.categoryLabel}>{categoryLabel(cat)}</Text>
            <Text style={styles.categoryCount}>{catGaps.length}</Text>
          </View>

          {catGaps.map((gap) => {
            const smartDefault = getSmartDefault(gap);
            const currentValue = fieldValues[gap.id] ?? smartDefault;

            return (
              <View key={gap.id} style={styles.gapCard}>
                <View style={styles.gapPriorityDot}>
                  <View
                    style={[
                      styles.priorityDot,
                      gap.priority === 'high' && styles.priorityHigh,
                      gap.priority === 'medium' && styles.priorityMedium,
                      gap.priority === 'low' && styles.priorityLow,
                    ]}
                  />
                </View>

                <Text style={styles.gapPrompt}>{gap.prompt_text}</Text>
                <Text style={styles.gapImpact}>{gap.impact_text}</Text>

                {/* Frequency picker for medication frequency gaps */}
                {gap.category === 'medication' && gap.field_key === 'frequency' ? (
                  <View style={styles.optionsRow}>
                    {FREQUENCY_OPTIONS.slice(0, 5).map((opt) => (
                      <TouchableOpacity
                        key={opt.value}
                        style={[
                          styles.optionChip,
                          currentValue === opt.value && styles.optionChipActive,
                        ]}
                        onPress={() =>
                          setFieldValues((prev) => ({
                            ...prev,
                            [gap.id]: opt.value,
                          }))
                        }
                      >
                        <Text
                          style={[
                            styles.optionChipText,
                            currentValue === opt.value &&
                              styles.optionChipTextActive,
                          ]}
                        >
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : gap.category === 'allergy' && gap.field_key === 'severity' ? (
                  <View style={styles.optionsRow}>
                    {['mild', 'moderate', 'severe'].map((opt) => (
                      <TouchableOpacity
                        key={opt}
                        style={[
                          styles.optionChip,
                          currentValue === opt && styles.optionChipActive,
                        ]}
                        onPress={() =>
                          setFieldValues((prev) => ({
                            ...prev,
                            [gap.id]: opt,
                          }))
                        }
                      >
                        <Text
                          style={[
                            styles.optionChipText,
                            currentValue === opt && styles.optionChipTextActive,
                          ]}
                        >
                          {opt.charAt(0).toUpperCase() + opt.slice(1)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : (
                  <TextInput
                    style={styles.gapInput}
                    placeholder={smartDefault || 'Enter value...'}
                    placeholderTextColor={COLORS.text.tertiary}
                    value={currentValue}
                    onChangeText={(v) =>
                      setFieldValues((prev) => ({ ...prev, [gap.id]: v }))
                    }
                  />
                )}

                <View style={styles.gapActions}>
                  <TouchableOpacity
                    style={styles.saveBtn}
                    onPress={() => handleSave(gap)}
                    disabled={fillGap.isPending || fillGeneral.isPending}
                  >
                    <Text style={styles.saveBtnText}>Save</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => handleSkip(gap.id)}>
                    <Text style={styles.skipText}>Skip</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>
      ))}
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  progressContainer: {
    marginBottom: 20,
  },
  progressBar: {
    height: 8,
    backgroundColor: COLORS.border.light,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.success.DEFAULT,
    borderRadius: 4,
  },
  progressText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  progressDetail: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    marginTop: 2,
  },

  categorySection: {
    marginBottom: 24,
  },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  categoryIcon: {
    fontSize: 18,
    marginRight: 8,
  },
  categoryLabel: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    flex: 1,
  },
  categoryCount: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.tertiary,
    fontWeight: FONT_WEIGHTS.medium,
  },

  gapCard: {
    backgroundColor: COLORS.surface.DEFAULT,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border.light,
  },
  gapPriorityDot: {
    position: 'absolute',
    top: 16,
    right: 16,
  },
  priorityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  priorityHigh: {
    backgroundColor: COLORS.error.DEFAULT,
  },
  priorityMedium: {
    backgroundColor: COLORS.warning.DEFAULT,
  },
  priorityLow: {
    backgroundColor: COLORS.text.tertiary,
  },
  gapPrompt: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
    marginBottom: 4,
    paddingRight: 24,
  },
  gapImpact: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.secondary.DEFAULT,
    marginBottom: 12,
  },
  gapInput: {
    borderWidth: 1,
    borderColor: COLORS.border.dark,
    borderRadius: 8,
    padding: 10,
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    backgroundColor: COLORS.surface.muted,
  },
  optionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border.dark,
    backgroundColor: COLORS.surface.muted,
  },
  optionChipActive: {
    borderColor: COLORS.primary.DEFAULT,
    backgroundColor: COLORS.primary.DEFAULT,
  },
  optionChipText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
  },
  optionChipTextActive: {
    color: COLORS.text.inverse,
  },
  gapActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginTop: 12,
  },
  saveBtn: {
    backgroundColor: COLORS.primary.DEFAULT,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
  },
  saveBtnText: {
    color: COLORS.text.inverse,
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  skipText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.tertiary,
  },

  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    minHeight: 300,
  },
  emptyIcon: {
    fontSize: 56,
    color: COLORS.success.DEFAULT,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: FONT_SIZES.xl,
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    textAlign: 'center',
    marginBottom: 24,
  },
  backBtn: {
    backgroundColor: COLORS.primary.DEFAULT,
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 12,
  },
  backBtnText: {
    color: COLORS.text.inverse,
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
  },
});
