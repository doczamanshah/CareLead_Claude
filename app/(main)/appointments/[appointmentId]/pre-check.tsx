/**
 * Pre-Appointment Profile Accuracy Check Screen
 *
 * Before an upcoming visit, walks the patient through a focused checklist:
 * medications, allergies, conditions, insurance, care team, questions ready,
 * and documents to bring. Items are grouped by status — what needs attention
 * first, then what's already in good shape.
 *
 * The screen is refresh-aware — every time it gains focus it re-runs the
 * check via TanStack Query invalidation, so updates made in linked screens
 * (medications, capture, etc.) show up without a reload.
 */

import { useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useAppointmentDetail } from '@/hooks/useAppointments';
import { usePreAppointmentCheck } from '@/hooks/usePreAppointmentCheck';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import type {
  PreAppointmentCheckItem,
  PreAppointmentCheckStatus,
} from '@/lib/types/appointments';

const STATUS_ORDER: Record<PreAppointmentCheckStatus, number> = {
  missing: 0,
  action_needed: 1,
  stale: 2,
  good: 3,
};

const STATUS_ICON: Record<
  PreAppointmentCheckStatus,
  keyof typeof import('@expo/vector-icons').Ionicons.glyphMap
> = {
  good: 'checkmark-circle',
  stale: 'warning',
  missing: 'alert-circle',
  action_needed: 'information-circle',
};

const STATUS_COLOR: Record<PreAppointmentCheckStatus, string> = {
  good: COLORS.success.DEFAULT,
  stale: COLORS.accent.dark,
  missing: COLORS.error.DEFAULT,
  action_needed: COLORS.primary.DEFAULT,
};

const STATUS_BACKGROUND: Record<PreAppointmentCheckStatus, string> = {
  good: COLORS.success.DEFAULT + '0D',
  stale: COLORS.accent.DEFAULT + '14',
  missing: COLORS.error.DEFAULT + '14',
  action_needed: COLORS.primary.DEFAULT + '0D',
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function PreCheckScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { appointmentId } = useLocalSearchParams<{ appointmentId: string }>();
  const { activeProfileId, activeProfile } = useActiveProfile();
  const { data: appointment, isLoading: apptLoading } = useAppointmentDetail(
    appointmentId ?? null,
  );

  const {
    data: checkResult,
    isLoading: checkLoading,
    refetch,
  } = usePreAppointmentCheck(
    activeProfileId,
    activeProfile?.household_id ?? null,
    appointmentId ?? null,
    appointment?.start_time ?? null,
    appointment?.provider_name ?? null,
  );

  // Re-run the check every time the screen regains focus. Users bounce out to
  // update medications / add questions / etc. and come back — the status
  // should reflect what they just changed.
  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  const sortedItems = useMemo(() => {
    if (!checkResult?.items) return [];
    return [...checkResult.items].sort(
      (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
    );
  }, [checkResult]);

  const handleAction = useCallback(
    (item: PreAppointmentCheckItem) => {
      if (!item.actionRoute) return;
      router.push(item.actionRoute as never);
    },
    [router],
  );

  const handleMarkReady = useCallback(() => {
    if (activeProfileId) {
      queryClient.invalidateQueries({
        queryKey: ['preAppointmentBriefing', activeProfileId],
      });
    }
    router.back();
  }, [activeProfileId, queryClient, router]);

  if (apptLoading || checkLoading || !appointment || !checkResult) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.navBar}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backButton}
          >
            <Text style={styles.backText}>{'\u2039'} Back</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.primary.DEFAULT} />
        </View>
      </SafeAreaView>
    );
  }

  const { isReady, completedCount, totalCount } = checkResult;
  const progressPercent = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.navBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>{'\u2039'} Back</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle} numberOfLines={1}>
          Pre-Visit Check
        </Text>
        <View style={styles.navSpacer} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.heading}>Get ready for your visit</Text>
          <Text style={styles.subheading}>
            {appointment.provider_name ? `With ${appointment.provider_name}` : appointment.title}
          </Text>
          <Text style={styles.dateTimeText}>
            {formatDateTime(appointment.start_time)}
          </Text>

          <View style={styles.progressCard}>
            <View style={styles.progressHeader}>
              <Text style={styles.progressLabel}>
                {completedCount} of {totalCount} ready
              </Text>
              {isReady && (
                <View style={styles.readyBadge}>
                  <Ionicons
                    name="checkmark-circle"
                    size={16}
                    color={COLORS.success.DEFAULT}
                  />
                  <Text style={styles.readyBadgeText}>All set</Text>
                </View>
              )}
            </View>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${progressPercent}%`,
                    backgroundColor: isReady
                      ? COLORS.success.DEFAULT
                      : COLORS.primary.DEFAULT,
                  },
                ]}
              />
            </View>
          </View>
        </View>

        <View style={styles.itemsSection}>
          {sortedItems.map((item) => (
            <CheckItemCard
              key={item.id}
              item={item}
              onAction={() => handleAction(item)}
            />
          ))}
        </View>

        <View style={styles.footer}>
          <Button
            title={isReady ? "I'm ready — looks great!" : "Looks good — I'm ready!"}
            onPress={handleMarkReady}
          />
          <TouchableOpacity
            style={styles.laterButton}
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <Text style={styles.laterText}>I'll do this later</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function CheckItemCard({
  item,
  onAction,
}: {
  item: PreAppointmentCheckItem;
  onAction: () => void;
}) {
  const isGood = item.status === 'good';
  const iconName = STATUS_ICON[item.status];
  const tint = STATUS_COLOR[item.status];
  const background = STATUS_BACKGROUND[item.status];

  if (isGood) {
    return (
      <Card style={{ ...styles.itemCard, backgroundColor: background }}>
        <View style={styles.itemRow}>
          <Ionicons name={iconName} size={20} color={tint} />
          <Text style={styles.itemTitleGood} numberOfLines={1}>
            {item.title}
          </Text>
        </View>
      </Card>
    );
  }

  return (
    <Card style={{ ...styles.itemCard, backgroundColor: background }}>
      <View style={styles.itemRow}>
        <Ionicons name={iconName} size={22} color={tint} />
        <View style={styles.itemBody}>
          <Text style={styles.itemTitle}>{item.title}</Text>
          <Text style={styles.itemDetail}>{item.detail}</Text>
        </View>
      </View>
      {item.actionLabel && item.actionRoute && (
        <View style={styles.itemActionRow}>
          <Button
            title={item.actionLabel}
            variant="outline"
            size="sm"
            onPress={onAction}
          />
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background.DEFAULT },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  navBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  backButton: { paddingVertical: 4, paddingRight: 16 },
  backText: {
    fontSize: FONT_SIZES.lg,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  navTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    flex: 1,
    textAlign: 'center',
  },
  navSpacer: { width: 60 },
  scrollView: { flex: 1 },
  content: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 40,
  },
  header: { marginBottom: 20 },
  heading: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    marginBottom: 4,
  },
  subheading: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.DEFAULT,
  },
  dateTimeText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginTop: 2,
  },
  progressCard: {
    backgroundColor: COLORS.surface.DEFAULT,
    borderRadius: 12,
    padding: 16,
    marginTop: 20,
    borderWidth: 1,
    borderColor: COLORS.border.light,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  progressLabel: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  readyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.success.DEFAULT + '14',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  readyBadgeText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.success.DEFAULT,
  },
  progressTrack: {
    height: 6,
    backgroundColor: COLORS.border.light,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  itemsSection: {
    gap: 10,
    marginBottom: 24,
  },
  itemCard: {
    borderWidth: 0,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  itemBody: {
    flex: 1,
    gap: 4,
  },
  itemTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  itemTitleGood: {
    flex: 1,
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.secondary,
  },
  itemDetail: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    lineHeight: 20,
  },
  itemActionRow: {
    marginTop: 12,
    alignItems: 'flex-start',
  },
  footer: {
    gap: 12,
  },
  laterButton: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  laterText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
  },
});
