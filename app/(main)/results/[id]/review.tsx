import { useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import {
  useResult,
  useLabObservations,
  useSaveCorrections,
  useConfirmResult,
} from '@/hooks/useResults';
import { COLORS } from '@/lib/constants/colors';
import { FONT_SIZES, FONT_WEIGHTS } from '@/lib/constants/typography';
import type { LabFlag } from '@/lib/types/results';
import type {
  LabCorrections,
  ImagingCorrections,
  OtherCorrections,
  OtherKeyFinding,
  ResultCorrections,
} from '@/services/results';

const FLAG_OPTIONS: Array<{ value: LabFlag; label: string }> = [
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'low', label: 'Low' },
  { value: 'abnormal', label: 'Abnormal' },
  { value: 'critical', label: 'Critical' },
];

const LOW_CONFIDENCE_THRESHOLD = 0.6;

interface BaseAnalyte {
  name: string;
  value: string | null;
  numeric_value: number | null;
  unit: string | null;
  ref_range_low: number | null;
  ref_range_high: number | null;
  ref_range_text: string | null;
  flag: LabFlag | null;
  confidence: number | null;
}

interface AnalyteRow {
  localKey: string;
  originalName: string | null; // null for manually added rows
  name: string;
  value: string;
  unit: string;
  refRangeText: string;
  flag: LabFlag | null;
  confidence: number | null;
  removed: boolean;
}

interface KeyFindingRow {
  localKey: string;
  label: string;
  value: string;
  confidence: number | null;
  removed: boolean;
}

let rowCounter = 0;
function nextRowKey(): string {
  rowCounter += 1;
  return `row-${Date.now()}-${rowCounter}`;
}

function parseNumeric(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Allow values like "95", "6.8", ">10", "<0.5", "Negative"
  const match = trimmed.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

function buildBaseAnalytes(structured: Record<string, unknown> | null): BaseAnalyte[] {
  if (!structured) return [];
  const raw = (structured.analytes ?? []) as Array<{
    name?: string;
    value?: string | null;
    numeric_value?: number | null;
    unit?: string | null;
    ref_range_low?: number | null;
    ref_range_high?: number | null;
    ref_range_text?: string | null;
    flag?: LabFlag | null;
    confidence?: number | null;
  }>;
  return raw
    .filter((a) => !!a.name)
    .map((a) => ({
      name: a.name as string,
      value: a.value ?? null,
      numeric_value: a.numeric_value ?? null,
      unit: a.unit ?? null,
      ref_range_low: a.ref_range_low ?? null,
      ref_range_high: a.ref_range_high ?? null,
      ref_range_text:
        a.ref_range_text ??
        (a.ref_range_low != null && a.ref_range_high != null
          ? `${a.ref_range_low}–${a.ref_range_high}`
          : null),
      flag: (a.flag ?? null) as LabFlag | null,
      confidence: a.confidence ?? null,
    }));
}

function confidenceMessage(confidence: number | null): string {
  if (confidence == null) {
    return 'Review the extracted values below and confirm when ready.';
  }
  if (confidence < 0.5) {
    return "Some values couldn't be read clearly. Please review and correct any errors.";
  }
  if (confidence < 0.7) {
    return 'Most values look good, but a few may need your attention.';
  }
  return 'Extraction looks accurate. Confirm to finalize.';
}

function confidenceLabel(confidence: number | null): string {
  if (confidence == null) return 'Unknown';
  if (confidence < 0.5) return 'Low';
  if (confidence < 0.7) return 'Medium';
  return 'High';
}

function confidenceColor(confidence: number | null): string {
  if (confidence == null) return COLORS.text.tertiary;
  if (confidence < 0.5) return COLORS.error.DEFAULT;
  if (confidence < 0.7) return COLORS.warning.DEFAULT;
  return COLORS.success.DEFAULT;
}

export default function ReviewResultScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const resultId = id ?? null;
  const { data: result, isLoading, error } = useResult(resultId);
  const saveCorrections = useSaveCorrections();
  const confirmResult = useConfirmResult();
  // Ensures list screen also refreshes if the user just ran extraction
  useLabObservations(resultId);

  const baseAnalytes = useMemo(
    () => buildBaseAnalytes(result?.structured_data ?? null),
    [result?.structured_data],
  );

  const existingCorrections = useMemo(
    () => (result?.user_corrections ?? {}) as ResultCorrections,
    [result?.user_corrections],
  );

  // ── Lab state ────────────────────────────────────────────────────────────
  const [analyteRows, setAnalyteRows] = useState<AnalyteRow[]>(() => {
    if (!result || result.result_type !== 'lab') return [];
    const corr = existingCorrections as LabCorrections;
    const analyteOverrides = corr.analytes ?? {};
    const removedSet = new Set(corr.removed_analytes ?? []);

    const base: AnalyteRow[] = baseAnalytes.map((a) => {
      const override = analyteOverrides[a.name];
      const valueStr = override?.value ?? a.value ?? '';
      return {
        localKey: nextRowKey(),
        originalName: a.name,
        name: override?.name ?? a.name,
        value: valueStr ?? '',
        unit: override?.unit ?? a.unit ?? '',
        refRangeText: override?.ref_range_text ?? a.ref_range_text ?? '',
        flag: (override?.flag ?? a.flag ?? null) as LabFlag | null,
        confidence: a.confidence,
        removed: removedSet.has(a.name),
      };
    });

    for (const added of corr.added_analytes ?? []) {
      base.push({
        localKey: nextRowKey(),
        originalName: null,
        name: added.name ?? '',
        value: added.value ?? '',
        unit: added.unit ?? '',
        refRangeText: added.ref_range_text ?? '',
        flag: (added.flag ?? null) as LabFlag | null,
        confidence: null,
        removed: false,
      });
    }
    return base;
  });

  // ── Imaging state ────────────────────────────────────────────────────────
  const [imagingForm, setImagingForm] = useState(() => {
    const structured = (result?.structured_data ?? {}) as Record<string, unknown>;
    const corr = existingCorrections as ImagingCorrections;
    const pick = (key: keyof ImagingCorrections): string => {
      if (key in corr && corr[key] !== undefined) return corr[key] ?? '';
      const v = structured[key];
      return typeof v === 'string' ? v : '';
    };
    return {
      modality: pick('modality'),
      body_part: pick('body_part'),
      findings: pick('findings'),
      impression: pick('impression'),
      radiologist: pick('radiologist'),
      comparison: pick('comparison'),
    };
  });

  // ── Other state ──────────────────────────────────────────────────────────
  const [otherSummary, setOtherSummary] = useState(() => {
    const structured = (result?.structured_data ?? {}) as Record<string, unknown>;
    const corr = existingCorrections as OtherCorrections;
    if ('summary' in corr) return corr.summary ?? '';
    return typeof structured.summary === 'string' ? structured.summary : '';
  });

  const [keyFindingRows, setKeyFindingRows] = useState<KeyFindingRow[]>(() => {
    if (!result || result.result_type !== 'other') return [];
    const structured = (result.structured_data ?? {}) as Record<string, unknown>;
    const corr = existingCorrections as OtherCorrections;
    const source: OtherKeyFinding[] =
      corr.key_findings ?? ((structured.key_findings ?? []) as OtherKeyFinding[]);
    return source.map((f) => ({
      localKey: nextRowKey(),
      label: f.label ?? '',
      value: f.value ?? '',
      confidence: typeof f.confidence === 'number' ? f.confidence : null,
      removed: false,
    }));
  });

  const [reportExpanded, setReportExpanded] = useState(false);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.primary.DEFAULT} />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !result) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <Text style={styles.errorText}>Could not load this result.</Text>
          <TouchableOpacity onPress={() => router.back()} style={styles.errorBack}>
            <Text style={styles.backText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const overallConfidence =
    typeof (result.structured_data as { overall_confidence?: unknown } | null)
      ?.overall_confidence === 'number'
      ? ((result.structured_data as { overall_confidence: number }).overall_confidence)
      : null;

  // ── Lab mutations ────────────────────────────────────────────────────────
  function updateAnalyte(key: string, patch: Partial<AnalyteRow>) {
    setAnalyteRows((rows) =>
      rows.map((r) => (r.localKey === key ? { ...r, ...patch } : r)),
    );
  }

  function removeAnalyte(key: string) {
    setAnalyteRows((rows) =>
      rows
        .map((r) => {
          if (r.localKey !== key) return r;
          // If it was a manually added row, drop it entirely. Otherwise
          // mark as removed so we emit it in removed_analytes.
          if (r.originalName === null) return null;
          return { ...r, removed: true };
        })
        .filter((r): r is AnalyteRow => r !== null),
    );
  }

  function restoreAnalyte(key: string) {
    setAnalyteRows((rows) =>
      rows.map((r) => (r.localKey === key ? { ...r, removed: false } : r)),
    );
  }

  function addBlankAnalyte() {
    setAnalyteRows((rows) => [
      ...rows,
      {
        localKey: nextRowKey(),
        originalName: null,
        name: '',
        value: '',
        unit: '',
        refRangeText: '',
        flag: null,
        confidence: null,
        removed: false,
      },
    ]);
  }

  // ── Other key-findings mutations ─────────────────────────────────────────
  function updateKeyFinding(key: string, patch: Partial<KeyFindingRow>) {
    setKeyFindingRows((rows) =>
      rows.map((r) => (r.localKey === key ? { ...r, ...patch } : r)),
    );
  }

  function removeKeyFinding(key: string) {
    setKeyFindingRows((rows) => rows.filter((r) => r.localKey !== key));
  }

  function addKeyFinding() {
    setKeyFindingRows((rows) => [
      ...rows,
      {
        localKey: nextRowKey(),
        label: '',
        value: '',
        confidence: null,
        removed: false,
      },
    ]);
  }

  // ── Corrections builder ──────────────────────────────────────────────────
  function buildCorrections(): ResultCorrections {
    if (result!.result_type === 'lab') {
      const baseByName = new Map<string, BaseAnalyte>();
      for (const b of baseAnalytes) baseByName.set(b.name, b);

      const analyteOverrides: LabCorrections['analytes'] = {};
      const addedAnalytes: LabCorrections['added_analytes'] = [];
      const removedAnalytes: string[] = [];

      for (const r of analyteRows) {
        if (r.originalName && r.removed) {
          removedAnalytes.push(r.originalName);
          continue;
        }
        const trimmedName = r.name.trim();
        if (!trimmedName) continue;

        if (r.originalName === null) {
          addedAnalytes.push({
            name: trimmedName,
            value: r.value.trim() || null,
            numeric_value: parseNumeric(r.value),
            unit: r.unit.trim() || null,
            ref_range_text: r.refRangeText.trim() || null,
            flag: r.flag,
          });
          continue;
        }

        const base = baseByName.get(r.originalName);
        if (!base) continue;

        const nameChanged = trimmedName !== r.originalName;
        const valueChanged = (r.value ?? '') !== (base.value ?? '');
        const unitChanged = (r.unit ?? '') !== (base.unit ?? '');
        const rangeChanged =
          (r.refRangeText ?? '') !== (base.ref_range_text ?? '');
        const flagChanged = (r.flag ?? null) !== (base.flag ?? null);

        if (
          !nameChanged &&
          !valueChanged &&
          !unitChanged &&
          !rangeChanged &&
          !flagChanged
        ) {
          continue;
        }

        analyteOverrides![r.originalName] = {
          ...(nameChanged ? { name: trimmedName } : {}),
          value: r.value.trim() || null,
          numeric_value: parseNumeric(r.value),
          unit: r.unit.trim() || null,
          ref_range_text: r.refRangeText.trim() || null,
          flag: r.flag,
          source: 'user_confirmed',
        };
      }

      const out: LabCorrections = {};
      if (Object.keys(analyteOverrides ?? {}).length > 0) {
        out.analytes = analyteOverrides;
      }
      if (addedAnalytes && addedAnalytes.length > 0) {
        out.added_analytes = addedAnalytes;
      }
      if (removedAnalytes.length > 0) {
        out.removed_analytes = removedAnalytes;
      }
      return out;
    }

    if (result!.result_type === 'imaging') {
      const structured = (result!.structured_data ?? {}) as Record<string, unknown>;
      const out: ImagingCorrections = {};
      (
        [
          'modality',
          'body_part',
          'findings',
          'impression',
          'radiologist',
          'comparison',
        ] as Array<keyof ImagingCorrections>
      ).forEach((k) => {
        const current = (imagingForm[k as keyof typeof imagingForm] ?? '').trim();
        const original =
          typeof structured[k] === 'string' ? (structured[k] as string) : '';
        if (current !== original) {
          out[k] = current ? current : null;
        }
      });
      return out;
    }

    // OTHER
    const structured = (result!.structured_data ?? {}) as Record<string, unknown>;
    const out: OtherCorrections = {};
    const originalSummary =
      typeof structured.summary === 'string' ? structured.summary : '';
    if (otherSummary.trim() !== originalSummary.trim()) {
      out.summary = otherSummary.trim() || null;
    }

    const originalFindings = (structured.key_findings ?? []) as OtherKeyFinding[];
    const currentFindings = keyFindingRows
      .filter((r) => r.label.trim() || r.value.trim())
      .map((r) => ({
        label: r.label.trim(),
        value: r.value.trim(),
        ...(r.confidence != null ? { confidence: r.confidence } : {}),
      }));
    const sameLength = currentFindings.length === originalFindings.length;
    const sameContents =
      sameLength &&
      currentFindings.every((c, i) => {
        const o = originalFindings[i];
        return (
          (c.label ?? '') === (o?.label ?? '') &&
          (c.value ?? '') === (o?.value ?? '')
        );
      });
    if (!sameContents) {
      out.key_findings = currentFindings;
    }
    return out;
  }

  // ── Actions ──────────────────────────────────────────────────────────────
  function handleSaveDraft() {
    if (!resultId) return;
    const corrections = buildCorrections();
    saveCorrections.mutate(
      { resultId, corrections },
      {
        onSuccess: () => router.back(),
        onError: (err) => Alert.alert('Error', err.message),
      },
    );
  }

  function handleConfirm() {
    if (!resultId || !result) return;
    const corrections = buildCorrections();
    confirmResult.mutate(
      {
        resultId,
        profileId: result.profile_id,
        householdId: result.household_id,
        corrections,
        resultType: result.result_type,
        structuredData: result.structured_data,
      },
      {
        onSuccess: () => {
          Alert.alert('Confirmed', 'Result confirmed and finalized.');
          router.back();
        },
        onError: (err) => Alert.alert('Error', err.message),
      },
    );
  }

  const busy = saveCorrections.isPending || confirmResult.isPending;
  const confMessage = confidenceMessage(overallConfidence);
  const confColor = confidenceColor(overallConfidence);
  const confLabel = confidenceLabel(overallConfidence);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTopRow}>
              <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                <Ionicons
                  name="chevron-back"
                  size={22}
                  color={COLORS.primary.DEFAULT}
                />
                <Text style={styles.backText}>Back</Text>
              </TouchableOpacity>
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
            <Text style={styles.title} numberOfLines={2}>
              Review Result
            </Text>
            <Text style={styles.subTitle} numberOfLines={2}>
              {result.test_name}
            </Text>
            {result.status === 'needs_review' && (
              <View
                style={[
                  styles.statusBadge,
                  { backgroundColor: COLORS.accent.dark + '1A' },
                ]}
              >
                <Ionicons
                  name="alert-circle"
                  size={12}
                  color={COLORS.accent.dark}
                />
                <Text
                  style={[styles.statusBadgeText, { color: COLORS.accent.dark }]}
                >
                  Needs Review
                </Text>
              </View>
            )}
          </View>

          {/* Confidence summary */}
          <View style={styles.sectionPadded}>
            <Card style={{ borderLeftWidth: 4, borderLeftColor: confColor }}>
              <View style={styles.confRow}>
                <View style={[styles.confDot, { backgroundColor: confColor }]} />
                <Text style={styles.confLabel}>Extraction Confidence</Text>
                {overallConfidence != null && (
                  <Text style={[styles.confScore, { color: confColor }]}>
                    {confLabel} · {(overallConfidence * 100).toFixed(0)}%
                  </Text>
                )}
              </View>
              <Text style={styles.confMessage}>{confMessage}</Text>
            </Card>
          </View>

          {/* Editable sections by type */}
          {result.result_type === 'lab' && (
            <LabEditor
              rows={analyteRows}
              onUpdate={updateAnalyte}
              onRemove={removeAnalyte}
              onRestore={restoreAnalyte}
              onAdd={addBlankAnalyte}
            />
          )}

          {result.result_type === 'imaging' && (
            <ImagingEditor form={imagingForm} onChange={setImagingForm} />
          )}

          {result.result_type === 'other' && (
            <OtherEditor
              summary={otherSummary}
              onSummaryChange={setOtherSummary}
              findings={keyFindingRows}
              onUpdateFinding={updateKeyFinding}
              onRemoveFinding={removeKeyFinding}
              onAddFinding={addKeyFinding}
            />
          )}

          {/* Original report text */}
          {result.raw_text && (
            <View style={styles.sectionPadded}>
              <TouchableOpacity
                onPress={() => setReportExpanded((x) => !x)}
                activeOpacity={0.7}
                style={styles.reportToggle}
              >
                <Ionicons
                  name={reportExpanded ? 'chevron-down' : 'chevron-forward'}
                  size={14}
                  color={COLORS.text.secondary}
                />
                <Text style={styles.reportToggleText}>
                  Original Report Text
                </Text>
              </TouchableOpacity>
              {reportExpanded && (
                <Card>
                  <Text style={styles.reportText}>{result.raw_text}</Text>
                </Card>
              )}
            </View>
          )}

          {/* Actions */}
          <View style={styles.sectionPadded}>
            <TouchableOpacity
              style={[styles.primaryAction, busy && styles.disabledAction]}
              onPress={handleConfirm}
              disabled={busy}
              activeOpacity={0.8}
            >
              {confirmResult.isPending ? (
                <ActivityIndicator color={COLORS.text.inverse} size="small" />
              ) : (
                <>
                  <Ionicons
                    name="checkmark-circle"
                    size={18}
                    color={COLORS.text.inverse}
                  />
                  <Text style={styles.primaryActionText}>Confirm & Finalize</Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.secondaryAction, busy && styles.disabledAction]}
              onPress={handleSaveDraft}
              disabled={busy}
              activeOpacity={0.7}
            >
              {saveCorrections.isPending ? (
                <ActivityIndicator color={COLORS.primary.DEFAULT} size="small" />
              ) : (
                <Text style={styles.secondaryActionText}>Save Draft</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.cancelAction}
              onPress={() => router.back()}
              disabled={busy}
              activeOpacity={0.7}
            >
              <Text style={styles.cancelActionText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Lab Editor ──────────────────────────────────────────────────────────────

interface LabEditorProps {
  rows: AnalyteRow[];
  onUpdate: (key: string, patch: Partial<AnalyteRow>) => void;
  onRemove: (key: string) => void;
  onRestore: (key: string) => void;
  onAdd: () => void;
}

function LabEditor({
  rows,
  onUpdate,
  onRemove,
  onRestore,
  onAdd,
}: LabEditorProps) {
  return (
    <View style={styles.sectionPadded}>
      <Text style={styles.sectionLabel}>LAB VALUES</Text>
      {rows.length === 0 && (
        <Card>
          <Text style={styles.emptyHint}>
            No analytes detected. Use Add Analyte below to enter values manually.
          </Text>
        </Card>
      )}
      {rows.map((row) => (
        <AnalyteCard
          key={row.localKey}
          row={row}
          onUpdate={(patch) => onUpdate(row.localKey, patch)}
          onRemove={() => onRemove(row.localKey)}
          onRestore={() => onRestore(row.localKey)}
        />
      ))}
      <TouchableOpacity
        style={styles.addRowButton}
        onPress={onAdd}
        activeOpacity={0.7}
      >
        <Ionicons name="add-circle-outline" size={18} color={COLORS.primary.DEFAULT} />
        <Text style={styles.addRowButtonText}>Add Analyte</Text>
      </TouchableOpacity>
    </View>
  );
}

function AnalyteCard({
  row,
  onUpdate,
  onRemove,
  onRestore,
}: {
  row: AnalyteRow;
  onUpdate: (patch: Partial<AnalyteRow>) => void;
  onRemove: () => void;
  onRestore: () => void;
}) {
  const lowConfidence =
    row.confidence != null && row.confidence < LOW_CONFIDENCE_THRESHOLD;
  const cardStyle = [
    styles.analyteCard,
    lowConfidence && !row.removed && styles.analyteCardLowConfidence,
    row.removed && styles.analyteCardRemoved,
  ];

  if (row.removed) {
    return (
      <View style={cardStyle}>
        <View style={styles.analyteHeaderRow}>
          <Text style={styles.analyteRemovedName}>{row.name}</Text>
          <TouchableOpacity onPress={onRestore} activeOpacity={0.7}>
            <Text style={styles.restoreText}>Restore</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.emptyHint}>Will be removed when you confirm.</Text>
      </View>
    );
  }

  return (
    <View style={cardStyle}>
      <View style={styles.analyteHeaderRow}>
        <View style={styles.analyteConfWrap}>
          {row.confidence != null && (
            <ConfidenceBadge confidence={row.confidence} />
          )}
          {row.originalName === null && (
            <View style={styles.addedBadge}>
              <Text style={styles.addedBadgeText}>Added</Text>
            </View>
          )}
        </View>
        <TouchableOpacity
          onPress={onRemove}
          style={styles.analyteDeleteButton}
          activeOpacity={0.7}
          hitSlop={8}
        >
          <Ionicons name="close" size={16} color={COLORS.text.secondary} />
        </TouchableOpacity>
      </View>

      <FieldLabel label="Analyte" />
      <TextInput
        style={styles.fieldInput}
        value={row.name}
        onChangeText={(v) => onUpdate({ name: v })}
        placeholder="e.g., Hemoglobin A1c"
        placeholderTextColor={COLORS.text.tertiary}
      />

      <View style={styles.fieldRow}>
        <View style={styles.fieldHalf}>
          <FieldLabel label="Value" />
          <TextInput
            style={styles.fieldInput}
            value={row.value}
            onChangeText={(v) => onUpdate({ value: v })}
            placeholder="e.g., 6.8"
            placeholderTextColor={COLORS.text.tertiary}
            keyboardType="default"
          />
        </View>
        <View style={styles.fieldHalf}>
          <FieldLabel label="Unit" />
          <TextInput
            style={styles.fieldInput}
            value={row.unit}
            onChangeText={(v) => onUpdate({ unit: v })}
            placeholder="e.g., mg/dL"
            placeholderTextColor={COLORS.text.tertiary}
            autoCapitalize="none"
          />
        </View>
      </View>

      <FieldLabel label="Reference Range" />
      <TextInput
        style={styles.fieldInput}
        value={row.refRangeText}
        onChangeText={(v) => onUpdate({ refRangeText: v })}
        placeholder="e.g., 70-100"
        placeholderTextColor={COLORS.text.tertiary}
      />

      <FieldLabel label="Flag" />
      <View style={styles.flagRow}>
        <TouchableOpacity
          style={[
            styles.flagChip,
            row.flag === null && styles.flagChipSelected,
          ]}
          onPress={() => onUpdate({ flag: null })}
          activeOpacity={0.7}
        >
          <Text
            style={[
              styles.flagChipText,
              row.flag === null && styles.flagChipTextSelected,
            ]}
          >
            None
          </Text>
        </TouchableOpacity>
        {FLAG_OPTIONS.map((opt) => (
          <TouchableOpacity
            key={opt.value}
            style={[
              styles.flagChip,
              row.flag === opt.value && styles.flagChipSelected,
            ]}
            onPress={() => onUpdate({ flag: opt.value })}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.flagChipText,
                row.flag === opt.value && styles.flagChipTextSelected,
              ]}
            >
              {opt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

// ── Imaging Editor ──────────────────────────────────────────────────────────

interface ImagingForm {
  modality: string;
  body_part: string;
  findings: string;
  impression: string;
  radiologist: string;
  comparison: string;
}

function ImagingEditor({
  form,
  onChange,
}: {
  form: ImagingForm;
  onChange: (next: ImagingForm) => void;
}) {
  const set = (key: keyof ImagingForm, value: string) =>
    onChange({ ...form, [key]: value });

  return (
    <View style={styles.sectionPadded}>
      <Text style={styles.sectionLabel}>IMAGING DETAILS</Text>
      <Card>
        <View style={styles.fieldRow}>
          <View style={styles.fieldHalf}>
            <FieldLabel label="Modality" />
            <TextInput
              style={styles.fieldInput}
              value={form.modality}
              onChangeText={(v) => set('modality', v)}
              placeholder="e.g., MRI"
              placeholderTextColor={COLORS.text.tertiary}
            />
          </View>
          <View style={styles.fieldHalf}>
            <FieldLabel label="Body Part" />
            <TextInput
              style={styles.fieldInput}
              value={form.body_part}
              onChangeText={(v) => set('body_part', v)}
              placeholder="e.g., Knee"
              placeholderTextColor={COLORS.text.tertiary}
            />
          </View>
        </View>

        <FieldLabel label="Findings" />
        <TextInput
          style={[styles.fieldInput, styles.fieldMultiline]}
          value={form.findings}
          onChangeText={(v) => set('findings', v)}
          placeholder="Findings as written in the report"
          placeholderTextColor={COLORS.text.tertiary}
          multiline
          textAlignVertical="top"
        />

        <FieldLabel label="Impression" />
        <TextInput
          style={[styles.fieldInput, styles.fieldMultiline]}
          value={form.impression}
          onChangeText={(v) => set('impression', v)}
          placeholder="Impression / conclusion"
          placeholderTextColor={COLORS.text.tertiary}
          multiline
          textAlignVertical="top"
        />

        <FieldLabel label="Radiologist" />
        <TextInput
          style={styles.fieldInput}
          value={form.radiologist}
          onChangeText={(v) => set('radiologist', v)}
          placeholder="Optional"
          placeholderTextColor={COLORS.text.tertiary}
        />

        <FieldLabel label="Comparison" />
        <TextInput
          style={styles.fieldInput}
          value={form.comparison}
          onChangeText={(v) => set('comparison', v)}
          placeholder="Optional"
          placeholderTextColor={COLORS.text.tertiary}
        />
      </Card>
    </View>
  );
}

// ── Other Editor ────────────────────────────────────────────────────────────

function OtherEditor({
  summary,
  onSummaryChange,
  findings,
  onUpdateFinding,
  onRemoveFinding,
  onAddFinding,
}: {
  summary: string;
  onSummaryChange: (v: string) => void;
  findings: KeyFindingRow[];
  onUpdateFinding: (key: string, patch: Partial<KeyFindingRow>) => void;
  onRemoveFinding: (key: string) => void;
  onAddFinding: () => void;
}) {
  return (
    <View style={styles.sectionPadded}>
      <Text style={styles.sectionLabel}>DETAILS</Text>
      <Card>
        <FieldLabel label="Summary" />
        <TextInput
          style={[styles.fieldInput, styles.fieldMultiline]}
          value={summary}
          onChangeText={onSummaryChange}
          placeholder="Overall summary or conclusion"
          placeholderTextColor={COLORS.text.tertiary}
          multiline
          textAlignVertical="top"
        />
      </Card>

      <Text style={[styles.sectionLabel, { marginTop: 16 }]}>KEY FINDINGS</Text>
      {findings.map((f) => {
        const lowConf =
          f.confidence != null && f.confidence < LOW_CONFIDENCE_THRESHOLD;
        return (
          <View
            key={f.localKey}
            style={[
              styles.analyteCard,
              lowConf && styles.analyteCardLowConfidence,
            ]}
          >
            <View style={styles.analyteHeaderRow}>
              {f.confidence != null && (
                <ConfidenceBadge confidence={f.confidence} />
              )}
              <View style={{ flex: 1 }} />
              <TouchableOpacity
                onPress={() => onRemoveFinding(f.localKey)}
                style={styles.analyteDeleteButton}
                activeOpacity={0.7}
                hitSlop={8}
              >
                <Ionicons name="close" size={16} color={COLORS.text.secondary} />
              </TouchableOpacity>
            </View>
            <FieldLabel label="Label" />
            <TextInput
              style={styles.fieldInput}
              value={f.label}
              onChangeText={(v) => onUpdateFinding(f.localKey, { label: v })}
              placeholder="e.g., Biopsy result"
              placeholderTextColor={COLORS.text.tertiary}
            />
            <FieldLabel label="Value" />
            <TextInput
              style={[styles.fieldInput, styles.fieldMultiline]}
              value={f.value}
              onChangeText={(v) => onUpdateFinding(f.localKey, { value: v })}
              placeholder="Finding detail"
              placeholderTextColor={COLORS.text.tertiary}
              multiline
              textAlignVertical="top"
            />
          </View>
        );
      })}
      <TouchableOpacity
        style={styles.addRowButton}
        onPress={onAddFinding}
        activeOpacity={0.7}
      >
        <Ionicons
          name="add-circle-outline"
          size={18}
          color={COLORS.primary.DEFAULT}
        />
        <Text style={styles.addRowButtonText}>Add Finding</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Shared ──────────────────────────────────────────────────────────────────

function FieldLabel({ label }: { label: string }) {
  return <Text style={styles.fieldLabel}>{label}</Text>;
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const color = confidenceColor(confidence);
  const label = confidenceLabel(confidence);
  return (
    <View style={[styles.confBadge, { backgroundColor: color + '1A' }]}>
      <Ionicons
        name={
          confidence >= 0.7
            ? 'checkmark-circle'
            : confidence >= 0.5
              ? 'warning'
              : 'alert-circle'
        }
        size={11}
        color={color}
      />
      <Text style={[styles.confBadgeText, { color }]}>
        {label} · {(confidence * 100).toFixed(0)}%
      </Text>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background.DEFAULT },
  flex: { flex: 1 },
  scrollContent: { paddingBottom: 48 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 10,
  },
  errorText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
    textAlign: 'center',
  },
  errorBack: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },

  header: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 8,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: -4,
  },
  homeButton: {
    padding: 6,
    marginRight: -6,
  },
  backText: {
    fontSize: FONT_SIZES.base,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  title: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: FONT_WEIGHTS.bold,
    color: COLORS.text.DEFAULT,
  },
  subTitle: {
    marginTop: 4,
    fontSize: FONT_SIZES.base,
    color: COLORS.text.secondary,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginTop: 8,
  },
  statusBadgeText: {
    fontSize: FONT_SIZES.xs,
    fontWeight: FONT_WEIGHTS.semibold,
  },

  // Section
  sectionPadded: {
    paddingHorizontal: 24,
    marginTop: 16,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.secondary,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 8,
  },

  // Confidence summary
  confRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  confDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  confLabel: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.DEFAULT,
    flex: 1,
  },
  confScore: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  confMessage: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    lineHeight: 20,
  },

  // Analyte card
  analyteCard: {
    backgroundColor: COLORS.surface.DEFAULT,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.border.light,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  analyteCardLowConfidence: {
    backgroundColor: COLORS.warning.light,
    borderColor: COLORS.warning.DEFAULT + '40',
  },
  analyteCardRemoved: {
    backgroundColor: COLORS.surface.muted,
    opacity: 0.7,
  },
  analyteHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    minHeight: 22,
    gap: 8,
  },
  analyteConfWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  analyteDeleteButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: COLORS.surface.muted,
  },
  analyteRemovedName: {
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.semibold,
    color: COLORS.text.secondary,
    textDecorationLine: 'line-through',
    flex: 1,
  },
  restoreText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  addedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: COLORS.secondary.DEFAULT + '1A',
  },
  addedBadgeText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.secondary.dark,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  emptyHint: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.tertiary,
    fontStyle: 'italic',
  },

  // Form fields
  fieldLabel: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.semibold,
    marginBottom: 6,
    marginTop: 8,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  fieldInput: {
    backgroundColor: COLORS.surface.DEFAULT,
    borderWidth: 1,
    borderColor: COLORS.border.DEFAULT,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
  },
  fieldMultiline: {
    minHeight: 90,
    paddingTop: 10,
  },
  fieldRow: {
    flexDirection: 'row',
    gap: 10,
  },
  fieldHalf: {
    flex: 1,
  },

  // Flag chips
  flagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  flagChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: COLORS.surface.muted,
    borderWidth: 1,
    borderColor: COLORS.border.light,
  },
  flagChipSelected: {
    backgroundColor: COLORS.primary.DEFAULT,
    borderColor: COLORS.primary.DEFAULT,
  },
  flagChipText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.text.DEFAULT,
    fontWeight: FONT_WEIGHTS.medium,
  },
  flagChipTextSelected: {
    color: COLORS.text.inverse,
  },

  // Confidence badge (per-row)
  confBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  confBadgeText: {
    fontSize: 11,
    fontWeight: FONT_WEIGHTS.semibold,
  },

  // Add row button
  addRowButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.primary.DEFAULT + '40',
    borderStyle: 'dashed',
    marginTop: 4,
  },
  addRowButtonText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.primary.DEFAULT,
    fontWeight: FONT_WEIGHTS.semibold,
  },

  // Report
  reportToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  reportToggleText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.secondary,
    fontWeight: FONT_WEIGHTS.semibold,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  reportText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.text.DEFAULT,
    lineHeight: 22,
  },

  // Actions
  primaryAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.primary.DEFAULT,
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 10,
  },
  primaryActionText: {
    color: COLORS.text.inverse,
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  secondaryAction: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.primary.DEFAULT,
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 10,
  },
  secondaryActionText: {
    color: COLORS.primary.DEFAULT,
    fontSize: FONT_SIZES.base,
    fontWeight: FONT_WEIGHTS.semibold,
  },
  cancelAction: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  cancelActionText: {
    color: COLORS.text.secondary,
    fontSize: FONT_SIZES.sm,
    fontWeight: FONT_WEIGHTS.medium,
  },
  disabledAction: {
    opacity: 0.6,
  },
});
