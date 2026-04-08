import { useState, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, Alert, StyleSheet } from 'react-native';
import { Audio } from 'expo-av';
import { useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/Button';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useUploadArtifact } from '@/hooks/useArtifacts';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

type RecordingState = 'idle' | 'recording' | 'recorded';

export default function VoiceScreen() {
  const router = useRouter();
  const { activeProfileId } = useActiveProfile();
  const uploadMutation = useUploadArtifact();

  const [state, setState] = useState<RecordingState>('idle');
  const [durationMs, setDurationMs] = useState(0);
  const [recordingUri, setRecordingUri] = useState<string | null>(null);
  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    checkPermission();
    return () => {
      // Cleanup on unmount
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync().catch(() => {});
      }
      if (soundRef.current) {
        soundRef.current.unloadAsync().catch(() => {});
      }
    };
  }, []);

  async function checkPermission() {
    const { granted } = await Audio.getPermissionsAsync();
    if (granted) {
      setPermissionGranted(true);
    } else {
      const result = await Audio.requestPermissionsAsync();
      setPermissionGranted(result.granted);
    }
  }

  async function startRecording() {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );

      recordingRef.current = recording;
      setState('recording');
      setDurationMs(0);

      recording.setOnRecordingStatusUpdate((status) => {
        if (status.isRecording) {
          setDurationMs(status.durationMillis);
        }
      });
    } catch {
      Alert.alert('Error', 'Could not start recording.');
    }
  }

  async function stopRecording() {
    if (!recordingRef.current) return;

    try {
      await recordingRef.current.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

      const uri = recordingRef.current.getURI();
      recordingRef.current = null;

      if (uri) {
        setRecordingUri(uri);
        setState('recorded');
      } else {
        setState('idle');
      }
    } catch {
      Alert.alert('Error', 'Could not stop recording.');
      setState('idle');
    }
  }

  async function handlePlayback() {
    if (!recordingUri) return;

    if (isPlaying && soundRef.current) {
      await soundRef.current.pauseAsync();
      setIsPlaying(false);
      return;
    }

    try {
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
      }

      const { sound } = await Audio.Sound.createAsync(
        { uri: recordingUri },
        { shouldPlay: true },
      );

      soundRef.current = sound;
      setIsPlaying(true);

      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          setIsPlaying(false);
        }
      });
    } catch {
      Alert.alert('Error', 'Could not play recording.');
    }
  }

  function handleDiscard() {
    setRecordingUri(null);
    setDurationMs(0);
    setState('idle');
    if (soundRef.current) {
      soundRef.current.unloadAsync().catch(() => {});
      soundRef.current = null;
    }
  }

  async function handleSave() {
    if (!recordingUri || !activeProfileId) return;

    try {
      const fileInfo = await FileSystem.getInfoAsync(recordingUri);
      const fileSize = fileInfo.exists ? (fileInfo.size ?? 0) : 0;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `voice-${timestamp}.m4a`;

      await uploadMutation.mutateAsync({
        profileId: activeProfileId,
        fileName,
        fileUri: recordingUri,
        mimeType: 'audio/mp4',
        artifactType: 'note',
        sourceChannel: 'voice',
        fileSizeBytes: fileSize,
      });

      router.replace('/(main)/(tabs)/documents');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      Alert.alert('Upload Error', message);
    }
  }

  function formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  // Permission check
  if (permissionGranted === null) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.loadingText}>Checking microphone access...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!permissionGranted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.permissionTitle}>Microphone Access Required</Text>
          <Text style={styles.permissionDesc}>
            CareLead needs microphone access to record voice notes about your
            health information.
          </Text>
          <Button title="Grant Microphone Access" onPress={checkPermission} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.content}>
        {/* Timer display */}
        <View style={styles.timerSection}>
          <Text style={styles.timer}>{formatDuration(durationMs)}</Text>
          {state === 'recording' && (
            <View style={styles.recordingIndicator}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingLabel}>Recording</Text>
            </View>
          )}
          {state === 'recorded' && (
            <Text style={styles.recordedLabel}>Recording complete</Text>
          )}
          {state === 'idle' && (
            <Text style={styles.idleLabel}>Tap the microphone to start</Text>
          )}
        </View>

        {/* Main action button */}
        <View style={styles.micSection}>
          {state === 'idle' && (
            <TouchableOpacity
              style={styles.micButton}
              onPress={startRecording}
              activeOpacity={0.7}
            >
              <Text style={styles.micIcon}>🎙️</Text>
            </TouchableOpacity>
          )}

          {state === 'recording' && (
            <TouchableOpacity
              style={[styles.micButton, styles.micButtonRecording]}
              onPress={stopRecording}
              activeOpacity={0.7}
            >
              <View style={styles.stopIcon} />
            </TouchableOpacity>
          )}

          {state === 'recorded' && (
            <TouchableOpacity
              style={[styles.micButton, styles.micButtonPlayback]}
              onPress={handlePlayback}
              activeOpacity={0.7}
            >
              <Text style={styles.playbackIcon}>
                {isPlaying ? '⏸' : '▶️'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Bottom actions */}
        {state === 'recorded' && (
          <View style={styles.bottomActions}>
            <Button
              title="Discard"
              variant="outline"
              onPress={handleDiscard}
            />
            <View style={styles.gap} />
            <Button
              title="Save Voice Note"
              onPress={handleSave}
              loading={uploadMutation.isPending}
            />
          </View>
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
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 24,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  loadingText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
  },
  permissionTitle: {
    fontSize: FONT_SIZES.xl,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    marginBottom: 12,
    textAlign: 'center',
  },
  permissionDesc: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
  timerSection: {
    alignItems: 'center',
    marginTop: 60,
  },
  timer: {
    fontSize: 64,
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    fontVariant: ['tabular-nums'],
  },
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.error.DEFAULT,
    marginRight: 8,
  },
  recordingLabel: {
    fontSize: FONT_SIZES.base,
    color: COLORS.error.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  recordedLabel: {
    fontSize: FONT_SIZES.base,
    color: COLORS.success.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
    marginTop: 12,
  },
  idleLabel: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.tertiary,
    marginTop: 12,
  },
  micSection: {
    alignItems: 'center',
  },
  micButton: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: COLORS.primary.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micButtonRecording: {
    backgroundColor: COLORS.error.DEFAULT,
  },
  micButtonPlayback: {
    backgroundColor: COLORS.secondary.DEFAULT,
  },
  micIcon: {
    fontSize: 40,
  },
  stopIcon: {
    width: 28,
    height: 28,
    borderRadius: 4,
    backgroundColor: '#fff',
  },
  playbackIcon: {
    fontSize: 36,
  },
  bottomActions: {
    flexDirection: 'row',
    width: '100%',
    gap: 12,
  },
  gap: {
    width: 12,
  },
});
