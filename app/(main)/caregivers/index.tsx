import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ScreenLayout } from '@/components/ui/ScreenLayout';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useAccessGrants, usePendingInvites, useRevokeInvite } from '@/hooks/useCaregivers';
import { PERMISSION_TEMPLATE_MAP } from '@/lib/constants/permissionTemplates';
import type { PermissionTemplateId } from '@/lib/constants/permissionTemplates';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

export default function CaregiversScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ profileId?: string }>();
  const { activeProfile, profiles } = useActiveProfile();

  const profileId = params.profileId ?? activeProfile?.id ?? null;
  const profile = profiles.find((p) => p.id === profileId) ?? activeProfile;

  const { data: grants, isLoading: grantsLoading } = useAccessGrants(profileId);
  const { data: invites, isLoading: invitesLoading } = usePendingInvites(
    profile?.household_id ?? null,
  );
  const revokeInviteMutation = useRevokeInvite();

  const activeGrants = (grants ?? []).filter((g) => g.status === 'active');
  const pendingGrants = (grants ?? []).filter((g) => g.status === 'pending');
  const pendingInvites = invites ?? [];

  if (grantsLoading || invitesLoading) return <ScreenLayout loading />;

  return (
    <ScreenLayout>
      {/* Header */}
      <Text style={styles.subtitle}>
        People who help with {profile?.display_name ?? 'care'}
      </Text>

      {/* Active Caregivers */}
      {activeGrants.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Active Caregivers</Text>
          {activeGrants.map((grant) => {
            const tmpl = PERMISSION_TEMPLATE_MAP[grant.permission_template as PermissionTemplateId];
            return (
              <Card
                key={grant.id}
                onPress={() => router.push(`/(main)/caregivers/${grant.id}`)}
                style={styles.grantCard}
              >
                <View style={styles.grantHeader}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>
                      {(grant.grantee_display_name ?? grant.grantee_email ?? '?')
                        .charAt(0)
                        .toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.grantInfo}>
                    <Text style={styles.grantName}>
                      {grant.grantee_display_name ?? grant.grantee_email ?? 'Unknown'}
                    </Text>
                    <View style={styles.badgeRow}>
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{tmpl?.name ?? grant.permission_template}</Text>
                      </View>
                    </View>
                    <Text style={styles.grantDate}>
                      Since {new Date(grant.granted_at).toLocaleDateString()}
                    </Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </View>
              </Card>
            );
          })}
        </View>
      ) : (
        <View style={styles.section}>
          <EmptyState
            title="No caregivers yet"
            description="Invite someone to help manage care. They'll only see what you allow."
          />
        </View>
      )}

      {/* Pending Grants */}
      {pendingGrants.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Pending Access</Text>
          {pendingGrants.map((grant) => {
            const tmpl = PERMISSION_TEMPLATE_MAP[grant.permission_template as PermissionTemplateId];
            return (
              <Card key={grant.id} style={styles.grantCard}>
                <View style={styles.grantHeader}>
                  <View style={[styles.avatar, styles.pendingAvatar]}>
                    <Text style={styles.avatarText}>?</Text>
                  </View>
                  <View style={styles.grantInfo}>
                    <Text style={styles.grantName}>
                      {grant.grantee_display_name ?? 'Pending'}
                    </Text>
                    <View style={styles.badgeRow}>
                      <View style={[styles.badge, styles.pendingBadge]}>
                        <Text style={styles.pendingBadgeText}>Pending</Text>
                      </View>
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{tmpl?.name ?? grant.permission_template}</Text>
                      </View>
                    </View>
                  </View>
                </View>
              </Card>
            );
          })}
        </View>
      )}

      {/* Pending Invitations */}
      {pendingInvites.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Pending Invitations</Text>
          {pendingInvites.map((invite) => {
            const tmpl = PERMISSION_TEMPLATE_MAP[invite.permission_template as PermissionTemplateId];
            return (
              <Card key={invite.id} style={styles.grantCard}>
                <View style={styles.inviteRow}>
                  <View style={styles.grantInfo}>
                    <Text style={styles.grantName}>
                      {invite.invited_name ?? invite.invited_email}
                    </Text>
                    {invite.invited_name && (
                      <Text style={styles.grantDate}>{invite.invited_email}</Text>
                    )}
                    <View style={styles.badgeRow}>
                      <View style={[styles.badge, styles.pendingBadge]}>
                        <Text style={styles.pendingBadgeText}>Invited</Text>
                      </View>
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{tmpl?.name ?? invite.permission_template}</Text>
                      </View>
                    </View>
                    <Text style={styles.grantDate}>
                      Expires {new Date(invite.expires_at).toLocaleDateString()}
                    </Text>
                  </View>
                  <Button
                    title="Cancel"
                    variant="ghost"
                    size="sm"
                    onPress={() => revokeInviteMutation.mutate(invite.id)}
                    loading={revokeInviteMutation.isPending}
                  />
                </View>
              </Card>
            );
          })}
        </View>
      )}

      {/* Invite Button */}
      <View style={styles.inviteButton}>
        <Button
          title="Invite a Caregiver"
          onPress={() =>
            router.push({
              pathname: '/(main)/caregivers/invite',
              params: profileId ? { profileId } : undefined,
            })
          }
        />
      </View>
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  subtitle: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginBottom: 20,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    marginBottom: 12,
  },
  grantCard: {
    marginBottom: 8,
  },
  grantHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.primary.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingAvatar: {
    backgroundColor: COLORS.text.tertiary,
  },
  avatarText: {
    color: COLORS.text.inverse,
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.bold,
  },
  grantInfo: {
    flex: 1,
    marginLeft: 12,
  },
  grantName: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
  },
  badge: {
    backgroundColor: COLORS.primary.light,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  pendingBadge: {
    backgroundColor: COLORS.warning.light,
  },
  pendingBadgeText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.warning.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  grantDate: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginTop: 2,
  },
  chevron: {
    fontSize: 24,
    color: COLORS.text.tertiary,
    fontWeight: FONT_WEIGHTS.bold,
  },
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  inviteButton: {
    marginTop: 8,
    marginBottom: 32,
  },
});
