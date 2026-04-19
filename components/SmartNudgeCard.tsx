import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { MicroCapture } from '@/components/MicroCapture';
import type { SmartNudge, EffortLevel } from '@/services/smartEnrichment';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

interface SmartNudgeCardProps {
  nudge: SmartNudge;
  profileId: string;
  compact?: boolean;
  onDismiss?: () => void;
  onCompleted?: () => void;
}

function effortLabel(level: EffortLevel): string {
  if (level === 'instant') return 'instant';
  if (level === 'quick') return '2 min';
  return '5 min';
}

function effortColor(level: EffortLevel): string {
  if (level === 'instant') return COLORS.success.DEFAULT;
  if (level === 'quick') return COLORS.primary.DEFAULT;
  return COLORS.text.secondary;
}

export function SmartNudgeCard({
  nudge,
  profileId,
  compact = false,
  onDismiss,
  onCompleted,
}: SmartNudgeCardProps) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);

  const isMicro = !!nudge.quickAction;

  const handlePress = () => {
    if (isMicro) {
      setExpanded(true);
      return;
    }
    if (!nudge.actionRoute) return;
    if (nudge.actionParams) {
      router.push({
        pathname: nudge.actionRoute,
        params: nudge.actionParams,
      } as never);
    } else {
      router.push(nudge.actionRoute as never);
    }
  };

  const handleComplete = () => {
    setExpanded(false);
    onCompleted?.();
  };

  if (expanded && nudge.quickAction) {
    return (
      <View style={[styles.card, styles.cardExpanded]}>
        <View style={styles.headerRow}>
          <View
            style={[
              styles.iconCircle,
              { backgroundColor: nudge.iconColor + '1A' },
            ]}
          >
            <Ionicons
              name={nudge.icon as keyof typeof Ionicons.glyphMap}
              size={18}
              color={nudge.iconColor}
            />
          </View>
          <View style={styles.titleBlock}>
            <Text style={styles.title} numberOfLines={2}>
              {nudge.title}
            </Text>
          </View>
        </View>
        <View style={styles.microWrap}>
          <MicroCapture
            quickAction={nudge.quickAction}
            profileId={profileId}
            onComplete={handleComplete}
            onCancel={() => setExpanded(false)}
          />
        </View>
      </View>
    );
  }

  return (
    <TouchableOpacity
      style={[styles.card, compact && styles.cardCompact]}
      onPress={handlePress}
      activeOpacity={0.75}
    >
      <View style={styles.headerRow}>
        <View
          style={[
            styles.iconCircle,
            { backgroundColor: nudge.iconColor + '1A' },
          ]}
        >
          <Ionicons
            name={nudge.icon as keyof typeof Ionicons.glyphMap}
            size={18}
            color={nudge.iconColor}
          />
        </View>
        <View style={styles.titleBlock}>
          <Text style={styles.title} numberOfLines={compact ? 2 : 3}>
            {nudge.title}
          </Text>
          {!compact && (
            <Text style={styles.detail} numberOfLines={2}>
              {nudge.detail}
            </Text>
          )}
        </View>
        {nudge.dismissable && onDismiss && (
          <TouchableOpacity
            onPress={onDismiss}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={styles.dismissBtn}
          >
            <Ionicons name="close" size={18} color={COLORS.text.tertiary} />
          </TouchableOpacity>
        )}
      </View>
      <View style={styles.footerRow}>
        <View
          style={[
            styles.effortBadge,
            { backgroundColor: effortColor(nudge.effortLevel) + '1A' },
          ]}
        >
          <Ionicons
            name="flash"
            size={10}
            color={effortColor(nudge.effortLevel)}
          />
          <Text
            style={[
              styles.effortBadgeText,
              { color: effortColor(nudge.effortLevel) },
            ]}
          >
            {effortLabel(nudge.effortLevel)}
          </Text>
        </View>
        <Text style={styles.actionLabel}>
          {nudge.actionLabel} <Ionicons name="chevron-forward" size={12} />
        </Text>
      </View>
    </TouchableOpacity>
  );
}

interface MilestoneBadgeCardProps {
  title: string;
  detail: string;
  icon: string;
}

export function MilestoneBadgeCard({
  title,
  detail,
  icon,
}: MilestoneBadgeCardProps) {
  return (
    <View style={styles.milestoneCard}>
      <View style={styles.milestoneIconWrap}>
        <Ionicons
          name={icon as keyof typeof Ionicons.glyphMap}
          size={22}
          color={COLORS.success.DEFAULT}
        />
      </View>
      <View style={styles.milestoneBody}>
        <Text style={styles.milestoneTitle}>{title}</Text>
        <Text style={styles.milestoneDetail}>{detail}</Text>
      </View>
      <Ionicons
        name="checkmark-circle"
        size={18}
        color={COLORS.success.DEFAULT}
      />
    </View>
  );
}

const CARD_SHADOW = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.05,
  shadowRadius: 6,
  elevation: 2,
} as const;

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface.DEFAULT,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    ...CARD_SHADOW,
  },
  cardCompact: {
    padding: 12,
  },
  cardExpanded: {
    backgroundColor: COLORS.surface.DEFAULT,
    borderColor: COLORS.primary.DEFAULT + '33',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleBlock: {
    flex: 1,
  },
  title: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    lineHeight: 20,
  },
  detail: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    marginTop: 4,
    lineHeight: 17,
  },
  dismissBtn: {
    padding: 2,
  },
  footerRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  effortBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  effortBadgeText: {
    fontSize: 11,
    fontWeight: FONT_WEIGHTS.semibold,
    textTransform: 'lowercase',
  },
  actionLabel: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.primary.DEFAULT,
  },
  microWrap: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border.light,
  },
  milestoneCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    backgroundColor: COLORS.success.light,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.success.DEFAULT + '33',
  },
  milestoneIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  milestoneBody: {
    flex: 1,
  },
  milestoneTitle: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  milestoneDetail: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    marginTop: 2,
  },
});
