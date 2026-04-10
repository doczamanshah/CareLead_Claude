import { useState } from 'react';
import { View, Text, TouchableOpacity, Alert, StyleSheet, Share } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ScreenLayout } from '@/components/ui/ScreenLayout';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useAuth } from '@/hooks/useAuth';
import { useCreateInvite } from '@/hooks/useCaregivers';
import { PERMISSION_TEMPLATES } from '@/lib/constants/permissionTemplates';
import type { PermissionTemplateId } from '@/lib/constants/permissionTemplates';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

type Step = 'info' | 'profiles' | 'permissions' | 'review';

export default function InviteCaregiverScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ profileId?: string }>();
  const { profiles, activeProfile } = useActiveProfile();
  const { user } = useAuth();
  const createInvite = useCreateInvite();

  const [step, setStep] = useState<Step>('info');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [selectedProfiles, setSelectedProfiles] = useState<string[]>(
    params.profileId ? [params.profileId] : [],
  );
  const [selectedTemplate, setSelectedTemplate] = useState<PermissionTemplateId>('view_only');

  const householdId = activeProfile?.household_id;

  function toggleProfile(id: string) {
    setSelectedProfiles((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  }

  function validateInfo(): boolean {
    if (!email.trim()) {
      Alert.alert('Required', 'Please enter an email address.');
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      Alert.alert('Invalid', 'Please enter a valid email address.');
      return false;
    }
    return true;
  }

  function validateProfiles(): boolean {
    if (selectedProfiles.length === 0) {
      Alert.alert('Required', 'Please select at least one family member.');
      return false;
    }
    return true;
  }

  async function handleSend() {
    if (!householdId) {
      Alert.alert('Error', 'No household found.');
      return;
    }

    createInvite.mutate(
      {
        householdId,
        params: {
          invited_email: email.trim(),
          invited_name: name.trim() || undefined,
          profile_ids: selectedProfiles,
          permission_template: selectedTemplate,
        },
      },
      {
        onSuccess: async (invite) => {
          // Share the invite token (in v1, no email sending — share link instead)
          try {
            await Share.share({
              message: `You've been invited to help manage care on CareLead! Use this invite code to get started: ${invite.token}`,
            });
          } catch {
            // User cancelled share — that's fine
          }
          router.back();
        },
        onError: (err) => {
          Alert.alert('Error', err.message);
        },
      },
    );
  }

  function renderStep() {
    switch (step) {
      case 'info':
        return (
          <View>
            <Text style={styles.stepTitle}>Who are you inviting?</Text>
            <Text style={styles.stepDescription}>
              Enter their name and email. They'll receive an invite to join your care team.
            </Text>
            <Input
              label="Name (optional)"
              placeholder="Caregiver's name"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
            />
            <Input
              label="Email"
              placeholder="caregiver@example.com"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <View style={styles.stepActions}>
              <Button
                title="Next"
                onPress={() => {
                  if (validateInfo()) setStep('profiles');
                }}
              />
            </View>
          </View>
        );

      case 'profiles':
        return (
          <View>
            <Text style={styles.stepTitle}>Which family members?</Text>
            <Text style={styles.stepDescription}>
              Select the profiles {name || 'this caregiver'} should have access to.
            </Text>
            {profiles.map((profile) => {
              const isSelected = selectedProfiles.includes(profile.id);
              return (
                <TouchableOpacity
                  key={profile.id}
                  style={[styles.profileOption, isSelected && styles.profileOptionSelected]}
                  onPress={() => toggleProfile(profile.id)}
                >
                  <View style={styles.checkbox}>
                    {isSelected && <View style={styles.checkboxFill} />}
                  </View>
                  <View style={styles.profileOptionInfo}>
                    <Text style={styles.profileOptionName}>{profile.display_name}</Text>
                    <Text style={styles.profileOptionRelation}>{profile.relationship}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
            <View style={styles.stepActions}>
              <Button
                title="Back"
                variant="outline"
                onPress={() => setStep('info')}
              />
              <Button
                title="Next"
                onPress={() => {
                  if (validateProfiles()) setStep('permissions');
                }}
              />
            </View>
          </View>
        );

      case 'permissions':
        return (
          <View>
            <Text style={styles.stepTitle}>What can they do?</Text>
            <Text style={styles.stepDescription}>
              Choose a permission level. You can change this later.
            </Text>
            {PERMISSION_TEMPLATES.map((template) => {
              const isSelected = selectedTemplate === template.id;
              return (
                <TouchableOpacity
                  key={template.id}
                  style={[styles.templateCard, isSelected && styles.templateCardSelected]}
                  onPress={() => setSelectedTemplate(template.id)}
                >
                  <View style={styles.templateHeader}>
                    <View style={[styles.radio, isSelected && styles.radioSelected]}>
                      {isSelected && <View style={styles.radioFill} />}
                    </View>
                    <Text style={[styles.templateName, isSelected && styles.templateNameSelected]}>
                      {template.name}
                    </Text>
                  </View>
                  <Text style={styles.templateDescription}>{template.description}</Text>
                  <View style={styles.scopeList}>
                    {template.scopes.slice(0, 4).map((scope) => (
                      <View key={scope} style={styles.scopeChip}>
                        <Text style={styles.scopeChipText}>{formatScope(scope)}</Text>
                      </View>
                    ))}
                    {template.scopes.length > 4 && (
                      <View style={styles.scopeChip}>
                        <Text style={styles.scopeChipText}>
                          +{template.scopes.length - 4} more
                        </Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
            <View style={styles.stepActions}>
              <Button
                title="Back"
                variant="outline"
                onPress={() => setStep('profiles')}
              />
              <Button title="Review" onPress={() => setStep('review')} />
            </View>
          </View>
        );

      case 'review':
        const template = PERMISSION_TEMPLATES.find((t) => t.id === selectedTemplate);
        const selectedProfileNames = profiles
          .filter((p) => selectedProfiles.includes(p.id))
          .map((p) => p.display_name);
        return (
          <View>
            <Text style={styles.stepTitle}>Review Invitation</Text>

            <Card style={styles.reviewCard}>
              <View style={styles.reviewRow}>
                <Text style={styles.reviewLabel}>Inviting</Text>
                <Text style={styles.reviewValue}>
                  {name || email}
                  {name ? `\n${email}` : ''}
                </Text>
              </View>
              <View style={styles.reviewDivider} />
              <View style={styles.reviewRow}>
                <Text style={styles.reviewLabel}>Profiles</Text>
                <Text style={styles.reviewValue}>{selectedProfileNames.join(', ')}</Text>
              </View>
              <View style={styles.reviewDivider} />
              <View style={styles.reviewRow}>
                <Text style={styles.reviewLabel}>Permissions</Text>
                <Text style={styles.reviewValue}>{template?.name ?? selectedTemplate}</Text>
              </View>
              <View style={styles.reviewDivider} />
              <View style={styles.reviewRow}>
                <Text style={styles.reviewLabel}>Expires</Text>
                <Text style={styles.reviewValue}>7 days from now</Text>
              </View>
            </Card>

            <Text style={styles.consentNote}>
              By sending this invitation, you consent to sharing the selected profile data with this
              caregiver at the chosen permission level. A consent record will be created for your
              records.
            </Text>

            <View style={styles.stepActions}>
              <Button
                title="Back"
                variant="outline"
                onPress={() => setStep('permissions')}
              />
              <Button
                title="Send Invitation"
                onPress={handleSend}
                loading={createInvite.isPending}
              />
            </View>
          </View>
        );
    }
  }

  return (
    <ScreenLayout>
      {/* Step indicator */}
      <View style={styles.stepIndicator}>
        {(['info', 'profiles', 'permissions', 'review'] as Step[]).map((s, i) => (
          <View key={s} style={styles.stepDotRow}>
            {i > 0 && (
              <View
                style={[
                  styles.stepLine,
                  getStepIndex(step) >= i && styles.stepLineActive,
                ]}
              />
            )}
            <View
              style={[
                styles.stepDot,
                getStepIndex(step) >= i && styles.stepDotActive,
              ]}
            />
          </View>
        ))}
      </View>

      {renderStep()}
    </ScreenLayout>
  );
}

function getStepIndex(step: Step): number {
  const steps: Step[] = ['info', 'profiles', 'permissions', 'review'];
  return steps.indexOf(step);
}

function formatScope(scope: string): string {
  return scope
    .replace('.', ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const styles = StyleSheet.create({
  stepIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  stepDotRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.border.DEFAULT,
  },
  stepDotActive: {
    backgroundColor: COLORS.primary.DEFAULT,
  },
  stepLine: {
    width: 40,
    height: 2,
    backgroundColor: COLORS.border.DEFAULT,
  },
  stepLineActive: {
    backgroundColor: COLORS.primary.DEFAULT,
  },
  stepTitle: {
    fontSize: FONT_SIZES.xl,
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    marginBottom: 8,
  },
  stepDescription: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginBottom: 20,
  },
  stepActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
    marginBottom: 32,
  },
  profileOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    marginBottom: 8,
    backgroundColor: COLORS.surface.DEFAULT,
  },
  profileOptionSelected: {
    borderColor: COLORS.primary.DEFAULT,
    backgroundColor: COLORS.primary.light,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: COLORS.border.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxFill: {
    width: 14,
    height: 14,
    borderRadius: 2,
    backgroundColor: COLORS.primary.DEFAULT,
  },
  profileOptionInfo: {
    marginLeft: 12,
  },
  profileOptionName: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  profileOptionRelation: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    textTransform: 'capitalize',
  },
  templateCard: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    marginBottom: 10,
    backgroundColor: COLORS.surface.DEFAULT,
  },
  templateCardSelected: {
    borderColor: COLORS.primary.DEFAULT,
    backgroundColor: COLORS.primary.light,
  },
  templateHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: COLORS.border.DEFAULT,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  radioSelected: {
    borderColor: COLORS.primary.DEFAULT,
  },
  radioFill: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.primary.DEFAULT,
  },
  templateName: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  templateNameSelected: {
    color: COLORS.primary.DEFAULT,
  },
  templateDescription: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginBottom: 8,
    marginLeft: 30,
  },
  scopeList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginLeft: 30,
  },
  scopeChip: {
    backgroundColor: COLORS.background.DEFAULT,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  scopeChipText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
  },
  reviewCard: {
    marginBottom: 16,
  },
  reviewRow: {
    flexDirection: 'row',
    paddingVertical: 8,
  },
  reviewLabel: {
    width: 100,
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.tertiary,
  },
  reviewValue: {
    flex: 1,
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
  },
  reviewDivider: {
    height: 1,
    backgroundColor: COLORS.border.light,
  },
  consentNote: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    textAlign: 'center',
    marginBottom: 8,
    lineHeight: 18,
  },
});
