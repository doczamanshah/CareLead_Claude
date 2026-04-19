import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  StyleSheet,
  Share,
  Modal,
  FlatList,
  TextInput,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { ScreenLayout } from '@/components/ui/ScreenLayout';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useCreateInvite } from '@/hooks/useCaregivers';
import { PERMISSION_TEMPLATES } from '@/lib/constants/permissionTemplates';
import type { PermissionTemplateId } from '@/lib/constants/permissionTemplates';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

type Step = 'who' | 'what' | 'review' | 'success';
type ContactMethod = 'phone' | 'email';

interface Country {
  code: string;
  dial: string;
  name: string;
  flag: string;
}

const COUNTRIES: Country[] = [
  { code: 'US', dial: '+1', name: 'United States', flag: '🇺🇸' },
  { code: 'CA', dial: '+1', name: 'Canada', flag: '🇨🇦' },
  { code: 'GB', dial: '+44', name: 'United Kingdom', flag: '🇬🇧' },
  { code: 'IN', dial: '+91', name: 'India', flag: '🇮🇳' },
  { code: 'AU', dial: '+61', name: 'Australia', flag: '🇦🇺' },
  { code: 'DE', dial: '+49', name: 'Germany', flag: '🇩🇪' },
  { code: 'FR', dial: '+33', name: 'France', flag: '🇫🇷' },
  { code: 'MX', dial: '+52', name: 'Mexico', flag: '🇲🇽' },
  { code: 'ES', dial: '+34', name: 'Spain', flag: '🇪🇸' },
  { code: 'IT', dial: '+39', name: 'Italy', flag: '🇮🇹' },
  { code: 'BR', dial: '+55', name: 'Brazil', flag: '🇧🇷' },
  { code: 'JP', dial: '+81', name: 'Japan', flag: '🇯🇵' },
];

const RELATIONSHIPS = [
  'Spouse / Partner',
  'Parent',
  'Child',
  'Sibling',
  'Other Family',
  'Friend',
  'Professional Caregiver',
  'Other',
] as const;

type Relationship = typeof RELATIONSHIPS[number];

function formatUsPhone(digits: string): string {
  const d = digits.slice(0, 10);
  if (d.length === 0) return '';
  if (d.length <= 3) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

const APP_STORE_LINK_PLACEHOLDER = '[App Store link coming soon]';

export default function InviteCaregiverScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ profileId?: string }>();
  const { profiles, activeProfile } = useActiveProfile();
  const createInvite = useCreateInvite();

  const [step, setStep] = useState<Step>('who');

  // Step 1 — Who
  const [name, setName] = useState('');
  const [contactMethod, setContactMethod] = useState<ContactMethod>('phone');
  const [country, setCountry] = useState<Country>(COUNTRIES[0]);
  const [phoneDigits, setPhoneDigits] = useState('');
  const [email, setEmail] = useState('');
  const [relationship, setRelationship] = useState<Relationship | null>(null);
  const [countryPickerVisible, setCountryPickerVisible] = useState(false);
  const [relationshipPickerVisible, setRelationshipPickerVisible] = useState(false);

  // Step 2 — What
  const [selectedProfiles, setSelectedProfiles] = useState<string[]>(
    params.profileId ? [params.profileId] : profiles.map((p) => p.id),
  );
  const [selectedTemplate, setSelectedTemplate] = useState<PermissionTemplateId>('view_only');

  // Success
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);

  const householdId = activeProfile?.household_id;
  const inviterName = profiles.find((p) => p.relationship === 'self')?.display_name ?? 'Someone';

  const isUsOrCa = country.dial === '+1';
  const phoneDisplay = isUsOrCa ? formatUsPhone(phoneDigits) : phoneDigits;
  const fullPhone = phoneDigits ? `${country.dial}${phoneDigits}` : '';

  function toggleProfile(id: string) {
    setSelectedProfiles((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  }

  function handlePhoneChange(text: string) {
    const digits = text.replace(/\D/g, '').slice(0, 15);
    setPhoneDigits(digits);
  }

  function validateWho(): boolean {
    if (!name.trim()) {
      Alert.alert('Required', "Please enter the caregiver's name.");
      return false;
    }
    if (contactMethod === 'phone') {
      const minDigits = 10;
      if (phoneDigits.length < minDigits) {
        Alert.alert('Invalid', `Please enter a valid ${minDigits}-digit phone number.`);
        return false;
      }
    } else {
      if (!email.trim()) {
        Alert.alert('Required', 'Please enter an email address.');
        return false;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        Alert.alert('Invalid', 'Please enter a valid email address.');
        return false;
      }
    }
    if (!relationship) {
      Alert.alert('Required', 'Please select a relationship.');
      return false;
    }
    return true;
  }

  function validateWhat(): boolean {
    if (selectedProfiles.length === 0) {
      Alert.alert('Required', 'Select at least one family member.');
      return false;
    }
    return true;
  }

  function buildShareMessage(token: string): string {
    const inviteLink = `carelead://invite/${token}`;
    return [
      `${inviterName} has invited you to help manage health information on CareLead.`,
      '',
      `Tap this link to accept: ${inviteLink}`,
      '',
      `If you don't have CareLead yet, download it first: ${APP_STORE_LINK_PLACEHOLDER}`,
      '',
      'This invite expires in 7 days.',
    ].join('\n');
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
          invited_email: contactMethod === 'email' ? email.trim() : undefined,
          invited_phone: contactMethod === 'phone' ? fullPhone : undefined,
          invited_name: name.trim() || undefined,
          profile_ids: selectedProfiles,
          permission_template: selectedTemplate,
        },
      },
      {
        onSuccess: async (invite) => {
          setCreatedToken(invite.token);
          setStep('success');
          try {
            await Share.share({ message: buildShareMessage(invite.token) });
          } catch {
            // User cancelled share — still on success screen
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
      await Share.share({ message: buildShareMessage(createdToken) });
    } catch {
      // User cancelled
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Render helpers
  // ─────────────────────────────────────────────────────────────────────

  function renderProgressDots() {
    if (step === 'success') return null;
    const steps: Step[] = ['who', 'what', 'review'];
    const currentIndex = steps.indexOf(step);
    return (
      <View style={styles.stepIndicator}>
        {steps.map((s, i) => (
          <View key={s} style={styles.stepDotRow}>
            {i > 0 && (
              <View style={[styles.stepLine, currentIndex >= i && styles.stepLineActive]} />
            )}
            <View style={[styles.stepDot, currentIndex >= i && styles.stepDotActive]} />
          </View>
        ))}
      </View>
    );
  }

  function renderContactToggle() {
    return (
      <View style={styles.toggleRow}>
        <TouchableOpacity
          style={[styles.toggleButton, contactMethod === 'phone' && styles.toggleButtonActive]}
          onPress={() => setContactMethod('phone')}
          activeOpacity={0.7}
        >
          <Ionicons
            name="call-outline"
            size={16}
            color={contactMethod === 'phone' ? COLORS.text.DEFAULT : COLORS.text.tertiary}
          />
          <Text
            style={[styles.toggleText, contactMethod === 'phone' && styles.toggleTextActive]}
          >
            Phone
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleButton, contactMethod === 'email' && styles.toggleButtonActive]}
          onPress={() => setContactMethod('email')}
          activeOpacity={0.7}
        >
          <Ionicons
            name="mail-outline"
            size={16}
            color={contactMethod === 'email' ? COLORS.text.DEFAULT : COLORS.text.tertiary}
          />
          <Text
            style={[styles.toggleText, contactMethod === 'email' && styles.toggleTextActive]}
          >
            Email
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  function renderPhoneInput() {
    return (
      <View style={styles.fieldBlock}>
        <Text style={styles.fieldLabel}>Phone number</Text>
        <View style={styles.phoneRow}>
          <TouchableOpacity
            style={styles.countryBtn}
            onPress={() => setCountryPickerVisible(true)}
            activeOpacity={0.7}
          >
            <Text style={styles.flag}>{country.flag}</Text>
            <Text style={styles.dial}>{country.dial}</Text>
            <Ionicons name="chevron-down" size={14} color={COLORS.text.secondary} />
          </TouchableOpacity>

          <TextInput
            style={styles.phoneInput}
            value={phoneDisplay}
            onChangeText={handlePhoneChange}
            placeholder={isUsOrCa ? '(555) 123-4567' : 'Phone number'}
            placeholderTextColor={COLORS.text.tertiary}
            keyboardType="phone-pad"
            maxLength={isUsOrCa ? 14 : 15}
          />
        </View>
      </View>
    );
  }

  function renderRelationshipPicker() {
    return (
      <View style={styles.fieldBlock}>
        <Text style={styles.fieldLabel}>Relationship</Text>
        <TouchableOpacity
          style={styles.relationshipBtn}
          onPress={() => setRelationshipPickerVisible(true)}
          activeOpacity={0.7}
        >
          <Text
            style={[
              styles.relationshipValue,
              !relationship && styles.relationshipPlaceholder,
            ]}
          >
            {relationship ?? 'Select a relationship'}
          </Text>
          <Ionicons name="chevron-down" size={18} color={COLORS.text.secondary} />
        </TouchableOpacity>
      </View>
    );
  }

  function renderWho() {
    return (
      <View>
        <Text style={styles.stepTitle}>Who are you inviting?</Text>
        <Text style={styles.stepDescription}>
          Enter their name, contact info, and relationship. You'll share the invite yourself.
        </Text>

        <Input
          label="Name"
          placeholder="Caregiver's name"
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
        />

        {renderContactToggle()}

        {contactMethod === 'phone' ? (
          renderPhoneInput()
        ) : (
          <Input
            label="Email"
            placeholder="caregiver@example.com"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
        )}

        {renderRelationshipPicker()}

        <View style={styles.stepActions}>
          <Button
            title="Next"
            onPress={() => {
              if (validateWho()) setStep('what');
            }}
          />
        </View>
      </View>
    );
  }

  function renderWhat() {
    return (
      <View>
        <Text style={styles.stepTitle}>What can they access?</Text>
        <Text style={styles.stepDescription}>
          Choose a permission level and which family members they can see.
        </Text>

        <Text style={styles.subsectionLabel}>Permission level</Text>
        {PERMISSION_TEMPLATES.map((template) => {
          const isSelected = selectedTemplate === template.id;
          return (
            <TouchableOpacity
              key={template.id}
              style={[styles.templateCard, isSelected && styles.templateCardSelected]}
              onPress={() => setSelectedTemplate(template.id)}
              activeOpacity={0.7}
            >
              <View style={styles.templateHeader}>
                <View style={[styles.radio, isSelected && styles.radioSelected]}>
                  {isSelected && <View style={styles.radioFill} />}
                </View>
                <Ionicons
                  name={template.icon as keyof typeof Ionicons.glyphMap}
                  size={18}
                  color={isSelected ? COLORS.primary.DEFAULT : COLORS.text.secondary}
                  style={styles.templateIcon}
                />
                <Text style={[styles.templateName, isSelected && styles.templateNameSelected]}>
                  {template.name}
                </Text>
              </View>
              <Text style={styles.templateDescription}>{template.description}</Text>
            </TouchableOpacity>
          );
        })}

        <Text style={[styles.subsectionLabel, styles.subsectionLabelSpaced]}>
          Family members
        </Text>
        {profiles.map((profile) => {
          const isSelected = selectedProfiles.includes(profile.id);
          return (
            <TouchableOpacity
              key={profile.id}
              style={[styles.profileOption, isSelected && styles.profileOptionSelected]}
              onPress={() => toggleProfile(profile.id)}
              activeOpacity={0.7}
            >
              <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                {isSelected && (
                  <Ionicons name="checkmark" size={14} color={COLORS.text.inverse} />
                )}
              </View>
              <View style={styles.profileOptionInfo}>
                <Text style={styles.profileOptionName}>{profile.display_name}</Text>
                <Text style={styles.profileOptionRelation}>{profile.relationship}</Text>
              </View>
            </TouchableOpacity>
          );
        })}

        <View style={styles.stepActions}>
          <Button title="Back" variant="outline" onPress={() => setStep('who')} />
          <Button
            title="Next"
            onPress={() => {
              if (validateWhat()) setStep('review');
            }}
          />
        </View>
      </View>
    );
  }

  function renderReview() {
    const template = PERMISSION_TEMPLATES.find((t) => t.id === selectedTemplate);
    const selectedProfileNames = profiles
      .filter((p) => selectedProfiles.includes(p.id))
      .map((p) => p.display_name);
    const contactDisplay =
      contactMethod === 'email' ? email : `${country.dial} ${phoneDisplay || phoneDigits}`;

    return (
      <View>
        <Text style={styles.stepTitle}>Review & Send</Text>
        <Text style={styles.stepDescription}>
          Make sure everything looks right. You'll pick how to deliver the invite next.
        </Text>

        <Card style={styles.reviewCard}>
          <ReviewRow label="Inviting" value={name} sub={relationship ?? undefined} />
          <ReviewDivider />
          <ReviewRow
            label={contactMethod === 'email' ? 'Email' : 'Phone'}
            value={contactDisplay}
          />
          <ReviewDivider />
          <ReviewRow
            label="Access to"
            value={selectedProfileNames.join(', ')}
          />
          <ReviewDivider />
          <ReviewRow label="Permission" value={template?.name ?? selectedTemplate} />
          <ReviewDivider />
          <ReviewRow label="Expires" value="7 days from now" />
        </Card>

        <Text style={styles.consentNote}>
          By sending this invite, you consent to sharing the selected profile data with this
          caregiver at the chosen permission level. A consent record will be saved.
        </Text>

        <View style={styles.stepActions}>
          <Button title="Back" variant="outline" onPress={() => setStep('what')} />
          <Button
            title="Send Invite"
            onPress={handleSend}
            loading={createInvite.isPending}
          />
        </View>
      </View>
    );
  }

  function renderSuccess() {
    const inviteLink = createdToken ? `carelead://invite/${createdToken}` : '';

    return (
      <View style={styles.successContainer}>
        <View style={styles.successIcon}>
          <Ionicons name="checkmark" size={32} color={COLORS.success.DEFAULT} />
        </View>
        <Text style={styles.successTitle}>Invite sent!</Text>
        <Text style={styles.successDescription}>
          Once {name || 'they'} tap{name ? 's' : ''} the link, they'll appear in your care team.
          {'\n\n'}
          If they're with you in person, show the QR code below — they can scan it with their
          phone camera.
        </Text>

        {showQr ? (
          <Card style={styles.qrCard}>
            <Text style={styles.qrTitle}>Scan to accept</Text>
            <View style={styles.qrWrap}>
              <QRCode
                value={inviteLink}
                size={220}
                color={COLORS.primary.DEFAULT}
                backgroundColor={COLORS.surface.DEFAULT}
              />
            </View>
            <Text style={styles.qrHint}>
              Open the camera app and point it at this code.
            </Text>
            <TouchableOpacity onPress={() => setShowQr(false)} style={styles.linkButton}>
              <Text style={styles.linkButtonText}>Hide QR code</Text>
            </TouchableOpacity>
          </Card>
        ) : (
          <View style={styles.successButtonStack}>
            <Button title="Show QR Code" onPress={() => setShowQr(true)} />
            <Button
              title="Share Link Instead"
              variant="outline"
              onPress={handleShareAgain}
            />
          </View>
        )}

        <View style={styles.successDone}>
          <Button title="Done" variant="ghost" onPress={() => router.back()} />
        </View>
      </View>
    );
  }

  return (
    <ScreenLayout>
      {renderProgressDots()}
      {step === 'who' && renderWho()}
      {step === 'what' && renderWhat()}
      {step === 'review' && renderReview()}
      {step === 'success' && renderSuccess()}

      {/* Country picker modal */}
      <Modal
        visible={countryPickerVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setCountryPickerVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setCountryPickerVisible(false)}
        >
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select country</Text>
              <TouchableOpacity
                onPress={() => setCountryPickerVisible(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={22} color={COLORS.text.secondary} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={COUNTRIES}
              keyExtractor={(item) => item.code}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.pickerRow}
                  onPress={() => {
                    setCountry(item);
                    setCountryPickerVisible(false);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.rowFlag}>{item.flag}</Text>
                  <Text style={styles.rowName}>{item.name}</Text>
                  <Text style={styles.rowDial}>{item.dial}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Relationship picker modal */}
      <Modal
        visible={relationshipPickerVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setRelationshipPickerVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setRelationshipPickerVisible(false)}
        >
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Relationship</Text>
              <TouchableOpacity
                onPress={() => setRelationshipPickerVisible(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={22} color={COLORS.text.secondary} />
              </TouchableOpacity>
            </View>
            {RELATIONSHIPS.map((r) => (
              <TouchableOpacity
                key={r}
                style={styles.pickerRow}
                onPress={() => {
                  setRelationship(r);
                  setRelationshipPickerVisible(false);
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.rowName}>{r}</Text>
                {relationship === r && (
                  <Ionicons name="checkmark" size={18} color={COLORS.primary.DEFAULT} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </ScreenLayout>
  );
}

function ReviewRow({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <View style={styles.reviewRow}>
      <Text style={styles.reviewLabel}>{label}</Text>
      <View style={styles.reviewValueWrap}>
        <Text style={styles.reviewValue}>{value}</Text>
        {sub && <Text style={styles.reviewSub}>{sub}</Text>}
      </View>
    </View>
  );
}

function ReviewDivider() {
  return <View style={styles.reviewDivider} />;
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
    lineHeight: 20,
  },
  stepActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
    marginBottom: 32,
  },
  fieldBlock: {
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.secondary,
    marginBottom: 8,
  },
  subsectionLabel: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
  },
  subsectionLabelSpaced: {
    marginTop: 20,
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
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
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
  phoneRow: {
    flexDirection: 'row',
    gap: 10,
  },
  countryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.surface.DEFAULT,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  flag: {
    fontSize: 18,
  },
  dial: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  phoneInput: {
    flex: 1,
    backgroundColor: COLORS.surface.DEFAULT,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
  },
  relationshipBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surface.DEFAULT,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  relationshipValue: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
  },
  relationshipPlaceholder: {
    color: COLORS.text.tertiary,
  },
  profileOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    marginBottom: 8,
    backgroundColor: COLORS.surface.DEFAULT,
  },
  profileOptionSelected: {
    borderColor: COLORS.primary.DEFAULT,
    backgroundColor: COLORS.primary.DEFAULT + '0D',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: COLORS.border.dark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    backgroundColor: COLORS.primary.DEFAULT,
    borderColor: COLORS.primary.DEFAULT,
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
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    marginBottom: 8,
    backgroundColor: COLORS.surface.DEFAULT,
  },
  templateCardSelected: {
    borderColor: COLORS.primary.DEFAULT,
    backgroundColor: COLORS.primary.DEFAULT + '0D',
  },
  templateHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  templateIcon: {
    marginRight: 8,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: COLORS.border.dark,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  radioSelected: {
    borderColor: COLORS.primary.DEFAULT,
  },
  radioFill: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.primary.DEFAULT,
  },
  templateName: {
    flex: 1,
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
    marginLeft: 38,
    lineHeight: 19,
  },
  reviewCard: {
    marginBottom: 16,
  },
  reviewRow: {
    flexDirection: 'row',
    paddingVertical: 10,
  },
  reviewLabel: {
    width: 100,
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.tertiary,
  },
  reviewValueWrap: {
    flex: 1,
  },
  reviewValue: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  reviewSub: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginTop: 2,
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
    backgroundColor: COLORS.success.light,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  successTitle: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    marginBottom: 8,
  },
  successDescription: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    textAlign: 'center',
    marginBottom: 24,
    paddingHorizontal: 16,
    lineHeight: 20,
  },
  successButtonStack: {
    width: '100%',
    gap: 12,
  },
  successDone: {
    marginTop: 24,
    marginBottom: 32,
  },
  qrCard: {
    width: '100%',
    alignItems: 'center',
    padding: 24,
    marginBottom: 8,
  },
  qrTitle: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.primary.DEFAULT,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 16,
  },
  qrWrap: {
    padding: 16,
    backgroundColor: COLORS.surface.DEFAULT,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.primary.DEFAULT + '33',
  },
  qrHint: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginTop: 16,
    textAlign: 'center',
  },
  linkButton: {
    marginTop: 12,
    paddingVertical: 8,
  },
  linkButtonText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: COLORS.surface.DEFAULT,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '70%',
    paddingBottom: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.light,
  },
  modalTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.light,
  },
  rowFlag: {
    fontSize: 22,
  },
  rowName: {
    flex: 1,
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
  },
  rowDial: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
  },
});
