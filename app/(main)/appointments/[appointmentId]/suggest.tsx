/**
 * Caregiver Suggest screen.
 *
 * Shown when a caregiver opens a shared appointment. The current visit prep
 * is read-only here; the caregiver can add suggestions that the patient sees
 * on their own Visit Prep screen and can accept or dismiss.
 */

import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import {
  useAddCaregiverSuggestion,
  useAppointmentDetail,
} from '@/hooks/useAppointments';
import { useAuth } from '@/hooks/useAuth';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import type { CaregiverSuggestion } from '@/lib/types/appointments';

const SUGGESTION_STATUS_LABELS: Record<CaregiverSuggestion['status'], string> = {
  pending: 'Sent',
  accepted: 'Added to prep',
  dismissed: 'Dismissed',
};

const SUGGESTION_STATUS_COLORS: Record<CaregiverSuggestion['status'], string> = {
  pending: COLORS.accent.dark,
  accepted: COLORS.success.DEFAULT,
  dismissed: COLORS.text.tertiary,
};

function getCaregiverName(
  user: { email?: string | null; user_metadata?: Record<string, unknown> } | null,
): string {
  if (!user) return 'Caregiver';
  const meta = user.user_metadata ?? {};
  const displayName = (meta.display_name as string | undefined) ?? (meta.full_name as string | undefined);
  if (displayName) return displayName;
  if (user.email) return user.email.split('@')[0] ?? 'Caregiver';
  return 'Caregiver';
}

export default function CaregiverSuggestScreen() {
  const router = useRouter();
  const { appointmentId } = useLocalSearchParams<{ appointmentId: string }>();
  const { user } = useAuth();
  const { data: appointment, isLoading, error } = useAppointmentDetail(
    appointmentId ?? null,
  );
  const addSuggestion = useAddCaregiverSuggestion();

  const [text, setText] = useState('');

  const caregiverName = useMemo(() => getCaregiverName(user), [user]);

  const prep = appointment?.prep_json ?? null;

  const mySuggestions = useMemo(() => {
    if (!prep || !user?.id) return [];
    return (prep.caregiver_suggestions ?? []).filter(
      (s) => s.from_user_id === user.id,
    );
  }, [prep, user?.id]);

  if (isLoading || !appointment) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.primary.DEFAULT} />
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <Text style={styles.errorText}>Couldn’t load this appointment.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const handleSend = () => {
    if (!text.trim() || !appointmentId) return;
    addSuggestion.mutate(
      {
        appointmentId,
        text: text.trim(),
        fromName: caregiverName,
      },
      {
        onSuccess: () => {
          setText('');
        },
        onError: (err) => {
          Alert.alert(
            'Couldn’t send suggestion',
            err instanceof Error ? err.message : 'Please try again.',
          );
        },
      },
    );
  };

  const visibleQuestions = prep
    ? prep.questions.filter((q) => !q.dismissed)
    : [];

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.navBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>{'\u2039'} Back</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle}>Add a Suggestion</Text>
        <View style={styles.navSpacer} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.appointmentTitle}>{appointment.title}</Text>
          <Text style={styles.appointmentMeta}>
            {new Date(appointment.start_time).toLocaleString('en-US', {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
            {appointment.provider_name ? ` \u2022 ${appointment.provider_name}` : ''}
          </Text>

          {!prep ? (
            <Card style={styles.card}>
              <Text style={styles.emptyHint}>
                The patient hasn’t prepared this visit yet. Once they create
                their visit prep you’ll be able to add suggestions here.
              </Text>
            </Card>
          ) : (
            <>
              <Text style={styles.sectionLabel}>Current Prep Summary</Text>
              <Card style={styles.card}>
                {prep.purpose_summary ? (
                  <Text style={styles.purposeText}>{prep.purpose_summary}</Text>
                ) : null}

                <Text style={styles.fieldLabel}>Questions & concerns</Text>
                {visibleQuestions.length === 0 ? (
                  <Text style={styles.emptyHint}>None added yet.</Text>
                ) : (
                  visibleQuestions.map((q) => (
                    <View key={q.id} style={styles.bulletRow}>
                      <Text style={styles.bulletDot}>{'\u2022'}</Text>
                      <Text style={styles.bulletText}>{q.text}</Text>
                    </View>
                  ))
                )}

                {prep.refills_needed.length > 0 && (
                  <>
                    <Text style={[styles.fieldLabel, styles.fieldLabelSpacer]}>
                      Refills
                    </Text>
                    {prep.refills_needed.map((r) => (
                      <View key={r.medication} style={styles.bulletRow}>
                        <Text style={styles.bulletDot}>{'\u2022'}</Text>
                        <Text style={styles.bulletText}>{r.medication}</Text>
                      </View>
                    ))}
                  </>
                )}

                {prep.logistics.what_to_bring.length > 0 && (
                  <>
                    <Text style={[styles.fieldLabel, styles.fieldLabelSpacer]}>
                      What to bring
                    </Text>
                    {prep.logistics.what_to_bring.map((item) => (
                      <View key={item} style={styles.bulletRow}>
                        <Text style={styles.bulletDot}>{'\u2022'}</Text>
                        <Text style={styles.bulletText}>{item}</Text>
                      </View>
                    ))}
                  </>
                )}
              </Card>
            </>
          )}

          {mySuggestions.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>Your Suggestions</Text>
              <Card style={styles.card}>
                {mySuggestions.map((s) => (
                  <View key={s.id} style={styles.suggestionRow}>
                    <Text style={styles.suggestionText}>{s.text}</Text>
                    <Text
                      style={[
                        styles.suggestionStatus,
                        { color: SUGGESTION_STATUS_COLORS[s.status] },
                      ]}
                    >
                      {SUGGESTION_STATUS_LABELS[s.status]}
                    </Text>
                  </View>
                ))}
              </Card>
            </>
          )}
        </ScrollView>

        {prep && (
          <View style={styles.bottomBar}>
            <TextInput
              style={styles.input}
              value={text}
              onChangeText={setText}
              placeholder="Add a suggestion for this visit"
              placeholderTextColor={COLORS.text.tertiary}
              multiline
            />
            <View style={styles.sendButtonWrap}>
              <Button
                title="Send"
                onPress={handleSend}
                disabled={!text.trim()}
                loading={addSuggestion.isPending}
              />
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background.DEFAULT },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  errorText: { fontSize: FONT_SIZES.base, color: COLORS.error.DEFAULT },
  navBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  backButton: { paddingVertical: 4, paddingRight: 16 },
  backText: {
    fontSize: FONT_SIZES.lg,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  navTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  navSpacer: { width: 60 },
  scrollView: { flex: 1 },
  content: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 24,
  },
  appointmentTitle: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
  },
  appointmentMeta: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginTop: 4,
    marginBottom: 8,
  },
  sectionLabel: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.primary.DEFAULT,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 16,
    marginBottom: 10,
  },
  card: { marginBottom: 12 },
  purposeText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    marginBottom: 12,
    lineHeight: 22,
  },
  fieldLabel: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  fieldLabelSpacer: { marginTop: 12 },
  bulletRow: {
    flexDirection: 'row',
    paddingVertical: 4,
  },
  bulletDot: { color: COLORS.text.tertiary, marginRight: 8 },
  bulletText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    flex: 1,
  },
  emptyHint: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.tertiary,
    fontStyle: 'italic',
  },
  suggestionRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.light,
  },
  suggestionText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    marginBottom: 4,
  },
  suggestionStatus: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  bottomBar: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 24,
    borderTopWidth: 1,
    borderTopColor: COLORS.border.light,
    backgroundColor: COLORS.background.DEFAULT,
  },
  input: {
    minHeight: 60,
    maxHeight: 140,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    backgroundColor: COLORS.background.DEFAULT,
    textAlignVertical: 'top',
  },
  sendButtonWrap: { marginTop: 10 },
});
