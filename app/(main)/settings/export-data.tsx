/**
 * Export My Data screen.
 *
 * Builds a plain-text export of everything CareLead has on file for the
 * active profile and opens the system Share sheet. HIPAA gives patients
 * the right to a copy of their health data on demand — this is the
 * one-tap way to provide that.
 *
 * Service: `services/dataExport.ts`.
 */

import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { shareAllData } from '@/services/dataExport';
import { sanitizeErrorMessage } from '@/lib/utils/sanitizeError';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

export default function ExportDataScreen() {
  const router = useRouter();
  const { activeProfile, activeProfileId } = useActiveProfile();
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    if (!activeProfile || !activeProfileId || exporting) return;
    setExporting(true);
    const result = await shareAllData(activeProfileId, activeProfile.household_id);
    setExporting(false);
    if (!result.success) {
      Alert.alert('Could not export', sanitizeErrorMessage(result.error));
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.navBar}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.navButton}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          disabled={exporting}
        >
          <Ionicons name="chevron-back" size={26} color={COLORS.primary.DEFAULT} />
        </TouchableOpacity>
        <Text style={styles.navTitle}>Export My Data</Text>
        <View style={styles.navButton} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.iconWrap}>
          <Ionicons
            name="download-outline"
            size={48}
            color={COLORS.primary.DEFAULT}
          />
        </View>

        <Text style={styles.title}>A copy of your data, on your terms</Text>
        <Text style={styles.body}>
          We'll build a plain-text summary of everything CareLead has on file
          for{' '}
          <Text style={styles.emphasis}>
            {activeProfile?.display_name ?? 'this profile'}
          </Text>{' '}
          and open the Share sheet so you can save it, email it to yourself,
          or hand it to a new provider.
        </Text>

        <Card>
          <Text style={styles.sectionHeading}>What's included</Text>
          <Text style={styles.bullet}>• Profile information (name, DOB, sex)</Text>
          <Text style={styles.bullet}>• Medications, sigs, pharmacy, prescriber</Text>
          <Text style={styles.bullet}>• Conditions, allergies, surgeries, family history</Text>
          <Text style={styles.bullet}>• Care team, insurance, preferred pharmacies</Text>
          <Text style={styles.bullet}>• Appointments (upcoming + past)</Text>
          <Text style={styles.bullet}>• Tasks & reminders</Text>
          <Text style={styles.bullet}>• Lab / imaging / other results</Text>
          <Text style={styles.bullet}>• Preventive care status</Text>
          <Text style={styles.bullet}>• Bills & EOBs (summary level)</Text>
          <Text style={styles.bullet}>• What Matters to You (priorities)</Text>
        </Card>

        <View style={styles.gap} />

        <Card>
          <Text style={styles.sectionHeading}>What's not included</Text>
          <Text style={styles.bodySmall}>
            Uploaded document binaries — photos, PDFs of bills, EOBs, lab
            reports — aren't bundled in this export. You can share each of
            those individually from their module.
          </Text>
        </Card>

        <View style={styles.actions}>
          {exporting ? (
            <ActivityIndicator color={COLORS.primary.DEFAULT} />
          ) : (
            <Button
              title="Generate & Share"
              onPress={handleExport}
              disabled={!activeProfileId}
            />
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background.DEFAULT,
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: COLORS.surface.DEFAULT,
    borderBottomColor: COLORS.border.DEFAULT,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  navButton: {
    width: 40,
    height: 36,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  navTitle: {
    flex: 1,
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    textAlign: 'center',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 48,
  },
  iconWrap: {
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    textAlign: 'center',
    marginBottom: 16,
  },
  body: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    lineHeight: 22,
    marginBottom: 24,
  },
  bodySmall: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    lineHeight: 20,
  },
  emphasis: {
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.primary.DEFAULT,
  },
  sectionHeading: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    marginBottom: 10,
  },
  bullet: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    lineHeight: 22,
  },
  gap: {
    height: 12,
  },
  actions: {
    marginTop: 24,
    alignItems: 'center',
  },
});
