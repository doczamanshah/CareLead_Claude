import { useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { TabHeader } from '@/components/ui/TabHeader';
import { Card } from '@/components/ui/Card';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useProfileDetail } from '@/hooks/useProfileDetail';
import { useMedications } from '@/hooks/useMedications';
import { useResults } from '@/hooks/useResults';
import { usePreventiveItems } from '@/hooks/usePreventive';
import { useSmartEnrichment } from '@/hooks/useSmartEnrichment';
import { COLORS } from '@/lib/constants/colors';
import { RADIUS, SPACING, TYPOGRAPHY } from '@/lib/constants/design';
import type { ProfileFact } from '@/lib/types/profile';

interface SectionCardProps {
  icon: keyof typeof import('@expo/vector-icons/build/Ionicons').default.glyphMap;
  title: string;
  summary: string;
  detail?: string | null;
  detailColor?: string;
  onPress: () => void;
}

function SectionCard({
  icon,
  title,
  summary,
  detail,
  detailColor,
  onPress,
}: SectionCardProps) {
  return (
    <Card onPress={onPress} padding="md" style={styles.sectionCard}>
      <View style={styles.sectionRow}>
        <View style={styles.iconWrap}>
          <Ionicons name={icon} size={24} color={COLORS.primary.light} />
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text
            style={[
              styles.cardSummary,
              detailColor ? { color: detailColor } : null,
            ]}
            numberOfLines={1}
          >
            {summary}
          </Text>
          {detail ? (
            <Text style={styles.cardDetail} numberOfLines={1}>
              {detail}
            </Text>
          ) : null}
        </View>
        <Ionicons
          name="chevron-forward"
          size={18}
          color={COLORS.text.tertiary}
        />
      </View>
    </Card>
  );
}

function readString(obj: Record<string, unknown> | null | undefined, key: string): string | null {
  if (!obj) return null;
  const v = obj[key];
  return typeof v === 'string' && v.trim().length > 0 ? v : null;
}

function getFactName(fact: ProfileFact): string | null {
  return (
    readString(fact.value_json, 'name') ??
    readString(fact.value_json, 'condition_name') ??
    readString(fact.value_json, 'substance') ??
    readString(fact.value_json, 'plan_name') ??
    readString(fact.value_json, 'provider') ??
    readString(fact.value_json, 'payer') ??
    null
  );
}

export default function HealthScreen() {
  const router = useRouter();
  const { activeProfile, activeProfileId } = useActiveProfile();
  const { data: profile } = useProfileDetail(activeProfileId);
  const { data: medications } = useMedications(activeProfileId);
  const { data: results } = useResults(activeProfileId);
  const { data: preventiveItems } = usePreventiveItems(activeProfileId);
  const { tierInfo, nonMilestoneNudges, topNudge } = useSmartEnrichment(
    activeProfileId,
    activeProfile?.household_id ?? null,
  );

  const stats = useMemo(() => {
    const facts = profile?.facts ?? [];
    const conditions = facts.filter((f) => f.category === 'condition');
    const allergies = facts.filter((f) => f.category === 'allergy');
    const careTeam = facts.filter((f) => f.category === 'care_team');
    const insurance = facts.filter((f) => f.category === 'insurance');

    const activeMeds = (medications ?? []).filter((m) => m.status === 'active');
    const topMedNames = activeMeds
      .slice(0, 3)
      .map((m) => m.drug_name)
      .filter(Boolean) as string[];

    const sortedResults = [...(results ?? [])].sort((a, b) => {
      const aTime = a.performed_at ?? a.reported_at ?? a.created_at;
      const bTime = b.performed_at ?? b.reported_at ?? b.created_at;
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    });
    const latestResult = sortedResults[0] ?? null;

    const relevantPrev = (preventiveItems ?? []).filter(
      (i) =>
        i.status !== 'declined' &&
        i.status !== 'deferred' &&
        i.status !== 'archived',
    );
    const upToDateCount = relevantPrev.filter(
      (i) => i.status === 'up_to_date' || i.status === 'completed',
    ).length;
    const totalPrev = relevantPrev.length;
    const compliancePct =
      totalPrev === 0 ? 0 : Math.round((upToDateCount / totalPrev) * 100);

    const topProvider = careTeam[0] ? getFactName(careTeam[0]) : null;
    const topInsurance = insurance[0]
      ? readString(insurance[0].value_json, 'plan_name') ??
        readString(insurance[0].value_json, 'payer') ??
        readString(insurance[0].value_json, 'provider') ??
        null
      : null;

    return {
      activeMedCount: activeMeds.length,
      topMedNames,
      conditionCount: conditions.length,
      allergyCount: allergies.length,
      careTeamCount: careTeam.length,
      insuranceCount: insurance.length,
      resultCount: (results ?? []).filter((r) => r.status !== 'archived').length,
      latestResult,
      upToDateCount,
      totalPrev,
      compliancePct,
      topProvider,
      topInsurance,
    };
  }, [profile, medications, results, preventiveItems]);

  function handleProfilePress() {
    if (activeProfileId) router.push(`/(main)/profile/${activeProfileId}`);
  }

  function handleStrengthenPress() {
    if (activeProfileId) {
      router.push(`/(main)/profile/${activeProfileId}/strengthen`);
    }
  }

  const quickStatRow = useMemo(() => {
    const parts: string[] = [];
    parts.push(
      `${stats.activeMedCount} ${stats.activeMedCount === 1 ? 'med' : 'meds'}`,
    );
    parts.push(
      `${stats.conditionCount} ${stats.conditionCount === 1 ? 'condition' : 'conditions'}`,
    );
    parts.push(
      `${stats.careTeamCount} ${stats.careTeamCount === 1 ? 'provider' : 'providers'}`,
    );
    return parts.join(' · ');
  }, [stats]);

  const compliancePctColor = useMemo(() => {
    if (stats.totalPrev === 0) return COLORS.text.secondary;
    if (stats.compliancePct >= 80) return COLORS.success.DEFAULT;
    if (stats.compliancePct >= 60) return COLORS.accent.dark;
    return COLORS.error.DEFAULT;
  }, [stats]);

  const latestResultDetail = useMemo(() => {
    const r = stats.latestResult;
    if (!r) return null;
    const date = r.performed_at ?? r.reported_at ?? r.created_at;
    const dateStr = date
      ? new Date(date).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
      : '';
    return `Latest: ${r.test_name}${dateStr ? ` · ${dateStr}` : ''}`;
  }, [stats]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <TabHeader title="Health" />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile header card */}
        <Card
          variant="elevated"
          padding="lg"
          onPress={handleProfilePress}
          style={styles.profileCard}
        >
          <View style={styles.profileTopRow}>
            <View style={styles.profileNameWrap}>
              <Text style={styles.profileName} numberOfLines={1}>
                {activeProfile?.display_name ?? 'Your profile'}
              </Text>
              {tierInfo ? (
                <View style={styles.tierBadge}>
                  <Ionicons
                    name={tierInfo.icon as keyof typeof Ionicons.glyphMap}
                    size={12}
                    color={COLORS.secondary.dark}
                  />
                  <Text style={styles.tierBadgeText}>{tierInfo.label}</Text>
                </View>
              ) : null}
            </View>
            <Ionicons
              name="chevron-forward"
              size={20}
              color={COLORS.text.tertiary}
            />
          </View>
          <Text style={styles.quickStats}>{quickStatRow}</Text>
        </Card>

        {/* Section cards */}
        <SectionCard
          icon="medical-outline"
          title="Medications"
          summary={
            stats.activeMedCount > 0
              ? `${stats.activeMedCount} active medication${stats.activeMedCount === 1 ? '' : 's'}`
              : 'No medications added yet'
          }
          detail={
            stats.topMedNames.length > 0 ? stats.topMedNames.join(', ') : null
          }
          onPress={() => router.push('/(main)/medications')}
        />

        <SectionCard
          icon="fitness-outline"
          title="Conditions & Allergies"
          summary={
            stats.conditionCount + stats.allergyCount > 0
              ? `${stats.conditionCount} ${stats.conditionCount === 1 ? 'condition' : 'conditions'}, ${stats.allergyCount} ${stats.allergyCount === 1 ? 'allergy' : 'allergies'}`
              : 'None listed'
          }
          onPress={handleProfilePress}
        />

        <SectionCard
          icon="flask-outline"
          title="Results & Labs"
          summary={
            stats.resultCount > 0
              ? `${stats.resultCount} result${stats.resultCount === 1 ? '' : 's'} on file`
              : 'No results on file'
          }
          detail={latestResultDetail}
          onPress={() => router.push('/(main)/results')}
        />

        <SectionCard
          icon="shield-checkmark-outline"
          title="Preventive Care"
          summary={
            stats.totalPrev > 0
              ? `${stats.upToDateCount} of ${stats.totalPrev} screenings current`
              : 'Run preventive scan'
          }
          detailColor={compliancePctColor}
          onPress={() => router.push('/(main)/preventive')}
        />

        <SectionCard
          icon="people-outline"
          title="Care Team"
          summary={
            stats.careTeamCount > 0
              ? `${stats.careTeamCount} provider${stats.careTeamCount === 1 ? '' : 's'}`
              : 'No providers added yet'
          }
          detail={stats.topProvider}
          onPress={handleProfilePress}
        />

        <SectionCard
          icon="card-outline"
          title="Insurance"
          summary={
            stats.insuranceCount > 0
              ? stats.topInsurance ?? `${stats.insuranceCount} on file`
              : 'Not on file'
          }
          onPress={handleProfilePress}
        />

        <SectionCard
          icon="trending-up-outline"
          title="Strengthen Your Profile"
          summary={
            nonMilestoneNudges.length > 0
              ? `${nonMilestoneNudges.length} suggestion${nonMilestoneNudges.length === 1 ? '' : 's'} to improve`
              : 'Looking great!'
          }
          detail={topNudge?.title ?? null}
          onPress={handleStrengthenPress}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background.DEFAULT,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xxxl,
  },
  profileCard: {
    marginBottom: SPACING.lg,
  },
  profileTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.xs + 2,
  },
  profileNameWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm + 2,
  },
  profileName: {
    ...TYPOGRAPHY.h2,
    color: COLORS.text.DEFAULT,
    flexShrink: 1,
  },
  tierBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.secondary.DEFAULT + '1A',
  },
  tierBadgeText: {
    ...TYPOGRAPHY.caption,
    fontWeight: '600',
    color: COLORS.secondary.dark,
  },
  quickStats: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.text.secondary,
    fontWeight: '500',
  },
  sectionCard: {
    marginBottom: SPACING.sm + 2,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.primary.lightest,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.md,
  },
  cardBody: {
    flex: 1,
  },
  cardTitle: {
    ...TYPOGRAPHY.h4,
    color: COLORS.text.DEFAULT,
    marginBottom: 2,
  },
  cardSummary: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.text.secondary,
  },
  cardDetail: {
    ...TYPOGRAPHY.caption,
    color: COLORS.text.tertiary,
    marginTop: 2,
  },
});
