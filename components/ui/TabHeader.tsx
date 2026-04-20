import { useState, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useTheme } from '@/hooks/useTheme';
import { ProfileSwitcher } from '@/components/ProfileSwitcher';
import { RADIUS, SPACING, TYPOGRAPHY } from '@/lib/constants/design';
import { getAvatarColor, getAvatarInitial } from '@/lib/utils/profileAvatar';

type TabHeaderVariant = 'default' | 'branded';

interface TabHeaderProps {
  title: string;
  /** Hide the profile avatar (e.g., on Ask which has its own header). */
  hideAvatar?: boolean;
  /** Hide the settings gear (e.g., on Ask which has its own header). */
  hideSettings?: boolean;
  /** Optional right-side override (overrides the settings gear). */
  rightAccessory?: React.ReactNode;
  /**
   * `'branded'` renders the dark-green Home-screen header with the CL
   * wordmark replacing the title. Default (white bg) is used on all
   * other tabs.
   */
  variant?: TabHeaderVariant;
}

export function TabHeader({
  title,
  hideAvatar = false,
  hideSettings = false,
  rightAccessory,
  variant = 'default',
}: TabHeaderProps) {
  const router = useRouter();
  const { colors } = useTheme();
  const { activeProfile, activeProfileId, profiles } = useActiveProfile();
  const [switcherOpen, setSwitcherOpen] = useState(false);

  const hasFamilyMembers = profiles.length > 1;
  const isDependent = activeProfile?.relationship === 'dependent';
  const isBranded = variant === 'branded';

  // On the branded header the avatar is inverted (white circle, primary text);
  // on the default header it uses the per-profile avatar color as before.
  const avatarColor = getAvatarColor(activeProfileId);
  const styles = useMemo(
    () => buildStyles(colors, isBranded),
    [colors, isBranded],
  );

  function handleAvatarPress() {
    if (hasFamilyMembers) {
      setSwitcherOpen(true);
    } else if (activeProfileId) {
      router.push(`/(main)/profile/${activeProfileId}`);
    }
  }

  const settingsIconColor = isBranded
    ? colors.text.inverse
    : colors.text.secondary;
  const switcherDotBorder = isBranded
    ? colors.primary.DEFAULT
    : colors.background.card;

  return (
    <>
      <View style={styles.header}>
        <View style={styles.side}>
          {!hideAvatar && (
            <TouchableOpacity
              style={styles.avatarWrap}
              activeOpacity={0.7}
              accessibilityLabel={
                hasFamilyMembers ? 'Switch profile' : 'Open profile'
              }
              onPress={handleAvatarPress}
            >
              <View
                style={[
                  styles.avatar,
                  isBranded
                    ? styles.avatarBranded
                    : { backgroundColor: avatarColor },
                ]}
              >
                <Text style={styles.avatarText}>
                  {getAvatarInitial(activeProfile?.display_name)}
                </Text>
              </View>
              {hasFamilyMembers && (
                <View
                  style={[
                    styles.switcherDot,
                    { borderColor: switcherDotBorder },
                  ]}
                >
                  <Ionicons
                    name="chevron-down"
                    size={10}
                    color={colors.text.inverse}
                  />
                </View>
              )}
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.titleBlock}>
          {isBranded ? (
            <View style={styles.brandRow}>
              <Ionicons
                name="leaf"
                size={18}
                color={colors.text.inverse}
                style={styles.brandIcon}
              />
              <Text style={styles.brandMark}>CL</Text>
            </View>
          ) : (
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
          )}
          {isDependent && activeProfile && (
            <TouchableOpacity
              onPress={() => setSwitcherOpen(true)}
              activeOpacity={0.7}
            >
              <Text style={styles.activeProfileLabel} numberOfLines={1}>
                {isBranded
                  ? `${activeProfile.display_name}'s Profile`
                  : `Viewing ${activeProfile.display_name}`}
              </Text>
            </TouchableOpacity>
          )}
        </View>

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
                  color={settingsIconColor}
                />
              </TouchableOpacity>
            ))}
        </View>
      </View>

      <ProfileSwitcher
        visible={switcherOpen}
        onDismiss={() => setSwitcherOpen(false)}
      />
    </>
  );
}

function buildStyles(
  colors: ReturnType<typeof useTheme>['colors'],
  isBranded: boolean,
) {
  const header: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md - 2,
    backgroundColor: isBranded ? colors.primary.DEFAULT : colors.background.card,
    borderBottomColor: isBranded ? 'transparent' : colors.border.DEFAULT,
    borderBottomWidth: isBranded ? 0 : StyleSheet.hairlineWidth,
  };

  const title: TextStyle = {
    ...TYPOGRAPHY.h3,
    color: isBranded ? colors.text.inverse : colors.text.DEFAULT,
    textAlign: 'center',
  };

  const activeProfileLabel: TextStyle = {
    ...TYPOGRAPHY.caption,
    color: isBranded ? 'rgba(255,255,255,0.8)' : colors.primary.DEFAULT,
    marginTop: 2,
    fontWeight: '600',
  };

  return StyleSheet.create({
    header,
    side: {
      width: 44,
      flexDirection: 'row',
      alignItems: 'center',
    },
    sideRight: {
      justifyContent: 'flex-end',
    },
    avatarWrap: {
      position: 'relative',
    },
    avatar: {
      width: 36,
      height: 36,
      borderRadius: RADIUS.full,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarBranded: {
      backgroundColor: '#FFFFFF',
    },
    avatarText: {
      color: isBranded ? colors.primary.DEFAULT : colors.text.inverse,
      fontSize: 15,
      fontWeight: '700',
    },
    switcherDot: {
      position: 'absolute',
      right: -2,
      bottom: -2,
      width: 16,
      height: 16,
      borderRadius: 8,
      backgroundColor: isBranded ? colors.primary.light : colors.primary.DEFAULT,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1.5,
    },
    titleBlock: {
      flex: 1,
      alignItems: 'center',
    },
    title,
    brandRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    brandIcon: {
      opacity: 0.9,
    },
    brandMark: {
      fontSize: 22,
      fontWeight: '800',
      letterSpacing: 1,
      color: colors.text.inverse,
    },
    activeProfileLabel,
    iconButton: {
      padding: 6,
    },
  });
}
