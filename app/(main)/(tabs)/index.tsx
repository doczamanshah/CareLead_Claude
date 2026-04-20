import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TabHeader } from '@/components/ui/TabHeader';
import { TodayCard } from '@/components/TodayCard';
import { QuickActionsGrid } from '@/components/QuickActionsGrid';
import { NeedsAttentionList } from '@/components/NeedsAttentionList';
import { MilestoneToast } from '@/components/MilestoneToast';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { usePrefetchProfileIndex } from '@/hooks/useAsk';
import { useNeedsAttention } from '@/hooks/useHomeScreen';
import { useHomeSideEffects } from '@/hooks/useHomeSideEffects';
import { COLORS } from '@/lib/constants/colors';
import { SPACING, TYPOGRAPHY } from '@/lib/constants/design';

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function getFirstName(displayName: string | null | undefined): string | null {
  if (!displayName) return null;
  const first = displayName.trim().split(' ')[0];
  return first || null;
}

export default function HomeScreen() {
  const { activeProfile, activeProfileId } = useActiveProfile();

  // Pre-build the Ask profile index so the first Ask query feels instant.
  usePrefetchProfileIndex(activeProfileId, activeProfile?.household_id ?? null);

  const { items: needsAttentionItems, totalCount: needsAttentionTotal } =
    useNeedsAttention(3);

  // One-time prompts + background migrations live in their own hook so
  // this screen file stays focused on layout.
  const { isCaregiver } = useHomeSideEffects();

  const firstName = getFirstName(activeProfile?.display_name);
  const greeting = firstName ? `${getGreeting()}, ${firstName}` : getGreeting();
  const dateLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <TabHeader title="Home" />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ZONE 1: GREETING */}
        <View style={styles.greetingZone}>
          <Text style={styles.greeting} numberOfLines={1}>
            {greeting}
          </Text>
          <Text style={styles.dateLine} numberOfLines={1}>
            {dateLabel}
          </Text>
          {isCaregiver && activeProfile && (
            <Text style={styles.caregiverLine} numberOfLines={1}>
              Managing {activeProfile.display_name}'s health
            </Text>
          )}
        </View>

        {/* ZONE 2: TODAY CARD */}
        <View style={styles.zone}>
          <TodayCard />
        </View>

        {/* ZONE 3: QUICK ACTIONS */}
        <View style={styles.zone}>
          <QuickActionsGrid />
        </View>

        {/* ZONE 4: NEEDS ATTENTION (renders only when items exist) */}
        {needsAttentionItems.length > 0 && (
          <View style={styles.zone}>
            <NeedsAttentionList
              items={needsAttentionItems}
              totalCount={needsAttentionTotal}
            />
          </View>
        )}
      </ScrollView>

      <MilestoneToast />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background.DEFAULT,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.xxl,
    paddingBottom: SPACING.xxxl,
  },
  greetingZone: {
    paddingTop: SPACING.xxxl,
    paddingBottom: SPACING.xxl,
  },
  greeting: {
    ...TYPOGRAPHY.h1,
    color: COLORS.text.DEFAULT,
  },
  dateLine: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.text.secondary,
    marginTop: SPACING.xs,
  },
  caregiverLine: {
    ...TYPOGRAPHY.caption,
    color: COLORS.text.tertiary,
    marginTop: SPACING.sm,
    fontStyle: 'italic',
  },
  zone: {
    marginBottom: SPACING.xxl + SPACING.xs,
  },
});
