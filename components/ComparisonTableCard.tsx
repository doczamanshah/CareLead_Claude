import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import type { ComparisonTableCard as ComparisonTableCardType } from '@/lib/types/ask';
import { CARD_SHADOW, FLAG_COLORS, flagColorFromString } from './askCardShared';

interface ComparisonTableCardProps {
  card: ComparisonTableCardType;
}

const ANALYTE_COL_WIDTH = 140;
const VALUE_COL_WIDTH = 100;

export function ComparisonTableCard({ card }: ComparisonTableCardProps) {
  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.iconWrap}>
          <Ionicons name="git-compare-outline" size={18} color={COLORS.primary.DEFAULT} />
        </View>
        <Text style={styles.title} numberOfLines={2}>{card.title}</Text>
      </View>

      {/* Table body */}
      <View style={styles.tableWrap}>
        {/* Sticky analyte column */}
        <View style={styles.analyteCol}>
          <View style={[styles.headerCell, styles.analyteHeader]}>
            <Text style={styles.headerText} numberOfLines={1}>Analyte</Text>
          </View>
          {card.analyteNames.map((name, i) => (
            <View
              key={name}
              style={[
                styles.bodyCell,
                styles.analyteCell,
                i % 2 === 0 && styles.rowEven,
                i === card.analyteNames.length - 1 && styles.rowLast,
              ]}
            >
              <Text style={styles.analyteText} numberOfLines={2}>{name}</Text>
            </View>
          ))}
        </View>

        {/* Scrollable values */}
        <ScrollView horizontal showsHorizontalScrollIndicator>
          <View>
            {/* Date header row */}
            <View style={styles.row}>
              {card.dates.map((d) => (
                <View key={d} style={[styles.headerCell, styles.valueHeader]}>
                  <Text style={styles.headerText} numberOfLines={1}>{d}</Text>
                </View>
              ))}
            </View>
            {/* Data rows */}
            {card.analyteNames.map((name, i) => (
              <View
                key={name}
                style={[
                  styles.row,
                  i % 2 === 0 && styles.rowEven,
                  i === card.analyteNames.length - 1 && styles.rowLast,
                ]}
              >
                {card.dates.map((d) => {
                  const cell = card.values[name]?.[d];
                  const flagColor = cell?.flag ? flagColorFromString(cell.flag) : 'normal';
                  const isAbnormal = cell?.flag && cell.flag.toLowerCase() !== 'normal';
                  const palette = FLAG_COLORS[flagColor];
                  return (
                    <View key={`${name}-${d}`} style={[styles.bodyCell, styles.valueCell]}>
                      {cell ? (
                        <Text
                          style={[
                            styles.valueText,
                            isAbnormal && { color: palette.text, fontWeight: FONT_WEIGHTS.semibold },
                          ]}
                          numberOfLines={1}
                        >
                          {cell.value}
                        </Text>
                      ) : (
                        <Text style={styles.valueMissing}>—</Text>
                      )}
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        </ScrollView>
      </View>

      {/* Provenance */}
      <View style={styles.footer}>
        <Ionicons name="document-attach-outline" size={12} color={COLORS.text.tertiary} />
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
    marginBottom: 12,
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
  tableWrap: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: COLORS.border.light,
    borderRadius: 8,
    overflow: 'hidden',
  },
  analyteCol: {
    width: ANALYTE_COL_WIDTH,
    borderRightWidth: 1,
    borderRightColor: COLORS.border.DEFAULT,
    backgroundColor: COLORS.surface.DEFAULT,
  },
  row: {
    flexDirection: 'row',
  },
  rowEven: {
    backgroundColor: COLORS.surface.muted,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  headerCell: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: COLORS.background.DEFAULT,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.DEFAULT,
    justifyContent: 'center',
  },
  analyteHeader: {
    width: ANALYTE_COL_WIDTH,
  },
  valueHeader: {
    width: VALUE_COL_WIDTH,
  },
  headerText: {
    fontSize: 11,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  bodyCell: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.light,
    justifyContent: 'center',
  },
  analyteCell: {
    width: ANALYTE_COL_WIDTH,
  },
  valueCell: {
    width: VALUE_COL_WIDTH,
  },
  analyteText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.DEFAULT,
  },
  valueText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
  },
  valueMissing: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.tertiary,
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
