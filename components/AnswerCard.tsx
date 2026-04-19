import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import type {
  AnswerCard as AnswerCardType,
  AnswerCardAction,
  FactDomain,
  FactFreshness,
  FactProvenanceSource,
  FactStatus,
} from '@/lib/types/ask';

interface AnswerCardProps {
  card: AnswerCardType;
  onActionPress?: (action: AnswerCardAction) => void;
}

const DOMAIN_ICONS: Record<FactDomain, keyof typeof Ionicons.glyphMap> = {
  medications: 'medical-outline',
  labs: 'flask-outline',
  allergies: 'warning-outline',
  conditions: 'fitness-outline',
  appointments: 'calendar-outline',
  insurance: 'card-outline',
  care_team: 'people-outline',
  surgeries: 'cut-outline',
  immunizations: 'bandage-outline',
  vitals: 'pulse-outline',
  results: 'document-text-outline',
  billing: 'receipt-outline',
  preventive: 'shield-checkmark-outline',
};

const PROVENANCE_ICONS: Record<
  FactProvenanceSource,
  { icon: keyof typeof Ionicons.glyphMap; label: string }
> = {
  manual: { icon: 'create-outline', label: 'You entered' },
  document: { icon: 'document-attach-outline', label: 'From document' },
  extraction: { icon: 'sparkles-outline', label: 'Extracted' },
  import: { icon: 'cloud-download-outline', label: 'Imported' },
  system: { icon: 'pulse-outline', label: 'From your profile' },
};

const FRESHNESS_CONFIG: Record<
  FactFreshness,
  { label: string | null; color: string; showBadge: boolean; showLabel: boolean }
> = {
  current: { label: 'Current', color: COLORS.success.DEFAULT, showBadge: true, showLabel: false },
  recent: { label: 'Recent', color: COLORS.warning.DEFAULT, showBadge: true, showLabel: false },
  stale: { label: 'May be outdated', color: COLORS.text.tertiary, showBadge: true, showLabel: true },
  very_stale: { label: null, color: COLORS.tertiary.DEFAULT, showBadge: true, showLabel: true },
  unknown: { label: null, color: COLORS.text.tertiary, showBadge: false, showLabel: false },
};

function monthsAgoLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return null;
  const days = Math.floor((Date.now() - d) / (1000 * 60 * 60 * 24));
  if (days < 365) {
    const months = Math.max(1, Math.floor(days / 30));
    return `Last updated ${months} month${months === 1 ? '' : 's'} ago`;
  }
  const years = Math.max(1, Math.floor(days / 365));
  return `Last updated ${years} year${years === 1 ? '' : 's'} ago`;
}

function formatRelative(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const diffMs = Date.now() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 0) {
    const future = Math.abs(diffDays);
    if (future === 0) return 'Today';
    if (future === 1) return 'Tomorrow';
    if (future < 7) return `In ${future} days`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} week${Math.floor(diffDays / 7) === 1 ? '' : 's'} ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} month${Math.floor(diffDays / 30) === 1 ? '' : 's'} ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function statusChip(
  status: FactStatus,
): { label: string; color: string; bg: string; icon: keyof typeof Ionicons.glyphMap | null } | null {
  if (status === 'unverified') {
    return {
      label: 'Unverified',
      color: COLORS.warning.DEFAULT,
      bg: COLORS.warning.light,
      icon: null,
    };
  }
  if (status === 'conflicted') {
    return {
      label: 'Conflicted — tap to resolve',
      color: COLORS.error.DEFAULT,
      bg: COLORS.error.light,
      icon: null,
    };
  }
  if (status === 'verified') {
    return {
      label: 'Verified',
      color: COLORS.success.DEFAULT,
      bg: COLORS.success.light,
      icon: 'checkmark-circle',
    };
  }
  return null;
}

export function AnswerCard({ card, onActionPress }: AnswerCardProps) {
  const domainIcon = DOMAIN_ICONS[card.domain] ?? 'document-outline';
  const freshness = FRESHNESS_CONFIG[card.freshness];
  const provenance = PROVENANCE_ICONS[card.provenance.source] ?? PROVENANCE_ICONS.system;
  const dateLine = formatRelative(card.dateRelevant);
  const chip = statusChip(card.status);

  const viewSource = card.actions.find((a) => a.type === 'view_source');
  const verifyAction = card.actions.find((a) => a.type === 'verify');
  const resolveAction = card.actions.find((a) => a.type === 'resolve_conflict');

  return (
    <View style={styles.card}>
      {/* Top row: domain icon + title + freshness badge */}
      <View style={styles.topRow}>
        <View style={styles.domainIconWrap}>
          <Ionicons name={domainIcon} size={18} color={COLORS.primary.DEFAULT} />
        </View>
        <Text style={styles.title} numberOfLines={2}>
          {card.title}
        </Text>
        {freshness.showBadge && (() => {
          const dynamicLabel =
            card.freshness === 'very_stale'
              ? monthsAgoLabel(card.dateRelevant ?? card.provenance.verifiedAt)
              : null;
          const labelText = dynamicLabel ?? freshness.label;
          return (
            <View style={styles.freshnessWrap}>
              <View style={[styles.freshnessDot, { backgroundColor: freshness.color }]} />
              {freshness.showLabel && labelText && (
                <Text style={[styles.freshnessLabel, { color: freshness.color }]}>
                  {labelText}
                </Text>
              )}
            </View>
          );
        })()}
      </View>

      {/* Primary value — the main answer */}
      <Text style={styles.primaryValue} numberOfLines={3}>
        {card.primaryValue}
      </Text>

      {/* Secondary value */}
      {card.secondaryValue && (
        <Text style={styles.secondaryValue} numberOfLines={2}>
          {card.secondaryValue}
        </Text>
      )}

      {/* Date line */}
      {dateLine && (
        <Text style={styles.dateLine}>
          {card.domain === 'appointments' && card.dateRelevant && new Date(card.dateRelevant).getTime() > Date.now()
            ? `On ${dateLine.toLowerCase()}`
            : `As of ${dateLine.toLowerCase()}`}
        </Text>
      )}

      {/* Provenance line */}
      <View style={styles.provenanceRow}>
        <Ionicons name={provenance.icon} size={12} color={COLORS.text.tertiary} />
        <Text style={styles.provenanceText}>
          {card.provenance.sourceLabel || provenance.label}
        </Text>
      </View>

      {/* Status indicator chip — tappable when conflicted (opens resolution) or unverified (verifies) */}
      {chip && (() => {
        const chipAction =
          card.status === 'conflicted' ? resolveAction
          : card.status === 'unverified' ? verifyAction
          : null;
        const chipTappable = !!chipAction && !!onActionPress;
        return (
          <TouchableOpacity
            style={[styles.statusChip, { backgroundColor: chip.bg }]}
            activeOpacity={chipTappable ? 0.7 : 1}
            disabled={!chipTappable}
            onPress={chipTappable ? () => onActionPress?.(chipAction!) : undefined}
          >
            {chip.icon && (
              <Ionicons name={chip.icon} size={11} color={chip.color} style={styles.statusChipIcon} />
            )}
            <Text style={[styles.statusChipText, { color: chip.color }]}>{chip.label}</Text>
          </TouchableOpacity>
        );
      })()}

      {/* Actions */}
      {(viewSource || verifyAction || resolveAction) && (
        <View style={styles.actionsRow}>
          {viewSource && (
            <TouchableOpacity
              style={[styles.actionButton, styles.actionPrimary]}
              activeOpacity={0.7}
              onPress={() => onActionPress?.(viewSource)}
              disabled={!viewSource.targetRoute}
            >
              <Ionicons
                name="arrow-forward-outline"
                size={14}
                color={viewSource.targetRoute ? COLORS.primary.DEFAULT : COLORS.text.tertiary}
              />
              <Text
                style={[
                  styles.actionButtonText,
                  { color: viewSource.targetRoute ? COLORS.primary.DEFAULT : COLORS.text.tertiary },
                ]}
              >
                View source
              </Text>
            </TouchableOpacity>
          )}
          {verifyAction && (
            <TouchableOpacity
              style={[styles.actionButton, styles.actionSuccess]}
              activeOpacity={0.7}
              onPress={() => onActionPress?.(verifyAction)}
            >
              <Ionicons
                name="checkmark-circle-outline"
                size={14}
                color={COLORS.success.DEFAULT}
              />
              <Text style={[styles.actionButtonText, { color: COLORS.success.DEFAULT }]}>
                Verify
              </Text>
            </TouchableOpacity>
          )}
          {resolveAction && (
            <TouchableOpacity
              style={[styles.actionButton, styles.actionWarning]}
              activeOpacity={0.7}
              onPress={() => onActionPress?.(resolveAction)}
            >
              <Ionicons
                name="alert-circle-outline"
                size={14}
                color={COLORS.tertiary.DEFAULT}
              />
              <Text style={[styles.actionButtonText, { color: COLORS.tertiary.DEFAULT }]}>
                Resolve
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const CARD_SHADOW = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 6,
  elevation: 2,
} as const;

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface.DEFAULT,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    padding: 14,
    ...CARD_SHADOW,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  domainIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: COLORS.primary.DEFAULT + '14',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  freshnessWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  freshnessDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  freshnessLabel: {
    fontSize: 11,
    fontWeight: FONT_WEIGHTS.medium,
  },
  primaryValue: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    marginTop: 2,
  },
  secondaryValue: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginTop: 4,
  },
  dateLine: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginTop: 6,
  },
  provenanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
  },
  provenanceText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
  },
  statusChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    marginTop: 8,
  },
  statusChipIcon: {
    marginRight: 4,
  },
  statusChipText: {
    fontSize: 11,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border.light,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  actionPrimary: {
    backgroundColor: COLORS.primary.DEFAULT + '0D',
  },
  actionSuccess: {
    backgroundColor: COLORS.success.DEFAULT + '14',
  },
  actionWarning: {
    backgroundColor: COLORS.tertiary.DEFAULT + '14',
  },
  actionDisabled: {
    backgroundColor: COLORS.surface.muted,
  },
  actionButtonText: {
    fontSize: 12,
    fontWeight: FONT_WEIGHTS.semibold,
  },
});
