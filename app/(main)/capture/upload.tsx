import { useState } from 'react';
import { View, Text, Alert, StyleSheet } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useUploadArtifact } from '@/hooks/useArtifacts';
import { useTriggerExtraction } from '@/hooks/useIntentSheet';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import { safeLog, safeError } from '@/lib/utils/safeLog';
import { sanitizeErrorMessage } from '@/lib/utils/sanitizeError';

const ALLOWED_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
];

interface PickedFile {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
}

export default function UploadScreen() {
  const router = useRouter();
  const { activeProfileId } = useActiveProfile();
  const uploadMutation = useUploadArtifact();
  const extractionMutation = useTriggerExtraction();
  const [pickedFile, setPickedFile] = useState<PickedFile | null>(null);

  async function handlePick() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ALLOWED_TYPES,
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      const mime = asset.mimeType ?? 'application/octet-stream';

      // Reject HEIC/HEIF — Claude API does not support these formats
      if (mime === 'image/heic' || mime === 'image/heif') {
        Alert.alert(
          'Unsupported Format',
          'HEIC/HEIF images are not supported. Please convert to JPEG or PNG and try again.',
        );
        return;
      }

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

  async function handleUpload() {
    if (!pickedFile || !activeProfileId) return;

    try {
      const artifact = await uploadMutation.mutateAsync({
        profileId: activeProfileId,
        fileName: pickedFile.name,
        fileUri: pickedFile.uri,
        mimeType: pickedFile.mimeType,
        artifactType: 'document',
        sourceChannel: 'upload',
        fileSizeBytes: pickedFile.size,
      });

      // Trigger AI extraction — navigate to intent sheet if successful
      try {
        const extraction = await extractionMutation.mutateAsync({
          artifactId: artifact.id,
          profileId: activeProfileId,
        });
        safeLog('[upload] Extraction triggered successfully for artifact', artifact.id);

        if (extraction.intentSheetId) {
          router.replace(`/(main)/intent-sheet/${extraction.intentSheetId}`);
          return;
        }
      } catch (extractionErr) {
        // Log but don't block navigation — extraction can be retried
        safeError('[upload] Extraction trigger failed', extractionErr);
      }

      router.replace('/(main)/(tabs)/documents');
    } catch (err) {
      Alert.alert('Upload Error', sanitizeErrorMessage(err, { fallback: 'Upload failed.' }));
    }
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function fileIcon(mimeType: string): string {
    if (mimeType === 'application/pdf') return '📕';
    if (mimeType.startsWith('image/')) return '🖼️';
    return '📄';
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.content}>
        {!pickedFile ? (
          <>
            <View style={styles.dropZone}>
              <Text style={styles.dropIcon}>📁</Text>
              <Text style={styles.dropTitle}>Select a Document</Text>
              <Text style={styles.dropDesc}>
                Choose a PDF or image file from your device. Supported formats:
                PDF, JPEG, PNG.
              </Text>
              <View style={styles.buttonWrap}>
                <Button title="Browse Files" onPress={handlePick} />
              </View>
            </View>
          </>
        ) : (
          <>
            <Card>
              <View style={styles.fileRow}>
                <Text style={styles.fileIcon}>{fileIcon(pickedFile.mimeType)}</Text>
                <View style={styles.fileInfo}>
                  <Text style={styles.fileName} numberOfLines={2}>
                    {pickedFile.name}
                  </Text>
                  <Text style={styles.fileMeta}>
                    {formatFileSize(pickedFile.size)}
                  </Text>
                </View>
              </View>
            </Card>

            <View style={styles.actions}>
              <Button
                title="Choose Different File"
                variant="outline"
                onPress={handlePick}
              />
              <View style={styles.gap} />
              <Button
                title="Upload"
                onPress={handleUpload}
                loading={uploadMutation.isPending}
              />
            </View>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background.DEFAULT,
  },
  content: {
    flex: 1,
    padding: 24,
  },
  dropZone: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: COLORS.border.dark,
    borderRadius: 16,
    padding: 32,
    marginTop: 24,
  },
  dropIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  dropTitle: {
    fontSize: FONT_SIZES.xl,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    marginBottom: 8,
  },
  dropDesc: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  buttonWrap: {
    marginTop: 8,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fileIcon: {
    fontSize: 36,
    marginRight: 16,
  },
  fileInfo: {
    flex: 1,
  },
  fileName: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  fileMeta: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginTop: 4,
  },
  actions: {
    marginTop: 24,
  },
  gap: {
    height: 12,
  },
});
