import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { COLORS } from '@/lib/constants/colors';
import { RADIUS, SPACING, TYPOGRAPHY } from '@/lib/constants/design';

function getInitial(name: string | undefined | null): string {
  if (!name) return '?';
  return name.trim().charAt(0).toUpperCase() || '?';
}

interface TabHeaderProps {
  title: string;
  /** Hide the profile avatar (e.g., on Ask which has its own header). */
  hideAvatar?: boolean;
  /** Hide the settings gear (e.g., on Ask which has its own header). */
  hideSettings?: boolean;
  /** Optional right-side override (overrides the settings gear). */
  rightAccessory?: React.ReactNode;
}

export function TabHeader({
  title,
  hideAvatar = false,
  hideSettings = false,
  rightAccessory,
}: TabHeaderProps) {
  const router = useRouter();
  const { activeProfile, activeProfileId } = useActiveProfile();

  return (
    <View style={styles.header}>
      <View style={styles.side}>
        {!hideAvatar && (
          <TouchableOpacity
            style={styles.avatar}
            activeOpacity={0.7}
            accessibilityLabel="Open profile"
            onPress={() => {
              if (activeProfileId) {
                router.push(`/(main)/profile/${activeProfileId}`);
              }
            }}
          >
            <Text style={styles.avatarText}>
              {getInitial(activeProfile?.display_name)}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>

      <View style={[styles.side, styles.sideRight]}>
        {rightAccessory ??
          (!hideSettings && (
            <TouchableOpacity
              style={styles.iconButton}
              activeOpacity={0.7}
              accessibilityLabel="Open settings"
              onPress={() => router.push('/(main)/settings')}
            >
              <Ionicons
                name="settings-outline"
                size={22}
                color={COLORS.text.secondary}
              />
            </TouchableOpacity>
          ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md - 2,
    backgroundColor: COLORS.background.card,
    borderBottomColor: COLORS.border.DEFAULT,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  side: {
    width: 44,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sideRight: {
    justifyContent: 'flex-end',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.primary.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: COLORS.text.inverse,
    fontSize: 15,
    fontWeight: '700',
  },
  title: {
    flex: 1,
    ...TYPOGRAPHY.h3,
    color: COLORS.text.DEFAULT,
    textAlign: 'center',
  },
  iconButton: {
    padding: 6,
  },
});
