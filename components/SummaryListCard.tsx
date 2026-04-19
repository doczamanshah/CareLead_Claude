import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import type {
  AnswerCardAction,
  FactDomain,
  FactFreshness,
  SummaryListCard as SummaryListCardType,
} from '@/lib/types/ask';
import { CARD_SHADOW, FLAG_COLORS, flagColorFromString } from './askCardShared';

function ageHint(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const days = Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24));
  if (days < 30) return null;
  if (days < 365) {
    const months = Math.max(1, Math.floor(days / 30));
    return `Updated ${months} month${months === 1 ? '' : 's'} ago`;
  }
  const years = Math.max(1, Math.floor(days / 365));
  return `Updated over ${years} year${years === 1 ? '' : 's'} ago`;
}

function shouldShowAge(freshness: FactFreshness | undefined): boolean {
  return freshness === 'stale' || freshness === 'very_stale';
}

interface SummaryListCardProps {
  card: SummaryListCardType;
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

export function SummaryListCard({ card, onActionPress }: SummaryListCardProps) {
  const icon = DOMAIN_ICONS[card.domain] ?? 'document-outline';

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.iconWrap}>
          <Ionicons name={icon} size={18} color={COLORS.primary.DEFAULT} />
        </View>
        <Text style={styles.title}>{card.title}</Text>
        <View style={styles.countPill}>
          <Text style={styles.countText}>{card.items.length}</Text>
        </View>
      </View>

      {/* Items */}
      <View style={styles.items}>
        {card.items.map((item, i) => {
          const flagColor = item.flagColor ?? (item.flag ? flagColorFromString(item.flag) : null);
          const flagPalette = flagColor ? FLAG_COLORS[flagColor] : null;
          const tappable = !!item.sourceRoute;
          const RowWrap = tappable ? TouchableOpacity : View;
          const isUnverified = item.status === 'unverified';
          const isConflicted = item.status === 'conflicted';
          const canVerify = isUnverified && !!item.sourceId && !!item.sourceType;
          const canResolve = isConflicted && !!item.sourceId && !!item.sourceType;

          return (
            <RowWrap
              key={`${item.label}-${i}`}
              style={[styles.item, i === card.items.length - 1 && styles.itemLast]}
              activeOpacity={0.7}
              onPress={
                tappable
                  ? () =>
                      onActionPress?.({
                        type: 'view_source',
                        label: 'View',
                        targetId: item.sourceId ?? null,
                        targetRoute: item.sourceRoute ?? null,
                      })
                  : undefined
              }
            >
              <View style={styles.itemContent}>
                <View style={styles.labelRow}>
                  <Text style={styles.label} numberOfLines={1}>
                    {item.label}
                  </Text>
                  {isConflicted && (
                    <View
                      style={[styles.statusDot, { backgroundColor: COLORS.tertiary.DEFAULT }]}
                    />
                  )}
                  {isUnverified && !isConflicted && (
                    <View
                      style={[styles.statusDot, { backgroundColor: COLORS.warning.DEFAULT }]}
                    />
                  )}
                  {flagPalette && item.flag && (
                    <View style={[styles.flagDot, { backgroundColor: flagPalette.text }]} />
                  )}
                </View>
                <Text style={styles.detail} numberOfLines={2}>
                  {item.detail}
                </Text>
                {item.secondary && (
                  <Text style={styles.secondary} numberOfLines={1}>
                    {item.secondary}
                  </Text>
                )}
                {shouldShowAge(item.freshness) && ageHint(item.lastUpdated) && (
                  <Text style={styles.ageHint} numberOfLines={1}>
                    {ageHint(item.lastUpdated)}
                  </Text>
                )}
              </View>
              {canResolve ? (
                <TouchableOpacity
                  style={styles.rowAction}
                  activeOpacity={0.7}
                  hitSlop={6}
                  onPress={() =>
                    onActionPress?.({
                      type: 'resolve_conflict',
                      label: 'Resolve',
                      targetId: item.sourceId ?? null,
                      targetRoute: null,
                      sourceType: item.sourceType ?? null,
                      conflictGroupId: item.conflictGroupId ?? null,
                    })
                  }
                >
                  <Ionicons
                    name="alert-circle-outline"
                    size={18}
                    color={COLORS.tertiary.DEFAULT}
                  />
                </TouchableOpacity>
              ) : canVerify ? (
                <TouchableOpacity
                  style={styles.rowAction}
                  activeOpacity={0.7}
                  hitSlop={6}
                  onPress={() =>
                    onActionPress?.({
                      type: 'verify',
                      label: 'Verify',
                      targetId: item.sourceId ?? null,
                      targetRoute: null,
                      sourceType: item.sourceType ?? null,
                      conflictGroupId: item.conflictGroupId ?? null,
                    })
                  }
                  accessibilityLabel="Verify this item"
                >
                  <Ionicons
                    name="checkmark-circle-outline"
                    size={18}
                    color={COLORS.success.DEFAULT}
                  />
                </TouchableOpacity>
              ) : tappable ? (
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={COLORS.text.tertiary}
                />
              ) : null}
            </RowWrap>
          );
        })}
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Ionicons name="pulse-outline" size={12} color={COLORS.text.tertiary} />
        <Text style={styles.footerText}>{card.provenance.sourceLabel}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface.DEFAULT,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    padding: 14,
    ...CARD_SHADOW,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  iconWrap: {
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
  countPill: {
    minWidth: 24,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: COLORS.primary.DEFAULT + '14',
    alignItems: 'center',
  },
  countText: {
    fontSize: 11,
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.primary.DEFAULT,
  },
  items: {
    marginTop: 8,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.light,
  },
  itemLast: {
    borderBottomWidth: 0,
  },
  itemContent: {
    flex: 1,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  label: {
    flex: 1,
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  flagDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  rowAction: {
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  detail: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginTop: 2,
  },
  secondary: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginTop: 2,
  },
  ageHint: {
    fontSize: 11,
    color: COLORS.text.tertiary,
    fontStyle: 'italic',
    marginTop: 2,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border.light,
  },
  footerText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
  },
});
