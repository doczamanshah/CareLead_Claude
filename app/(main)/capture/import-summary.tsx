import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

const ACCEPTED_TYPES = [
  'application/xml',
  'text/xml',
  'application/pdf',
  'text/html',
  'image/jpeg',
  'image/png',
  'text/plain',
  'application/octet-stream', // .ccd / .ccda files often report this
];

interface PickedFile {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
}

export default function ImportHealthSummaryScreen() {
  const router = useRouter();
  const { activeProfileId } = useActiveProfile();
  const [pickedFile, setPickedFile] = useState<PickedFile | null>(null);
  const [howToExpanded, setHowToExpanded] = useState(false);

  async function handlePickFile() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ACCEPTED_TYPES,
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      const lower = asset.name.toLowerCase();
      const isCcda = lower.endsWith('.xml') || lower.endsWith('.ccd') || lower.endsWith('.ccda');
      const mime = asset.mimeType ?? (isCcda ? 'application/xml' : 'application/octet-stream');

      setPickedFile({
        uri: asset.uri,
        name: asset.name,
        mimeType: mime,
        size: asset.size ?? 0,
      });
    } catch {
      Alert.alert('Error', 'Could not open the document picker.');
    }
  }

  async function handleUseCamera() {
    // Route through capture/camera, but with a flag in route params so the
    // photo flows into import-processing rather than generic extraction.
    router.push('/(main)/capture/import-summary-camera' as never);
  }

  function handleImport() {
    if (!pickedFile || !activeProfileId) return;
    router.push({
      pathname: '/(main)/capture/import-processing',
      params: {
        fileUri: pickedFile.uri,
        fileName: pickedFile.name,
        mimeType: pickedFile.mimeType,
        fileSize: String(pickedFile.size),
        sourceChannel: 'upload',
      },
    } as never);
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backRow} hitSlop={8}>
          <Ionicons name="chevron-back" size={18} color={COLORS.primary.DEFAULT} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>

        <View style={styles.heroIconWrap}>
          <Ionicons name="cloud-download-outline" size={30} color={COLORS.primary.DEFAULT} />
        </View>

        <Text style={styles.title}>Import Health Summary</Text>
        <Text style={styles.subtitle}>
          Many patient portals let you download your health summary. This file can contain
          your complete medical history — medications, allergies, conditions, lab results,
          and more.
        </Text>

        <TouchableOpacity
          style={styles.howToCard}
          activeOpacity={0.7}
          onPress={() => setHowToExpanded((v) => !v)}
        >
          <Ionicons
            name="help-circle-outline"
            size={20}
            color={COLORS.primary.DEFAULT}
          />
          <Text style={styles.howToTitle}>How to get your health summary</Text>
          <Ionicons
            name={howToExpanded ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={COLORS.text.tertiary}
          />
        </TouchableOpacity>

        {howToExpanded && (
          <View style={styles.howToBody}>
            <InstructionRow
              label="MyChart"
              detail="Go to Menu → Health Summary → Download"
            />
            <InstructionRow
              label="FollowMyHealth"
              detail="Go to My Record → Export"
            />
            <InstructionRow
              label="Other portals"
              detail='Look for "Health Summary", "CCD", "CCDA", or "Export My Data"'
            />
            <InstructionRow
              label="File format"
              detail="The file is usually an XML or PDF"
            />
          </View>
        )}

        {pickedFile ? (
          <View style={styles.filePreview}>
            <Ionicons
              name={
                pickedFile.mimeType.startsWith('image/')
                  ? 'image-outline'
                  : pickedFile.mimeType === 'application/pdf'
                  ? 'document-text-outline'
                  : 'code-slash-outline'
              }
              size={28}
              color={COLORS.primary.DEFAULT}
            />
            <View style={styles.filePreviewBody}>
              <Text style={styles.filePreviewName} numberOfLines={2}>
                {pickedFile.name}
              </Text>
              <Text style={styles.filePreviewMeta}>
                {formatFileSize(pickedFile.size)}
              </Text>
            </View>
            <TouchableOpacity onPress={() => setPickedFile(null)} hitSlop={8}>
              <Ionicons name="close-circle" size={22} color={COLORS.text.tertiary} />
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.actionsGroup}>
          <TouchableOpacity
            style={styles.actionCard}
            activeOpacity={0.7}
            onPress={handlePickFile}
          >
            <View style={styles.actionIconWrap}>
              <Ionicons name="folder-open-outline" size={22} color={COLORS.primary.DEFAULT} />
            </View>
            <View style={styles.actionBody}>
              <Text style={styles.actionTitle}>Upload File</Text>
              <Text style={styles.actionDetail}>XML, PDF, or HTML from your portal</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.text.tertiary} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionCard}
            activeOpacity={0.7}
            onPress={handleUseCamera}
          >
            <View style={[styles.actionIconWrap, styles.actionIconAccent]}>
              <Ionicons name="camera-outline" size={22} color={COLORS.secondary.dark} />
            </View>
            <View style={styles.actionBody}>
              <Text style={styles.actionTitle}>Take a Photo</Text>
              <Text style={styles.actionDetail}>For paper printouts</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.text.tertiary} />
          </TouchableOpacity>
        </View>

        <View style={styles.trustBlock}>
          <Ionicons
            name="shield-checkmark-outline"
            size={16}
            color={COLORS.text.secondary}
          />
          <Text style={styles.trustText}>
            Your data stays on your profile. You pick what to import on the next screen.
          </Text>
        </View>

        <View style={styles.spacer} />

        <Button
          title={pickedFile ? `Import` : 'Pick a file to continue'}
          onPress={handleImport}
          disabled={!pickedFile}
          size="lg"
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function InstructionRow({ label, detail }: { label: string; detail: string }) {
  return (
    <View style={styles.instructionRow}>
      <Text style={styles.instructionLabel}>{label}</Text>
      <Text style={styles.instructionDetail}>{detail}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background.DEFAULT },
  content: { padding: 24, paddingBottom: 48 },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    alignSelf: 'flex-start',
  },
  backText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  heroIconWrap: {
    width: 60,
    height: 60,
    borderRadius: 16,
    backgroundColor: COLORS.primary.DEFAULT + '14',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
  },
  subtitle: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    marginTop: 8,
    lineHeight: 22,
    marginBottom: 16,
  },
  howToCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    backgroundColor: COLORS.surface.DEFAULT,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    borderRadius: 12,
  },
  howToTitle: {
    flex: 1,
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  howToBody: {
    marginTop: 8,
    padding: 14,
    backgroundColor: COLORS.surface.muted,
    borderRadius: 12,
    gap: 10,
  },
  instructionRow: {
    gap: 2,
  },
  instructionLabel: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  instructionDetail: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    lineHeight: 20,
  },
  filePreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 20,
    padding: 14,
    backgroundColor: COLORS.primary.DEFAULT + '0D',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.primary.DEFAULT + '20',
  },
  filePreviewBody: { flex: 1 },
  filePreviewName: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  filePreviewMeta: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    marginTop: 2,
  },
  actionsGroup: {
    marginTop: 20,
    gap: 10,
  },
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: COLORS.surface.DEFAULT,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
  },
  actionIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: COLORS.primary.DEFAULT + '14',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionIconAccent: {
    backgroundColor: COLORS.secondary.DEFAULT + '22',
  },
  actionBody: { flex: 1 },
  actionTitle: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  actionDetail: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    marginTop: 2,
  },
  trustBlock: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 20,
  },
  trustText: {
    flex: 1,
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    lineHeight: 16,
  },
  spacer: { height: 24 },
});
