import { useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useAuth } from '@/hooks/useAuth';
import { useCommitHealthSummaryImport } from '@/hooks/useHealthSummaryImport';
import { useHealthSummaryImportStore } from '@/stores/healthSummaryImportStore';
import type {
  HealthSummaryExtraction,
  DuplicateMap,
  ImportSelection,
} from '@/services/healthSummaryImport';
import { totalSelected } from '@/services/healthSummaryImport';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import { safeWarn } from '@/lib/utils/safeLog';

interface SectionConfig {
  key: keyof ImportSelection;
  label: string;
  icon: keyof typeof import('@expo/vector-icons').Ionicons.glyphMap;
  getItems: (e: HealthSummaryExtraction) => { title: string; detail?: string }[];
  getDuplicates: (d: DuplicateMap | null) => Set<number>;
}

const SECTIONS: SectionConfig[] = [
  {
    key: 'medications',
    label: 'Medications',
    icon: 'medkit-outline',
    getItems: (e) =>
      e.medications.map((m) => ({
        title: m.name,
        detail: [m.dose, m.frequency, m.status].filter(Boolean).join(' • ') || undefined,
      })),
    getDuplicates: (d) => d?.medications ?? new Set(),
  },
  {
    key: 'allergies',
    label: 'Allergies',
    icon: 'warning-outline',
    getItems: (e) =>
      e.allergies.map((a) => ({
        title: a.allergen,
        detail: [a.reaction, a.severity].filter(Boolean).join(' • ') || undefined,
      })),
    getDuplicates: (d) => d?.allergies ?? new Set(),
  },
  {
    key: 'conditions',
    label: 'Conditions',
    icon: 'pulse-outline',
    getItems: (e) =>
      e.conditions.map((c) => ({
        title: c.name,
        detail: [c.onset_date, c.status].filter(Boolean).join(' • ') || undefined,
      })),
    getDuplicates: (d) => d?.conditions ?? new Set(),
  },
  {
    key: 'procedures',
    label: 'Procedures / Surgeries',
    icon: 'bandage-outline',
    getItems: (e) =>
      e.procedures.map((p) => ({
        title: p.name,
        detail: [p.date, p.provider].filter(Boolean).join(' • ') || undefined,
      })),
    getDuplicates: (d) => d?.procedures ?? new Set(),
  },
  {
    key: 'immunizations',
    label: 'Immunizations',
    icon: 'shield-checkmark-outline',
    getItems: (e) =>
      e.immunizations.map((i) => ({
        title: i.name,
        detail: [i.date, i.site].filter(Boolean).join(' • ') || undefined,
      })),
    getDuplicates: (d) => d?.immunizations ?? new Set(),
  },
  {
    key: 'lab_results',
    label: 'Lab Results',
    icon: 'flask-outline',
    getItems: (e) =>
      e.lab_results.map((lab) => ({
        title: lab.test_name,
        detail: [lab.date, `${lab.results.length} analytes`].filter(Boolean).join(' • '),
      })),
    getDuplicates: () => new Set(), // lab results always import as new records
  },
  {
    key: 'providers',
    label: 'Providers',
    icon: 'people-outline',
    getItems: (e) =>
      e.providers.map((p) => ({
        title: p.name,
        detail: [p.specialty, p.organization].filter(Boolean).join(' • ') || undefined,
      })),
    getDuplicates: (d) => d?.providers ?? new Set(),
  },
  {
    key: 'insurance',
    label: 'Insurance',
    icon: 'shield-outline',
    getItems: (e) =>
      e.insurance.map((i) => ({
        title: i.payer,
        detail: [i.plan_name, i.member_id].filter(Boolean).join(' • ') || undefined,
      })),
    getDuplicates: (d) => d?.insurance ?? new Set(),
  },
  {
    key: 'emergency_contacts',
    label: 'Emergency Contacts',
    icon: 'call-outline',
    getItems: (e) =>
      e.emergency_contacts.map((c) => ({
        title: c.name,
        detail: [c.relationship, c.phone].filter(Boolean).join(' • ') || undefined,
      })),
    getDuplicates: (d) => d?.emergency_contacts ?? new Set(),
  },
];

export default function ImportReviewScreen() {
  const router = useRouter();
  const { activeProfileId, activeProfile } = useActiveProfile();
  const { user } = useAuth();
  const commitMutation = useCommitHealthSummaryImport();

  const extraction = useHealthSummaryImportStore((s) => s.extraction);
  const duplicates = useHealthSummaryImportStore((s) => s.duplicates);
  const selection = useHealthSummaryImportStore((s) => s.selection);
  const artifactId = useHealthSummaryImportStore((s) => s.artifactId);
  const setSelection = useHealthSummaryImportStore((s) => s.setSelection);
  const setImportedCounts = useHealthSummaryImportStore((s) => s.setImportedCounts);

  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    () => new Set(['medications', 'allergies', 'conditions']),
  );

  const totalFound = useMemo(() => {
    if (!extraction) return 0;
    return (
      extraction.medications.length +
      extraction.allergies.length +
      extraction.conditions.length +
      extraction.procedures.length +
      extraction.immunizations.length +
      extraction.lab_results.length +
      extraction.providers.length +
      extraction.insurance.length +
      extraction.emergency_contacts.length
    );
  }, [extraction]);

  if (!extraction || !activeProfileId) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>Nothing to review</Text>
          <Text style={styles.emptyDesc}>
            Start by uploading a health summary file.
          </Text>
          <Button title="Start over" onPress={() => router.replace('/(main)/capture/import-summary' as never)} />
        </View>
      </SafeAreaView>
    );
  }

  function toggleItem(sectionKey: keyof ImportSelection, idx: number) {
    const currentSet = selection[sectionKey];
    const newSet = new Set(currentSet);
    if (newSet.has(idx)) newSet.delete(idx);
    else newSet.add(idx);
    setSelection({ ...selection, [sectionKey]: newSet });
  }

  function selectAll(sectionKey: keyof ImportSelection, total: number) {
    const newSet = new Set<number>();
    for (let i = 0; i < total; i++) newSet.add(i);
    setSelection({ ...selection, [sectionKey]: newSet });
  }

  function deselectAll(sectionKey: keyof ImportSelection) {
    setSelection({ ...selection, [sectionKey]: new Set() });
  }

  function toggleSection(key: string) {
    const next = new Set(expandedSections);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setExpandedSections(next);
  }

  async function handleImport() {
    if (!activeProfileId || !activeProfile?.household_id || !user?.id || !artifactId || !extraction) {
      Alert.alert('Not ready', 'Missing profile info. Please try again.');
      return;
    }

    const total = totalSelected(selection);
    if (total === 0) {
      Alert.alert('Nothing selected', 'Pick at least one item to import.');
      return;
    }

    try {
      const res = await commitMutation.mutateAsync({
        profileId: activeProfileId,
        householdId: activeProfile.household_id,
        userId: user.id,
        artifactId,
        extraction,
        selection,
      });
      setImportedCounts(res.counts);
      if (res.failures.length > 0) {
        // failures may contain names/dates — log count only in production.
        safeWarn('[import] partial failures', { count: res.failures.length, failures: res.failures });
      }
      router.replace('/(main)/capture/import-done' as never);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Import failed';
      Alert.alert('Could not import', msg);
    }
  }

  const selectedCount = totalSelected(selection);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <View />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.heroBlock}>
          <Ionicons name="sparkles" size={22} color={COLORS.accent.dark} />
          <Text style={styles.heroTitle}>We found a lot!</Text>
          <Text style={styles.heroSubtitle}>
            {totalFound} items from your health summary. Pick what you want to import.
          </Text>
        </View>

        {SECTIONS.map((section) => {
          const items = section.getItems(extraction);
          if (items.length === 0) return null;

          const dupes = section.getDuplicates(duplicates);
          const selectedSet = selection[section.key];
          const expanded = expandedSections.has(section.key);

          return (
            <View key={section.key} style={styles.section}>
              <TouchableOpacity
                style={styles.sectionHeader}
                activeOpacity={0.7}
                onPress={() => toggleSection(section.key)}
              >
                <View style={styles.sectionTitleRow}>
                  <Ionicons name={section.icon} size={18} color={COLORS.primary.DEFAULT} />
                  <Text style={styles.sectionTitle}>{section.label}</Text>
                  <View style={styles.sectionCount}>
                    <Text style={styles.sectionCountText}>{items.length}</Text>
                  </View>
                </View>
                <Ionicons
                  name={expanded ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={COLORS.text.tertiary}
                />
              </TouchableOpacity>

              {expanded && (
                <View style={styles.sectionBody}>
                  <View style={styles.bulkRow}>
                    <TouchableOpacity
                      onPress={() => selectAll(section.key, items.length)}
                      hitSlop={6}
                    >
                      <Text style={styles.bulkText}>Select all</Text>
                    </TouchableOpacity>
                    <Text style={styles.bulkSep}>·</Text>
                    <TouchableOpacity onPress={() => deselectAll(section.key)} hitSlop={6}>
                      <Text style={styles.bulkText}>Deselect all</Text>
                    </TouchableOpacity>
                  </View>

                  {items.map((item, idx) => {
                    const isSelected = selectedSet.has(idx);
                    const isDup = dupes.has(idx);
                    return (
                      <TouchableOpacity
                        key={`${section.key}-${idx}`}
                        style={[
                          styles.itemRow,
                          isSelected && styles.itemRowSelected,
                          isDup && styles.itemRowDuplicate,
                        ]}
                        activeOpacity={0.7}
                        onPress={() => toggleItem(section.key, idx)}
                      >
                        <View
                          style={[
                            styles.checkbox,
                            isSelected && styles.checkboxSelected,
                          ]}
                        >
                          {isSelected && (
                            <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                          )}
                        </View>
                        <View style={styles.itemBody}>
                          <Text style={styles.itemTitle} numberOfLines={2}>
                            {item.title}
                          </Text>
                          {item.detail && (
                            <Text style={styles.itemDetail} numberOfLines={2}>
                              {item.detail}
                            </Text>
                          )}
                          {isDup && (
                            <View style={styles.dupBadge}>
                              <Ionicons
                                name="checkmark-circle"
                                size={12}
                                color={COLORS.success.DEFAULT}
                              />
                              <Text style={styles.dupBadgeText}>
                                Already in your profile
                              </Text>
                            </View>
                          )}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>
          );
        })}

        <View style={styles.spacer} />
      </ScrollView>

      <View style={styles.bottomBar}>
        <Button
          title={selectedCount > 0 ? `Import ${selectedCount} items` : 'Select items to import'}
          onPress={handleImport}
          disabled={selectedCount === 0}
          loading={commitMutation.isPending}
          size="lg"
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background.DEFAULT },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  cancelText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  scrollContent: { paddingHorizontal: 24, paddingBottom: 24 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  emptyDesc: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    textAlign: 'center',
    marginBottom: 12,
  },
  heroBlock: {
    alignItems: 'center',
    marginBottom: 20,
    gap: 6,
    backgroundColor: COLORS.accent.DEFAULT + '14',
    padding: 18,
    borderRadius: 12,
  },
  heroTitle: {
    fontSize: FONT_SIZES.xl,
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
  },
  heroSubtitle: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  section: {
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    borderRadius: 12,
    backgroundColor: COLORS.surface.DEFAULT,
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  sectionTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  sectionCount: {
    backgroundColor: COLORS.primary.DEFAULT + '14',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    minWidth: 24,
    alignItems: 'center',
  },
  sectionCountText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.primary.DEFAULT,
  },
  sectionBody: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    gap: 8,
  },
  bulkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  bulkText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  bulkSep: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    backgroundColor: COLORS.surface.DEFAULT,
  },
  itemRowSelected: {
    borderColor: COLORS.primary.DEFAULT,
    backgroundColor: COLORS.primary.DEFAULT + '0D',
  },
  itemRowDuplicate: {
    opacity: 0.9,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: COLORS.border.dark,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxSelected: {
    backgroundColor: COLORS.primary.DEFAULT,
    borderColor: COLORS.primary.DEFAULT,
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
    lineHeight: 16,
  },
  dupBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  dupBadgeText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.success.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  bottomBar: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border.light,
    backgroundColor: COLORS.background.DEFAULT,
  },
  spacer: { height: 12 },
});
