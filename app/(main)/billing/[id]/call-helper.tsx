import { useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
  Linking,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { DatePicker } from '@/components/ui/DatePicker';
import {
  useBillingCase,
  useFindings,
  useDenialRecords,
  useCasePayments,
  useCaseParties,
  useCreateCallLog,
  useCreateCallFollowUp,
} from '@/hooks/useBilling';
import { generateCallScript } from '@/services/billingCallScripts';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import type { CallParty, CallScript } from '@/lib/types/billing';

type PartyOption = {
  party: CallParty;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
};

export default function CallHelperScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const caseId = id ?? null;

  const { data: billingCase, isLoading } = useBillingCase(caseId);
  const { data: findings } = useFindings(caseId);
  const { data: denialRecords } = useDenialRecords(caseId);
  const { data: payments } = useCasePayments(caseId);
  const { data: caseParties } = useCaseParties(caseId);
  const createLog = useCreateCallLog();
  const createFollowUp = useCreateCallFollowUp();

  const [party, setParty] = useState<CallParty>('provider');
  const [checkedQuestions, setCheckedQuestions] = useState<Set<number>>(new Set());
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const [logExpanded, setLogExpanded] = useState(false);

  // Log form state
  const [calledAt, setCalledAt] = useState<Date | null>(new Date());
  const [duration, setDuration] = useState('');
  const [repName, setRepName] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [outcome, setOutcome] = useState('');
  const [nextSteps, setNextSteps] = useState('');
  const [followUpDue, setFollowUpDue] = useState<Date | null>(null);

  const partyOptions: PartyOption[] = useMemo(() => {
    const providerLabel = billingCase?.provider_name
      ? `Provider Billing — ${billingCase.provider_name}`
      : 'Provider Billing';
    const payerLabel = billingCase?.payer_name
      ? `Insurance — ${billingCase.payer_name}`
      : 'Insurance Company';
    return [
      { party: 'provider', label: providerLabel, icon: 'business-outline' },
      { party: 'payer', label: payerLabel, icon: 'shield-checkmark-outline' },
      { party: 'pharmacy', label: 'Pharmacy', icon: 'medkit-outline' },
      { party: 'other', label: 'Other', icon: 'call-outline' },
    ];
  }, [billingCase?.provider_name, billingCase?.payer_name]);

  const script: CallScript | null = useMemo(() => {
    if (!billingCase) return null;
    return generateCallScript({
      party,
      billingCase,
      findings: findings ?? [],
      denialRecords: denialRecords ?? [],
      payments: payments ?? [],
      caseParties: caseParties ?? null,
    });
  }, [party, billingCase, findings, denialRecords, payments, caseParties]);

  function handleSelectParty(next: CallParty) {
    if (next === party) return;
    setParty(next);
    setCheckedQuestions(new Set());
  }

  function toggleQuestion(idx: number) {
    setCheckedQuestions((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  async function handleCopy(label: string, value: string) {
    try {
      await Clipboard.setStringAsync(value);
      setCopiedLabel(label);
      setTimeout(() => {
        setCopiedLabel((current) => (current === label ? null : current));
      }, 1500);
    } catch {
      Alert.alert('Copy failed', 'Could not copy to clipboard.');
    }
  }

  function handleDial(phone: string) {
    const url = `tel:${phone.replace(/[^0-9+]/g, '')}`;
    Linking.openURL(url).catch(() => {
      Alert.alert('Cannot place call', 'This device cannot place phone calls.');
    });
  }

  function resetLogForm() {
    setCalledAt(new Date());
    setDuration('');
    setRepName('');
    setReferenceNumber('');
    setOutcome('');
    setNextSteps('');
    setFollowUpDue(null);
  }

  async function handleSaveLog() {
    if (!billingCase || !caseId) return;
    if (!outcome.trim()) {
      Alert.alert('Outcome required', 'Please describe what happened on this call.');
      return;
    }

    const partyName =
      party === 'provider'
        ? (billingCase.provider_name ?? undefined)
        : party === 'payer'
          ? (billingCase.payer_name ?? undefined)
          : undefined;

    const durationMinutes = duration.trim() ? parseInt(duration, 10) : undefined;

    try {
      const log = await createLog.mutateAsync({
        caseId,
        profileId: billingCase.profile_id,
        householdId: billingCase.household_id,
        party,
        partyName,
        calledAt: calledAt ? calledAt.toISOString() : undefined,
        durationMinutes: Number.isFinite(durationMinutes) ? durationMinutes : undefined,
        repName: repName.trim() || undefined,
        referenceNumber: referenceNumber.trim() || undefined,
        outcome: outcome.trim(),
        nextSteps: nextSteps.trim() || undefined,
        followUpDue: followUpDue ? followUpDue.toISOString() : undefined,
      });

      if (followUpDue) {
        const followUpTitle = nextSteps.trim()
          ? `Follow up: ${nextSteps.trim().split('\n')[0].slice(0, 80)}`
          : `Follow up on call with ${partyName ?? script?.title ?? 'contact'}`;
        await createFollowUp.mutateAsync({
          callLogId: log.id,
          caseId,
          profileId: billingCase.profile_id,
          householdId: billingCase.household_id,
          title: followUpTitle,
          description: nextSteps.trim() || outcome.trim(),
          dueDate: followUpDue.toISOString(),
        });
      }

      resetLogForm();
      setLogExpanded(false);
      Alert.alert('Call logged', followUpDue ? 'Follow-up task created.' : 'Call saved.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save call log';
      Alert.alert('Save failed', message);
    }
  }

  if (isLoading || !billingCase) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.centered}>
          <Text style={styles.loadingText}>Loading case...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="chevron-back" size={22} color={COLORS.primary.DEFAULT} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.topTitle}>Call Helper</Text>
          <TouchableOpacity
            onPress={() => router.replace('/(main)/(tabs)')}
            style={styles.homeButton}
            activeOpacity={0.7}
            hitSlop={8}
            accessibilityLabel="Go to Home"
          >
            <Ionicons name="home-outline" size={20} color={COLORS.text.secondary} />
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Party selector */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>WHO ARE YOU CALLING?</Text>
            <View style={styles.partyGrid}>
              {partyOptions.map((opt) => {
                const selected = opt.party === party;
                return (
                  <TouchableOpacity
                    key={opt.party}
                    onPress={() => handleSelectParty(opt.party)}
                    activeOpacity={0.7}
                    style={[styles.partyOption, selected && styles.partyOptionSelected]}
                  >
                    <Ionicons
                      name={opt.icon}
                      size={20}
                      color={selected ? COLORS.primary.DEFAULT : COLORS.text.secondary}
                    />
                    <Text
                      style={[styles.partyOptionText, selected && styles.partyOptionTextSelected]}
                      numberOfLines={2}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {script && (
            <>
              <View style={styles.section}>
                <Text style={styles.scriptTitle}>{script.title}</Text>
                {script.phoneNumber ? (
                  <TouchableOpacity
                    onPress={() => handleDial(script.phoneNumber as string)}
                    style={styles.phoneRow}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="call" size={18} color={COLORS.primary.DEFAULT} />
                    <Text style={styles.phoneText}>{script.phoneNumber}</Text>
                    <Text style={styles.phoneHint}>Tap to call</Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              {/* Reference numbers */}
              {script.referenceNumbers.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>REFERENCE NUMBERS</Text>
                  <View style={styles.refGrid}>
                    {script.referenceNumbers.map((ref) => {
                      const copied = copiedLabel === ref.label;
                      return (
                        <TouchableOpacity
                          key={ref.label}
                          activeOpacity={0.7}
                          onPress={() => handleCopy(ref.label, ref.value)}
                          style={styles.refCard}
                        >
                          <View style={styles.refTextBlock}>
                            <Text style={styles.refLabel}>{ref.label}</Text>
                            <Text style={styles.refValue} numberOfLines={1}>
                              {ref.value}
                            </Text>
                          </View>
                          <View style={styles.refIconWrap}>
                            {copied ? (
                              <>
                                <Ionicons
                                  name="checkmark-circle"
                                  size={18}
                                  color={COLORS.success.DEFAULT}
                                />
                                <Text style={styles.copiedText}>Copied!</Text>
                              </>
                            ) : (
                              <Ionicons
                                name="copy-outline"
                                size={18}
                                color={COLORS.text.tertiary}
                              />
                            )}
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              )}

              {/* Introduction */}
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>WHAT TO SAY</Text>
                <Card style={styles.introCard}>
                  <Ionicons
                    name="chatbubbles-outline"
                    size={18}
                    color={COLORS.primary.DEFAULT}
                    style={styles.introIcon}
                  />
                  <Text style={styles.introText}>{script.introduction}</Text>
                </Card>
              </View>

              {/* Questions */}
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>QUESTIONS TO ASK</Text>
                {script.questions.map((q, idx) => {
                  const checked = checkedQuestions.has(idx);
                  return (
                    <TouchableOpacity
                      key={idx}
                      activeOpacity={0.7}
                      onPress={() => toggleQuestion(idx)}
                      style={styles.questionCard}
                    >
                      <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                        {checked && (
                          <Ionicons name="checkmark" size={14} color={COLORS.text.inverse} />
                        )}
                      </View>
                      <View style={styles.questionTextBlock}>
                        <Text
                          style={[styles.questionText, checked && styles.questionTextChecked]}
                        >
                          {q.question}
                        </Text>
                        <Text style={styles.questionWhy}>{q.why}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Tips */}
              {script.tips.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>TIPS</Text>
                  <Card>
                    {script.tips.map((tip, idx) => (
                      <View
                        key={idx}
                        style={[
                          styles.tipRow,
                          idx < script.tips.length - 1 && styles.tipRowBorder,
                        ]}
                      >
                        <Ionicons
                          name="bulb-outline"
                          size={16}
                          color={COLORS.accent.dark}
                          style={styles.tipIcon}
                        />
                        <Text style={styles.tipText}>{tip}</Text>
                      </View>
                    ))}
                  </Card>
                </View>
              )}
            </>
          )}

          {/* Log call CTA */}
          {!logExpanded && (
            <View style={styles.section}>
              <Button
                title="Log This Call"
                onPress={() => setLogExpanded(true)}
                variant="primary"
                size="lg"
              />
            </View>
          )}

          {/* Log form */}
          {logExpanded && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>LOG THIS CALL</Text>
              <Card>
                <DatePicker
                  label="Date / time of call"
                  mode="datetime"
                  value={calledAt}
                  onChange={setCalledAt}
                />

                <View style={styles.formField}>
                  <Text style={styles.formLabel}>Duration (minutes)</Text>
                  <TextInput
                    style={styles.textInput}
                    value={duration}
                    onChangeText={setDuration}
                    keyboardType="number-pad"
                    placeholder="Optional"
                    placeholderTextColor={COLORS.text.tertiary}
                  />
                </View>

                <View style={styles.formField}>
                  <Text style={styles.formLabel}>Rep name</Text>
                  <TextInput
                    style={styles.textInput}
                    value={repName}
                    onChangeText={setRepName}
                    placeholder="Who you spoke with"
                    placeholderTextColor={COLORS.text.tertiary}
                  />
                </View>

                <View style={styles.formField}>
                  <Text style={styles.formLabel}>Reference number they gave you</Text>
                  <TextInput
                    style={styles.textInput}
                    value={referenceNumber}
                    onChangeText={setReferenceNumber}
                    placeholder="Confirmation / ticket number"
                    placeholderTextColor={COLORS.text.tertiary}
                  />
                </View>

                <View style={styles.formField}>
                  <Text style={styles.formLabel}>What happened? *</Text>
                  <TextInput
                    style={[styles.textInput, styles.textArea]}
                    value={outcome}
                    onChangeText={setOutcome}
                    multiline
                    placeholder="Summary of the call — what was discussed or decided"
                    placeholderTextColor={COLORS.text.tertiary}
                  />
                </View>

                <View style={styles.formField}>
                  <Text style={styles.formLabel}>Next steps</Text>
                  <TextInput
                    style={[styles.textInput, styles.textArea]}
                    value={nextSteps}
                    onChangeText={setNextSteps}
                    multiline
                    placeholder="What needs to happen next"
                    placeholderTextColor={COLORS.text.tertiary}
                  />
                </View>

                <DatePicker
                  label="Follow-up needed by"
                  mode="date"
                  value={followUpDue}
                  onChange={setFollowUpDue}
                  minimumDate={new Date()}
                />

                <View style={styles.formActions}>
                  <Button
                    title="Cancel"
                    variant="ghost"
                    size="md"
                    onPress={() => {
                      setLogExpanded(false);
                      resetLogForm();
                    }}
                  />
                  <Button
                    title="Save Call Log"
                    variant="primary"
                    size="md"
                    onPress={handleSaveLog}
                    loading={createLog.isPending || createFollowUp.isPending}
                  />
                </View>
              </Card>
            </View>
          )}

          <View style={styles.bottomSpacer} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background.DEFAULT,
  },
  flex: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.light,
    backgroundColor: COLORS.surface.DEFAULT,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 8,
    paddingRight: 12,
  },
  backText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  topTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    flex: 1,
    textAlign: 'center',
  },
  topSpacer: { width: 56 },
  homeButton: {
    padding: 6,
    marginLeft: 4,
  },

  section: {
    paddingHorizontal: 24,
    marginTop: 24,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
  },

  // Party selector
  partyGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  partyOption: {
    flexBasis: '48%',
    flexGrow: 1,
    backgroundColor: COLORS.surface.DEFAULT,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  partyOptionSelected: {
    borderColor: COLORS.primary.DEFAULT,
    backgroundColor: COLORS.primary.DEFAULT + '0D',
  },
  partyOptionText: {
    flex: 1,
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.medium,
  },
  partyOptionTextSelected: {
    color: COLORS.primary.DEFAULT,
  },

  // Script title + phone
  scriptTitle: {
    fontSize: FONT_SIZES.xl,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    marginBottom: 8,
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: COLORS.primary.DEFAULT + '14',
    borderRadius: 12,
  },
  phoneText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  phoneHint: {
    marginLeft: 'auto',
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
  },

  // Reference numbers
  refGrid: {
    gap: 10,
  },
  refCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface.DEFAULT,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  refTextBlock: {
    flex: 1,
  },
  refLabel: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: FONT_WEIGHTS.semibold,
    marginBottom: 2,
  },
  refValue: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  refIconWrap: {
    alignItems: 'center',
    marginLeft: 12,
    minWidth: 60,
  },
  copiedText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.success.DEFAULT,
    marginTop: 2,
    fontWeight: FONT_WEIGHTS.medium,
  },

  // Introduction
  introCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: COLORS.secondary.DEFAULT + '14',
  },
  introIcon: {
    marginRight: 10,
    marginTop: 2,
  },
  introText: {
    flex: 1,
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    lineHeight: 22,
    fontStyle: 'italic',
  },

  // Questions
  questionCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: COLORS.surface.DEFAULT,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: COLORS.border.dark,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    marginTop: 2,
    backgroundColor: COLORS.surface.DEFAULT,
  },
  checkboxChecked: {
    backgroundColor: COLORS.primary.DEFAULT,
    borderColor: COLORS.primary.DEFAULT,
  },
  questionTextBlock: {
    flex: 1,
  },
  questionText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
    lineHeight: 22,
    marginBottom: 4,
  },
  questionTextChecked: {
    color: COLORS.text.secondary,
  },
  questionWhy: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    lineHeight: 18,
  },

  // Tips
  tipRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 8,
  },
  tipRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border.light,
  },
  tipIcon: {
    marginRight: 10,
    marginTop: 2,
  },
  tipText: {
    flex: 1,
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    lineHeight: 20,
  },

  // Log form
  formField: {
    marginTop: 12,
  },
  formLabel: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
    color: COLORS.text.secondary,
    marginBottom: 6,
  },
  textInput: {
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: FONT_SIZES.base,
    color: COLORS.text.DEFAULT,
    backgroundColor: COLORS.background.secondary,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  formActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 16,
  },

  bottomSpacer: { height: 40 },
});
