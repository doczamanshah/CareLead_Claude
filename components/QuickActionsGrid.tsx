import { useMemo, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useTheme } from '@/hooks/useTheme';
import { RADIUS, SPACING, TYPOGRAPHY } from '@/lib/constants/design';
import type { ThemePalette } from '@/lib/constants/themes';

interface QuickAction {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
}

function buildActions(activeProfileId: string | null): QuickAction[] {
  return [
    // Row 1
    {
      key: 'priorities',
      label: 'Priorities',
      icon: 'heart-outline',
      route: activeProfileId
        ? `/(main)/profile/${activeProfileId}/priorities`
        : '/(main)/(tabs)/health',
    },
    { key: 'catch-up', label: 'Catch Up', icon: 'camera-outline', route: '/(main)/capture/catch-up' },
    { key: 'snap', label: 'Snap Photo', icon: 'scan-outline', route: '/(main)/capture/camera' },
    { key: 'import', label: 'Import', icon: 'cloud-download-outline', route: '/(main)/capture/import-summary' },
    // Row 2
    { key: 'medications', label: 'Medications', icon: 'medical-outline', route: '/(main)/medications' },
    { key: 'appointments', label: 'Appointments', icon: 'calendar-outline', route: '/(main)/appointments' },
    { key: 'voice', label: 'Voice Note', icon: 'mic-outline', route: '/(main)/capture/voice' },
    { key: 'tasks', label: 'Tasks', icon: 'checkmark-circle-outline', route: '/(main)/(tabs)/activity' },
  ];
}

function ActionButton({
  action,
  styles,
  iconColor,
}: {
  action: QuickAction;
  styles: ReturnType<typeof buildStyles>;
  iconColor: string;
}) {
  const router = useRouter();
  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scale, {
      toValue: 0.95,
      useNativeDriver: true,
      friction: 8,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      friction: 8,
    }).start();
  };

  return (
    <View style={styles.cell}>
      <TouchableOpacity
        activeOpacity={0.85}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={() => router.push(action.route as never)}
        accessibilityLabel={action.label}
      >
        <Animated.View style={[styles.column, { transform: [{ scale }] }]}>
          <View style={styles.circle}>
            <Ionicons name={action.icon} size={22} color={iconColor} />
          </View>
          <Text style={styles.label} numberOfLines={1}>
            {action.label}
          </Text>
        </Animated.View>
      </TouchableOpacity>
    </View>
  );
}

export function QuickActionsGrid() {
  const { activeProfileId } = useActiveProfile();
  const { colors, isDark } = useTheme();
  const actions = useMemo(() => buildActions(activeProfileId), [activeProfileId]);
  const styles = useMemo(() => buildStyles(colors, isDark), [colors, isDark]);
  // Dark mode: primary is already lightened (see DARK_THEME). Use the
  // lighter variant on dark so the icon pops against the dark circle.
  const iconColor = isDark ? colors.primary.lighter : colors.primary.DEFAULT;

  return (
    <View style={styles.grid}>
      {actions.map((a) => (
        <ActionButton
          key={a.key}
          action={a}
          styles={styles}
          iconColor={iconColor}
        />
      ))}
    </View>
  );
}

function buildStyles(colors: ThemePalette, isDark: boolean) {
  return StyleSheet.create({
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      rowGap: SPACING.lg,
    },
    cell: {
      width: '25%',
      alignItems: 'center',
    },
    column: {
      alignItems: 'center',
    },
    circle: {
      width: 48,
      height: 48,
      borderRadius: RADIUS.full,
      // In dark mode `primary.lightest` is a very dark green tint, so this
      // still reads as a subtle green chip — just inverted.
      backgroundColor: isDark
        ? colors.primary.lightest
        : colors.primary.lightest,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: SPACING.xs + 2,
    },
    label: {
      ...TYPOGRAPHY.caption,
      fontWeight: '500',
      color: colors.text.secondary,
      textAlign: 'center',
      maxWidth: 72,
    },
  });
}
