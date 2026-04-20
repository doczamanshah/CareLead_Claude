import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { COLORS } from '@/lib/constants/colors';
import { RADIUS, SHADOWS, SPACING, TYPOGRAPHY } from '@/lib/constants/design';
import type { NeedsAttentionItem } from '@/services/needsAttention';

interface NeedsAttentionListProps {
  items: NeedsAttentionItem[];
  /** Total count across all sources before slicing — used for "View N more". */
  totalCount: number;
  /** Where to send the user when they tap "View more" (defaults to Today). */
  viewMoreRoute?: string;
}

export function NeedsAttentionList({
  items,
  totalCount,
  viewMoreRoute = '/(main)/today',
}: NeedsAttentionListProps) {
  const router = useRouter();

  if (items.length === 0) return null;

  const remaining = Math.max(0, totalCount - items.length);

  const handleItemPress = (item: NeedsAttentionItem) => {
    if (item.routeParams) {
      router.push({ pathname: item.route, params: item.routeParams } as never);
    } else {
      router.push(item.route as never);
    }
  };

  return (
    <View style={styles.container}>
      <SectionHeader title="Needs your attention" />
      <View style={styles.card}>
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          return (
            <TouchableOpacity
              key={item.id}
              style={[styles.row, !isLast && styles.rowDivider]}
              activeOpacity={0.7}
              onPress={() => handleItemPress(item)}
            >
              <View style={[styles.dot, { backgroundColor: item.color }]} />
              <Text style={styles.title} numberOfLines={2}>
                {item.title}
              </Text>
              <Text style={styles.action}>{item.actionLabel}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {remaining > 0 && (
        <TouchableOpacity
          style={styles.viewMoreRow}
          activeOpacity={0.7}
          onPress={() => router.push(viewMoreRoute as never)}
        >
          <Text style={styles.viewMoreText}>View {remaining} more</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  card: {
    backgroundColor: COLORS.background.card,
    borderRadius: RADIUS.md,
    overflow: 'hidden',
    ...SHADOWS.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md - 2,
    minHeight: 44,
    gap: SPACING.md - 2,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border.light,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  title: {
    flex: 1,
    ...TYPOGRAPHY.body,
    color: COLORS.text.DEFAULT,
  },
  action: {
    ...TYPOGRAPHY.buttonSmall,
    color: COLORS.primary.DEFAULT,
  },
  viewMoreRow: {
    paddingVertical: SPACING.md - 2,
    alignItems: 'center',
  },
  viewMoreText: {
    ...TYPOGRAPHY.buttonSmall,
    color: COLORS.primary.DEFAULT,
  },
});
