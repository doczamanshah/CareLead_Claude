import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS } from '@/lib/constants/colors';
import { RADIUS, SPACING, TYPOGRAPHY } from '@/lib/constants/design';

interface SectionHeaderProps {
  title: string;
  /** Optional right-aligned text button. */
  action?: { label: string; onPress: () => void };
  /** Optional count badge displayed next to the title. */
  count?: number;
}

export function SectionHeader({ title, action, count }: SectionHeaderProps) {
  return (
    <View style={styles.row}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>{title}</Text>
        {typeof count === 'number' && count > 0 && (
          <View style={styles.countBadge}>
            <Text style={styles.countText}>{count}</Text>
          </View>
        )}
      </View>
      {action && (
        <TouchableOpacity onPress={action.onPress} hitSlop={8} activeOpacity={0.7}>
          <Text style={styles.action}>{action.label}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  title: {
    ...TYPOGRAPHY.label,
    color: COLORS.text.secondary,
  },
  countBadge: {
    minWidth: 18,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.background.subtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: {
    ...TYPOGRAPHY.caption,
    fontWeight: '600',
    color: COLORS.text.secondary,
  },
  action: {
    ...TYPOGRAPHY.buttonSmall,
    color: COLORS.primary.DEFAULT,
  },
});
