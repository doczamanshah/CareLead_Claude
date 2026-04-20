/**
 * Milestone celebration toast — replaces the persistent milestone card.
 *
 * Watches the smart-enrichment unseen milestones list. When a new milestone
 * appears, fades in for `VISIBLE_MS`, then fades out and marks it seen so
 * it doesn't reappear next session.
 */

import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useSmartEnrichment, getMilestone } from '@/hooks/useSmartEnrichment';
import type { MilestoneId } from '@/services/smartEnrichment';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

const VISIBLE_MS = 3000;
const FADE_MS = 250;

export function MilestoneToast() {
  const insets = useSafeAreaInsets();
  const { activeProfile, activeProfileId } = useActiveProfile();
  const { unseenMilestones, markSeen } = useSmartEnrichment(
    activeProfileId,
    activeProfile?.household_id ?? null,
  );

  const opacity = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState<MilestoneId | null>(null);
  const handledRef = useRef<Set<MilestoneId>>(new Set());

  const next = unseenMilestones[0] ?? null;

  useEffect(() => {
    if (!next) return;
    if (handledRef.current.has(next)) return;
    handledRef.current.add(next);
    setShown(next);

    Animated.sequence([
      Animated.timing(opacity, {
        toValue: 1,
        duration: FADE_MS,
        useNativeDriver: true,
      }),
      Animated.delay(VISIBLE_MS),
      Animated.timing(opacity, {
        toValue: 0,
        duration: FADE_MS,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setShown(null);
      // Fire-and-forget — server-side flag prevents future surfacing.
      void markSeen([next]);
    });
  }, [next, opacity, markSeen]);

  if (!shown) return null;
  const meta = getMilestone(shown);
  if (!meta) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.toast,
        { opacity, top: insets.top + 8 },
      ]}
    >
      <View style={styles.iconWrap}>
        <Ionicons
          name={meta.icon as keyof typeof Ionicons.glyphMap}
          size={18}
          color={COLORS.accent.dark}
        />
      </View>
      <View style={styles.textWrap}>
        <Text style={styles.title} numberOfLines={1}>
          {meta.title}
        </Text>
        {meta.detail && (
          <Text style={styles.detail} numberOfLines={1}>
            {meta.detail}
          </Text>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: COLORS.surface.DEFAULT,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.accent.DEFAULT + '40',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 100,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.accent.DEFAULT + '20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: {
    flex: 1,
  },
  title: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
  },
  detail: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    marginTop: 1,
  },
});
