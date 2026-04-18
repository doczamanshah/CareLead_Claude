import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, LayoutChangeEvent } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import type { AnswerCardAction, TrendChartCard as TrendChartCardType, TrendDataPoint } from '@/lib/types/ask';
import { CARD_SHADOW, FLAG_COLORS, flagColorFromString } from './askCardShared';

interface TrendChartCardProps {
  card: TrendChartCardType;
  onActionPress?: (action: AnswerCardAction) => void;
}

const CHART_HEIGHT = 180;
const PADDING_LEFT = 40;
const PADDING_RIGHT = 16;
const PADDING_TOP = 16;
const PADDING_BOTTOM = 32;

function formatDateShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDateLong(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function TrendChartCard({ card, onActionPress }: TrendChartCardProps) {
  const [chartWidth, setChartWidth] = useState(320);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && Math.abs(w - chartWidth) > 1) setChartWidth(w);
  };

  const points = card.dataPoints;
  const hasRange = card.refRangeLow != null && card.refRangeHigh != null;

  // Compute Y range
  const values = points.map((p) => p.value);
  const rangeVals: number[] = [...values];
  if (card.refRangeLow != null) rangeVals.push(card.refRangeLow);
  if (card.refRangeHigh != null) rangeVals.push(card.refRangeHigh);
  const rawMin = Math.min(...rangeVals);
  const rawMax = Math.max(...rangeVals);
  const span = rawMax - rawMin || 1;
  const minY = rawMin - span * 0.15;
  const maxY = rawMax + span * 0.15;

  const innerW = Math.max(0, chartWidth - PADDING_LEFT - PADDING_RIGHT);
  const innerH = CHART_HEIGHT - PADDING_TOP - PADDING_BOTTOM;

  // Positions
  function xAt(i: number): number {
    if (points.length === 1) return PADDING_LEFT + innerW / 2;
    return PADDING_LEFT + (i / (points.length - 1)) * innerW;
  }
  function yAt(value: number): number {
    return PADDING_TOP + innerH - ((value - minY) / (maxY - minY)) * innerH;
  }

  // Path data for the polyline
  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i)} ${yAt(p.value)}`)
    .join(' ');

  // Reference band
  const refBand = hasRange
    ? {
        y: yAt(card.refRangeHigh!),
        height: yAt(card.refRangeLow!) - yAt(card.refRangeHigh!),
      }
    : null;

  // Y-axis ticks (4 evenly spaced)
  const tickCount = 4;
  const yTicks = Array.from({ length: tickCount }, (_, i) => {
    const value = minY + ((maxY - minY) * i) / (tickCount - 1);
    return { value, y: yAt(value) };
  });

  // Determine which X labels to show (cap at 6)
  const xLabelStride = Math.max(1, Math.ceil(points.length / 6));

  const selected = selectedIdx != null ? points[selectedIdx] : null;
  const limitedData = points.length < 4;

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.iconWrap}>
          <Ionicons name="trending-up-outline" size={18} color={COLORS.primary.DEFAULT} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title}>{card.title}</Text>
          {card.unit ? <Text style={styles.subtitle}>Unit: {card.unit}</Text> : null}
        </View>
        <Text style={styles.count}>{points.length} readings</Text>
      </View>

      {limitedData && (
        <View style={styles.noticeRow}>
          <Ionicons name="information-circle-outline" size={12} color={COLORS.text.tertiary} />
          <Text style={styles.noticeText}>Limited data — {points.length} data point{points.length === 1 ? '' : 's'}.</Text>
        </View>
      )}

      {/* Chart */}
      <View style={styles.chartWrap} onLayout={onLayout}>
        {chartWidth > 0 && (
          <Svg width={chartWidth} height={CHART_HEIGHT}>
            {/* Reference range band */}
            {refBand && refBand.height > 0 && (
              <Rect
                x={PADDING_LEFT}
                y={refBand.y}
                width={innerW}
                height={refBand.height}
                fill={COLORS.success.DEFAULT}
                opacity={0.08}
              />
            )}

            {/* Y-axis gridlines + labels */}
            <G>
              {yTicks.map((t, i) => (
                <G key={i}>
                  <Line
                    x1={PADDING_LEFT}
                    y1={t.y}
                    x2={chartWidth - PADDING_RIGHT}
                    y2={t.y}
                    stroke={COLORS.border.light}
                    strokeWidth={1}
                  />
                  <SvgText
                    x={PADDING_LEFT - 6}
                    y={t.y + 3}
                    fontSize={10}
                    fill={COLORS.text.tertiary}
                    textAnchor="end"
                  >
                    {Math.round(t.value * 10) / 10}
                  </SvgText>
                </G>
              ))}
            </G>

            {/* X-axis baseline */}
            <Line
              x1={PADDING_LEFT}
              y1={CHART_HEIGHT - PADDING_BOTTOM}
              x2={chartWidth - PADDING_RIGHT}
              y2={CHART_HEIGHT - PADDING_BOTTOM}
              stroke={COLORS.border.DEFAULT}
              strokeWidth={1}
            />

            {/* X-axis labels */}
            {points.map((p, i) =>
              i % xLabelStride === 0 || i === points.length - 1 ? (
                <SvgText
                  key={`xl-${i}`}
                  x={xAt(i)}
                  y={CHART_HEIGHT - PADDING_BOTTOM + 14}
                  fontSize={10}
                  fill={COLORS.text.tertiary}
                  textAnchor="middle"
                >
                  {formatDateShort(p.date)}
                </SvgText>
              ) : null,
            )}

            {/* Line */}
            {points.length > 1 && (
              <Path
                d={pathD}
                stroke={COLORS.primary.DEFAULT}
                strokeWidth={2}
                fill="none"
              />
            )}

            {/* Data points */}
            {points.map((p, i) => {
              const flagColor = flagColorFromString(p.flag);
              const color = FLAG_COLORS[flagColor].text;
              const isSelected = selectedIdx === i;
              return (
                <Circle
                  key={`pt-${i}`}
                  cx={xAt(i)}
                  cy={yAt(p.value)}
                  r={isSelected ? 6 : 4}
                  fill={color}
                  stroke={COLORS.surface.DEFAULT}
                  strokeWidth={isSelected ? 2 : 1}
                  onPress={() => setSelectedIdx(i === selectedIdx ? null : i)}
                />
              );
            })}
          </Svg>
        )}
      </View>

      {/* Reference range legend */}
      {hasRange && (
        <View style={styles.legend}>
          <View style={[styles.legendSwatch, { backgroundColor: COLORS.success.DEFAULT, opacity: 0.3 }]} />
          <Text style={styles.legendText}>
            Reference range: {card.refRangeLow}–{card.refRangeHigh}
            {card.unit ? ` ${card.unit}` : ''}
          </Text>
        </View>
      )}

      {/* Selected point detail */}
      {selected && (
        <View style={styles.tooltip}>
          <Text style={styles.tooltipTitle}>
            {selected.value}
            {card.unit ? ` ${card.unit}` : ''}
          </Text>
          <Text style={styles.tooltipDate}>{formatDateLong(selected.date)}</Text>
          {selected.flag && selected.flag !== 'normal' && (
            <Text
              style={[
                styles.tooltipFlag,
                { color: FLAG_COLORS[flagColorFromString(selected.flag)].text },
              ]}
            >
              {selected.flag.toUpperCase()}
            </Text>
          )}
          {selected.sourceId && (
            <TouchableOpacity
              style={styles.tooltipLink}
              activeOpacity={0.7}
              onPress={() =>
                onActionPress?.({
                  type: 'view_source',
                  label: 'View source',
                  targetId: selected.sourceId,
                  targetRoute: `/(main)/results/${selected.sourceId}`,
                })
              }
            >
              <Text style={styles.tooltipLinkText}>View source</Text>
              <Ionicons name="arrow-forward-outline" size={12} color={COLORS.primary.DEFAULT} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Provenance footer */}
      <View style={styles.footer}>
        <Ionicons name="sparkles-outline" size={12} color={COLORS.text.tertiary} />
        <Text style={styles.footerText}>{card.provenance.sourceLabel}</Text>
        <Text style={styles.footerHint}>Tap a point for detail</Text>
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
    marginBottom: 8,
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
  subtitle: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginTop: 1,
  },
  count: {
    fontSize: 11,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.secondary,
  },
  noticeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 6,
  },
  noticeText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
  },
  chartWrap: {
    marginTop: 4,
    marginBottom: 4,
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  legendSwatch: {
    width: 14,
    height: 10,
    borderRadius: 2,
  },
  legendText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
  },
  tooltip: {
    marginTop: 10,
    padding: 10,
    backgroundColor: COLORS.surface.muted,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border.light,
  },
  tooltipTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
  },
  tooltipDate: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    marginTop: 2,
  },
  tooltipFlag: {
    fontSize: 11,
    fontWeight: FONT_WEIGHTS.semibold,
    marginTop: 4,
  },
  tooltipLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
  },
  tooltipLinkText: {
    fontSize: 12,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.primary.DEFAULT,
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
    flex: 1,
  },
  footerHint: {
    fontSize: 10,
    color: COLORS.text.tertiary,
    fontStyle: 'italic',
  },
});
