import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { DatePicker } from '@/components/ui/DatePicker';
import { useAddProfileFact, useUpdateProfile } from '@/hooks/useProfileDetail';
import { useCreateMedication, useMedications } from '@/hooks/useMedications';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import type { QuickActionType } from '@/services/smartEnrichment';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';

interface MicroCaptureProps {
  quickAction: QuickActionType;
  profileId: string;
  onComplete: () => void;
  onCancel: () => void;
}

/**
 * Inline, one-to-two-tap capture for "instant"-effort nudges.
 * After completion calls `onComplete` so the parent can fade out the nudge.
 */
export function MicroCapture({
  quickAction,
  profileId,
  onComplete,
  onCancel,
}: MicroCaptureProps) {
  switch (quickAction) {
    case 'confirm_meds':
      return <ConfirmMeds profileId={profileId} onComplete={onComplete} onCancel={onCancel} />;
    case 'confirm_allergies':
      return <ConfirmAllergies profileId={profileId} onComplete={onComplete} onCancel={onCancel} />;
    case 'add_single_med':
      return <AddSingleMed profileId={profileId} onComplete={onComplete} onCancel={onCancel} />;
    case 'add_allergy':
      return <AddAllergy profileId={profileId} onComplete={onComplete} onCancel={onCancel} />;
    case 'snap_insurance':
      return <SnapInsurance onComplete={onComplete} onCancel={onCancel} />;
    case 'set_dob':
      return <SetDob profileId={profileId} onComplete={onComplete} onCancel={onCancel} />;
    case 'set_sex':
      return <SetSex profileId={profileId} onComplete={onComplete} onCancel={onCancel} />;
    case 'add_pharmacy':
      return <AddPharmacy profileId={profileId} onComplete={onComplete} onCancel={onCancel} />;
    case 'add_emergency_contact':
      return <AddEmergencyContact profileId={profileId} onComplete={onComplete} onCancel={onCancel} />;
    default:
      return null;
  }
}

// ── Shared UI ───────────────────────────────────────────────────────────

function DonePulse() {
  return (
    <View style={styles.donePulse}>
      <Ionicons name="checkmark-circle" size={20} color={COLORS.success.DEFAULT} />
      <Text style={styles.doneText}>Done</Text>
    </View>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <View style={styles.actionRow}>{children}</View>;
}

function PrimaryBtn({
  label,
  onPress,
  loading,
  disabled,
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.primaryBtn, disabled && styles.primaryBtnDisabled]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.8}
    >
      {loading ? (
        <ActivityIndicator color="#FFFFFF" size="small" />
      ) : (
        <Text style={styles.primaryBtnText}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

function GhostBtn({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={styles.ghostBtn}>
      <Text style={styles.ghostBtnText}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── Confirm Meds ────────────────────────────────────────────────────────

function ConfirmMeds({
  profileId,
  onComplete,
  onCancel,
}: {
  profileId: string;
  onComplete: () => void;
  onCancel: () => void;
}) {
  const { data: medications } = useMedications(profileId);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const active = (medications ?? []).filter((m) => m.status === 'active');

  const handleConfirm = async () => {
    setSaving(true);
    try {
      const nowIso = new Date().toISOString();
      // Bump updated_at on each active medication so staleness checks reset.
      await Promise.all(
        active.map((m) =>
          supabase
            .from('med_medications')
            .update({ updated_at: nowIso })
            .eq('id', m.id),
        ),
      );
      if (user?.id) {
        await supabase.from('audit_events').insert({
          profile_id: profileId,
          actor_id: user.id,
          event_type: 'medication.list_confirmed',
          metadata: { medication_count: active.length, source: 'micro_capture' },
        });
      }
      queryClient.invalidateQueries({ queryKey: ['medications'] });
      setDone(true);
      setTimeout(onComplete, 700);
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to confirm');
    } finally {
      setSaving(false);
    }
  };

  if (done) return <DonePulse />;

  if (active.length === 0) {
    return (
      <View>
        <Text style={styles.inlinePrompt}>No active medications on file yet.</Text>
        <Row>
          <PrimaryBtn label="OK" onPress={onCancel} />
        </Row>
      </View>
    );
  }

  return (
    <View>
      <Text style={styles.inlinePrompt}>Still taking all of these?</Text>
      <View style={styles.medList}>
        {active.slice(0, 5).map((m) => (
          <View key={m.id} style={styles.medItem}>
            <Ionicons name="ellipse" size={6} color={COLORS.text.tertiary} />
            <Text style={styles.medItemText} numberOfLines={1}>
              {m.drug_name}
              {m.strength ? ` · ${m.strength}` : ''}
            </Text>
          </View>
        ))}
        {active.length > 5 && (
          <Text style={styles.medMore}>+{active.length - 5} more</Text>
        )}
      </View>
      <Row>
        <PrimaryBtn label="Yes, all correct" onPress={handleConfirm} loading={saving} />
        <GhostBtn label="Update list" onPress={onCancel} />
      </Row>
    </View>
  );
}

// ── Confirm Allergies ───────────────────────────────────────────────────

function ConfirmAllergies({
  profileId,
  onComplete,
  onCancel,
}: {
  profileId: string;
  onComplete: () => void;
  onCancel: () => void;
}) {
  const addFact = useAddProfileFact(profileId);
  const [done, setDone] = useState(false);

  const handleNoAllergies = () => {
    addFact.mutate(
      {
        category: 'allergy',
        field_key: 'allergy.substance',
        value_json: {
          substance: 'No known drug allergies',
          reaction: null,
          severity: null,
          nkda: true,
        },
      },
      {
        onSuccess: () => {
          setDone(true);
          setTimeout(onComplete, 700);
        },
        onError: (err) => Alert.alert('Error', err.message),
      },
    );
  };

  if (done) return <DonePulse />;

  return (
    <View>
      <Text style={styles.inlinePrompt}>Any allergies?</Text>
      <Row>
        <PrimaryBtn
          label="No known allergies"
          onPress={handleNoAllergies}
          loading={addFact.isPending}
        />
        <GhostBtn label="Yes, add one" onPress={onCancel} />
      </Row>
    </View>
  );
}

// ── Add Single Med ──────────────────────────────────────────────────────

function AddSingleMed({
  profileId,
  onComplete,
  onCancel,
}: {
  profileId: string;
  onComplete: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [dose, setDose] = useState('');
  const [done, setDone] = useState(false);
  const createMed = useCreateMedication();
  const addFact = useAddProfileFact(profileId);

  const handleAdd = () => {
    if (!name.trim()) {
      Alert.alert('Required', 'Enter a medication name.');
      return;
    }
    createMed.mutate(
      {
        profile_id: profileId,
        drug_name: name.trim(),
        strength: dose.trim() || undefined,
        prn_flag: false,
      },
      {
        onSuccess: () => {
          addFact.mutate(
            {
              category: 'medication',
              field_key: 'medication.name',
              value_json: {
                drug_name: name.trim(),
                dose: dose.trim() || null,
              },
            },
            {
              onSuccess: () => {
                setDone(true);
                setTimeout(onComplete, 700);
              },
              onError: () => {
                // Medication row created successfully — fact write is best-effort
                setDone(true);
                setTimeout(onComplete, 700);
              },
            },
          );
        },
        onError: (err) => Alert.alert('Error', err.message),
      },
    );
  };

  if (done) return <DonePulse />;

  return (
    <View>
      <TextInput
        style={styles.input}
        placeholder="Medication name"
        placeholderTextColor={COLORS.text.tertiary}
        value={name}
        onChangeText={setName}
        autoFocus
      />
      <TextInput
        style={[styles.input, styles.inputGap]}
        placeholder="Dose (optional, e.g. 10mg)"
        placeholderTextColor={COLORS.text.tertiary}
        value={dose}
        onChangeText={setDose}
      />
      <Row>
        <PrimaryBtn
          label="Add"
          onPress={handleAdd}
          loading={createMed.isPending || addFact.isPending}
          disabled={!name.trim()}
        />
        <GhostBtn label="Cancel" onPress={onCancel} />
      </Row>
    </View>
  );
}

// ── Add Allergy ─────────────────────────────────────────────────────────

function AddAllergy({
  profileId,
  onComplete,
  onCancel,
}: {
  profileId: string;
  onComplete: () => void;
  onCancel: () => void;
}) {
  const [substance, setSubstance] = useState('');
  const [reaction, setReaction] = useState('');
  const [done, setDone] = useState(false);
  const addFact = useAddProfileFact(profileId);

  const handleAdd = () => {
    if (!substance.trim()) {
      Alert.alert('Required', 'Enter an allergen.');
      return;
    }
    addFact.mutate(
      {
        category: 'allergy',
        field_key: 'allergy.substance',
        value_json: {
          substance: substance.trim(),
          reaction: reaction.trim() || null,
        },
      },
      {
        onSuccess: () => {
          setDone(true);
          setTimeout(onComplete, 700);
        },
        onError: (err) => Alert.alert('Error', err.message),
      },
    );
  };

  if (done) return <DonePulse />;

  return (
    <View>
      <TextInput
        style={styles.input}
        placeholder="Allergen (e.g. Penicillin)"
        placeholderTextColor={COLORS.text.tertiary}
        value={substance}
        onChangeText={setSubstance}
        autoFocus
      />
      <TextInput
        style={[styles.input, styles.inputGap]}
        placeholder="Reaction (optional, e.g. Hives)"
        placeholderTextColor={COLORS.text.tertiary}
        value={reaction}
        onChangeText={setReaction}
      />
      <Row>
        <PrimaryBtn
          label="Add"
          onPress={handleAdd}
          loading={addFact.isPending}
          disabled={!substance.trim()}
        />
        <GhostBtn label="Cancel" onPress={onCancel} />
      </Row>
    </View>
  );
}

// ── Snap Insurance ──────────────────────────────────────────────────────

function SnapInsurance({
  onComplete,
  onCancel,
}: {
  onComplete: () => void;
  onCancel: () => void;
}) {
  const router = useRouter();

  const handleOpen = () => {
    router.push('/(main)/capture/camera');
    onComplete();
  };

  return (
    <View>
      <Text style={styles.inlinePrompt}>
        Snap a photo of your insurance card — CareLead will extract the details.
      </Text>
      <Row>
        <PrimaryBtn label="Open camera" onPress={handleOpen} />
        <GhostBtn label="Not now" onPress={onCancel} />
      </Row>
    </View>
  );
}

// ── Set DOB ─────────────────────────────────────────────────────────────

function SetDob({
  profileId,
  onComplete,
  onCancel,
}: {
  profileId: string;
  onComplete: () => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState<Date | null>(null);
  const [done, setDone] = useState(false);
  const updateProfile = useUpdateProfile(profileId);

  const handleSave = () => {
    if (!date) {
      Alert.alert('Required', 'Pick your date of birth.');
      return;
    }
    const iso = date.toISOString().split('T')[0];
    updateProfile.mutate(
      { date_of_birth: iso },
      {
        onSuccess: () => {
          setDone(true);
          setTimeout(onComplete, 700);
        },
        onError: (err) => Alert.alert('Error', err.message),
      },
    );
  };

  if (done) return <DonePulse />;

  return (
    <View>
      <DatePicker
        value={date}
        onChange={setDate}
        mode="date"
        placeholder="Select date of birth"
        maximumDate={new Date()}
      />
      <Row>
        <PrimaryBtn
          label="Save"
          onPress={handleSave}
          loading={updateProfile.isPending}
          disabled={!date}
        />
        <GhostBtn label="Cancel" onPress={onCancel} />
      </Row>
    </View>
  );
}

// ── Set Sex ─────────────────────────────────────────────────────────────

function SetSex({
  profileId,
  onComplete,
  onCancel,
}: {
  profileId: string;
  onComplete: () => void;
  onCancel: () => void;
}) {
  const [done, setDone] = useState(false);
  const updateProfile = useUpdateProfile(profileId);

  const handlePick = (gender: 'male' | 'female') => {
    updateProfile.mutate(
      { gender },
      {
        onSuccess: () => {
          setDone(true);
          setTimeout(onComplete, 700);
        },
        onError: (err) => Alert.alert('Error', err.message),
      },
    );
  };

  if (done) return <DonePulse />;

  return (
    <View>
      <Text style={styles.inlinePrompt}>Select your sex:</Text>
      <View style={styles.twoButtonRow}>
        <TouchableOpacity
          style={styles.toggleBtn}
          onPress={() => handlePick('male')}
          disabled={updateProfile.isPending}
          activeOpacity={0.8}
        >
          <Text style={styles.toggleBtnText}>Male</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.toggleBtn}
          onPress={() => handlePick('female')}
          disabled={updateProfile.isPending}
          activeOpacity={0.8}
        >
          <Text style={styles.toggleBtnText}>Female</Text>
        </TouchableOpacity>
      </View>
      <Row>
        <GhostBtn label="Cancel" onPress={onCancel} />
      </Row>
    </View>
  );
}

// ── Add Pharmacy ────────────────────────────────────────────────────────

function AddPharmacy({
  profileId,
  onComplete,
  onCancel,
}: {
  profileId: string;
  onComplete: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [done, setDone] = useState(false);
  const addFact = useAddProfileFact(profileId);

  const handleAdd = () => {
    if (!name.trim()) {
      Alert.alert('Required', 'Enter a pharmacy name.');
      return;
    }
    addFact.mutate(
      {
        category: 'pharmacy',
        field_key: 'pharmacy.name',
        value_json: {
          name: name.trim(),
          phone: phone.trim() || null,
        },
      },
      {
        onSuccess: () => {
          setDone(true);
          setTimeout(onComplete, 700);
        },
        onError: (err) => Alert.alert('Error', err.message),
      },
    );
  };

  if (done) return <DonePulse />;

  return (
    <View>
      <TextInput
        style={styles.input}
        placeholder="Pharmacy name (e.g. CVS, Walgreens)"
        placeholderTextColor={COLORS.text.tertiary}
        value={name}
        onChangeText={setName}
        autoFocus
      />
      <TextInput
        style={[styles.input, styles.inputGap]}
        placeholder="Phone (optional)"
        placeholderTextColor={COLORS.text.tertiary}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
      />
      <Row>
        <PrimaryBtn
          label="Add"
          onPress={handleAdd}
          loading={addFact.isPending}
          disabled={!name.trim()}
        />
        <GhostBtn label="Cancel" onPress={onCancel} />
      </Row>
    </View>
  );
}

// ── Add Emergency Contact ───────────────────────────────────────────────

function AddEmergencyContact({
  profileId,
  onComplete,
  onCancel,
}: {
  profileId: string;
  onComplete: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [relationship, setRelationship] = useState('');
  const [done, setDone] = useState(false);
  const addFact = useAddProfileFact(profileId);

  const handleAdd = () => {
    if (!name.trim() || !phone.trim()) {
      Alert.alert('Required', 'Enter a name and phone number.');
      return;
    }
    addFact.mutate(
      {
        category: 'emergency_contact',
        field_key: 'emergency_contact.name',
        value_json: {
          name: name.trim(),
          phone: phone.trim(),
          relationship: relationship.trim() || null,
        },
      },
      {
        onSuccess: () => {
          setDone(true);
          setTimeout(onComplete, 700);
        },
        onError: (err) => Alert.alert('Error', err.message),
      },
    );
  };

  if (done) return <DonePulse />;

  return (
    <View>
      <TextInput
        style={styles.input}
        placeholder="Name"
        placeholderTextColor={COLORS.text.tertiary}
        value={name}
        onChangeText={setName}
        autoFocus
      />
      <TextInput
        style={[styles.input, styles.inputGap]}
        placeholder="Phone"
        placeholderTextColor={COLORS.text.tertiary}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
      />
      <TextInput
        style={[styles.input, styles.inputGap]}
        placeholder="Relationship (optional)"
        placeholderTextColor={COLORS.text.tertiary}
        value={relationship}
        onChangeText={setRelationship}
      />
      <Row>
        <PrimaryBtn
          label="Add"
          onPress={handleAdd}
          loading={addFact.isPending}
          disabled={!name.trim() || !phone.trim()}
        />
        <GhostBtn label="Cancel" onPress={onCancel} />
      </Row>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  inlinePrompt: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    marginBottom: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border.dark,
    borderRadius: 8,
    padding: 10,
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    backgroundColor: COLORS.surface.muted,
  },
  inputGap: {
    marginTop: 8,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
    flexWrap: 'wrap',
  },
  primaryBtn: {
    backgroundColor: COLORS.primary.DEFAULT,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
    minWidth: 80,
    alignItems: 'center',
  },
  primaryBtnDisabled: {
    opacity: 0.5,
  },
  primaryBtnText: {
    color: COLORS.text.inverse,
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  ghostBtn: {
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  ghostBtnText: {
    color: COLORS.text.secondary,
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
  },
  twoButtonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  toggleBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.primary.DEFAULT,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: COLORS.primary.DEFAULT + '0D',
  },
  toggleBtnText: {
    color: COLORS.primary.DEFAULT,
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  donePulse: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  doneText: {
    color: COLORS.success.DEFAULT,
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  medList: {
    gap: 6,
    marginBottom: 4,
  },
  medItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  medItemText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    flex: 1,
  },
  medMore: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginTop: 2,
  },
});
