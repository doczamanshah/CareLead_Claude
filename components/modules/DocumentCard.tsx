import { View, Text, StyleSheet } from 'react-native';
import { Card } from '@/components/ui/Card';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import type { Artifact, ProcessingStatus, SourceChannel } from '@/lib/types/artifacts';

interface DocumentCardProps {
  artifact: Artifact;
  onPress?: () => void;
}

const SOURCE_ICONS: Record<SourceChannel, string> = {
  camera: '📷',
  upload: '📄',
  voice: '🎙️',
  manual: '✏️',
};

const STATUS_CONFIG: Record<ProcessingStatus, { label: string; color: string; bg: string }> = {
  pending: { label: 'Processing...', color: COLORS.warning.DEFAULT, bg: COLORS.warning.light },
  processing: { label: 'Processing...', color: COLORS.warning.DEFAULT, bg: COLORS.warning.light },
  completed: { label: 'Ready', color: COLORS.success.DEFAULT, bg: COLORS.success.light },
  failed: { label: 'Failed', color: COLORS.error.DEFAULT, bg: COLORS.error.light },
};

export function DocumentCard({ artifact, onPress }: DocumentCardProps) {
  const icon = SOURCE_ICONS[artifact.source_channel] ?? '📄';
  const status = STATUS_CONFIG[artifact.processing_status];

  function formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  return (
    <Card onPress={onPress}>
      <View style={styles.row}>
        <Text style={styles.icon}>{icon}</Text>
        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={1}>
            {artifact.file_name}
          </Text>
          <Text style={styles.meta}>{formatDate(artifact.created_at)}</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: status.bg }]}>
          <Text style={[styles.badgeText, { color: status.color }]}>
            {status.label}
          </Text>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  icon: {
    fontSize: 28,
    marginRight: 12,
  },
  info: {
    flex: 1,
  },
  name: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  meta: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginTop: 2,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginLeft: 8,
  },
  badgeText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
  },
});
