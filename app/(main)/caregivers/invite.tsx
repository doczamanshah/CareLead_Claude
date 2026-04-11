import { useState } from 'react';
import { View, Text, TouchableOpacity, Alert, StyleSheet, Share, Platform } from 'react-native';
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

type Step = 'info' | 'profiles' | 'permissions' | 'review' | 'success';
type ContactMethod = 'email' | 'phone';

export default function InviteCaregiverScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ profileId?: string }>();
  const { profiles, activeProfile } = useActiveProfile();
  const { user } = useAuth();
  const createInvite = useCreateInvite();

  const [step, setStep] = useState<Step>('info');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [contactMethod, setContactMethod] = useState<ContactMethod>('email');
  const [selectedProfiles, setSelectedProfiles] = useState<string[]>(
    params.profileId ? [params.profileId] : [],
  );
  const [selectedTemplate, setSelectedTemplate] = useState<PermissionTemplateId>('view_only');
  const [createdToken, setCreatedToken] = useState<string | null>(null);

  const householdId = activeProfile?.household_id;
  const inviteeName = name || email || phone || 'this person';
  const patientName = activeProfile?.display_name || 'Your family';

  function toggleProfile(id: string) {
    setSelectedProfiles((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  }

  function validateInfo(): boolean {
    if (contactMethod === 'email') {
      if (!email.trim()) {
        Alert.alert('Required', 'Please enter an email address.');
        return false;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        Alert.alert('Invalid', 'Please enter a valid email address.');
        return false;
      }
    } else {
      if (!phone.trim()) {
        Alert.alert('Required', 'Please enter a phone number.');
        return false;
      }
      // Basic phone validation: at least 7 digits
      const digits = phone.replace(/\D/g, '');
      if (digits.length < 7) {
        Alert.alert('Invalid', 'Please enter a valid phone number.');
        return false;
      }
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

  function getShareMessage(): string {
    const inviteLink = `carelead://invite/${createdToken}`;
    const appStoreLink = '[App Store link coming soon]';

    if (contactMethod === 'email') {
      return `Hello,\n\n${patientName} has invited you to help manage care on CareLead.\n\nTap this link to accept the invitation:\n${inviteLink}\n\nIf you don't have CareLead yet, download it here:\n${appStoreLink}\n\nOr enter this invite code manually: ${createdToken}`;
    }

    return `${patientName} has invited you to help manage care on CareLead. Tap this link to join: ${inviteLink}\n\nDownload CareLead: ${appStoreLink}`;
  }

  async function handleCreateAndShare() {
    if (!householdId) {
      Alert.alert('Error', 'No household found.');
      return;
    }

    createInvite.mutate(
      {
        householdId,
        params: {
          invited_email: email.trim() || undefined,
          invited_phone: phone.trim() || undefined,
          invited_name: name.trim() || undefined,
          profile_ids: selectedProfiles,
          permission_template: selectedTemplate,
        },
      },
      {
        onSuccess: async (invite) => {
          setCreatedToken(invite.token);
          setStep('success');

          // Open share sheet
          try {
            const inviteLink = `carelead://invite/${invite.token}`;
            const appStoreLink = '[App Store link coming soon]';

            let message: string;
            if (contactMethod === 'email') {
              message = `Hello,\n\n${patientName} has invited you to help manage care on CareLead.\n\nTap this link to accept the invitation:\n${inviteLink}\n\nIf you don't have CareLead yet, download it here:\n${appStoreLink}\n\nOr enter this invite code manually: ${invite.token}`;
            } else {
              message = `${patientName} has invited you to help manage care on CareLead. Tap this link to join: ${inviteLink}\n\nDownload CareLead: ${appStoreLink}`;
            }

            await Share.share({ message });
          } catch {
            // User cancelled share — that's fine, they're on the success screen
          }
        },
        onError: (err) => {
          Alert.alert('Error', err.message);
        },
      },
    );
  }

  async function handleShareAgain() {
    if (!createdToken) return;
    try {
      await Share.share({ message: getShareMessage() });
    } catch {
      // User cancelled
    }
  }

  function renderContactMethodToggle() {
    return (
      <View style={styles.toggleRow}>
        <TouchableOpacity
          style={[styles.toggleButton, contactMethod === 'email' && styles.toggleButtonActive]}
          onPress={() => setContactMethod('email')}
        >
          <Text
            style={[styles.toggleText, contactMethod === 'email' && styles.toggleTextActive]}
          >
            Email
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleButton, contactMethod === 'phone' && styles.toggleButtonActive]}
          onPress={() => setContactMethod('phone')}
        >
          <Text
            style={[styles.toggleText, contactMethod === 'phone' && styles.toggleTextActive]}
          >
            Phone Number
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  function renderStep() {
    switch (step) {
      case 'info':
        return (
          <View>
            <Text style={styles.stepTitle}>Who are you inviting?</Text>
            <Text style={styles.stepDescription}>
              Enter their name and how to reach them. You'll share the invite yourself.
            </Text>
            <Input
              label="Name (optional)"
              placeholder="Caregiver's name"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
            />
            {renderContactMethodToggle()}
            {contactMethod === 'email' ? (
              <Input
                label="Email"
                placeholder="caregiver@example.com"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            ) : (
              <Input
                label="Phone Number"
                placeholder="(555) 123-4567"
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
              />
            )}
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

      case 'review': {
        const template = PERMISSION_TEMPLATES.find((t) => t.id === selectedTemplate);
        const selectedProfileNames = profiles
          .filter((p) => selectedProfiles.includes(p.id))
          .map((p) => p.display_name);
        const contactDisplay = contactMethod === 'email' ? email : phone;
        return (
          <View>
            <Text style={styles.stepTitle}>Review Invitation</Text>

            <Card style={styles.reviewCard}>
              <View style={styles.reviewRow}>
                <Text style={styles.reviewLabel}>Inviting</Text>
                <Text style={styles.reviewValue}>
                  {name || contactDisplay}
                  {name ? `\n${contactDisplay}` : ''}
                </Text>
              </View>
              <View style={styles.reviewDivider} />
              <View style={styles.reviewRow}>
                <Text style={styles.reviewLabel}>Contact</Text>
                <Text style={styles.reviewValue}>
                  {contactMethod === 'email' ? 'Email' : 'Phone'}
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
              By creating this invitation, you consent to sharing the selected profile data with this
              caregiver at the chosen permission level. A consent record will be created for your
              records. You'll choose how to deliver the invite via the share sheet.
            </Text>

            <View style={styles.stepActions}>
              <Button
                title="Back"
                variant="outline"
                onPress={() => setStep('permissions')}
              />
              <Button
                title="Create & Share Invite"
                onPress={handleCreateAndShare}
                loading={createInvite.isPending}
              />
            </View>
          </View>
        );
      }

      case 'success':
        return (
          <View style={styles.successContainer}>
            <View style={styles.successIcon}>
              <Text style={styles.successIconText}>✓</Text>
            </View>
            <Text style={styles.successTitle}>Invite Created!</Text>
            <Text style={styles.successDescription}>
              Once {name || 'they'} accept{name ? 's' : ''}, they'll appear in your care team.
            </Text>

            <Card style={styles.tokenCard}>
              <Text style={styles.tokenLabel}>Invite Link</Text>
              <Text style={styles.tokenValue} selectable>
                carelead://invite/{createdToken}
              </Text>
              <View style={styles.tokenDivider} />
              <Text style={styles.tokenLabel}>Or share this code</Text>
              <Text style={styles.tokenCode} selectable>
                {createdToken}
              </Text>
              <Text style={styles.tokenHint}>
                The caregiver can enter this code after creating their account.
              </Text>
            </Card>

            <View style={styles.successActions}>
              <Button
                title="Share Again"
                variant="outline"
                onPress={handleShareAgain}
              />
              <Button
                title="Done"
                onPress={() => router.back()}
              />
            </View>
          </View>
        );
    }
  }

  return (
    <ScreenLayout>
      {step !== 'success' && (
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
      )}

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
  toggleRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.background.DEFAULT,
    borderRadius: 10,
    padding: 3,
    marginBottom: 16,
  },
  toggleButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  toggleButtonActive: {
    backgroundColor: COLORS.surface.DEFAULT,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  toggleText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.tertiary,
  },
  toggleTextActive: {
    color: COLORS.text.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
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
  successContainer: {
    alignItems: 'center',
    paddingTop: 24,
  },
  successIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.success?.light ?? '#E8F5E9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  successIconText: {
    fontSize: 28,
    color: COLORS.success?.DEFAULT ?? '#4CAF50',
    fontWeight: FONT_WEIGHTS.bold,
  },
  successTitle: {
    fontSize: FONT_SIZES.xl,
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    marginBottom: 8,
  },
  successDescription: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    textAlign: 'center',
    marginBottom: 24,
    paddingHorizontal: 32,
  },
  tokenCard: {
    width: '100%',
    padding: 20,
    marginBottom: 24,
  },
  tokenLabel: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  tokenValue: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    marginBottom: 12,
  },
  tokenDivider: {
    height: 1,
    backgroundColor: COLORS.border.light,
    marginBottom: 12,
  },
  tokenCode: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    letterSpacing: 1,
    textAlign: 'center',
    marginBottom: 8,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  tokenHint: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    textAlign: 'center',
  },
  successActions: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
});
