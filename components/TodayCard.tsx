import { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { useTodayCard } from '@/hooks/useHomeScreen';
import { useTheme } from '@/hooks/useTheme';
import { RADIUS, SPACING, TYPOGRAPHY } from '@/lib/constants/design';

export function TodayCard() {
  const router = useRouter();
  const data = useTodayCard();
  const { colors } = useTheme();
  const styles = useMemo(() => buildStyles(colors), [colors]);

  const handlePress = () => {
    if (!data.route) return;
    if (data.routeParams) {
      router.push({ pathname: data.route, params: data.routeParams } as never);
    } else {
      router.push(data.route as never);
    }
  };

  const isAllClear = data.kind === 'all_clear';

  return (
    <Card variant="accent" accentColor={data.accentColor} padding="none">
      <View style={styles.content}>
        <View style={styles.iconWrap}>
          <Ionicons
            name={data.icon as keyof typeof Ionicons.glyphMap}
            size={22}
            color={data.accentColor}
          />
        </View>
        <View style={styles.textWrap}>
          <Text
            style={[styles.title, isAllClear && { color: colors.status.success }]}
            numberOfLines={1}
          >
            {data.title}
          </Text>
          {data.detail && (
            <Text style={styles.detail} numberOfLines={1}>
              {data.detail}
            </Text>
          )}
        </View>
        {data.actionLabel && data.route && (
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: data.accentColor }]}
            activeOpacity={0.85}
            onPress={handlePress}
            accessibilityLabel={data.actionLabel}
          >
            <Text style={styles.actionText}>{data.actionLabel}</Text>
          </TouchableOpacity>
        )}
      </View>
    </Card>
  );
}

function buildStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    content: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: SPACING.lg,
      paddingVertical: SPACING.lg,
      minHeight: 80,
      gap: SPACING.md,
    },
    iconWrap: {
      width: 40,
      height: 40,
      borderRadius: RADIUS.full,
      backgroundColor: colors.background.subtle,
      alignItems: 'center',
      justifyContent: 'center',
    },
    textWrap: {
      flex: 1,
    },
    title: {
      ...TYPOGRAPHY.h4,
      color: colors.text.DEFAULT,
    },
    detail: {
      ...TYPOGRAPHY.bodySmall,
      color: colors.text.secondary,
      marginTop: 2,
    },
    actionButton: {
      paddingHorizontal: SPACING.lg,
      paddingVertical: SPACING.sm,
      borderRadius: RADIUS.sm,
    },
    actionText: {
      ...TYPOGRAPHY.buttonSmall,
      color: '#FFFFFF',
    },
  });
}
