/**
 * Visit Prep — Patient Voice First flow.
 *
 * Three logical phases on this screen:
 *  1. INPUT — patient types/dictates what's on their mind.
 *  2. PROCESSING — quick loading state while AI structures the input.
 *  3. REVIEW — editable view of the structured prep + share/save.
 *
 * If prep_json already exists on the appointment we skip directly to REVIEW.
 * From REVIEW the user can re-enter INPUT to add more thoughts, which get
 * merged into the existing prep.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Share,
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
  useAppointmentDetail,
  useGenerateVisitPacket,
  useMergeVisitPrepInput,
  useProcessVisitPrepInput,
  useSaveVisitPrep,
  useUpdateCaregiverSuggestionStatus,
} from '@/hooks/useAppointments';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { useHouseholdMembers } from '@/hooks/useTasks';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import { getPrepStatus } from '@/lib/types/appointments';
import type {
  VisitPrep,
  VisitPrepDriver,
  VisitPrepQuestion,
} from '@/lib/types/appointments';

type Phase = 'input' | 'processing' | 'review';

const SUGGESTION_CHIPS = [
  "I've been having…",
  'I need to ask about…',
  'I need help getting there…',
  'My medications…',
];

function makeQuestionId(): string {
  return `q-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

function formatDepartBy(iso: string | null): string {
  if (!iso) return 'Not set';
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function VisitPrepScreen() {
  const router = useRouter();
  const { appointmentId } = useLocalSearchParams<{ appointmentId: string }>();
  const { activeProfile } = useActiveProfile();
  const { data: appointment, isLoading, error } = useAppointmentDetail(
    appointmentId ?? null,
  );
  const processInput = useProcessVisitPrepInput();
  const mergeInput = useMergeVisitPrepInput();
  const savePrep = useSaveVisitPrep();
  const generatePacket = useGenerateVisitPacket();
  const updateCaregiverSuggestion = useUpdateCaregiverSuggestionStatus();
  const { data: householdMembers } = useHouseholdMembers(
    activeProfile?.household_id ?? null,
  );

  const [phase, setPhase] = useState<Phase>('input');
  const [prep, setPrep] = useState<VisitPrep | null>(null);
  const [patientInput, setPatientInput] = useState('');
  const [driverPickerOpen, setDriverPickerOpen] = useState(false);
  const [newQuestionText, setNewQuestionText] = useState('');
  const [isAddingMore, setIsAddingMore] = useState(false);

  // On mount, decide where to start: existing prep → REVIEW, otherwise INPUT.
  useEffect(() => {
    if (!appointment) return;
    if (appointment.prep_json) {
      setPrep(appointment.prep_json);
      setPhase('review');
    } else {
      setPhase('input');
    }
  }, [appointment?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const driverOptions = useMemo(
    () => householdMembers ?? [],
    [householdMembers],
  );

  const wordCount = useMemo(
    () => patientInput.trim().split(/\s+/).filter(Boolean).length,
    [patientInput],
  );

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

  // ── Phase handlers ─────────────────────────────────────────────────────────

  const handlePrepareMyVisit = () => {
    if (!patientInput.trim() || !activeProfile?.id || !appointmentId) return;
    setPhase('processing');
    processInput.mutate(
      {
        appointmentId,
        patientInput,
        profileId: activeProfile.id,
      },
      {
        onSuccess: (data) => {
          setPrep(data);
          setPatientInput('');
          setIsAddingMore(false);
          setPhase('review');
        },
        onError: (err) => {
          setPhase('input');
          Alert.alert(
            'Couldn’t organize your prep',
            err instanceof Error ? err.message : 'Please try again.',
          );
        },
      },
    );
  };

  const handleAddMore = () => {
    if (!prep || !patientInput.trim() || !activeProfile?.id || !appointmentId) return;
    setPhase('processing');
    mergeInput.mutate(
      {
        appointmentId,
        existingPrep: prep,
        additionalInput: patientInput,
        profileId: activeProfile.id,
      },
      {
        onSuccess: (data) => {
          setPrep(data);
          setPatientInput('');
          setIsAddingMore(false);
          setPhase('review');
        },
        onError: (err) => {
          setPhase('review');
          Alert.alert(
            'Couldn’t add to your prep',
            err instanceof Error ? err.message : 'Please try again.',
          );
        },
      },
    );
  };

  // ── Prep mutators (REVIEW phase) ───────────────────────────────────────────

  /**
   * Apply a patch to the local prep. Any user edit to a prep that was
   * previously 'ready' automatically reverts it back to 'draft' — the
   * patient has to explicitly Mark as Ready again to re-publish.
   *
   * `silent: true` skips the auto-revert. Used for housekeeping changes
   * (e.g. caching a freshly-generated packet) that aren't meaningful edits.
   */
  const updatePrep = (
    patch: Partial<VisitPrep>,
    options?: { silent?: boolean },
  ) =>
    setPrep((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      if (!options?.silent && prev.prep_status === 'ready') {
        next.prep_status = 'draft';
      }
      return next;
    });

  const updateQuestion = (id: string, text: string) => {
    if (!prep) return;
    updatePrep({
      questions: prep.questions.map((q) => (q.id === id ? { ...q, text } : q)),
    });
  };

  const removeQuestion = (id: string) => {
    if (!prep) return;
    updatePrep({ questions: prep.questions.filter((q) => q.id !== id) });
  };

  const acceptSuggestion = (id: string) => {
    if (!prep) return;
    updatePrep({
      questions: prep.questions.map((q) =>
        q.id === id ? { ...q, source: 'user_added', ai_suggested: false } : q,
      ),
    });
  };

  const dismissSuggestion = (id: string) => {
    if (!prep) return;
    updatePrep({ questions: prep.questions.filter((q) => q.id !== id) });
  };

  const addQuestion = () => {
    if (!prep || !newQuestionText.trim()) return;
    const next: VisitPrepQuestion = {
      id: makeQuestionId(),
      text: newQuestionText.trim(),
      source: 'user_added',
      priority: prep.questions.length + 1,
    };
    updatePrep({ questions: [...prep.questions, next] });
    setNewQuestionText('');
  };

  const handleAcceptCaregiverSuggestion = (suggestionId: string) => {
    if (!prep || !appointmentId) return;
    const suggestion = (prep.caregiver_suggestions ?? []).find(
      (s) => s.id === suggestionId,
    );
    if (!suggestion) return;

    // Move the suggestion text into questions_and_concerns and mark accepted.
    const newQuestion: VisitPrepQuestion = {
      id: makeQuestionId(),
      text: `${suggestion.text} (from ${suggestion.from_name})`,
      source: 'user_added',
      priority: prep.questions.length + 1,
    };
    updatePrep(
      {
        questions: [...prep.questions, newQuestion],
        caregiver_suggestions: (prep.caregiver_suggestions ?? []).map((s) =>
          s.id === suggestionId ? { ...s, status: 'accepted' } : s,
        ),
      },
      { silent: true },
    );

    // Persist the status change immediately so caregivers see it reflected.
    updateCaregiverSuggestion.mutate({
      appointmentId,
      suggestionId,
      status: 'accepted',
    });
  };

  const handleDismissCaregiverSuggestion = (suggestionId: string) => {
    if (!prep || !appointmentId) return;
    updatePrep(
      {
        caregiver_suggestions: (prep.caregiver_suggestions ?? []).map((s) =>
          s.id === suggestionId ? { ...s, status: 'dismissed' } : s,
        ),
      },
      { silent: true },
    );
    updateCaregiverSuggestion.mutate({
      appointmentId,
      suggestionId,
      status: 'dismissed',
    });
  };

  const setDriver = (driver: VisitPrepDriver | null) => {
    if (!prep) return;
    updatePrep({ logistics: { ...prep.logistics, driver } });
    setDriverPickerOpen(false);
  };

  const notifyDriver = () => {
    if (!prep?.logistics.driver) return;
    Alert.alert(
      'Driver notified',
      `${prep.logistics.driver.name} will be notified about this ride.`,
    );
    updatePrep({
      logistics: {
        ...prep.logistics,
        driver: { ...prep.logistics.driver, notified: true },
      },
    });
  };

  const handleGeneratePacket = () => {
    if (!appointment) return;
    generatePacket.mutate(
      { appointmentId: appointment.id, profileId: appointment.profile_id },
      {
        onSuccess: (data) => {
          updatePrep(
            {
              packet_generated: true,
              packet_content: data.packet,
            },
            { silent: true },
          );
        },
      },
    );
  };

  const handleSharePacket = async () => {
    if (!prep) return;
    let content = prep.packet_content;
    if (!content) {
      // Auto-generate the packet if the user hasn't yet — sharing should
      // always Just Work.
      const result = await new Promise<string | null>((resolve) => {
        generatePacket.mutate(
          {
            appointmentId: appointment.id,
            profileId: appointment.profile_id,
          },
          {
            onSuccess: (data) => {
              updatePrep(
                {
                  packet_generated: true,
                  packet_content: data.packet,
                },
                { silent: true },
              );
              resolve(data.packet);
            },
            onError: () => resolve(null),
          },
        );
      });
      if (!result) {
        Alert.alert('Couldn’t prepare the packet', 'Please try again.');
        return;
      }
      content = result;
    }
    try {
      await Share.share({
        message: content,
        title: `Visit Prep — ${appointment.title}`,
      });
    } catch {
      // user cancelled
    }
  };

  const handleSaveDraft = () => {
    if (!prep || !appointmentId) return;
    savePrep.mutate(
      { appointmentId, prep, markReady: false },
      {
        onSuccess: () => {
          router.replace(`/(main)/appointments/${appointmentId}`);
        },
      },
    );
  };

  const handleMarkReady = () => {
    if (!prep || !appointmentId) return;
    savePrep.mutate(
      { appointmentId, prep, markReady: true },
      {
        onSuccess: () => {
          router.replace(`/(main)/appointments/${appointmentId}`);
        },
      },
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (phase === 'processing') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.primary.DEFAULT} />
          <Text style={styles.loadingTitle}>Organizing your visit prep…</Text>
          <Text style={styles.loadingHint}>
            CareLead is structuring what you said.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (phase === 'input') {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.navBar}>
          <TouchableOpacity
            onPress={() => {
              if (isAddingMore && prep) {
                setIsAddingMore(false);
                setPatientInput('');
                setPhase('review');
              } else {
                router.back();
              }
            }}
            style={styles.backButton}
          >
            <Text style={styles.backText}>{'\u2039'} Back</Text>
          </TouchableOpacity>
          <Text style={styles.navTitle}>Visit Prep</Text>
          <View style={styles.navSpacer} />
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={0}
        >
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.inputContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.inputTitle}>
              {isAddingMore
                ? 'Anything else on your mind?'
                : "What's on your mind for this visit?"}
            </Text>
            <Text style={styles.inputSubtitle}>
              Tell CareLead what matters to you — speak using the mic button on
              your keyboard or type.
            </Text>

            <View style={styles.appointmentBlurb}>
              <Text style={styles.appointmentBlurbTitle}>{appointment.title}</Text>
              <Text style={styles.appointmentBlurbMeta}>
                {new Date(appointment.start_time).toLocaleString('en-US', {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
                {appointment.provider_name
                  ? ` \u2022 ${appointment.provider_name}`
                  : ''}
              </Text>
            </View>

            <TextInput
              style={styles.bigInput}
              value={patientInput}
              onChangeText={setPatientInput}
              placeholder="What do you want to discuss? Any concerns? Need any logistics help?"
              placeholderTextColor={COLORS.text.tertiary}
              multiline
              autoFocus
              textAlignVertical="top"
            />
            <Text style={styles.wordCount}>
              {wordCount} word{wordCount === 1 ? '' : 's'}
            </Text>

            <View style={styles.chipsRow}>
              {SUGGESTION_CHIPS.map((chip) => (
                <TouchableOpacity
                  key={chip}
                  style={styles.chip}
                  onPress={() => {
                    setPatientInput((prev) =>
                      prev.length === 0 ? chip + ' ' : `${prev.trim()} ${chip} `,
                    );
                  }}
                >
                  <Text style={styles.chipText}>{chip}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          <View style={styles.bottomBar}>
            <Button
              title={isAddingMore ? 'Add to my prep' : 'Prepare My Visit'}
              onPress={isAddingMore ? handleAddMore : handlePrepareMyVisit}
              disabled={!patientInput.trim()}
              loading={processInput.isPending || mergeInput.isPending}
            />
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── REVIEW phase ───────────────────────────────────────────────────────────
  if (!prep) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.primary.DEFAULT} />
        </View>
      </SafeAreaView>
    );
  }

  const patientItems = prep.questions.filter(
    (q) => q.source === 'patient' || q.source === 'user_added',
  );
  const aiItems = prep.questions.filter((q) => q.source === 'ai_suggested');
  const prepStatus = getPrepStatus(prep);
  const isDraft = prepStatus !== 'ready';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.navBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>{'\u2039'} Back</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle}>Visit Prep</Text>
        <View style={styles.navSpacer} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
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

        <View
          style={[
            styles.prepStatusPill,
            isDraft ? styles.prepStatusPillDraft : styles.prepStatusPillReady,
          ]}
        >
          <Text
            style={[
              styles.prepStatusPillText,
              isDraft
                ? styles.prepStatusPillTextDraft
                : styles.prepStatusPillTextReady,
            ]}
          >
            {isDraft ? 'Draft — keep editing' : 'Ready \u2713'}
          </Text>
        </View>

        <TouchableOpacity
          style={styles.addMoreLink}
          onPress={() => {
            setIsAddingMore(true);
            setPhase('input');
          }}
        >
          <Text style={styles.addMoreLinkText}>
            {'\u270E'} Add more details
          </Text>
        </TouchableOpacity>

        {/* ── Questions & Concerns ─────────────────────────────────────── */}
        <Text style={styles.sectionLabel}>Your Questions & Concerns</Text>

        <Card style={styles.card}>
          {patientItems.length === 0 && (
            <Text style={styles.emptyHint}>
              Nothing from you yet — tap “Add more details” above.
            </Text>
          )}
          {patientItems.map((q) => (
            <View key={q.id} style={styles.questionRow}>
              <View style={styles.questionContent}>
                <Text style={styles.fromYouTag}>From you</Text>
                <TextInput
                  style={styles.questionInput}
                  value={q.text}
                  onChangeText={(text) => updateQuestion(q.id, text)}
                  multiline
                />
              </View>
              <TouchableOpacity
                onPress={() => removeQuestion(q.id)}
                style={styles.removeButton}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.removeText}>{'\u2715'}</Text>
              </TouchableOpacity>
            </View>
          ))}

          <View style={styles.addRow}>
            <TextInput
              style={styles.addInput}
              value={newQuestionText}
              onChangeText={setNewQuestionText}
              placeholder="Add another question…"
              placeholderTextColor={COLORS.text.tertiary}
              onSubmitEditing={addQuestion}
              returnKeyType="done"
            />
            <TouchableOpacity onPress={addQuestion} style={styles.addButton}>
              <Text style={styles.addButtonText}>Add</Text>
            </TouchableOpacity>
          </View>
        </Card>

        {aiItems.length > 0 && (
          <Card style={{ ...styles.card, ...styles.aiCard }}>
            <Text style={styles.aiCardLabel}>
              {'\u2728'} Suggested by CareLead
            </Text>
            <Text style={styles.aiCardHint}>
              Based on your profile. Accept the ones you want; dismiss the rest.
            </Text>
            {aiItems.map((q) => (
              <View key={q.id} style={styles.aiQuestionRow}>
                <Text style={styles.aiQuestionText}>{q.text}</Text>
                <View style={styles.aiActions}>
                  <TouchableOpacity
                    style={styles.aiDismissBtn}
                    onPress={() => dismissSuggestion(q.id)}
                  >
                    <Text style={styles.aiDismissText}>Dismiss</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.aiAcceptBtn}
                    onPress={() => acceptSuggestion(q.id)}
                  >
                    <Text style={styles.aiAcceptText}>Accept</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </Card>
        )}

        {/* ── Suggestions from family ──────────────────────────────────── */}
        {(() => {
          const pendingSuggestions = (prep.caregiver_suggestions ?? []).filter(
            (s) => s.status === 'pending',
          );
          if (pendingSuggestions.length === 0) return null;
          return (
            <>
              <Text style={styles.sectionLabel}>Suggestions from family</Text>
              <Card style={{ ...styles.card, ...styles.caregiverCard }}>
                <Text style={styles.caregiverCardHint}>
                  Family members reviewing your prep added these. Add the ones
                  that matter; dismiss the rest.
                </Text>
                {pendingSuggestions.map((s) => (
                  <View key={s.id} style={styles.caregiverRow}>
                    <Text style={styles.caregiverFrom}>From {s.from_name}</Text>
                    <Text style={styles.caregiverText}>{s.text}</Text>
                    <View style={styles.caregiverActions}>
                      <TouchableOpacity
                        style={styles.aiDismissBtn}
                        onPress={() => handleDismissCaregiverSuggestion(s.id)}
                      >
                        <Text style={styles.aiDismissText}>Dismiss</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.aiAcceptBtn}
                        onPress={() => handleAcceptCaregiverSuggestion(s.id)}
                      >
                        <Text style={styles.aiAcceptText}>Add to prep</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </Card>
            </>
          );
        })()}

        {/* ── Logistics ────────────────────────────────────────────────── */}
        <Text style={styles.sectionLabel}>Logistics</Text>

        <Card style={styles.card}>
          <View style={styles.logisticsRow}>
            <Text style={styles.fieldLabel}>Leave by</Text>
            <Text style={styles.logisticsValue}>
              {formatDepartBy(prep.logistics.depart_by)}
            </Text>
          </View>
        </Card>

        <Card style={styles.card}>
          <Text style={styles.fieldLabel}>Driver / ride</Text>
          {prep.logistics.driver ? (
            <View style={styles.driverRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.driverName}>{prep.logistics.driver.name}</Text>
                <Text style={styles.driverSub}>
                  {prep.logistics.driver.notified
                    ? 'Notified'
                    : 'Not yet notified'}
                </Text>
              </View>
              <TouchableOpacity
                onPress={notifyDriver}
                style={styles.smallButton}
                disabled={prep.logistics.driver.notified}
              >
                <Text style={styles.smallButtonText}>
                  {prep.logistics.driver.notified ? 'Done' : 'Notify'}
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <Text style={styles.emptyHint}>No driver assigned yet.</Text>
          )}
          <TouchableOpacity
            onPress={() => setDriverPickerOpen(true)}
            style={styles.linkButton}
          >
            <Text style={styles.linkButtonText}>
              {prep.logistics.driver ? 'Change driver' : 'Assign driver'}
            </Text>
          </TouchableOpacity>
        </Card>

        {prep.logistics.what_to_bring.length > 0 && (
          <Card style={styles.card}>
            <Text style={styles.fieldLabel}>What to bring</Text>
            {prep.logistics.what_to_bring.map((item) => (
              <View key={item} style={styles.bringRow}>
                <Text style={styles.bringDot}>{'\u2022'}</Text>
                <Text style={styles.bringText}>{item}</Text>
              </View>
            ))}
          </Card>
        )}

        {prep.special_needs && prep.special_needs.length > 0 && (
          <Card style={styles.card}>
            <Text style={styles.fieldLabel}>Special needs you mentioned</Text>
            {prep.special_needs.map((s) => (
              <View key={s} style={styles.bringRow}>
                <Text style={styles.bringDot}>{'\u2022'}</Text>
                <Text style={styles.bringText}>{s}</Text>
              </View>
            ))}
          </Card>
        )}

        {prep.refills_needed.length > 0 && (
          <Card style={styles.card}>
            <Text style={styles.fieldLabel}>Refills to request</Text>
            {prep.refills_needed.map((r) => (
              <View key={r.medication} style={styles.bringRow}>
                <Text style={styles.bringDot}>{'\u2022'}</Text>
                <Text style={styles.bringText}>{r.medication}</Text>
              </View>
            ))}
          </Card>
        )}

        {/* ── Visit Packet ─────────────────────────────────────────────── */}
        <Text style={styles.sectionLabel}>Visit Packet</Text>

        <Card style={styles.card}>
          {isDraft && (
            <View style={styles.draftBanner}>
              <Text style={styles.draftBannerText}>
                {'\u26A0'} This is a draft. Anything you share will include a
                “DRAFT” header until you mark the prep as ready.
              </Text>
            </View>
          )}
          <Text style={styles.packetIntro}>
            A shareable summary of {activeProfile?.display_name ?? 'your'} health
            details and the questions for this visit.
          </Text>
          <Text style={styles.packetPreviewLabel}>Will include:</Text>
          <Text style={styles.packetItem}>{'\u2022'} Patient & insurance</Text>
          <Text style={styles.packetItem}>{'\u2022'} Current medications</Text>
          <Text style={styles.packetItem}>
            {'\u2022'} Active conditions & allergies
          </Text>
          <Text style={styles.packetItem}>
            {'\u2022'} {patientItems.length} prepared question
            {patientItems.length === 1 ? '' : 's'}
          </Text>

          <View style={styles.packetActions}>
            <Button
              title={
                prep.packet_generated ? 'Regenerate Packet' : 'Generate Packet'
              }
              onPress={handleGeneratePacket}
              loading={generatePacket.isPending}
              variant="outline"
            />
            <Button title="Generate & Share" onPress={handleSharePacket} />
          </View>
          {prep.packet_generated && (
            <Text style={styles.packetReady}>{'\u2713'} Packet ready</Text>
          )}
        </Card>
      </ScrollView>

      {/* Bottom save bar — Save Draft (always available) and Mark as Ready */}
      <View style={styles.bottomBar}>
        <View style={styles.bottomBarRow}>
          <View style={styles.bottomBarHalf}>
            <Button
              title="Save Draft"
              onPress={handleSaveDraft}
              loading={savePrep.isPending && !savePrep.variables?.markReady}
              variant="outline"
            />
          </View>
          <View style={styles.bottomBarHalf}>
            <Button
              title={prepStatus === 'ready' ? 'Re-mark Ready' : 'Mark as Ready'}
              onPress={handleMarkReady}
              loading={savePrep.isPending && savePrep.variables?.markReady}
            />
          </View>
        </View>
      </View>

      {/* Driver picker modal */}
      <Modal
        visible={driverPickerOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setDriverPickerOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Assign driver</Text>
            <ScrollView style={{ maxHeight: 320 }}>
              <TouchableOpacity
                style={styles.modalRow}
                onPress={() => setDriver(null)}
              >
                <Text style={styles.modalRowText}>No one (skip)</Text>
              </TouchableOpacity>
              {driverOptions.map((m) => (
                <TouchableOpacity
                  key={m.user_id}
                  style={styles.modalRow}
                  onPress={() =>
                    setDriver({
                      name: m.display_name,
                      user_id: m.user_id,
                      notified: false,
                    })
                  }
                >
                  <Text style={styles.modalRowText}>{m.display_name}</Text>
                  <Text style={styles.modalRowSub}>{m.role}</Text>
                </TouchableOpacity>
              ))}
              {driverOptions.length === 0 && (
                <Text style={styles.emptyHint}>
                  No household members available.
                </Text>
              )}
            </ScrollView>
            <TouchableOpacity
              onPress={() => setDriverPickerOpen(false)}
              style={styles.modalCancel}
            >
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  loadingTitle: {
    marginTop: 18,
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  loadingHint: {
    marginTop: 6,
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    textAlign: 'center',
  },
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

  // INPUT phase
  inputContent: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 32,
  },
  inputTitle: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    marginBottom: 8,
  },
  inputSubtitle: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    marginBottom: 16,
    lineHeight: 22,
  },
  appointmentBlurb: {
    backgroundColor: COLORS.surface.muted,
    borderRadius: 12,
    padding: 12,
    marginBottom: 18,
  },
  appointmentBlurbTitle: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  appointmentBlurbMeta: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    marginTop: 2,
  },
  bigInput: {
    minHeight: 200,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    borderRadius: 14,
    padding: 14,
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    backgroundColor: COLORS.background.DEFAULT,
  },
  wordCount: {
    marginTop: 8,
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    textAlign: 'right',
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 16,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: COLORS.primary.DEFAULT + '12',
  },
  chipText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },

  // REVIEW phase
  content: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 120,
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
  addMoreLink: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    marginBottom: 6,
  },
  addMoreLinkText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
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
  fieldLabel: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  questionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.light,
  },
  questionContent: { flex: 1 },
  questionInput: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    paddingVertical: 2,
  },
  fromYouTag: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
    marginBottom: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  removeButton: { paddingHorizontal: 8, paddingTop: 4 },
  removeText: { color: COLORS.text.tertiary, fontSize: FONT_SIZES.base },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    gap: 8,
  },
  addInput: {
    flex: 1,
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: COLORS.surface.muted,
    borderRadius: 8,
  },
  addButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: COLORS.primary.DEFAULT + '15',
    borderRadius: 8,
  },
  addButtonText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.primary.DEFAULT,
  },
  emptyHint: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.tertiary,
    fontStyle: 'italic',
  },
  aiCard: {
    backgroundColor: COLORS.accent.dark + '0A',
    borderWidth: 1,
    borderColor: COLORS.accent.dark + '33',
  },
  aiCardLabel: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.accent.dark,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  aiCardHint: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    marginTop: 4,
    marginBottom: 8,
  },
  aiQuestionRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.light,
  },
  aiQuestionText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    marginBottom: 8,
  },
  aiActions: {
    flexDirection: 'row',
    gap: 8,
  },
  aiAcceptBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: COLORS.primary.DEFAULT,
  },
  aiAcceptText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.inverse,
  },
  aiDismissBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: COLORS.surface.muted,
  },
  aiDismissText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.secondary,
  },
  caregiverCard: {
    backgroundColor: COLORS.primary.DEFAULT + '08',
    borderWidth: 1,
    borderColor: COLORS.primary.DEFAULT + '33',
  },
  caregiverCardHint: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    marginBottom: 8,
  },
  caregiverRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.light,
  },
  caregiverFrom: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.primary.DEFAULT,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  caregiverText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    marginBottom: 8,
  },
  caregiverActions: {
    flexDirection: 'row',
    gap: 8,
  },
  logisticsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  logisticsValue: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.primary.DEFAULT,
  },
  driverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  driverName: {
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
  },
  driverSub: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    marginTop: 2,
  },
  smallButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: COLORS.primary.DEFAULT + '15',
    borderRadius: 8,
  },
  smallButtonText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.primary.DEFAULT,
  },
  linkButton: { marginTop: 10 },
  linkButtonText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  bringRow: {
    flexDirection: 'row',
    paddingVertical: 4,
  },
  bringDot: { color: COLORS.text.tertiary, marginRight: 8 },
  bringText: { fontSize: FONT_SIZES.base, color: COLORS.text.DEFAULT, flex: 1 },
  packetIntro: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    marginBottom: 10,
    lineHeight: 20,
  },
  packetPreviewLabel: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.tertiary,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  packetItem: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    paddingVertical: 1,
  },
  packetActions: {
    marginTop: 14,
    gap: 8,
  },
  packetReady: {
    marginTop: 10,
    fontSize: FONT_SIZES.sm,
    color: COLORS.success.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  bottomBar: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 24,
    borderTopWidth: 1,
    borderTopColor: COLORS.border.light,
    backgroundColor: COLORS.background.DEFAULT,
  },
  bottomBarRow: {
    flexDirection: 'row',
    gap: 10,
  },
  bottomBarHalf: { flex: 1 },
  prepStatusPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    marginTop: 8,
    marginBottom: 4,
  },
  prepStatusPillDraft: { backgroundColor: COLORS.accent.dark + '1F' },
  prepStatusPillReady: { backgroundColor: COLORS.success.DEFAULT + '1F' },
  prepStatusPillText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  prepStatusPillTextDraft: { color: COLORS.accent.dark },
  prepStatusPillTextReady: { color: COLORS.success.DEFAULT },
  draftBanner: {
    backgroundColor: COLORS.accent.dark + '10',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  draftBannerText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.accent.dark,
    lineHeight: 16,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: COLORS.background.DEFAULT,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 32,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  modalTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
    marginBottom: 12,
  },
  modalRow: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.light,
  },
  modalRowText: { fontSize: FONT_SIZES.base, color: COLORS.text.DEFAULT },
  modalRowSub: { fontSize: FONT_SIZES.xs, color: COLORS.text.tertiary, marginTop: 2 },
  modalCancel: {
    marginTop: 16,
    alignItems: 'center',
    paddingVertical: 12,
  },
  modalCancelText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
});
