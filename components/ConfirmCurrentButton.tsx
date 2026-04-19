import { useEffect, useState } from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import { useConfirmCurrent } from '@/hooks/useDataQuality';
import type { DataQualitySourceType } from '@/lib/types/dataQuality';

interface ConfirmCurrentButtonProps {
  /** The source table containing the record to "touch" */
  sourceType: DataQualitySourceType;
  /** The ID of the record */
  sourceId: string;
  /** The active profile (used for cache invalidation) */
  profileId: string;
  /** Optional human label — used for accessibility, not displayed by default */
  label?: string;
  /** Compact "checkmark" variant vs. text "Still current?" variant */
  variant?: 'text' | 'icon';
  /** Called after a successful confirmation */
  onConfirmed?: () => void;
}

const SUCCESS_FLASH_MS = 1500;

export function ConfirmCurrentButton({
  sourceType,
  sourceId,
  profileId,
  label,
  variant = 'text',
  onConfirmed,
}: ConfirmCurrentButtonProps) {
  const mutation = useConfirmCurrent(profileId);
  const [justConfirmed, setJustConfirmed] = useState(false);

  useEffect(() => {
    if (!justConfirmed) return;
    const t = setTimeout(() => setJustConfirmed(false), SUCCESS_FLASH_MS);
    return () => clearTimeout(t);
  }, [justConfirmed]);

  const handlePress = () => {
    mutation.mutate(
      { sourceType, sourceId },
      {
        onSuccess: () => {
          setJustConfirmed(true);
          onConfirmed?.();
        },
      },
    );
  };

  const isPending = mutation.isPending;
  const showSuccess = justConfirmed && !isPending;

  if (variant === 'icon') {
    return (
      <TouchableOpacity
        onPress={handlePress}
        disabled={isPending || showSuccess}
        style={styles.iconButton}
        accessibilityLabel={label ? `Confirm ${label} is still current` : 'Confirm still current'}
        hitSlop={8}
        activeOpacity={0.7}
      >
        <Ionicons
          name={showSuccess ? 'checkmark-circle' : 'checkmark-circle-outline'}
          size={20}
          color={showSuccess ? COLORS.success.DEFAULT : COLORS.text.tertiary}
        />
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      onPress={handlePress}
      disabled={isPending || showSuccess}
      style={[styles.textButton, showSuccess && styles.textButtonSuccess]}
      accessibilityLabel={label ? `Confirm ${label} is still current` : 'Confirm still current'}
      activeOpacity={0.7}
    >
      <Ionicons
        name={showSuccess ? 'checkmark-circle' : 'checkmark-circle-outline'}
        size={14}
        color={showSuccess ? COLORS.success.DEFAULT : COLORS.primary.DEFAULT}
      />
      <Text
        style={[
          styles.textButtonText,
          showSuccess && { color: COLORS.success.DEFAULT },
        ]}
      >
        {showSuccess ? 'Confirmed' : isPending ? 'Confirming…' : 'Still current'}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  iconButton: {
    padding: 4,
  },
  textButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: COLORS.primary.DEFAULT + '0D',
  },
  textButtonSuccess: {
    backgroundColor: COLORS.success.light,
  },
  textButtonText: {
    fontSize: 12,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.primary.DEFAULT,
  },
});

