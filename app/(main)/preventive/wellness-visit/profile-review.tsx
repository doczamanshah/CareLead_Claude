import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useProfileDetail } from '@/hooks/useProfileDetail';
import { useMedications } from '@/hooks/useMedications';
import { useWellnessVisitStore } from '@/stores/wellnessVisitStore';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import type { ProfileFact } from '@/lib/types/profile';

type SectionKey =
  | 'medications'
  | 'conditions'
  | 'allergies'
  | 'care_team'
  | 'insurance'
  | 'emergency_contact';

const SECTIONS: { key: SectionKey; title: string; icon: string }[] = [
  { key: 'medications', title: 'Medications', icon: 'medkit-outline' },
  { key: 'conditions', title: 'Conditions', icon: 'pulse-outline' },
  { key: 'allergies', title: 'Allergies', icon: 'warning-outline' },
  { key: 'care_team', title: 'Care Team', icon: 'people-outline' },
  { key: 'insurance', title: 'Insurance', icon: 'shield-outline' },
  {
    key: 'emergency_contact',
    title: 'Emergency Contacts',
    icon: 'call-outline',
  },
];

function getString(fact: ProfileFact, keys: string[]): string | null {
  const v = fact.value_json as Record<string, unknown>;
  for (const k of keys) {
    const raw = v[k];
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
  }
  return null;
}

export default function ProfileReviewScreen() {
  const router = useRouter();
  const { activeProfileId } = useActiveProfile();
  const { data: profile } = useProfileDetail(activeProfileId);
  const { data: meds } = useMedications(activeProfileId);

  const hydrate = useWellnessVisitStore((s) => s.hydrate);
  const hydrated = useWellnessVisitStore((s) => s.hydrated);
  const markStepCompleted = useWellnessVisitStore((s) => s.markStepCompleted);
  const markProfileReviewCompleted = useWellnessVisitStore(
    (s) => s.markProfileReviewCompleted,
  );

  const [sectionStatus, setSectionStatus] = useState<Record<SectionKey, 'pending' | 'confirmed'>>(
    {
      medications: 'pending',
      conditions: 'pending',
      allergies: 'pending',
      care_team: 'pending',
      insurance: 'pending',
      emergency_contact: 'pending',
    },
  );

  useEffect(() => {
    if (!hydrated) void hydrate();
  }, [hydrated, hydrate]);

  const factsByCategory = useMemo(() => {
    const groups: Record<SectionKey, ProfileFact[]> = {
      medications: [],
      conditions: [],
      allergies: [],
      care_team: [],
      insurance: [],
      emergency_contact: [],
    };
    for (const f of profile?.facts ?? []) {
      if (f.category === 'condition') groups.conditions.push(f);
      else if (f.category === 'allergy') groups.allergies.push(f);
      else if (f.category === 'care_team') groups.care_team.push(f);
      else if (f.category === 'insurance') groups.insurance.push(f);
      else if (f.category === 'emergency_contact')
        groups.emergency_contact.push(f);
    }
    return groups;
  }, [profile]);

  const markConfirmed = useCallback((key: SectionKey) => {
    setSectionStatus((prior) => ({ ...prior, [key]: 'confirmed' }));
  }, []);

  const allConfirmed = Object.values(sectionStatus).every(
    (s) => s === 'confirmed',
  );

  const handleDone = useCallback(() => {
    markProfileReviewCompleted(true);
    markStepCompleted('profile_review', true);
    router.back();
  }, [markProfileReviewCompleted, markStepCompleted, router]);

  const renderSection = (section: (typeof SECTIONS)[number]) => {
    let items: { title: string; detail: string | null }[] = [];

    if (section.key === 'medications') {
      items = (meds ?? [])
        .filter((m) => m.status === 'active')
        .map((m) => ({
          title: m.drug_name,
          detail: [m.strength, m.sig?.frequency_text].filter(Boolean).join(' · ') || null,
        }));
    } else {
      for (const f of factsByCategory[section.key]) {
        if (section.key === 'conditions') {
          const name = getString(f, ['condition_name', 'name']);
          if (name)
            items.push({
              title: name,
              detail:
                getString(f, ['diagnosed_date', 'status']) ?? null,
            });
        } else if (section.key === 'allergies') {
          const allergen = getString(f, ['substance', 'allergen', 'name']);
          if (allergen)
            items.push({
              title: allergen,
              detail: getString(f, ['reaction', 'severity']) ?? null,
            });
        } else if (section.key === 'care_team') {
          const name = getString(f, ['name']);
          if (name)
            items.push({
              title: name,
              detail: getString(f, ['specialty', 'role']) ?? null,
            });
        } else if (section.key === 'insurance') {
          const plan = getString(f, ['plan_name', 'provider', 'plan']);
          if (plan)
            items.push({
              title: plan,
              detail: getString(f, ['member_id', 'memberId']) ?? null,
            });
        } else if (section.key === 'emergency_contact') {
          const name = getString(f, ['name']);
          if (name)
            items.push({
              title: name,
              detail:
                getString(f, ['relationship', 'phone']) ?? null,
            });
        }
      }
    }

    const status = sectionStatus[section.key];
    const confirmed = status === 'confirmed';
    const empty = items.length === 0;

    return (
      <Card key={section.key} style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleRow}>
            <Ionicons
              name={section.icon as keyof typeof Ionicons.glyphMap}
              size={18}
              color={COLORS.primary.DEFAULT}
            />
            <Text style={styles.sectionTitle}>{section.title}</Text>
          </View>
          {confirmed && (
            <View style={styles.confirmedBadge}>
              <Ionicons
                name="checkmark"
                size={14}
                color={COLORS.success.DEFAULT}
              />
              <Text style={styles.confirmedBadgeText}>Confirmed</Text>
            </View>
          )}
        </View>

        {empty ? (
          <Text style={styles.emptyText}>None on file</Text>
        ) : (
          <View style={styles.itemList}>
            {items.slice(0, 6).map((it, i) => (
              <View key={i} style={styles.itemRow}>
                <View style={styles.itemDot} />
                <View style={styles.itemBody}>
                  <Text style={styles.itemTitle}>{it.title}</Text>
                  {it.detail && (
                    <Text style={styles.itemDetail}>{it.detail}</Text>
                  )}
                </View>
              </View>
            ))}
            {items.length > 6 && (
              <Text style={styles.itemMore}>
                +{items.length - 6} more
              </Text>
            )}
          </View>
        )}

        {!confirmed && (
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.primaryAction}
              onPress={() => markConfirmed(section.key)}
              activeOpacity={0.8}
            >
              <Ionicons
                name="checkmark-circle"
                size={16}
                color={COLORS.text.inverse}
              />
              <Text style={styles.primaryActionText}>All correct</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryAction}
              onPress={() => {
                // Navigate to the profile edit page for this category so the
                // user can update in place. After returning they can tap
                // "All correct" to confirm.
                if (section.key === 'insurance' || section.key === 'emergency_contact') {
                  router.push(`/(main)/profile/${activeProfileId}/edit` as never);
                } else if (section.key === 'medications') {
                  router.push('/(main)/medications' as never);
                } else if (section.key === 'care_team') {
                  router.push(`/(main)/profile/${activeProfileId}` as never);
                } else {
                  router.push(`/(main)/profile/${activeProfileId}` as never);
                }
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.secondaryActionText}>Needs update</Text>
            </TouchableOpacity>
          </View>
        )}
      </Card>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Ionicons
            name="chevron-back"
            size={22}
            color={COLORS.primary.DEFAULT}
          />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Is everything current?</Text>
        <Text style={styles.subtitle}>
          Let's make sure your profile is accurate before your visit.
        </Text>
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scrollContent}
      >
        {SECTIONS.map(renderSection)}

        <TouchableOpacity
          style={[
            styles.doneButton,
            !allConfirmed && styles.doneButtonPartial,
          ]}
          onPress={handleDone}
          activeOpacity={0.8}
        >
          <Text style={styles.doneButtonText}>
            {allConfirmed ? 'Profile review complete' : 'Save what I reviewed'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background.DEFAULT },
  flex: { flex: 1 },
  header: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8 },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginBottom: 8,
    marginLeft: -4,
  },
  backText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  title: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
  },
  subtitle: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginTop: 8,
    lineHeight: 20,
  },
  scrollContent: { paddingHorizontal: 24, paddingBottom: 40, paddingTop: 16 },
  section: { marginBottom: 12 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  confirmedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: COLORS.success.light,
  },
  confirmedBadgeText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.success.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  emptyText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.tertiary,
    fontStyle: 'italic',
  },
  itemList: { gap: 6 },
  itemRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  itemDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.text.tertiary,
    marginTop: 7,
  },
  itemBody: { flex: 1 },
  itemTitle: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.DEFAULT,
  },
  itemDetail: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    marginTop: 2,
  },
  itemMore: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginTop: 2,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  primaryAction: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: COLORS.primary.DEFAULT,
  },
  primaryActionText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.inverse,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  secondaryAction: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    backgroundColor: COLORS.surface.DEFAULT,
  },
  secondaryActionText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  doneButton: {
    marginTop: 8,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: COLORS.primary.DEFAULT,
  },
  doneButtonPartial: { backgroundColor: COLORS.text.tertiary },
  doneButtonText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.inverse,
    fontWeight: FONT_WEIGHTS.semibold,
  },
});
