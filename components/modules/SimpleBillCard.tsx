import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

interface SimpleBillCardProps {
  providerName: string | null;
  serviceDate: string | null;
  patientResponsibility: number;
  onRecordPayment: () => void;
  onSomethingWrong: () => void;
  onSaveForLater: () => void;
}

export function SimpleBillCard({
  providerName,
  serviceDate,
  patientResponsibility,
  onRecordPayment,
  onSomethingWrong,
  onSaveForLater,
}: SimpleBillCardProps) {
  const header = [providerName, formatServiceDate(serviceDate)]
    .filter(Boolean)
    .join(' — ');

  return (
    <View style={styles.card}>
      <Text style={styles.header} numberOfLines={2}>
        {header || 'Bill ready'}
      </Text>

      <Text style={styles.amountLabel}>You owe</Text>
      <Text style={styles.amount}>${patientResponsibility.toFixed(2)}</Text>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.button, styles.primaryButton]}
          onPress={onRecordPayment}
          activeOpacity={0.8}
        >
          <Ionicons name="card-outline" size={16} color={COLORS.text.inverse} />
          <Text style={styles.primaryText}>Record Payment</Text>
        </TouchableOpacity>

        <View style={styles.secondaryRow}>
          <TouchableOpacity
            style={[styles.button, styles.secondaryButton]}
            onPress={onSomethingWrong}
            activeOpacity={0.7}
          >
            <Text style={styles.secondaryText}>Something seems wrong</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.ghostButton]}
            onPress={onSaveForLater}
            activeOpacity={0.7}
          >
            <Text style={styles.ghostText}>Save for later</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

function formatServiceDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface.DEFAULT,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: COLORS.primary.DEFAULT + '33',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  header: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.secondary,
    marginBottom: 12,
  },
  amountLabel: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontWeight: FONT_WEIGHTS.semibold,
    marginBottom: 4,
  },
  amount: {
    fontSize: FONT_SIZES['4xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.primary.DEFAULT,
    marginBottom: 20,
  },
  actions: {
    gap: 10,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  primaryButton: {
    backgroundColor: COLORS.primary.DEFAULT,
  },
  primaryText: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.inverse,
  },
  secondaryRow: {
    flexDirection: 'row',
    gap: 10,
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: COLORS.primary.DEFAULT + '14',
  },
  secondaryText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.primary.DEFAULT,
    textAlign: 'center',
  },
  ghostButton: {
    flex: 1,
    backgroundColor: COLORS.surface.muted,
  },
  ghostText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.secondary,
    textAlign: 'center',
  },
});
