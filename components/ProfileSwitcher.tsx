import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useProfileStore } from '@/stores/profileStore';
import type { Profile } from '@/lib/types/profile';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import {
  getAvatarColor,
  getAvatarInitial,
  getRelationshipLabel,
} from '@/lib/utils/profileAvatar';

interface ProfileSwitcherProps {
  visible: boolean;
  onDismiss: () => void;
}

export function ProfileSwitcher({ visible, onDismiss }: ProfileSwitcherProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { profiles, activeProfileId } = useProfileStore();
  const switchProfile = useProfileStore((s) => s.switchProfile);

  const sorted = [...profiles].sort((a, b) => {
    if (a.relationship === 'self') return -1;
    if (b.relationship === 'self') return 1;
    return a.display_name.localeCompare(b.display_name);
  });

  const activeProfile = sorted.find((p) => p.id === activeProfileId) ?? null;

  function handleSelect(profile: Profile) {
    if (profile.id !== activeProfileId) {
      switchProfile(profile.id);
      // Nuclear invalidation so every profile-scoped query refetches. Query
      // keys already include activeProfileId, so this is a belt-and-braces
      // refresh (covers ask cache, prefetched indexes, side-effect state).
      queryClient.invalidateQueries();
    }
    onDismiss();
  }

  function handleViewProfile() {
    if (!activeProfileId) return;
    onDismiss();
    router.push(`/(main)/profile/${activeProfileId}`);
  }

  function handleAddMember() {
    onDismiss();
    router.push('/(main)/caregivers/add-member');
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <View style={styles.backdrop}>
        <TouchableOpacity
          style={styles.backdropTouch}
          activeOpacity={1}
          onPress={onDismiss}
        />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>Switch Profile</Text>
            <TouchableOpacity onPress={onDismiss} hitSlop={8}>
              <Ionicons name="close" size={22} color={COLORS.text.secondary} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          >
            {sorted.map((profile) => {
              const isActive = profile.id === activeProfileId;
              return (
                <TouchableOpacity
                  key={profile.id}
                  style={[styles.row, isActive && styles.rowActive]}
                  activeOpacity={0.7}
                  onPress={() => handleSelect(profile)}
                >
                  <View
                    style={[
                      styles.avatar,
                      { backgroundColor: getAvatarColor(profile.id) },
                    ]}
                  >
                    <Text style={styles.avatarText}>
                      {getAvatarInitial(profile.display_name)}
                    </Text>
                  </View>
                  <View style={styles.info}>
                    <Text style={styles.name} numberOfLines={1}>
                      {profile.display_name}
                    </Text>
                    <Text style={styles.relationship} numberOfLines={1}>
                      {getRelationshipLabel(profile)}
                    </Text>
                  </View>
                  {isActive ? (
                    <Ionicons
                      name="checkmark-circle"
                      size={22}
                      color={COLORS.primary.DEFAULT}
                    />
                  ) : (
                    <Ionicons
                      name="chevron-forward"
                      size={18}
                      color={COLORS.text.tertiary}
                    />
                  )}
                </TouchableOpacity>
              );
            })}

            {activeProfile ? (
              <TouchableOpacity
                style={styles.viewRow}
                activeOpacity={0.7}
                onPress={handleViewProfile}
              >
                <View style={styles.viewIconWrap}>
                  <Ionicons
                    name="person-outline"
                    size={20}
                    color={COLORS.primary.DEFAULT}
                  />
                </View>
                <Text style={styles.viewText} numberOfLines={1}>
                  View {activeProfile.display_name}'s Profile
                </Text>
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={COLORS.text.tertiary}
                />
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity
              style={styles.addRow}
              activeOpacity={0.7}
              onPress={handleAddMember}
            >
              <View style={styles.addIconWrap}>
                <Ionicons
                  name="add"
                  size={22}
                  color={COLORS.primary.DEFAULT}
                />
              </View>
              <Text style={styles.addText}>Add Family Member</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'flex-end',
  },
  backdropTouch: {
    flex: 1,
  },
  sheet: {
    backgroundColor: COLORS.surface.DEFAULT,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 10,
    paddingBottom: 24,
    paddingHorizontal: 20,
    maxHeight: '80%',
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border.DEFAULT,
    marginBottom: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  title: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
  },
  list: {
    maxHeight: 440,
  },
  listContent: {
    gap: 6,
    paddingBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    backgroundColor: COLORS.background.DEFAULT,
    gap: 12,
  },
  rowActive: {
    backgroundColor: COLORS.primary.DEFAULT + '14',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: COLORS.text.inverse,
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.bold,
  },
  info: {
    flex: 1,
  },
  name: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  relationship: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    marginTop: 2,
  },
  viewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    backgroundColor: COLORS.background.DEFAULT,
    gap: 12,
    marginTop: 8,
  },
  viewIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary.DEFAULT + '14',
  },
  viewText: {
    flex: 1,
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: COLORS.primary.DEFAULT + '33',
    gap: 12,
    marginTop: 8,
  },
  addIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary.DEFAULT + '14',
  },
  addText: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.primary.DEFAULT,
  },
});
