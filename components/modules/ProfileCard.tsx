import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import type { Profile } from '@/lib/types/profile';

interface ProfileCardProps {
  profile: Profile;
  isActive?: boolean;
  onPress?: () => void;
  compact?: boolean;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function ProfileCard({ profile, isActive, onPress, compact }: ProfileCardProps) {
  const initials = getInitials(profile.display_name);
  const isDependent = profile.relationship === 'dependent';

  if (compact) {
    return (
      <TouchableOpacity
        onPress={onPress}
        style={[styles.compactCard, isActive && styles.compactCardActive]}
        activeOpacity={0.7}
      >
        <View style={[styles.avatarSmall, isActive && styles.avatarActive]}>
          <Text style={[styles.avatarTextSmall, isActive && styles.avatarTextActive]}>
            {initials}
          </Text>
        </View>
        <Text
          style={[styles.compactName, isActive && styles.compactNameActive]}
          numberOfLines={1}
        >
          {profile.display_name}
        </Text>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.card, isActive && styles.cardActive]}
      activeOpacity={0.7}
    >
      <View style={[styles.avatar, isActive && styles.avatarActive]}>
        <Text style={[styles.avatarText, isActive && styles.avatarTextActive]}>
          {initials}
        </Text>
      </View>
      <View style={styles.info}>
        <Text style={styles.name}>{profile.display_name}</Text>
        <Text style={styles.relationship}>
          {isDependent ? 'Family Member' : 'Self'}
        </Text>
      </View>
      {isActive && <View style={styles.activeBadge}><Text style={styles.activeBadgeText}>Active</Text></View>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface.DEFAULT,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    marginBottom: 12,
  },
  cardActive: {
    borderColor: COLORS.primary.DEFAULT,
    backgroundColor: '#F0F7F4',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.secondary.light,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarActive: {
    backgroundColor: COLORS.primary.DEFAULT,
  },
  avatarText: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.primary.DEFAULT,
  },
  avatarTextActive: {
    color: COLORS.text.inverse,
  },
  info: {
    flex: 1,
    marginLeft: 12,
  },
  name: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  relationship: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginTop: 2,
  },
  activeBadge: {
    backgroundColor: COLORS.primary.DEFAULT,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  activeBadgeText: {
    color: COLORS.text.inverse,
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  // Compact variant for horizontal profile switcher
  compactCard: {
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    marginRight: 8,
    backgroundColor: COLORS.surface.DEFAULT,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    minWidth: 72,
  },
  compactCardActive: {
    borderColor: COLORS.primary.DEFAULT,
    backgroundColor: '#F0F7F4',
  },
  avatarSmall: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.secondary.light,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  avatarTextSmall: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.primary.DEFAULT,
  },
  compactName: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.secondary,
    maxWidth: 64,
    textAlign: 'center',
  },
  compactNameActive: {
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
});
