import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import type { AnswerCardAction, TableCard } from '@/lib/types/ask';
import { CARD_SHADOW, FLAG_COLORS, flagColorFromString, formatFlagLabel } from './askCardShared';

interface LabTableCardProps {
  card: TableCard;
  onActionPress?: (action: AnswerCardAction) => void;
}

function formatRelative(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function isOverAYearOld(iso: string | null): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t > 365 * 24 * 60 * 60 * 1000;
}

export function LabTableCard({ card, onActionPress }: LabTableCardProps) {
  const viewSource = card.actions.find((a) => a.type === 'view_source');
  const dateLine = formatRelative(card.dateRelevant);

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.iconWrap}>
          <Ionicons name="flask-outline" size={18} color={COLORS.primary.DEFAULT} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={2}>{card.title}</Text>
          {dateLine && <Text style={styles.date}>{dateLine}</Text>}
        </View>
      </View>

      {/* Table */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.table}>
          {/* Header row */}
          <View style={[styles.row, styles.headerRow]}>
            {card.columns.map((col) => (
              <Text
                key={col.key}
                style={[
                  styles.headerCell,
                  styles[`col_${col.key}` as keyof typeof styles] as object,
                  col.align === 'right' && { textAlign: 'right' },
                  col.align === 'center' && { textAlign: 'center' },
                ]}
              >
                {col.label}
              </Text>
            ))}
          </View>

          {/* Data rows */}
          {card.rows.map((row, rowIdx) => {
            const flagColor = row.flagColor ?? flagColorFromString(row.flag);
            const flagPalette = FLAG_COLORS[flagColor];
            const isAbnormal = flagColor !== 'normal' && row.flag;
            return (
              <View
                key={rowIdx}
                style={[
                  styles.row,
                  rowIdx % 2 === 0 && styles.rowEven,
                  rowIdx === card.rows.length - 1 && styles.rowLast,
                ]}
              >
                {card.columns.map((col) => {
                  const raw = row.values[col.key];
                  const text = raw == null ? '—' : String(raw);
                  const isFlagCol = col.key === 'flag';
                  const isValueCol = col.key === 'value';
                  const valueStyle = isAbnormal && isValueCol
                    ? { color: flagPalette.text, fontWeight: FONT_WEIGHTS.semibold }
                    : undefined;
                  return (
                    <View
                      key={col.key}
                      style={[
                        styles.cellWrap,
                        styles[`col_${col.key}` as keyof typeof styles] as object,
                      ]}
                    >
                      {isFlagCol && row.flag ? (
                        <View
                          style={[
                            styles.flagPill,
                            { backgroundColor: flagPalette.bg },
                          ]}
                        >
                          <Text style={[styles.flagText, { color: flagPalette.text }]}>
                            {formatFlagLabel(row.flag)}
                          </Text>
                        </View>
                      ) : (
                        <Text
                          style={[
                            styles.cellText,
                            col.align === 'right' && { textAlign: 'right' },
                            col.align === 'center' && { textAlign: 'center' },
                            valueStyle,
                          ]}
                        >
                          {text}
                        </Text>
                      )}
                    </View>
                  );
                })}
              </View>
            );
          })}
        </View>
      </ScrollView>

      {isOverAYearOld(card.dateRelevant) && (
        <View style={styles.ageNote}>
          <Ionicons name="time-outline" size={12} color={COLORS.text.tertiary} />
          <Text style={styles.ageNoteText}>These results are over a year old</Text>
        </View>
      )}

      {/* Provenance footer */}
      <View style={styles.footer}>
        <View style={styles.provenanceRow}>
          <Ionicons name="document-attach-outline" size={12} color={COLORS.text.tertiary} />
          <Text style={styles.provenanceText}>{card.provenance.sourceLabel}</Text>
        </View>
        {viewSource && viewSource.targetRoute && (
          <TouchableOpacity
            style={styles.viewSource}
            activeOpacity={0.7}
            onPress={() => onActionPress?.(viewSource)}
          >
            <Text style={styles.viewSourceText}>View source</Text>
            <Ionicons name="arrow-forward-outline" size={13} color={COLORS.primary.DEFAULT} />
          </TouchableOpacity>
        )}
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
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  date: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginTop: 2,
  },
  table: {
    minWidth: '100%',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.light,
  },
  rowEven: {
    backgroundColor: COLORS.surface.muted,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  headerRow: {
    backgroundColor: COLORS.background.DEFAULT,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.DEFAULT,
  },
  headerCell: {
    fontSize: 11,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 10,
  },
  cellWrap: {
    paddingHorizontal: 10,
    justifyContent: 'center',
  },
  cellText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
  },
  col_analyte: {
    minWidth: 140,
    maxWidth: 160,
  },
  col_value: {
    minWidth: 90,
  },
  col_ref: {
    minWidth: 110,
  },
  col_flag: {
    minWidth: 90,
    alignItems: 'flex-end',
  },
  flagPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    alignSelf: 'flex-end',
  },
  flagText: {
    fontSize: 11,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border.light,
  },
  ageNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
  },
  ageNoteText: {
    fontSize: 11,
    color: COLORS.text.tertiary,
    fontStyle: 'italic',
  },
  provenanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flex: 1,
  },
  provenanceText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
  },
  viewSource: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  viewSourceText: {
    fontSize: 12,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.primary.DEFAULT,
  },
});
