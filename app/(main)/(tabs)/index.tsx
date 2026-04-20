import { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { TabHeader } from '@/components/ui/TabHeader';
import { TodayCard } from '@/components/TodayCard';
import { QuickActionsGrid } from '@/components/QuickActionsGrid';
import { NeedsAttentionList } from '@/components/NeedsAttentionList';
import { MilestoneToast } from '@/components/MilestoneToast';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { usePrefetchProfileIndex } from '@/hooks/useAsk';
import { useNeedsAttention } from '@/hooks/useHomeScreen';
import { useHomeSideEffects } from '@/hooks/useHomeSideEffects';
import { useTheme } from '@/hooks/useTheme';
import { useAuthStore } from '@/stores/authStore';
import { SPACING, TYPOGRAPHY } from '@/lib/constants/design';

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function getAccountHolderFirstName(
  fullName: string | null | undefined,
): string | null {
  if (!fullName) return null;
  const first = fullName.trim().split(' ')[0];
  return first || null;
}

export default function HomeScreen() {
  const { colors } = useTheme();
  const { activeProfile, activeProfileId } = useActiveProfile();
  const user = useAuthStore((s) => s.user);

  // Pre-build the Ask profile index so the first Ask query feels instant.
  usePrefetchProfileIndex(activeProfileId, activeProfile?.household_id ?? null);

  const { items: needsAttentionItems, totalCount: needsAttentionTotal } =
    useNeedsAttention(3);

  const { isCaregiver } = useHomeSideEffects();

  const accountHolderName =
    (user?.user_metadata?.full_name as string | undefined) ?? null;
  const firstName = getAccountHolderFirstName(accountHolderName);
  const greeting = firstName ? `${getGreeting()}, ${firstName}` : getGreeting();
  const dateLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const styles = useMemo(() => buildStyles(colors), [colors]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/* Status bar is always light-content on Home because the branded
          header sits behind the system status bar. */}
      <StatusBar style="light" />
      <TabHeader title="Home" variant="branded" />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ZONE 1: GREETING (centered, account holder's first name) */}
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

function buildStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      // SafeArea paints the gutter above the status bar — keep it branded
      // so the notch matches the header.
      backgroundColor: colors.primary.DEFAULT,
    },
    flex: {
      flex: 1,
      backgroundColor: colors.background.DEFAULT,
    },
    scrollContent: {
      paddingHorizontal: SPACING.xxl,
      paddingBottom: SPACING.xxxl,
      backgroundColor: colors.background.DEFAULT,
    },
    greetingZone: {
      paddingTop: SPACING.xxxl,
      paddingBottom: SPACING.xxl,
      alignItems: 'center',
    },
    greeting: {
      ...TYPOGRAPHY.h1,
      color: colors.text.DEFAULT,
      textAlign: 'center',
    },
    dateLine: {
      ...TYPOGRAPHY.bodySmall,
      color: colors.text.secondary,
      marginTop: SPACING.xs,
      textAlign: 'center',
    },
    caregiverLine: {
      ...TYPOGRAPHY.caption,
      color: colors.text.tertiary,
      marginTop: SPACING.sm,
      fontStyle: 'italic',
      textAlign: 'center',
    },
    zone: {
      marginBottom: SPACING.xxl + SPACING.xs,
    },
  });
}
