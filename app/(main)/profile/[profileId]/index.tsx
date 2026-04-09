import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScreenLayout } from '@/components/ui/ScreenLayout';
import { Card } from '@/components/ui/Card';
import { useProfileDetail } from '@/hooks/useProfileDetail';
import { useProfileGaps } from '@/hooks/useProfileGaps';
import { PROFILE_FACT_CATEGORIES } from '@/lib/types/profile';
import type { ProfileFact, ProfileFactCategory } from '@/lib/types/profile';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import { formatProfileFact } from '@/lib/utils/formatProfileFact';

function groupFactsByCategory(facts: ProfileFact[]): Record<string, ProfileFact[]> {
  const grouped: Record<string, ProfileFact[]> = {};
  for (const fact of facts) {
    if (!grouped[fact.category]) grouped[fact.category] = [];
    grouped[fact.category].push(fact);
  }
  return grouped;
}

export default function ProfileOverviewScreen() {
  const { profileId } = useLocalSearchParams<{ profileId: string }>();
  const { data: profile, isLoading, error } = useProfileDetail(profileId ?? null);
  const { data: gaps } = useProfileGaps(profileId);
  const router = useRouter();

  if (isLoading) return <ScreenLayout loading />;
  if (error) return <ScreenLayout error={error as Error} />;
  if (!profile) return <ScreenLayout error={new Error('Profile not found')} />;

  const grouped = groupFactsByCategory(profile.facts);
  const gapCount = gaps?.length ?? 0;

  return (
    <ScreenLayout>
      {/* Strengthen Your Profile Card */}
      {gapCount > 0 && (
        <TouchableOpacity
          style={styles.strengthenCard}
          onPress={() =>
            router.push(`/(main)/profile/${profileId}/strengthen`)
          }
        >
          <View style={styles.strengthenContent}>
            <Text style={styles.strengthenTitle}>
              Strengthen Your Profile
            </Text>
            <Text style={styles.strengthenSubtitle}>
              {gapCount} {gapCount === 1 ? 'item' : 'items'} could help CareLead work better for you
            </Text>
          </View>
          <Text style={styles.strengthenArrow}>›</Text>
        </TouchableOpacity>
      )}

      {/* Profile Header */}
      <View style={styles.profileHeader}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {profile.display_name
              .split(' ')
              .map((p) => p[0])
              .join('')
              .toUpperCase()
              .slice(0, 2)}
          </Text>
        </View>
        <View style={styles.profileInfo}>
          <Text style={styles.profileName}>{profile.display_name}</Text>
          <View style={styles.profileMeta}>
            {profile.date_of_birth && (
              <Text style={styles.metaText}>
                DOB: {new Date(profile.date_of_birth).toLocaleDateString()}
              </Text>
            )}
            {profile.gender && (
              <Text style={styles.metaText}>{profile.gender}</Text>
            )}
          </View>
        </View>
        <TouchableOpacity
          onPress={() => router.push(`/(main)/profile/${profileId}/edit`)}
          style={styles.editButton}
        >
          <Text style={styles.editButtonText}>Edit</Text>
        </TouchableOpacity>
      </View>

      {/* Category Sections */}
      {PROFILE_FACT_CATEGORIES.map((category) => {
        const facts = grouped[category.key] ?? [];
        return (
          <CategorySection
            key={category.key}
            icon={category.icon}
            label={category.label}
            facts={facts}
            categoryKey={category.key}
            profileId={profileId!}
            onAdd={() =>
              router.push(
                `/(main)/profile/${profileId}/add-fact?category=${category.key}`,
              )
            }
          />
        );
      })}
    </ScreenLayout>
  );
}

function CategorySection({
  icon,
  label,
  facts,
  categoryKey,
  profileId,
  onAdd,
}: {
  icon: string;
  label: string;
  facts: ProfileFact[];
  categoryKey: ProfileFactCategory;
  profileId: string;
  onAdd: () => void;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionIcon}>{icon}</Text>
        <Text style={styles.sectionLabel}>{label}</Text>
        <Text style={styles.sectionCount}>
          {facts.length > 0 ? `${facts.length}` : ''}
        </Text>
      </View>

      {facts.length > 0 ? (
        <Card>
          {facts.map((fact, i) => {
            const formatted = formatProfileFact(fact);
            return (
              <View key={fact.id}>
                {i > 0 && <View style={styles.factDivider} />}
                <View style={styles.factRow}>
                  <View style={styles.factContent}>
                    <Text style={styles.factValue}>
                      {formatted.title}
                    </Text>
                    {fact.verification_status === 'verified' && (
                      <Text style={styles.verifiedBadge}>Verified</Text>
                    )}
                  </View>
                  {formatted.details.length > 0 && (
                    <View style={styles.factDetails}>
                      {formatted.details.map((detail) => (
                        <View key={detail.label} style={styles.detailRow}>
                          <Text style={styles.detailLabel}>{detail.label}</Text>
                          <Text style={styles.detailValue}>{detail.value}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              </View>
            );
          })}
          <TouchableOpacity onPress={onAdd} style={styles.addMoreButton}>
            <Text style={styles.addMoreText}>+ Add more</Text>
          </TouchableOpacity>
        </Card>
      ) : (
        <Card onPress={onAdd}>
          <View style={styles.emptyCategory}>
            <Text style={styles.emptyCategoryText}>No {label.toLowerCase()} recorded</Text>
            <Text style={styles.addText}>+ Add</Text>
          </View>
        </Card>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  strengthenCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.accent.light,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.accent.DEFAULT,
  },
  strengthenContent: {
    flex: 1,
  },
  strengthenTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    marginBottom: 2,
  },
  strengthenSubtitle: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
  },
  strengthenArrow: {
    fontSize: 24,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.bold,
    marginLeft: 8,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 20,
    marginBottom: 8,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.primary.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: COLORS.text.inverse,
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
  },
  profileInfo: {
    flex: 1,
    marginLeft: 16,
  },
  profileName: {
    fontSize: FONT_SIZES.xl,
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
  },
  profileMeta: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  metaText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
  },
  editButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.primary.DEFAULT,
  },
  editButtonText: {
    color: COLORS.primary.DEFAULT,
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  section: {
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionIcon: {
    fontSize: 18,
    marginRight: 8,
  },
  sectionLabel: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    flex: 1,
  },
  sectionCount: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.tertiary,
    fontWeight: FONT_WEIGHTS.medium,
  },
  factRow: {
    paddingVertical: 8,
  },
  factContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  factValue: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    flex: 1,
  },
  verifiedBadge: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.success.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
    marginLeft: 8,
  },
  factDetails: {
    marginTop: 4,
  },
  detailRow: {
    flexDirection: 'row',
    paddingVertical: 2,
  },
  detailLabel: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.tertiary,
    fontWeight: FONT_WEIGHTS.medium,
    width: 120,
  },
  detailValue: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    flex: 1,
  },
  factDivider: {
    height: 1,
    backgroundColor: COLORS.border.light,
  },
  addMoreButton: {
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border.light,
    marginTop: 4,
  },
  addMoreText: {
    color: COLORS.primary.DEFAULT,
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    textAlign: 'center',
  },
  emptyCategory: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  emptyCategoryText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.tertiary,
  },
  addText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
});
