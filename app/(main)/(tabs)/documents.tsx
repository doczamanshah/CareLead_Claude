import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  SectionList,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenLayout } from '@/components/ui/ScreenLayout';
import { EmptyState } from '@/components/ui/EmptyState';
import { DocumentCard } from '@/components/modules/DocumentCard';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useArtifacts } from '@/hooks/useArtifacts';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import type { Artifact } from '@/lib/types/artifacts';

interface Section {
  title: string;
  data: Artifact[];
}

function groupByDate(artifacts: Artifact[]): Section[] {
  const groups: Record<string, Artifact[]> = {};
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  for (const artifact of artifacts) {
    const date = new Date(artifact.created_at);
    let label: string;

    if (date.toDateString() === today.toDateString()) {
      label = 'Today';
    } else if (date.toDateString() === yesterday.toDateString()) {
      label = 'Yesterday';
    } else {
      label = date.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
    }

    if (!groups[label]) groups[label] = [];
    groups[label].push(artifact);
  }

  return Object.entries(groups).map(([title, data]) => ({ title, data }));
}

const CAPTURE_OPTIONS = [
  { key: 'camera', icon: '📷', label: 'Take Photo', route: '/(main)/capture/camera' },
  { key: 'upload', icon: '📁', label: 'Upload Document', route: '/(main)/capture/upload' },
  { key: 'voice', icon: '🎙️', label: 'Record Voice Note', route: '/(main)/capture/voice' },
] as const;

export default function DocumentsScreen() {
  const router = useRouter();
  const { activeProfileId } = useActiveProfile();
  const { data: artifacts, isLoading, error } = useArtifacts(activeProfileId ?? undefined);
  const [sheetVisible, setSheetVisible] = useState(false);

  if (isLoading) return <ScreenLayout title="Documents" loading />;
  if (error) return <ScreenLayout title="Documents" error={error as Error} />;

  const sections = groupByDate(artifacts ?? []);
  const isEmpty = !artifacts || artifacts.length === 0;

  return (
    <ScreenLayout title="Documents" scrollable={false}>
      {isEmpty ? (
        <EmptyState
          title="No documents yet"
          description="Capture photos, upload files, or record voice notes to get started."
          actionTitle="Add Document"
          onAction={() => setSheetVisible(true)}
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={styles.cardWrap}>
              <DocumentCard artifact={item} />
            </View>
          )}
          renderSectionHeader={({ section }) => (
            <Text style={styles.sectionHeader}>{section.title}</Text>
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Floating Add Button */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => setSheetVisible(true)}
        activeOpacity={0.8}
      >
        <Text style={styles.fabIcon}>+</Text>
      </TouchableOpacity>

      {/* Bottom Sheet */}
      <Modal
        visible={sheetVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setSheetVisible(false)}
      >
        <TouchableOpacity
          style={styles.sheetBackdrop}
          activeOpacity={1}
          onPress={() => setSheetVisible(false)}
        >
          <View style={styles.sheetContainer}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Add New</Text>
            {CAPTURE_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.key}
                style={styles.sheetOption}
                activeOpacity={0.7}
                onPress={() => {
                  setSheetVisible(false);
                  router.push(option.route);
                }}
              >
                <Text style={styles.sheetOptionIcon}>{option.icon}</Text>
                <Text style={styles.sheetOptionLabel}>{option.label}</Text>
                <Text style={styles.sheetChevron}>›</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  cardWrap: {
    marginBottom: 8,
  },
  sectionHeader: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 16,
  },
  listContent: {
    paddingBottom: 100,
  },
  fab: {
    position: 'absolute',
    right: 0,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.primary.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  fabIcon: {
    fontSize: 28,
    color: COLORS.text.inverse,
    fontWeight: FONT_WEIGHTS.bold,
    marginTop: -2,
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    backgroundColor: COLORS.surface.DEFAULT,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 48,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border.dark,
    alignSelf: 'center',
    marginBottom: 20,
  },
  sheetTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    marginBottom: 16,
  },
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.light,
  },
  sheetOptionIcon: {
    fontSize: 24,
    marginRight: 16,
  },
  sheetOptionLabel: {
    flex: 1,
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.DEFAULT,
  },
  sheetChevron: {
    fontSize: FONT_SIZES.xl,
    color: COLORS.text.tertiary,
  },
});
