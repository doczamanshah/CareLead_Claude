import { useMemo } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenLayout } from '@/components/ui/ScreenLayout';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useInviteLookup, useAcceptInvite } from '@/hooks/useCaregivers';
import { useAuthStore } from '@/stores/authStore';
import { logAuthEvent } from '@/services/securityAudit';
import { PERMISSION_TEMPLATE_MAP } from '@/lib/constants/permissionTemplates';
import type { PermissionTemplateId } from '@/lib/constants/permissionTemplates';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

export default function AcceptInviteScreen() {
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token?: string }>();
  const lookup = useInviteLookup(token ?? null);
  const accept = useAcceptInvite();
  const userId = useAuthStore((s) => s.user?.id ?? null);

  const invite = lookup.data ?? null;
  const template = useMemo(() => {
    if (!invite) return null;
    return PERMISSION_TEMPLATE_MAP[invite.permission_template as PermissionTemplateId] ?? null;
  }, [invite]);

  function friendlyError(): string {
    const err = lookup.error?.message ?? accept.error?.message ?? '';
    const msg = err.toLowerCase();
    if (msg.includes('not found')) {
      return "This invite doesn't look right. Double-check the link or ask the person who invited you to send it again.";
    }
    if (msg.includes('expired')) {
      return 'This invite has expired. Ask the person who invited you to send a new one.';
    }
    if (msg.includes('already')) {
      return "This invite has already been used. If you didn't accept it, let the person who invited you know.";
    }
    if (msg.includes('own')) {
      return "You can't accept your own invite. Share the link with the caregiver you invited instead.";
    }
    return err || 'Something went wrong. Please try again.';
  }

  function handleAccept() {
    if (!token) return;
    accept.mutate(token, {
      onSuccess: () => {
        logAuthEvent({ eventType: 'invite_accepted', userId });
        // Brief success state, then go home
        router.replace('/(main)/(tabs)');
      },
    });
  }

  function handleDecline() {
    logAuthEvent({ eventType: 'invite_declined', userId });
    router.back();
  }

  // ─── Loading ───────────────────────────────────────────────────────
  if (!token) {
    return (
      <ScreenLayout>
        <ErrorState
          title="No invite code"
          message="We didn't get an invite code. Tap the link from your invitation or enter the code manually."
          onDismiss={() => router.back()}
        />
      </ScreenLayout>
    );
  }

  if (lookup.isLoading) {
    return (
      <ScreenLayout>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.primary.DEFAULT} />
          <Text style={styles.loadingText}>Looking up your invite...</Text>
        </View>
      </ScreenLayout>
    );
  }

  // ─── Error from lookup ─────────────────────────────────────────────
  if (lookup.error || !invite) {
    return (
      <ScreenLayout>
        <ErrorState
          title="We couldn't open this invite"
          message={friendlyError()}
          onDismiss={() => router.back()}
        />
      </ScreenLayout>
    );
  }

  // ─── Already accepted / revoked / expired ──────────────────────────
  if (invite.status !== 'pending') {
    const titleMap: Record<string, string> = {
      accepted: 'Already accepted',
      revoked: 'Invite cancelled',
      expired: 'Invite expired',
    };
    const messageMap: Record<string, string> = {
      accepted: 'This invite has already been used.',
      revoked: 'The person who invited you has cancelled this invite. Ask them to send a new one if you still need access.',
      expired: 'This invite has expired. Ask the person who invited you to send a new one.',
    };
    return (
      <ScreenLayout>
        <ErrorState
          title={titleMap[invite.status] ?? 'Invite unavailable'}
          message={messageMap[invite.status] ?? friendlyError()}
          onDismiss={() => router.back()}
        />
      </ScreenLayout>
    );
  }

  // ─── Expired based on timestamp (safety) ───────────────────────────
  if (new Date(invite.expires_at) < new Date()) {
    return (
      <ScreenLayout>
        <ErrorState
          title="Invite expired"
          message="This invite has expired. Ask the person who invited you to send a new one."
          onDismiss={() => router.back()}
        />
      </ScreenLayout>
    );
  }

  // ─── Error from accept attempt ─────────────────────────────────────
  if (accept.isError) {
    return (
      <ScreenLayout>
        <ErrorState
          title="Couldn't accept invite"
          message={friendlyError()}
          onDismiss={() => router.back()}
          secondaryAction={{
            label: 'Try Again',
            onPress: () => {
              accept.reset();
              handleAccept();
            },
          }}
        />
      </ScreenLayout>
    );
  }

  // ─── Details view ──────────────────────────────────────────────────
  const inviterName = invite.inviter_display_name ?? 'Someone';
  const profileNames = invite.profile_names ?? [];
  const scopes = template?.scopes ?? [];

  return (
    <ScreenLayout>
      <View style={styles.heroIcon}>
        <Ionicons name="people" size={32} color={COLORS.primary.DEFAULT} />
      </View>

      <Text style={styles.heroTitle}>You've been invited</Text>
      <Text style={styles.heroSubtitle}>
        {inviterName} wants to give you access to help manage health information on CareLead.
      </Text>

      <Card style={styles.detailCard}>
        <DetailRow
          icon="person-outline"
          label="Invited by"
          value={inviterName}
        />
        <DetailDivider />
        <DetailRow
          icon="people-outline"
          label="Access to"
          value={profileNames.length > 0 ? profileNames.join(', ') : 'Family members'}
        />
        <DetailDivider />
        <DetailRow
          icon="shield-checkmark-outline"
          label="Permission level"
          value={template?.name ?? invite.permission_template}
          sub={template?.description}
        />
      </Card>

      {scopes.length > 0 && (
        <Card style={styles.scopeCard}>
          <Text style={styles.scopeTitle}>What you'll be able to do</Text>
          {scopes.map((scope) => (
            <View key={scope} style={styles.scopeRow}>
              <Ionicons
                name="checkmark-circle"
                size={16}
                color={COLORS.success.DEFAULT}
                style={styles.scopeIcon}
              />
              <Text style={styles.scopeText}>{formatScope(scope)}</Text>
            </View>
          ))}
        </Card>
      )}

      <Text style={styles.trustNote}>
        You're about to access sensitive health information. Your access is recorded and can be
        revoked by {inviterName} at any time.
      </Text>

      <View style={styles.actions}>
        <Button
          title="Decline"
          variant="outline"
          onPress={handleDecline}
          disabled={accept.isPending}
        />
        <Button
          title="Accept Invite"
          onPress={handleAccept}
          loading={accept.isPending}
        />
      </View>
    </ScreenLayout>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Subcomponents
// ─────────────────────────────────────────────────────────────────────

function DetailRow({
  icon,
  label,
  value,
  sub,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <View style={styles.detailRow}>
      <View style={styles.detailIconWrap}>
        <Ionicons name={icon} size={18} color={COLORS.primary.DEFAULT} />
      </View>
      <View style={styles.detailTextWrap}>
        <Text style={styles.detailLabel}>{label}</Text>
        <Text style={styles.detailValue}>{value}</Text>
        {sub && <Text style={styles.detailSub}>{sub}</Text>}
      </View>
    </View>
  );
}

function DetailDivider() {
  return <View style={styles.detailDivider} />;
}

function ErrorState({
  title,
  message,
  onDismiss,
  secondaryAction,
}: {
  title: string;
  message: string;
  onDismiss: () => void;
  secondaryAction?: { label: string; onPress: () => void };
}) {
  return (
    <View style={styles.errorState}>
      <View style={styles.errorIcon}>
        <Ionicons name="alert-circle" size={36} color={COLORS.warning.DEFAULT} />
      </View>
      <Text style={styles.errorTitle}>{title}</Text>
      <Text style={styles.errorMessage}>{message}</Text>
      <View style={styles.errorActions}>
        {secondaryAction && (
          <Button
            title={secondaryAction.label}
            variant="outline"
            onPress={secondaryAction.onPress}
          />
        )}
        <Button title="Close" onPress={onDismiss} />
      </View>
    </View>
  );
}

function formatScope(scope: string): string {
  return scope
    .replace('.', ' — ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
  },
  loadingText: {
    marginTop: 16,
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
  },
  heroIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.primary.DEFAULT + '14',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginTop: 16,
    marginBottom: 20,
  },
  heroTitle: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    textAlign: 'center',
    marginBottom: 8,
  },
  heroSubtitle: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
    paddingHorizontal: 8,
  },
  detailCard: {
    marginBottom: 16,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
  },
  detailIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.primary.DEFAULT + '14',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  detailTextWrap: {
    flex: 1,
  },
  detailLabel: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  detailValue: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  detailSub: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginTop: 4,
    lineHeight: 19,
  },
  detailDivider: {
    height: 1,
    backgroundColor: COLORS.border.light,
  },
  scopeCard: {
    marginBottom: 16,
  },
  scopeTitle: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  scopeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  scopeIcon: {
    marginRight: 8,
  },
  scopeText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
  },
  trustNote: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 18,
    paddingHorizontal: 16,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 32,
  },
  errorState: {
    alignItems: 'center',
    paddingTop: 40,
  },
  errorIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.warning.light,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  errorTitle: {
    fontSize: FONT_SIZES.xl,
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    textAlign: 'center',
    marginBottom: 8,
  },
  errorMessage: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 22,
    paddingHorizontal: 16,
  },
  errorActions: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
});
