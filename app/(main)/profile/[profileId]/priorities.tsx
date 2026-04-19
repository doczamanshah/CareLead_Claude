import { useState } from 'react';
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
  useMergePriorities,
  useAddQuickPriority,
  useRemovePriority,
  useResetPriorities,
} from '@/hooks/usePatientPriorities';
import { Button } from '@/components/ui/Button';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import type {
  ExtractedPriorities,
  FrictionCategory,
  HealthPriority,
} from '@/lib/types/priorities';

const CATEGORY_LABELS: Record<FrictionCategory, string> = {
  medications: 'Medications',
  appointments: 'Appointments',
  billing: 'Billing',
  results: 'Results',
  preventive: 'Preventive care',
  coordination: 'Coordination',
  other: 'Other',
};

/** Quick-add chips: pre-structured topics the user can tap to add instantly. */
const QUICK_ADD_CHIPS: { topic: string; category: FrictionCategory }[] = [
  { topic: 'Medication tracking', category: 'medications' },
  { topic: 'Appointment management', category: 'appointments' },
  { topic: 'Diabetes care', category: 'medications' },
  { topic: 'Heart health', category: 'other' },
  { topic: 'Billing & insurance', category: 'billing' },
  { topic: 'Preventive screenings', category: 'preventive' },
  { topic: 'Caregiver coordination', category: 'coordination' },
  { topic: 'Refill management', category: 'medications' },
  { topic: 'Pain management', category: 'other' },
  { topic: 'Mental health', category: 'other' },
];

const INITIAL_PLACEHOLDER = `Examples:

• I have type 2 diabetes and it's hard to keep track of which meds I took.
• My daughter helps me with bills — she lives out of state.
• I hate surprise medical charges.
• Please remind me about appointments a few days ahead.`;

const UPDATE_PLACEHOLDER = `What else matters to you? For example:

• I just started seeing a cardiologist and want to track my heart health better.
• My sleep has been really affecting me lately.`;

export default function PrioritiesScreen() {
  const { profileId } = useLocalSearchParams<{ profileId: string }>();
  const router = useRouter();
  const { profiles } = useActiveProfile();
  const profile = profiles.find((p) => p.id === profileId);

  const { data: existing } = usePatientPriorities(profileId ?? null);
  const extract = useExtractPriorities();
  const upsert = useUpsertPatientPriorities();
  const merge = useMergePriorities();
  const quickAdd = useAddQuickPriority();
  const removePriority = useRemovePriority();
  const reset = useResetPriorities();

  const [text, setText] = useState('');
  const [extracted, setExtracted] = useState<ExtractedPriorities | null>(null);
  const [confirmationText, setConfirmationText] = useState<string | null>(null);

  const hasExisting = !!existing && (
    existing.health_priorities.length > 0 ||
    existing.friction_points.length > 0 ||
    existing.conditions_of_focus.length > 0
  );

  const householdId = profile?.household_id ?? null;

  // Derive the set of quick-add topics already present so chips render filled.
  const activeQuickTopics = new Set(
    (existing?.health_priorities ?? []).map((hp) => hp.topic.toLowerCase()),
  );

  const flashConfirmation = (msg: string) => {
    setConfirmationText(msg);
    setTimeout(() => setConfirmationText(null), 2500);
  };

  const handleChipTap = async (topic: string, category: FrictionCategory) => {
    if (!profileId || !householdId) return;
    const isActive = activeQuickTopics.has(topic.toLowerCase());
    if (isActive) {
      // Toggle off — remove this topic
      try {
        await removePriority.mutateAsync({
          profile_id: profileId,
          household_id: householdId,
          kind: 'topic',
          value: topic,
        });
        flashConfirmation('Removed');
      } catch (err) {
        Alert.alert(
          "Couldn't remove",
          err instanceof Error ? err.message : 'Please try again.',
        );
      }
      return;
    }
    try {
      await quickAdd.mutateAsync({
        profile_id: profileId,
        household_id: householdId,
        topic,
        category,
      });
      flashConfirmation('Priorities updated — your tasks will reflect this');
    } catch (err) {
      Alert.alert(
        "Couldn't add",
        err instanceof Error ? err.message : 'Please try again.',
      );
    }
  };

  const handleRemoveTopic = async (topic: string) => {
    if (!profileId || !householdId) return;
    try {
      await removePriority.mutateAsync({
        profile_id: profileId,
        household_id: householdId,
        kind: 'topic',
        value: topic,
      });
      flashConfirmation('Removed');
    } catch (err) {
      Alert.alert(
        "Couldn't remove",
        err instanceof Error ? err.message : 'Please try again.',
      );
    }
  };

  const handleRemoveFriction = async (area: string) => {
    if (!profileId || !householdId) return;
    try {
      await removePriority.mutateAsync({
        profile_id: profileId,
        household_id: householdId,
        kind: 'friction',
        value: area,
      });
      flashConfirmation('Removed');
    } catch (err) {
      Alert.alert(
        "Couldn't remove",
        err instanceof Error ? err.message : 'Please try again.',
      );
    }
  };

  const handleExtract = async () => {
    const trimmed = text.trim();
    if (trimmed.length < 10) {
      Alert.alert(
        'Tell us a bit more',
        'Please share at least a sentence or two.',
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

  const handleSaveExtracted = async () => {
    if (!extracted || !profile || !profileId) return;
    try {
      if (hasExisting) {
        await merge.mutateAsync({
          profile_id: profileId,
          household_id: profile.household_id,
          raw_input: text.trim(),
          extracted,
        });
      } else {
        await upsert.mutateAsync({
          profile_id: profileId,
          household_id: profile.household_id,
          raw_input: text.trim(),
          extracted,
        });
      }
      setExtracted(null);
      setText('');
      flashConfirmation('Priorities updated — your tasks will reflect this');
    } catch (err) {
      Alert.alert(
        "Couldn't save",
        err instanceof Error ? err.message : 'Please try again.',
      );
    }
  };

  const handleStartFresh = () => {
    if (!profileId) return;
    Alert.alert(
      'Start fresh?',
      'This will clear your current priorities so you can redo them. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear & start over',
          style: 'destructive',
          onPress: async () => {
            try {
              await reset.mutateAsync({ profile_id: profileId });
              setExtracted(null);
              setText('');
              flashConfirmation('Cleared — tell us what matters now');
            } catch (err) {
              Alert.alert(
                "Couldn't reset",
                err instanceof Error ? err.message : 'Please try again.',
              );
            }
          },
        },
      ],
    );
  };

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
          <Text style={styles.heading}>What matters to you?</Text>
          <Text style={styles.subheading}>
            {hasExisting
              ? 'These shape how your tasks are organized and what you see first.'
              : "Tell CareLead what's most important so we can focus on what you care about."}
          </Text>

          {/* Current priorities — editable list */}
          {hasExisting && existing && (
            <View style={styles.currentSection}>
              <Text style={styles.sectionTitle}>YOUR CURRENT PRIORITIES</Text>

              {existing.health_priorities.map((hp) => (
                <PriorityItemCard
                  key={`hp-${hp.topic}`}
                  title={hp.topic}
                  badgeText={hp.importance}
                  isHigh={hp.importance === 'high'}
                  detail={hp.detail}
                  onRemove={() => handleRemoveTopic(hp.topic)}
                />
              ))}

              {existing.friction_points
                .filter((fp) => !fp.area.startsWith('quick:'))
                .map((fp) => (
                  <PriorityItemCard
                    key={`fp-${fp.area}`}
                    title={fp.description || fp.area}
                    badgeText={CATEGORY_LABELS[fp.category]}
                    isHigh={false}
                    detail={null}
                    onRemove={() => handleRemoveFriction(fp.area)}
                  />
                ))}

              {existing.conditions_of_focus.length > 0 && (
                <View style={styles.conditionsRow}>
                  <Ionicons
                    name="medical-outline"
                    size={14}
                    color={COLORS.text.secondary}
                  />
                  <Text style={styles.conditionsText} numberOfLines={2}>
                    Focus: {existing.conditions_of_focus.join(', ')}
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* Add more section */}
          <View style={styles.addSection}>
            <Text style={styles.sectionTitle}>
              {hasExisting ? 'ADD MORE' : 'QUICK ADD'}
            </Text>
            <Text style={styles.sectionSubtitle}>
              Tap any that apply. You can remove them any time.
            </Text>

            <View style={styles.chipRow}>
              {QUICK_ADD_CHIPS.map((c) => {
                const active = activeQuickTopics.has(c.topic.toLowerCase());
                return (
                  <TouchableOpacity
                    key={c.topic}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => handleChipTap(c.topic, c.category)}
                    disabled={quickAdd.isPending || removePriority.isPending}
                    activeOpacity={0.75}
                  >
                    {active && (
                      <Ionicons
                        name="checkmark"
                        size={12}
                        color={COLORS.primary.DEFAULT}
                        style={styles.chipCheck}
                      />
                    )}
                    <Text
                      style={[
                        styles.chipText,
                        active && styles.chipTextActive,
                      ]}
                    >
                      {c.topic}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Freeform entry */}
          <View style={styles.freeformSection}>
            <Text style={styles.sectionTitle}>
              {hasExisting ? 'TELL US MORE' : 'YOUR OWN WORDS'}
            </Text>
            <Text style={styles.sectionSubtitle}>
              {hasExisting
                ? 'Describe anything else that matters. We\'ll add it to your priorities.'
                : 'Speak or type what\'s on your mind. Your own words work best.'}
            </Text>

            <TextInput
              style={styles.input}
              multiline
              value={text}
              onChangeText={setText}
              placeholder={hasExisting ? UPDATE_PLACEHOLDER : INITIAL_PLACEHOLDER}
              placeholderTextColor={COLORS.text.tertiary}
              textAlignVertical="top"
            />

            <View style={styles.processButtonWrap}>
              <Button
                title={
                  extract.isPending
                    ? 'Understanding...'
                    : hasExisting
                      ? 'Add to my priorities'
                      : 'Review my priorities'
                }
                onPress={handleExtract}
                disabled={extract.isPending || text.trim().length < 10}
                loading={extract.isPending}
                variant="primary"
              />
            </View>
          </View>

          {/* Extraction review card */}
          {extracted && (
            <View style={styles.reviewCard}>
              <Text style={styles.reviewHeading}>
                {hasExisting ? "Here's what we'll add:" : "Here's what we understood:"}
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
                <ReviewBlock label="What matters most" icon="star-outline">
                  {extracted.health_priorities.map((hp, i) => (
                    <HealthPriorityRow key={i} priority={hp} />
                  ))}
                </ReviewBlock>
              )}

              {extracted.friction_points.length > 0 && (
                <ReviewBlock label="Friction points" icon="warning-outline">
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
                <ReviewBlock label="Hard to keep track of" icon="list-outline">
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
                  title={hasExisting ? 'Add these' : 'Save priorities'}
                  onPress={handleSaveExtracted}
                  loading={merge.isPending || upsert.isPending}
                  disabled={merge.isPending || upsert.isPending}
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

          {/* Start fresh */}
          {hasExisting && (
            <View style={styles.startFreshWrap}>
              <TouchableOpacity
                style={styles.startFreshRow}
                onPress={handleStartFresh}
                disabled={reset.isPending}
                activeOpacity={0.7}
              >
                <Ionicons
                  name="refresh-outline"
                  size={14}
                  color={COLORS.text.tertiary}
                />
                <Text style={styles.startFreshText}>
                  Want to redo your priorities?
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Confirmation toast */}
      {confirmationText && (
        <View style={styles.toast} pointerEvents="none">
          <Ionicons
            name="checkmark-circle"
            size={16}
            color={COLORS.success.DEFAULT}
          />
          <Text style={styles.toastText}>{confirmationText}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

// ── Subcomponents ───────────────────────────────────────────────────────────

function PriorityItemCard({
  title,
  badgeText,
  isHigh,
  detail,
  onRemove,
}: {
  title: string;
  badgeText: string;
  isHigh: boolean;
  detail: string | null;
  onRemove: () => void;
}) {
  return (
    <View style={styles.itemCard}>
      <View style={styles.itemBody}>
        <Text style={styles.itemTitle}>{title}</Text>
        {detail && (
          <Text style={styles.itemDetail} numberOfLines={2}>
            {detail}
          </Text>
        )}
        <View
          style={[styles.itemBadge, isHigh && styles.itemBadgeHigh]}
        >
          <Text
            style={[styles.itemBadgeText, isHigh && styles.itemBadgeTextHigh]}
          >
            {badgeText}
          </Text>
        </View>
      </View>
      <TouchableOpacity
        style={styles.removeButton}
        onPress={onRemove}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons name="close" size={16} color={COLORS.text.tertiary} />
      </TouchableOpacity>
    </View>
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
        style={[styles.hpBadge, priority.importance === 'high' && styles.hpBadgeHigh]}
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

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background.DEFAULT,
  },
  content: {
    padding: 24,
    paddingBottom: 60,
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
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
  },
  sectionSubtitle: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginBottom: 12,
  },
  currentSection: {
    marginBottom: 24,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface.DEFAULT,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    padding: 14,
    marginBottom: 8,
  },
  itemBody: {
    flex: 1,
  },
  itemTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    marginBottom: 2,
  },
  itemDetail: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    marginBottom: 6,
    lineHeight: 16,
  },
  itemBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: COLORS.surface.muted,
    marginTop: 4,
  },
  itemBadgeHigh: {
    backgroundColor: COLORS.accent.DEFAULT + '20',
  },
  itemBadgeText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
    textTransform: 'capitalize',
  },
  itemBadgeTextHigh: {
    color: COLORS.accent.dark,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  removeButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.surface.muted,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  conditionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
    marginTop: 4,
  },
  conditionsText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    flex: 1,
  },
  addSection: {
    marginBottom: 24,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: COLORS.surface.DEFAULT,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
  },
  chipActive: {
    backgroundColor: COLORS.primary.DEFAULT + '14',
    borderColor: COLORS.primary.DEFAULT,
  },
  chipCheck: {
    marginRight: 4,
  },
  chipText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.secondary,
  },
  chipTextActive: {
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  freeformSection: {
    marginBottom: 24,
  },
  input: {
    minHeight: 160,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    borderRadius: 12,
    padding: 14,
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    backgroundColor: COLORS.surface.DEFAULT,
    marginBottom: 12,
  },
  processButtonWrap: {
    marginTop: 4,
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
    marginBottom: 16,
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
  startFreshWrap: {
    marginTop: 8,
    alignItems: 'center',
  },
  startFreshRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
  },
  startFreshText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.tertiary,
    textDecorationLine: 'underline',
  },
  toast: {
    position: 'absolute',
    bottom: 24,
    left: 24,
    right: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: COLORS.text.DEFAULT,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
  },
  toastText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.inverse,
    flex: 1,
  },
});
