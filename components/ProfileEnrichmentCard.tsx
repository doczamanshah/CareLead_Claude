/**
 * ProfileEnrichmentCard
 *
 * Non-intrusive card surfaced on bill/result/document detail screens after
 * extraction completes. Lists profile-relevant facts the system noticed in
 * the document but that don't belong to the document's primary domain
 * (e.g., a cardiologist's name on a hospital bill). Each row is a one-tap
 * Add or Dismiss — no forms, no confirmations.
 *
 * The card is collapsible (auto-expanded on first surface) and self-hides
 * when its list empties.
 */

import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import {
  ENRICHMENT_CATEGORY_META,
  type ProfileEnrichmentSuggestion,
} from '@/lib/types/enrichment';

interface ProfileEnrichmentCardProps {
  suggestions: ProfileEnrichmentSuggestion[];
  /** Human-readable source descriptor for the subtitle (e.g., "bill", "lab result"). */
  sourceLabel: string;
  /** Called when the user taps Add. Should create the profile fact and resolve when done. */
  onAccept: (suggestion: ProfileEnrichmentSuggestion) => Promise<void> | void;
  onDismiss: (suggestion: ProfileEnrichmentSuggestion) => void;
  onDismissAll: () => void;
}

export function ProfileEnrichmentCard({
  suggestions,
  sourceLabel,
  onAccept,
  onDismiss,
  onDismissAll,
}: ProfileEnrichmentCardProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [justAddedId, setJustAddedId] = useState<string | null>(null);

  if (suggestions.length === 0) return null;

  async function handleAccept(s: ProfileEnrichmentSuggestion) {
    if (pendingId) return;
    setPendingId(s.id);
    try {
      await onAccept(s);
      setJustAddedId(s.id);
      setTimeout(() => setJustAddedId(null), 1200);
    } finally {
      setPendingId(null);
    }
  }

  return (
    <View style={styles.wrapper}>
      <Card style={styles.card}>
        <TouchableOpacity
          activeOpacity={0.7}
          style={styles.header}
          onPress={() => setCollapsed((c) => !c)}
        >
          <View style={styles.headerLeft}>
            <View style={styles.iconBubble}>
              <Ionicons name="sparkles" size={16} color={COLORS.secondary.dark} />
            </View>
            <View style={styles.headerText}>
              <Text style={styles.title}>Profile updates found</Text>
              <Text style={styles.subtitle}>
                Based on your recent {sourceLabel}
              </Text>
            </View>
          </View>
          <View style={styles.headerRight}>
            <View style={styles.countBadge}>
              <Text style={styles.countText}>{suggestions.length}</Text>
            </View>
            <Ionicons
              name={collapsed ? 'chevron-down' : 'chevron-up'}
              size={18}
              color={COLORS.text.secondary}
            />
          </View>
        </TouchableOpacity>

        {!collapsed && (
          <View style={styles.list}>
            {suggestions.map((s) => {
              const meta = ENRICHMENT_CATEGORY_META[s.category];
              const isPending = pendingId === s.id;
              const justAdded = justAddedId === s.id;
              return (
                <View key={s.id} style={styles.row}>
                  <View style={styles.rowIconBubble}>
                    <Ionicons
                      name={meta.icon as keyof typeof Ionicons.glyphMap}
                      size={18}
                      color={COLORS.primary.DEFAULT}
                    />
                  </View>
                  <View style={styles.rowContent}>
                    <View style={styles.titleRow}>
                      <Text style={styles.rowTitle} numberOfLines={2}>
                        {s.displayTitle}
                      </Text>
                      {s.confidence < 0.6 && (
                        <View style={styles.lowConfidenceBadge}>
                          <Text style={styles.lowConfidenceText}>?</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.rowDetail} numberOfLines={1}>
                      {s.displayDetail}
                    </Text>
                  </View>
                  {justAdded ? (
                    <View style={styles.addedConfirm}>
                      <Ionicons
                        name="checkmark-circle"
                        size={20}
                        color={COLORS.success.DEFAULT}
                      />
                      <Text style={styles.addedText}>Added</Text>
                    </View>
                  ) : (
                    <View style={styles.actions}>
                      <TouchableOpacity
                        style={[styles.addButton, isPending && styles.addButtonDisabled]}
                        activeOpacity={0.7}
                        disabled={isPending}
                        onPress={() => handleAccept(s)}
                      >
                        {isPending ? (
                          <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : (
                          <Text style={styles.addButtonText}>Add</Text>
                        )}
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.dismissButton}
                        activeOpacity={0.7}
                        disabled={isPending}
                        onPress={() => onDismiss(s)}
                      >
                        <Ionicons
                          name="close"
                          size={18}
                          color={COLORS.text.tertiary}
                        />
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })}

            {suggestions.length > 1 && (
              <TouchableOpacity
                onPress={onDismissAll}
                activeOpacity={0.7}
                style={styles.dismissAllRow}
              >
                <Text style={styles.dismissAllText}>Dismiss all</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: 24,
    marginBottom: 16,
  },
  card: {
    padding: 0,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  iconBubble: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.secondary.DEFAULT + '20',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
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
    color: COLORS.text.secondary,
    marginTop: 2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  countBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.secondary.DEFAULT + '33',
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.secondary.dark,
  },
  list: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border.light,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.light,
  },
  rowIconBubble: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.primary.DEFAULT + '14',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rowContent: {
    flex: 1,
    marginRight: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rowTitle: {
    flexShrink: 1,
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.DEFAULT,
  },
  lowConfidenceBadge: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.text.tertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lowConfidenceText: {
    fontSize: 10,
    color: COLORS.text.tertiary,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  rowDetail: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  addButton: {
    backgroundColor: COLORS.success.DEFAULT,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    minWidth: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonDisabled: {
    opacity: 0.6,
  },
  addButtonText: {
    color: '#FFFFFF',
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  dismissButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addedConfirm: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
  },
  addedText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.success.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  dismissAllRow: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  dismissAllText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
  },
});
