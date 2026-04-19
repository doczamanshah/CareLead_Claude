import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import type {
  BriefingLine,
  BriefingLineTone,
  DailyBriefing,
} from '@/services/dailyBriefing';

interface Props {
  briefing: DailyBriefing;
  dateLabel: string;
  onViewDetails: () => void;
  onAsk?: () => void;
  onPrioritiesPress?: () => void;
}

const toneColors: Record<BriefingLineTone, string> = {
  default: COLORS.text.DEFAULT,
  warning: COLORS.accent.dark,
  critical: COLORS.error.DEFAULT,
  success: COLORS.success.DEFAULT,
};

const toneIconColors: Record<BriefingLineTone, string> = {
  default: COLORS.primary.DEFAULT,
  warning: COLORS.accent.dark,
  critical: COLORS.error.DEFAULT,
  success: COLORS.success.DEFAULT,
};

export function DailyBriefingCard({
  briefing,
  dateLabel,
  onViewDetails,
  onAsk,
  onPrioritiesPress,
}: Props) {
  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.8}
      onPress={onViewDetails}
    >
      <View style={styles.accent} />
      <View style={styles.content}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.greeting}>{briefing.greeting}</Text>
            <Text style={styles.dateLabel}>{dateLabel}</Text>
          </View>
          <Ionicons
            name="chevron-forward"
            size={20}
            color={COLORS.text.tertiary}
          />
        </View>

        {briefing.leadIn && (
          <Text style={styles.leadIn}>{briefing.leadIn}</Text>
        )}

        {briefing.isQuiet ? (
          <View style={styles.allClear}>
            <Ionicons
              name="checkmark-circle"
              size={24}
              color={COLORS.success.DEFAULT}
            />
            <Text style={styles.allClearText}>
              All caught up — nothing pressing today.
            </Text>
          </View>
        ) : (
          <View style={styles.body}>
            {briefing.immediate.length > 0 && (
              <View style={styles.section}>
                {briefing.immediate.map((line) => (
                  <Line key={line.key} line={line} />
                ))}
              </View>
            )}

            {briefing.outlook && (
              <View style={styles.section}>
                <Line line={briefing.outlook} />
              </View>
            )}

            {briefing.priorityUpdate && (
              <View style={styles.section}>
                <Line line={briefing.priorityUpdate} />
              </View>
            )}

            {briefing.encouragement && (
              <View style={[styles.section, styles.encouragementBg]}>
                <Line line={briefing.encouragement} />
              </View>
            )}
          </View>
        )}

        {briefing.priorityStalePrompt && onPrioritiesPress && (
          <TouchableOpacity
            style={styles.stalePrompt}
            onPress={(e) => {
              e.stopPropagation?.();
              onPrioritiesPress();
            }}
            activeOpacity={0.7}
          >
            <Ionicons
              name="refresh-outline"
              size={16}
              color={COLORS.text.secondary}
            />
            <Text style={styles.stalePromptText}>
              {briefing.priorityStalePrompt.text}
            </Text>
            <Ionicons
              name="chevron-forward"
              size={14}
              color={COLORS.text.tertiary}
            />
          </TouchableOpacity>
        )}

        {onAsk && (briefing.isQuiet || briefing.immediate.length < 2) && (
          <TouchableOpacity
            style={styles.askPrompt}
            onPress={(e) => {
              e.stopPropagation?.();
              onAsk();
            }}
            activeOpacity={0.7}
          >
            <Ionicons
              name="chatbubble-ellipses-outline"
              size={16}
              color={COLORS.primary.DEFAULT}
            />
            <Text style={styles.askPromptText}>
              Need something? Ask CareLead anything about your profile.
            </Text>
          </TouchableOpacity>
        )}

        <View style={styles.footer}>
          <Text style={styles.footerText}>View details</Text>
          <Ionicons
            name="chevron-forward"
            size={16}
            color={COLORS.primary.DEFAULT}
          />
        </View>
      </View>
    </TouchableOpacity>
  );
}

function Line({ line }: { line: BriefingLine }) {
  return (
    <View style={styles.line}>
      <Ionicons
        name={line.icon as keyof typeof Ionicons.glyphMap}
        size={18}
        color={toneIconColors[line.tone]}
      />
      <Text style={[styles.lineText, { color: toneColors[line.tone] }]}>
        {line.text}
      </Text>
    </View>
  );
}

const CARD_SHADOW = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.08,
  shadowRadius: 8,
  elevation: 3,
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface.DEFAULT,
    borderRadius: 12,
    flexDirection: 'row',
    overflow: 'hidden',
    ...CARD_SHADOW,
  },
  accent: {
    width: 4,
    backgroundColor: COLORS.secondary.DEFAULT,
  },
  content: {
    flex: 1,
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  headerText: {
    flex: 1,
  },
  greeting: {
    fontSize: FONT_SIZES.xl,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  dateLabel: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.tertiary,
    marginTop: 2,
  },
  leadIn: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.primary.DEFAULT,
    marginBottom: 12,
  },
  body: {
    gap: 12,
  },
  section: {
    gap: 10,
  },
  encouragementBg: {
    backgroundColor: COLORS.success.light,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  allClear: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.success.light,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  allClearText: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.success.DEFAULT,
    flex: 1,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  lineText: {
    fontSize: FONT_SIZES.base,
    flex: 1,
    lineHeight: 20,
  },
  askPrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: COLORS.primary.DEFAULT + '0D',
    borderWidth: 1,
    borderColor: COLORS.primary.DEFAULT + '20',
  },
  stalePrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: COLORS.surface.muted,
    borderWidth: 1,
    borderColor: COLORS.border.light,
  },
  stalePromptText: {
    flex: 1,
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
  },
  askPromptText: {
    flex: 1,
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 14,
    gap: 4,
  },
  footerText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
});
