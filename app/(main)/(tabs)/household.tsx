import { useState } from 'react';
import { View, Text, Alert, Modal, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenLayout } from '@/components/ui/ScreenLayout';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ProfileCard } from '@/components/modules/ProfileCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useCreateDependentProfile } from '@/hooks/useProfiles';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

export default function HouseholdScreen() {
  const { profiles, activeProfileId, switchProfile } = useActiveProfile();
  const createDependent = useCreateDependentProfile();
  const router = useRouter();

  const [showAddModal, setShowAddModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDob, setNewDob] = useState('');
  const [newGender, setNewGender] = useState('');

  function handleAddMember() {
    if (!newName.trim()) {
      Alert.alert('Required', 'Please enter a name.');
      return;
    }

    createDependent.mutate(
      {
        display_name: newName.trim(),
        date_of_birth: newDob.trim() || undefined,
        gender: newGender.trim() || undefined,
      },
      {
        onSuccess: () => {
          setShowAddModal(false);
          setNewName('');
          setNewDob('');
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
      <Text style={styles.subtitle}>
        {profiles.length} {profiles.length === 1 ? 'profile' : 'profiles'} in your household
      </Text>

      {profiles.map((profile) => (
        <ProfileCard
          key={profile.id}
          profile={profile}
          isActive={profile.id === activeProfileId}
          onPress={() => router.push(`/(main)/profile/${profile.id}`)}
        />
      ))}

      <View style={styles.addButton}>
        <Button
          title="+ Add Family Member"
          variant="outline"
          onPress={() => setShowAddModal(true)}
        />
      </View>

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

          <Input
            label="Date of Birth (optional)"
            placeholder="YYYY-MM-DD"
            value={newDob}
            onChangeText={setNewDob}
            keyboardType="numbers-and-punctuation"
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

const styles = StyleSheet.create({
  subtitle: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginBottom: 16,
  },
  addButton: {
    marginTop: 8,
    marginBottom: 24,
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
