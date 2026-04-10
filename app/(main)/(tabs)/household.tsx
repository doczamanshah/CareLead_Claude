import { useState } from 'react';
import { View, Text, Alert, Modal, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenLayout } from '@/components/ui/ScreenLayout';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { DatePicker } from '@/components/ui/DatePicker';
import { ProfileCard } from '@/components/modules/ProfileCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useCreateDependentProfile } from '@/hooks/useProfiles';
import { useAuth } from '@/hooks/useAuth';
import { useAccessGrants, useMyAccessGrants, usePendingInvites } from '@/hooks/useCaregivers';
import { PERMISSION_TEMPLATE_MAP } from '@/lib/constants/permissionTemplates';
import type { PermissionTemplateId } from '@/lib/constants/permissionTemplates';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

export default function HouseholdScreen() {
  const { profiles, activeProfileId, activeProfile, switchProfile } = useActiveProfile();
  const { user } = useAuth();
  const createDependent = useCreateDependentProfile();
  const router = useRouter();

  const householdId = activeProfile?.household_id ?? null;
  const { data: pendingInvites } = usePendingInvites(householdId);
  const { data: myGrants } = useMyAccessGrants();

  // Check if current user is a household owner (has a 'self' profile)
  const isOwner = profiles.some((p) => p.relationship === 'self' && p.user_id === user?.id);

  const [showAddModal, setShowAddModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDob, setNewDob] = useState<Date | null>(null);
  const [newGender, setNewGender] = useState('');

  function handleAddMember() {
    if (!newName.trim()) {
      Alert.alert('Required', 'Please enter a name.');
      return;
    }

    createDependent.mutate(
      {
        display_name: newName.trim(),
        date_of_birth: newDob ? newDob.toISOString().split('T')[0] : undefined,
        gender: newGender.trim() || undefined,
      },
      {
        onSuccess: () => {
          setShowAddModal(false);
          setNewName('');
          setNewDob(null);
          setNewGender('');
        },
        onError: (err) => {
          Alert.alert('Error', err.message);
        },
      },
    );
  }

  if (profiles.length === 0) {
    return (
      <ScreenLayout title="Household">
        <EmptyState
          title="No profiles yet"
          description="Your profiles will appear here after you sign in."
        />
      </ScreenLayout>
    );
  }

  return (
    <ScreenLayout title="Household">
      {/* Family Members Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Family Members</Text>
        <Text style={styles.sectionSubtitle}>
          {profiles.length} {profiles.length === 1 ? 'profile' : 'profiles'} in your household
        </Text>

        {profiles.map((profile) => (
          <View key={profile.id} style={styles.profileRow}>
            <ProfileCard
              profile={profile}
              isActive={profile.id === activeProfileId}
              onPress={() => router.push(`/(main)/profile/${profile.id}`)}
            />
            <CaregiverCountBadge profileId={profile.id} onPress={() =>
              router.push({
                pathname: '/(main)/caregivers/',
                params: { profileId: profile.id },
              })
            } />
          </View>
        ))}

        {isOwner && (
          <View style={styles.addButton}>
            <Button
              title="+ Add Family Member"
              variant="outline"
              onPress={() => setShowAddModal(true)}
            />
          </View>
        )}
      </View>

      {/* Caregivers Section — for household owners */}
      {isOwner && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Caregivers</Text>
          {(pendingInvites ?? []).length > 0 ? (
            <Card
              onPress={() => router.push('/(main)/caregivers/')}
              style={styles.summaryCard}
            >
              <Text style={styles.summaryText}>
                {(pendingInvites ?? []).length} pending{' '}
                {(pendingInvites ?? []).length === 1 ? 'invitation' : 'invitations'}
              </Text>
              <Text style={styles.summaryLink}>View all</Text>
            </Card>
          ) : (
            <Text style={styles.emptyText}>
              No caregivers yet. Invite someone to help manage care.
            </Text>
          )}

          <View style={styles.inviteButton}>
            <Button
              title="Invite a Caregiver"
              onPress={() => router.push('/(main)/caregivers/invite')}
            />
          </View>
        </View>
      )}

      {/* My Access Section — for caregivers viewing what they have access to */}
      {!isOwner && (myGrants ?? []).length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>My Access</Text>
          <Text style={styles.sectionSubtitle}>
            Profiles you've been given access to
          </Text>
          {(myGrants ?? []).map((grant) => {
            const tmpl = PERMISSION_TEMPLATE_MAP[grant.permission_template as PermissionTemplateId];
            return (
              <Card key={grant.id} style={styles.accessCard}>
                <View style={styles.accessRow}>
                  <View style={styles.accessInfo}>
                    <Text style={styles.accessProfileId}>
                      Profile: {grant.profile_id.slice(0, 8)}...
                    </Text>
                    <View style={styles.accessBadge}>
                      <Text style={styles.accessBadgeText}>
                        {tmpl?.name ?? grant.permission_template}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.accessDate}>
                    Since {new Date(grant.granted_at).toLocaleDateString()}
                  </Text>
                </View>
              </Card>
            );
          })}
        </View>
      )}

      {/* Add Family Member Modal */}
      <Modal
        visible={showAddModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowAddModal(false)}
      >
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Add Family Member</Text>
            <Button
              title="Cancel"
              variant="ghost"
              size="sm"
              onPress={() => setShowAddModal(false)}
            />
          </View>

          <Input
            label="Name"
            placeholder="Family member's name"
            value={newName}
            onChangeText={setNewName}
            autoCapitalize="words"
          />

          <DatePicker
            label="Date of Birth (optional)"
            placeholder="Select date of birth"
            value={newDob}
            onChange={setNewDob}
            mode="date"
            maximumDate={new Date()}
          />

          <Input
            label="Gender (optional)"
            placeholder="e.g. Male, Female"
            value={newGender}
            onChangeText={setNewGender}
          />

          <View style={styles.modalSave}>
            <Button
              title="Add Member"
              onPress={handleAddMember}
              loading={createDependent.isPending}
            />
          </View>
        </View>
      </Modal>
    </ScreenLayout>
  );
}

/**
 * Small badge showing caregiver count for a profile, with a tap to manage.
 */
function CaregiverCountBadge({
  profileId,
  onPress,
}: {
  profileId: string;
  onPress: () => void;
}) {
  const { data: grants } = useAccessGrants(profileId);
  const activeCount = (grants ?? []).filter((g) => g.status === 'active').length;

  if (activeCount === 0) return null;

  return (
    <Card onPress={onPress} style={styles.countBadge}>
      <Text style={styles.countBadgeText}>
        {activeCount} {activeCount === 1 ? 'caregiver' : 'caregivers'}
      </Text>
      <Text style={styles.countBadgeLink}>Manage Access</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 28,
  },
  sectionTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginBottom: 16,
  },
  profileRow: {
    marginBottom: 4,
  },
  addButton: {
    marginTop: 8,
  },
  summaryCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  summaryText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
  },
  summaryLink: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  emptyText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.tertiary,
    marginBottom: 12,
  },
  inviteButton: {
    marginTop: 4,
  },
  accessCard: {
    marginBottom: 8,
  },
  accessRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  accessInfo: {
    flex: 1,
  },
  accessProfileId: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  accessBadge: {
    backgroundColor: COLORS.primary.light,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  accessBadgeText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  accessDate: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
  },
  countBadge: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: -4,
    marginBottom: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  countBadgeText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
  },
  countBadgeLink: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  modal: {
    flex: 1,
    backgroundColor: COLORS.background.DEFAULT,
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: FONT_SIZES.xl,
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
  },
  modalSave: {
    marginTop: 16,
  },
});
