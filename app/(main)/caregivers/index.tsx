import { useState } from 'react';
import { View, Text, TouchableOpacity, Share, Alert, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { ScreenLayout } from '@/components/ui/ScreenLayout';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import {
  useAccessGrants,
  usePendingInvites,
  useCancelInvite,
  useResendInvite,
} from '@/hooks/useCaregivers';
import { PERMISSION_TEMPLATE_MAP } from '@/lib/constants/permissionTemplates';
import type { PermissionTemplateId } from '@/lib/constants/permissionTemplates';
import type { CaregiverInvite } from '@/lib/types/caregivers';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

const APP_STORE_LINK_PLACEHOLDER = '[App Store link coming soon]';

export default function CaregiversScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ profileId?: string }>();
  const { activeProfile, profiles } = useActiveProfile();

  const profileId = params.profileId ?? activeProfile?.id ?? null;
  const profile = profiles.find((p) => p.id === profileId) ?? activeProfile;
  const inviterName = profiles.find((p) => p.relationship === 'self')?.display_name ?? 'Someone';

  const { data: grants, isLoading: grantsLoading } = useAccessGrants(profileId);
  const { data: invites, isLoading: invitesLoading } = usePendingInvites(
    profile?.household_id ?? null,
  );

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
                  <Ionicons name="chevron-forward" size={18} color={COLORS.text.tertiary} />
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
          <Text style={styles.sectionTitle}>Pending Invites</Text>
          <Text style={styles.sectionSubtitle}>
            Waiting for the caregiver to accept. Share the link again or show a QR code.
          </Text>
          {pendingInvites.map((invite) => (
            <PendingInviteCard
              key={invite.id}
              invite={invite}
              inviterName={inviterName}
            />
          ))}
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

      <TouchableOpacity
        style={styles.codeEntryLink}
        activeOpacity={0.7}
        onPress={() => router.push('/(main)/caregivers/enter-code')}
      >
        <Ionicons name="key-outline" size={16} color={COLORS.primary.DEFAULT} />
        <Text style={styles.codeEntryText}>I have an invite code</Text>
      </TouchableOpacity>
    </ScreenLayout>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Pending invite card with resend/QR/cancel actions
// ─────────────────────────────────────────────────────────────────────

function PendingInviteCard({
  invite,
  inviterName,
}: {
  invite: CaregiverInvite;
  inviterName: string;
}) {
  const [qrOpen, setQrOpen] = useState(false);
  const cancel = useCancelInvite();
  const resend = useResendInvite();

  const tmpl = PERMISSION_TEMPLATE_MAP[invite.permission_template as PermissionTemplateId];
  const inviteLink = `carelead://invite/${invite.token}`;
  const contactLabel = invite.invited_email || invite.invited_phone || 'No contact info';

  const expiresDate = new Date(invite.expires_at);
  const daysLeft = Math.max(
    0,
    Math.ceil((expiresDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
  );

  function shareMessage(): string {
    return [
      `${inviterName} has invited you to help manage health information on CareLead.`,
      '',
      `Tap this link to accept: ${inviteLink}`,
      '',
      `If you don't have CareLead yet, download it first: ${APP_STORE_LINK_PLACEHOLDER}`,
      '',
      'This invite expires in 7 days.',
    ].join('\n');
  }

  async function handleResend() {
    resend.mutate(invite.id, {
      onSuccess: async () => {
        try {
          await Share.share({ message: shareMessage() });
        } catch {
          // Cancelled
        }
      },
      onError: (err) => {
        Alert.alert('Error', err.message);
      },
    });
  }

  function handleCancel() {
    Alert.alert(
      'Cancel invite?',
      `The caregiver will no longer be able to accept this invite. You can create a new one any time.`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Cancel Invite',
          style: 'destructive',
          onPress: () =>
            cancel.mutate(invite.id, {
              onError: (err) => Alert.alert('Error', err.message),
            }),
        },
      ],
    );
  }

  return (
    <Card style={styles.grantCard}>
      <View style={styles.inviteHeader}>
        <View style={styles.grantInfo}>
          <Text style={styles.grantName}>
            {invite.invited_name ?? contactLabel}
          </Text>
          {invite.invited_name && (
            <Text style={styles.grantDate}>{contactLabel}</Text>
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
            {daysLeft > 0
              ? `Expires in ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}`
              : 'Expires today'}
          </Text>
        </View>
      </View>

      <View style={styles.actionRow}>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={handleResend}
          activeOpacity={0.7}
          disabled={resend.isPending}
        >
          <Ionicons name="share-outline" size={16} color={COLORS.primary.DEFAULT} />
          <Text style={styles.actionBtnText}>Resend</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => setQrOpen((v) => !v)}
          activeOpacity={0.7}
        >
          <Ionicons name="qr-code-outline" size={16} color={COLORS.primary.DEFAULT} />
          <Text style={styles.actionBtnText}>{qrOpen ? 'Hide QR' : 'Show QR'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={handleCancel}
          activeOpacity={0.7}
          disabled={cancel.isPending}
        >
          <Ionicons name="close-circle-outline" size={16} color={COLORS.error.DEFAULT} />
          <Text style={[styles.actionBtnText, styles.actionBtnDanger]}>Cancel</Text>
        </TouchableOpacity>
      </View>

      {qrOpen && (
        <View style={styles.qrWrap}>
          <QRCode
            value={inviteLink}
            size={180}
            color={COLORS.primary.DEFAULT}
            backgroundColor={COLORS.surface.DEFAULT}
          />
          <Text style={styles.qrHint}>
            Point the caregiver's phone camera at this code.
          </Text>
        </View>
      )}
    </Card>
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
    marginBottom: 6,
  },
  sectionSubtitle: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginBottom: 12,
    lineHeight: 17,
  },
  grantCard: {
    marginBottom: 8,
  },
  grantHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  inviteHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
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
    flexWrap: 'wrap',
  },
  badge: {
    backgroundColor: COLORS.primary.DEFAULT + '14',
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
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border.light,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: COLORS.background.DEFAULT,
  },
  actionBtnText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.primary.DEFAULT,
  },
  actionBtnDanger: {
    color: COLORS.error.DEFAULT,
  },
  qrWrap: {
    marginTop: 16,
    alignItems: 'center',
    paddingVertical: 16,
    backgroundColor: COLORS.surface.DEFAULT,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.primary.DEFAULT + '33',
  },
  qrHint: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginTop: 12,
    textAlign: 'center',
    paddingHorizontal: 12,
  },
  inviteButton: {
    marginTop: 8,
  },
  codeEntryLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 16,
    marginBottom: 16,
  },
  codeEntryText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.primary.DEFAULT,
  },
});
