import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Share,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useWellnessVisitStore } from '@/stores/wellnessVisitStore';
import { buildWellnessPacket } from '@/services/wellnessVisit';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import type { WellnessPacket } from '@/lib/types/wellnessVisit';

export default function PacketScreen() {
  const router = useRouter();
  const { activeProfileId } = useActiveProfile();
  const hydrate = useWellnessVisitStore((s) => s.hydrate);
  const hydrated = useWellnessVisitStore((s) => s.hydrated);
  const markPacketGenerated = useWellnessVisitStore((s) => s.markPacketGenerated);
  const wellness = useWellnessVisitStore((s) => ({
    currentVisitId: s.currentVisitId,
    freeformInput: s.freeformInput,
    extractedData: s.extractedData,
    profileReviewCompleted: s.profileReviewCompleted,
    profileChanges: s.profileChanges,
    selectedScreenings: s.selectedScreenings,
    questions: s.questions,
    packetGenerated: s.packetGenerated,
    stepsCompleted: s.stepsCompleted,
    createdAt: s.createdAt,
    appointmentId: s.appointmentId,
  }));

  const [packet, setPacket] = useState<WellnessPacket | null>(null);
  const [building, setBuilding] = useState(false);

  useEffect(() => {
    if (!hydrated) void hydrate();
  }, [hydrated, hydrate]);

  const handleGenerate = useCallback(async () => {
    if (!activeProfileId) return;
    setBuilding(true);
    try {
      const res = await buildWellnessPacket({
        profileId: activeProfileId,
        prep: wellness,
      });
      if (!res.success) {
        Alert.alert('Could not generate', res.error);
        return;
      }
      setPacket(res.data);
      markPacketGenerated();
    } finally {
      setBuilding(false);
    }
  }, [activeProfileId, wellness, markPacketGenerated]);

  const handleShare = useCallback(async () => {
    if (!packet) return;
    try {
      await Share.share({ message: packet.text, title: packet.title });
    } catch (err) {
      Alert.alert(
        'Could not share',
        err instanceof Error ? err.message : 'Please try again.',
      );
    }
  }, [packet]);

  const handleCopy = useCallback(async () => {
    if (!packet) return;
    try {
      await Clipboard.setStringAsync(packet.text);
      Alert.alert('Copied', 'Your visit packet is on the clipboard.');
    } catch (err) {
      Alert.alert(
        'Could not copy',
        err instanceof Error ? err.message : 'Please try again.',
      );
    }
  }, [packet]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={22} color={COLORS.primary.DEFAULT} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Your Wellness Visit Packet</Text>
        <Text style={styles.subtitle}>
          A shareable summary to bring to your visit. Review, then share with
          yourself or a caregiver.
        </Text>
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scrollContent}
      >
        {!packet ? (
          <>
            <PreviewSection
              title="Health snapshot"
              description="Active meds, conditions, and allergies from your profile."
            />
            <PreviewSection
              title="Preventive care status"
              description="What's current and what's due — plus items you flagged to discuss."
            />
            <PreviewSection
              title="Your questions"
              description="Prioritized list with the highest priorities first."
            />
            <PreviewSection
              title="Concerns and updates"
              description="Summary of what you shared in the freeform step."
            />
            <PreviewSection
              title="Insurance & emergency contact"
              description="So your visit packet has the info your provider might need."
            />
            <TouchableOpacity
              style={[styles.generateButton, building && styles.generateDisabled]}
              onPress={handleGenerate}
              disabled={building}
              activeOpacity={0.8}
            >
              {building ? (
                <ActivityIndicator color={COLORS.text.inverse} />
              ) : (
                <>
                  <Ionicons
                    name="sparkles"
                    size={16}
                    color={COLORS.text.inverse}
                  />
                  <Text style={styles.generateButtonText}>Generate Packet</Text>
                </>
              )}
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Card style={styles.packetCard}>
              <Text style={styles.packetTitle}>{packet.title}</Text>
              <Text style={styles.packetText}>{packet.text}</Text>
            </Card>

            <View style={styles.actionRow}>
              <TouchableOpacity
                style={styles.actionButton}
                onPress={handleShare}
                activeOpacity={0.8}
              >
                <Ionicons
                  name="share-outline"
                  size={18}
                  color={COLORS.text.inverse}
                />
                <Text style={styles.actionButtonText}>Share</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionButton, styles.actionButtonSecondary]}
                onPress={handleCopy}
                activeOpacity={0.8}
              >
                <Ionicons
                  name="copy-outline"
                  size={18}
                  color={COLORS.primary.DEFAULT}
                />
                <Text style={styles.actionButtonSecondaryText}>Copy</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              onPress={handleGenerate}
              style={styles.regenLink}
              activeOpacity={0.7}
            >
              <Ionicons
                name="refresh"
                size={14}
                color={COLORS.text.secondary}
              />
              <Text style={styles.regenLinkText}>Regenerate</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function PreviewSection({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Card style={styles.previewSection}>
      <View style={styles.previewRow}>
        <Ionicons
          name="document-text-outline"
          size={20}
          color={COLORS.primary.DEFAULT}
        />
        <View style={styles.previewBody}>
          <Text style={styles.previewTitle}>{title}</Text>
          <Text style={styles.previewDescription}>{description}</Text>
        </View>
      </View>
    </Card>
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
  previewSection: { marginBottom: 10 },
  previewRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  previewBody: { flex: 1 },
  previewTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    marginBottom: 4,
  },
  previewDescription: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    lineHeight: 20,
  },
  generateButton: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: COLORS.primary.DEFAULT,
  },
  generateDisabled: { opacity: 0.6 },
  generateButtonText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.inverse,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  packetCard: { marginBottom: 16 },
  packetTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    marginBottom: 10,
  },
  packetText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    lineHeight: 21,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: COLORS.primary.DEFAULT,
  },
  actionButtonText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.inverse,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  actionButtonSecondary: {
    backgroundColor: COLORS.primary.DEFAULT + '14',
  },
  actionButtonSecondaryText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  regenLink: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  regenLinkText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
  },
});
