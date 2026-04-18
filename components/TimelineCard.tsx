import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import type {
  AnswerCardAction,
  TimelineCard as TimelineCardType,
  TimelineItem,
} from '@/lib/types/ask';
import { CARD_SHADOW } from './askCardShared';

interface TimelineCardProps {
  card: TimelineCardType;
  onActionPress?: (action: AnswerCardAction) => void;
}

export function TimelineCard({ card, onActionPress }: TimelineCardProps) {
  const hasAny = card.upcoming.length > 0 || card.past.length > 0;

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.iconWrap}>
          <Ionicons name="calendar-outline" size={18} color={COLORS.primary.DEFAULT} />
        </View>
        <Text style={styles.title}>{card.title}</Text>
      </View>

      {!hasAny && (
        <Text style={styles.empty}>Nothing on your calendar.</Text>
      )}

      {card.upcoming.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Upcoming</Text>
          <View>
            {card.upcoming.map((item, i) => (
              <TimelineRow
                key={`up-${i}`}
                item={item}
                variant="upcoming"
                isLast={i === card.upcoming.length - 1}
                onActionPress={onActionPress}
              />
            ))}
          </View>
        </View>
      )}

      {card.past.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Past</Text>
          <View>
            {card.past.map((item, i) => (
              <TimelineRow
                key={`pa-${i}`}
                item={item}
                variant="past"
                isLast={i === card.past.length - 1}
                onActionPress={onActionPress}
              />
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

function TimelineRow({
  item,
  variant,
  isLast,
  onActionPress,
}: {
  item: TimelineItem;
  variant: 'upcoming' | 'past';
  isLast: boolean;
  onActionPress?: (action: AnswerCardAction) => void;
}) {
  const dim = variant === 'past';
  const dotColor = variant === 'upcoming' ? COLORS.primary.DEFAULT : COLORS.border.dark;
  const tappable = !!item.sourceRoute;
  const RowWrap = tappable ? TouchableOpacity : View;

  return (
    <RowWrap
      style={styles.row}
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
      <View style={styles.rail}>
        <View style={[styles.dot, { backgroundColor: dotColor }]} />
        {!isLast && <View style={styles.rail__line} />}
      </View>
      <View style={[styles.rowContent, dim && styles.rowContentDim]}>
        <View style={styles.rowHeader}>
          <Text
            style={[styles.rowLabel, dim && styles.dimText]}
            numberOfLines={1}
          >
            {item.label}
          </Text>
          {item.status && (
            <View style={[styles.statusPill, dim && styles.statusPillDim]}>
              <Text style={[styles.statusText, dim && styles.dimText]}>{item.status}</Text>
            </View>
          )}
        </View>
        {item.sublabel ? (
          <Text
            style={[styles.rowSublabel, dim && styles.dimText]}
            numberOfLines={1}
          >
            {item.sublabel}
          </Text>
        ) : null}
        <Text style={[styles.rowDate, dim && styles.dimText]}>{item.date}</Text>
      </View>
      {tappable && (
        <Ionicons name="chevron-forward" size={16} color={COLORS.text.tertiary} />
      )}
    </RowWrap>
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
    marginBottom: 10,
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
  empty: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    paddingVertical: 8,
  },
  section: {
    marginTop: 6,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 8,
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
    paddingVertical: 8,
  },
  rail: {
    width: 10,
    alignItems: 'center',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 4,
    zIndex: 1,
  },
  rail__line: {
    position: 'absolute',
    top: 12,
    bottom: 0,
    left: 4,
    width: 2,
    backgroundColor: COLORS.border.DEFAULT,
  },
  rowContent: {
    flex: 1,
  },
  rowContentDim: {
    opacity: 0.9,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowLabel: {
    flex: 1,
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  rowSublabel: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    marginTop: 2,
  },
  rowDate: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginTop: 2,
  },
  dimText: {
    color: COLORS.text.secondary,
  },
  statusPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: COLORS.primary.DEFAULT + '14',
  },
  statusPillDim: {
    backgroundColor: COLORS.surface.muted,
  },
  statusText: {
    fontSize: 10,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.primary.DEFAULT,
    textTransform: 'capitalize',
  },
});
