import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenLayout } from '@/components/ui/ScreenLayout';
import { Card } from '@/components/ui/Card';
import { ProfileCard } from '@/components/modules/ProfileCard';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

const QUICK_ACTIONS = [
  { key: 'camera', icon: '📷', label: 'Take\nPhoto', route: '/(main)/capture/camera' },
  { key: 'document', icon: '📄', label: 'Add\nDocument', route: '/(main)/capture/upload' },
  { key: 'voice', icon: '🎙️', label: 'Record\nVoice Note', route: '/(main)/capture/voice' },
  { key: 'appointment', icon: '📅', label: 'New\nAppointment', route: null },
] as const;

export default function HomeScreen() {
  const { activeProfile, activeProfileId, profiles, switchProfile } = useActiveProfile();
  const router = useRouter();

  function getGreeting(): string {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }

  return (
    <ScreenLayout>
      {/* Header with greeting */}
      <View style={styles.header}>
        <Text style={styles.greeting}>{getGreeting()}</Text>
        <Text style={styles.profileName}>
          {activeProfile?.display_name ?? 'User'}
        </Text>
        <Text style={styles.tagline}>Your care. In your hands.</Text>
      </View>

      {/* Profile Switcher (horizontal scroll) */}
      {profiles.length > 1 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Profiles</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.profileScroll}
          >
            {profiles.map((profile) => (
              <ProfileCard
                key={profile.id}
                profile={profile}
                isActive={profile.id === activeProfileId}
                onPress={() => switchProfile(profile.id)}
                compact
              />
            ))}
          </ScrollView>
        </View>
      )}

      {/* Quick Actions */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Quick Actions</Text>
        <View style={styles.actionsGrid}>
          {QUICK_ACTIONS.map((action) => (
            <TouchableOpacity
              key={action.key}
              style={styles.actionButton}
              activeOpacity={0.7}
              onPress={() => {
                if (action.route) {
                  router.push(action.route as string);
                }
              }}
            >
              <View style={styles.actionIconWrap}>
                <Text style={styles.actionIcon}>{action.icon}</Text>
              </View>
              <Text style={styles.actionLabel}>{action.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Profile Snapshot Card */}
      {activeProfile && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Health Profile</Text>
          <Card
            onPress={() => router.push(`/(main)/profile/${activeProfileId}`)}
          >
            <View style={styles.profileSnapshotRow}>
              <View style={styles.profileSnapshotAvatar}>
                <Text style={styles.profileSnapshotInitials}>
                  {activeProfile.display_name
                    .split(' ')
                    .map((p) => p[0])
                    .join('')
                    .toUpperCase()
                    .slice(0, 2)}
                </Text>
              </View>
              <View style={styles.profileSnapshotInfo}>
                <Text style={styles.profileSnapshotName}>
                  {activeProfile.display_name}
                </Text>
                <Text style={styles.profileSnapshotSub}>
                  Tap to view full health profile
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </View>
          </Card>
        </View>
      )}

      {/* Recent Activity */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Recent Activity</Text>
        <Card>
          <View style={styles.emptyActivity}>
            <Text style={styles.emptyIcon}>📋</Text>
            <Text style={styles.emptyTitle}>No recent activity</Text>
            <Text style={styles.emptyDesc}>
              Add a document, record a voice note, or update your profile to get started.
            </Text>
          </View>
        </Card>
      </View>
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingTop: 8,
    paddingBottom: 20,
  },
  greeting: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
  },
  profileName: {
    fontSize: FONT_SIZES['3xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.primary.DEFAULT,
    marginTop: 2,
  },
  tagline: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.tertiary,
    marginTop: 4,
    fontStyle: 'italic',
  },
  section: {
    marginBottom: 24,
  },
  sectionLabel: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  profileScroll: {
    marginHorizontal: -4,
  },
  actionsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  actionButton: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  actionIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: COLORS.surface.DEFAULT,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  actionIcon: {
    fontSize: 24,
  },
  actionLabel: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.secondary,
    textAlign: 'center',
    lineHeight: 16,
  },
  profileSnapshotRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  profileSnapshotAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.primary.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileSnapshotInitials: {
    color: COLORS.text.inverse,
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.bold,
  },
  profileSnapshotInfo: {
    flex: 1,
    marginLeft: 12,
  },
  profileSnapshotName: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  profileSnapshotSub: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.tertiary,
    marginTop: 2,
  },
  chevron: {
    fontSize: FONT_SIZES['2xl'],
    color: COLORS.text.tertiary,
    fontWeight: FONT_WEIGHTS.medium,
  },
  emptyActivity: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  emptyIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    marginBottom: 4,
  },
  emptyDesc: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    textAlign: 'center',
    lineHeight: 20,
  },
});
