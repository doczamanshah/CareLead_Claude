import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import {
  usePatientPriorities,
  useExtractPriorities,
  useUpsertPatientPriorities,
} from '@/hooks/usePatientPriorities';
import { Button } from '@/components/ui/Button';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import type {
  ExtractedPriorities,
  FrictionCategory,
  HealthPriority,
} from '@/lib/types/priorities';

const PROMPT_CHIPS: { label: string; text: string }[] = [
  {
    label: 'Medications',
    text: 'The hardest part of my medications is ',
  },
  {
    label: 'Appointments',
    text: 'When it comes to appointments, ',
  },
  {
    label: 'Billing',
    text: 'What frustrates me most about bills is ',
  },
  {
    label: 'Family coordination',
    text: 'My family helps me with ',
  },
  {
    label: 'Specific condition',
    text: 'What matters most to me about my ',
  },
];

const CATEGORY_LABELS: Record<FrictionCategory, string> = {
  medications: 'Medications',
  appointments: 'Appointments',
  billing: 'Billing',
  results: 'Results',
  preventive: 'Preventive care',
  coordination: 'Coordination',
  other: 'Other',
};

const PLACEHOLDER = `Examples:

• I have type 2 diabetes and it's hard to keep track of which meds I took.
• My daughter helps me with bills — she lives out of state.
• I hate surprise medical charges.
• Please remind me about appointments a few days ahead.`;

export default function PrioritiesScreen() {
  const { profileId } = useLocalSearchParams<{ profileId: string }>();
  const router = useRouter();
  const { profiles } = useActiveProfile();
  const profile = profiles.find((p) => p.id === profileId);

  const { data: existing } = usePatientPriorities(profileId ?? null);
  const extract = useExtractPriorities();
  const upsert = useUpsertPatientPriorities();

  const [text, setText] = useState(existing?.raw_input ?? '');
  const [extracted, setExtracted] = useState<ExtractedPriorities | null>(null);

  useEffect(() => {
    if (existing?.raw_input && !text) {
      setText(existing.raw_input);
    }
  }, [existing]);

  const handleChipPress = (chipText: string) => {
    setText((prev) => (prev ? `${prev}\n${chipText}` : chipText));
  };

  const handleExtract = async () => {
    const trimmed = text.trim();
    if (trimmed.length < 10) {
      Alert.alert(
        'Tell us a bit more',
        'Please share at least a sentence or two about what matters to you.',
      );
      return;
    }
    try {
      const result = await extract.mutateAsync({
        text: trimmed,
        profileName: profile?.display_name ?? null,
      });
      setExtracted(result);
    } catch (err) {
      Alert.alert(
        "Couldn't process",
        err instanceof Error ? err.message : 'Please try again.',
      );
    }
  };

  const handleSave = async () => {
    if (!extracted || !profile || !profileId) return;
    try {
      await upsert.mutateAsync({
        profile_id: profileId,
        household_id: profile.household_id,
        raw_input: text.trim(),
        extracted,
      });
      router.back();
    } catch (err) {
      Alert.alert(
        "Couldn't save",
        err instanceof Error ? err.message : 'Please try again.',
      );
    }
  };

  const hasExisting = !!existing && !extracted;

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.heroIcon}>
            <Ionicons
              name="heart-outline"
              size={28}
              color={COLORS.primary.DEFAULT}
            />
          </View>
          <Text style={styles.heading}>What matters most to you?</Text>
          <Text style={styles.subheading}>
            Tell CareLead what's most important so we can focus on what you care
            about. Your own words, your own priorities.
          </Text>

          {/* Existing priorities summary (collapsed) */}
          {hasExisting && (
            <View style={styles.existingCard}>
              <Text style={styles.existingTitle}>
                Your current priorities
              </Text>
              {existing.health_priorities.length > 0 && (
                <Text style={styles.existingLine} numberOfLines={2}>
                  Focus: {existing.health_priorities.map((hp) => hp.topic).join(', ')}
                </Text>
              )}
              {existing.friction_points.length > 0 && (
                <Text style={styles.existingLine} numberOfLines={2}>
                  Friction:{' '}
                  {existing.friction_points
                    .map((fp) => CATEGORY_LABELS[fp.category])
                    .join(', ')}
                </Text>
              )}
              <Text style={styles.existingHint}>
                Edit the text below to update them.
              </Text>
            </View>
          )}

          {/* Prompt chips */}
          <View style={styles.chipRow}>
            {PROMPT_CHIPS.map((c) => (
              <TouchableOpacity
                key={c.label}
                style={styles.chip}
                onPress={() => handleChipPress(c.text)}
              >
                <Text style={styles.chipText}>{c.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TextInput
            style={styles.input}
            multiline
            value={text}
            onChangeText={setText}
            placeholder={PLACEHOLDER}
            placeholderTextColor={COLORS.text.tertiary}
            textAlignVertical="top"
          />

          <View style={styles.processButtonWrap}>
            <Button
              title={extract.isPending ? 'Understanding...' : 'Review my priorities'}
              onPress={handleExtract}
              disabled={extract.isPending || text.trim().length < 10}
              loading={extract.isPending}
              variant="primary"
            />
          </View>

          {/* Review card */}
          {extracted && (
            <View style={styles.reviewCard}>
              <Text style={styles.reviewHeading}>
                Here's what we understood:
              </Text>

              {extracted.conditions_of_focus.length > 0 && (
                <ReviewBlock
                  label="Conditions you're focused on"
                  icon="medical-outline"
                >
                  {extracted.conditions_of_focus.map((c, i) => (
                    <Text key={i} style={styles.reviewItem}>
                      • {c}
                    </Text>
                  ))}
                </ReviewBlock>
              )}

              {extracted.health_priorities.length > 0 && (
                <ReviewBlock
                  label="What matters most"
                  icon="star-outline"
                >
                  {extracted.health_priorities.map((hp, i) => (
                    <HealthPriorityRow key={i} priority={hp} />
                  ))}
                </ReviewBlock>
              )}

              {extracted.friction_points.length > 0 && (
                <ReviewBlock
                  label="Friction points"
                  icon="warning-outline"
                >
                  {extracted.friction_points.map((fp, i) => (
                    <Text key={i} style={styles.reviewItem}>
                      •{' '}
                      <Text style={styles.reviewItemBold}>
                        {CATEGORY_LABELS[fp.category]}:
                      </Text>{' '}
                      {fp.description}
                    </Text>
                  ))}
                </ReviewBlock>
              )}

              {extracted.tracking_difficulties.length > 0 && (
                <ReviewBlock
                  label="Hard to keep track of"
                  icon="list-outline"
                >
                  {extracted.tracking_difficulties.map((td, i) => (
                    <Text key={i} style={styles.reviewItem}>
                      • {td.what}
                    </Text>
                  ))}
                </ReviewBlock>
              )}

              {extracted.support_context &&
                (extracted.support_context.helpers.length > 0 ||
                  extracted.support_context.coordination_challenges) && (
                  <ReviewBlock label="Your support" icon="people-outline">
                    {extracted.support_context.helpers.length > 0 && (
                      <Text style={styles.reviewItem}>
                        • Helpers: {extracted.support_context.helpers.join(', ')}
                      </Text>
                    )}
                    {extracted.support_context.coordination_challenges && (
                      <Text style={styles.reviewItem}>
                        • {extracted.support_context.coordination_challenges}
                      </Text>
                    )}
                  </ReviewBlock>
                )}

              {extracted.reminder_preferences && (
                <ReviewBlock
                  label="Reminder preferences"
                  icon="notifications-outline"
                >
                  {extracted.reminder_preferences.preferred_time && (
                    <Text style={styles.reviewItem}>
                      • Preferred time:{' '}
                      {extracted.reminder_preferences.preferred_time}
                    </Text>
                  )}
                  {extracted.reminder_preferences.frequency_preference && (
                    <Text style={styles.reviewItem}>
                      • Frequency:{' '}
                      {extracted.reminder_preferences.frequency_preference}
                    </Text>
                  )}
                </ReviewBlock>
              )}

              <View style={styles.saveRow}>
                <Button
                  title="Save priorities"
                  onPress={handleSave}
                  loading={upsert.isPending}
                  disabled={upsert.isPending}
                  variant="primary"
                />
                <View style={{ height: 8 }} />
                <Button
                  title="Edit my answer"
                  onPress={() => setExtracted(null)}
                  variant="ghost"
                />
              </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ReviewBlock({
  label,
  icon,
  children,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.reviewBlock}>
      <View style={styles.reviewBlockHeader}>
        <Ionicons name={icon} size={14} color={COLORS.primary.DEFAULT} />
        <Text style={styles.reviewBlockLabel}>{label}</Text>
      </View>
      {children}
    </View>
  );
}

function HealthPriorityRow({ priority }: { priority: HealthPriority }) {
  return (
    <View style={styles.hpRow}>
      <Text style={styles.reviewItem}>• {priority.topic}</Text>
      <View
        style={[
          styles.hpBadge,
          priority.importance === 'high' && styles.hpBadgeHigh,
        ]}
      >
        <Text
          style={[
            styles.hpBadgeText,
            priority.importance === 'high' && styles.hpBadgeTextHigh,
          ]}
        >
          {priority.importance}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background.DEFAULT,
  },
  content: {
    padding: 24,
    paddingBottom: 48,
  },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.primary.DEFAULT + '14',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  heading: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    marginBottom: 8,
  },
  subheading: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    lineHeight: 22,
    marginBottom: 20,
  },
  existingCard: {
    backgroundColor: COLORS.secondary.DEFAULT + '14',
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
  },
  existingTitle: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.primary.DEFAULT,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  existingLine: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    marginBottom: 3,
  },
  existingHint: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginTop: 6,
    fontStyle: 'italic',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: COLORS.surface.DEFAULT,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
  },
  chipText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.secondary,
  },
  input: {
    minHeight: 220,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    borderRadius: 12,
    padding: 14,
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    backgroundColor: COLORS.surface.DEFAULT,
    marginBottom: 16,
  },
  processButtonWrap: {
    marginBottom: 24,
  },
  reviewCard: {
    backgroundColor: COLORS.surface.DEFAULT,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: COLORS.primary.DEFAULT + '33',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  reviewHeading: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    marginBottom: 16,
  },
  reviewBlock: {
    marginBottom: 14,
  },
  reviewBlockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    gap: 6,
  },
  reviewBlockLabel: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.primary.DEFAULT,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  reviewItem: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    lineHeight: 20,
    marginBottom: 2,
  },
  reviewItemBold: {
    fontWeight: FONT_WEIGHTS.semibold,
  },
  hpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  hpBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: COLORS.surface.muted,
  },
  hpBadgeHigh: {
    backgroundColor: COLORS.accent.DEFAULT + '20',
  },
  hpBadgeText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
    textTransform: 'capitalize',
  },
  hpBadgeTextHigh: {
    color: COLORS.accent.dark,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  saveRow: {
    marginTop: 8,
  },
});
