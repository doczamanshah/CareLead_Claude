/**
 * Voice Retrieval ("Ask Profile") — Deterministic Retrieval Engine
 *
 * Given a RoutedQuery + ProfileIndex, executes the query against the index
 * and builds an AskResponse with the right visualization format (tables,
 * trend charts, comparison tables, summary lists, timelines, or single
 * cards) based on the query type and data shape. No AI calls.
 */

import type {
  AnswerCard,
  AnswerCardAction,
  AskResponse,
  CanonicalFact,
  ComparisonCellValue,
  ComparisonTableCard,
  FactDomain,
  FactProvenance,
  FlagColor,
  GapAction,
  ProfileIndex,
  SummaryListCard,
  SummaryListItem,
  TableCard,
  TableColumn,
  TableRow,
  TimelineCard,
  TimelineItem,
  TrendChartCard,
  TrendDataPoint,
} from '@/lib/types/ask';
import type { AskIntent, AskQueryType } from '@/services/askIntents';
import type { RoutedQuery } from '@/services/askRouter';
import { formatLabValue } from '@/lib/utils/formatLabValue';
import { gapActionForIntent, gapActionForUnclassified } from '@/services/askGapActions';

// ── Utilities ──────────────────────────────────────────────────────────────

function compareByDateDesc(a: CanonicalFact, b: CanonicalFact): number {
  const aTime = a.dateRelevant ? new Date(a.dateRelevant).getTime() : 0;
  const bTime = b.dateRelevant ? new Date(b.dateRelevant).getTime() : 0;
  if (aTime !== bTime) return bTime - aTime;
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

function statusRank(f: CanonicalFact): number {
  switch (f.status) {
    case 'active':
      return 0;
    case 'verified':
      return 1;
    case 'unverified':
      return 2;
    case 'conflicted':
      return 3;
    case 'inactive':
      return 4;
    case 'archived':
      return 5;
  }
}

function routeForFact(fact: CanonicalFact): string | null {
  switch (fact.sourceType) {
    case 'med_medications':
      return `/(main)/medications/${fact.sourceId}`;
    case 'result_items':
      return `/(main)/results/${fact.sourceId}`;
    case 'apt_appointments':
      return `/(main)/appointments/${fact.sourceId}`;
    case 'billing_cases':
      return `/(main)/billing/${fact.sourceId}`;
    case 'preventive_items':
      return `/(main)/preventive/${fact.sourceId}`;
    default:
      return null;
  }
}

function viewSource(fact: CanonicalFact): AnswerCardAction {
  return {
    type: 'view_source',
    label: 'View details',
    targetId: fact.sourceId,
    targetRoute: routeForFact(fact),
  };
}

function buildCardFromFact(fact: CanonicalFact): AnswerCard {
  const actions: AnswerCardAction[] = [viewSource(fact)];
  if (fact.status === 'unverified' || fact.status === 'conflicted') {
    actions.push({
      type: fact.status === 'conflicted' ? 'resolve_conflict' : 'verify',
      label: fact.status === 'conflicted' ? 'Resolve conflict' : 'Verify',
      targetId: fact.sourceId,
      targetRoute: null,
      sourceType: fact.sourceType,
      conflictGroupId: fact.conflictGroupId,
    });
  }

  return {
    id: `card:${fact.id}`,
    title: fact.displayName,
    primaryValue: cardPrimaryValue(fact),
    secondaryValue: fact.secondaryValue,
    domain: fact.domain,
    provenance: fact.provenance,
    freshness: fact.freshness,
    dateRelevant: fact.dateRelevant,
    status: fact.status,
    sourceId: fact.sourceId,
    sourceType: fact.sourceType,
    conflictGroupId: fact.conflictGroupId,
    actions,
  };
}

function cardPrimaryValue(fact: CanonicalFact): string {
  const value = fact.value as Record<string, unknown> | null;
  if (!value || typeof value !== 'object') return fact.displayName;

  switch (fact.factType) {
    case 'medication': {
      const dose = (value.dose as string | null) ?? null;
      const frequency = (value.frequency as string | null) ?? null;
      return [dose, frequency].filter(Boolean).join(' — ') || 'Active';
    }
    case 'lab_result': {
      const text = (value.valueText as string | null) ?? null;
      const unit = (value.unit as string | null) ?? null;
      return formatLabValue(text, unit) || 'No value';
    }
    case 'imaging_result': {
      const impression = (value.impression as string | null) ?? null;
      return impression ?? 'No impression';
    }
    case 'appointment': {
      const when = (value.startTime as string | null) ?? null;
      return when ? formatDateTime(when) : (value.status as string) ?? 'Scheduled';
    }
    case 'preventive': {
      const status = ((value.status as string) ?? '').replace(/_/g, ' ');
      const due = (value.dueDate as string | null) ?? null;
      return due ? `${status} · due ${due}` : status || 'Review';
    }
    case 'billing_case': {
      const patient = value.patientResponsibility as number | null;
      const status = (value.status as string) ?? 'open';
      return patient != null ? `$${patient} · ${status}` : status;
    }
    case 'allergy': {
      const reaction = (value.reaction as string | null) ?? null;
      return reaction ?? 'Allergy noted';
    }
    case 'condition': {
      const s = (value.status as string | null) ?? null;
      return s ?? 'On record';
    }
    case 'insurance': {
      const memberId = (value.member_id as string | null) ?? null;
      return memberId ? `Member ${memberId}` : 'On file';
    }
    case 'care_team': {
      const specialty = (value.specialty as string | null) ?? null;
      return specialty ?? 'Provider';
    }
    case 'surgery': {
      const date = (value.date as string | null) ?? null;
      return date ?? 'Surgery on record';
    }
    case 'family_history':
      return (value.notes as string) ?? 'Family history';
    default:
      return fact.displayName;
  }
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatDateShort(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function factsByDomain(index: ProfileIndex, domain: FactDomain): CanonicalFact[] {
  return index.facts.filter((f) => f.domain === domain);
}

function sortForListAll(facts: CanonicalFact[]): CanonicalFact[] {
  return [...facts].sort((a, b) => {
    const rank = statusRank(a) - statusRank(b);
    if (rank !== 0) return rank;
    return compareByDateDesc(a, b);
  });
}

function fuzzyEntityMatch(fact: CanonicalFact, entity: string): boolean {
  const key = fact.factKey;
  const display = fact.displayName.toLowerCase();
  if (!entity) return false;
  const e = entity.toLowerCase().trim();
  if (!e) return false;
  if (key.includes(e) || e.includes(key)) return true;
  if (display.includes(e) || e.includes(display)) return true;
  return false;
}

function flagToColor(flag: string | null | undefined): FlagColor | undefined {
  if (!flag) return undefined;
  const f = flag.toLowerCase();
  if (f === 'normal' || f === 'in_range' || f === 'n') return 'normal';
  if (f === 'high' || f === 'h') return 'high';
  if (f === 'low' || f === 'l') return 'low';
  if (f === 'critical' || f === 'crit' || f === 'alert') return 'critical';
  return 'abnormal';
}

function systemProvenance(label: string): FactProvenance {
  return {
    source: 'system',
    sourceLabel: label,
    verifiedBy: null,
    verifiedAt: null,
  };
}

function domainLabelSingular(domain: FactDomain): string {
  switch (domain) {
    case 'medications':
      return 'medication';
    case 'labs':
      return 'lab result';
    case 'allergies':
      return 'allergy';
    case 'conditions':
      return 'condition';
    case 'appointments':
      return 'appointment';
    case 'insurance':
      return 'insurance record';
    case 'care_team':
      return 'care team member';
    case 'surgeries':
      return 'surgery';
    case 'immunizations':
      return 'immunization';
    case 'vitals':
      return 'vital';
    case 'results':
      return 'result';
    case 'billing':
      return 'billing case';
    case 'preventive':
      return 'preventive item';
  }
}

function domainLabelPlural(domain: FactDomain): string {
  switch (domain) {
    case 'medications':
      return 'medications';
    case 'labs':
      return 'lab results';
    case 'allergies':
      return 'allergies';
    case 'conditions':
      return 'conditions';
    case 'appointments':
      return 'appointments';
    case 'insurance':
      return 'insurance records';
    case 'care_team':
      return 'care team members';
    case 'surgeries':
      return 'surgeries';
    case 'immunizations':
      return 'immunizations';
    case 'vitals':
      return 'vitals';
    case 'results':
      return 'results';
    case 'billing':
      return 'billing cases';
    case 'preventive':
      return 'preventive items';
  }
}

// ── Follow-up suggestions ──────────────────────────────────────────────────

function suggestFollowUps(
  domain: FactDomain,
  firstCardTitle: string | null,
  queryType: AskQueryType,
): string[] {
  const suggestions: string[] = [];
  switch (domain) {
    case 'medications':
      if (firstCardTitle) {
        suggestions.push(`What's the dose of ${firstCardTitle}?`);
        suggestions.push(`Who prescribed ${firstCardTitle}?`);
      }
      suggestions.push('What are my allergies?');
      break;
    case 'labs':
      if (firstCardTitle && queryType !== 'get_history') {
        suggestions.push(`Show my ${firstCardTitle} history`);
      }
      suggestions.push('What are all my recent lab results?');
      suggestions.push('Any imaging on file?');
      break;
    case 'results':
      suggestions.push('What was my latest lab result?');
      suggestions.push('Show my recent lab results');
      break;
    case 'allergies':
      suggestions.push('What medications am I taking?');
      suggestions.push('What conditions do I have?');
      break;
    case 'conditions':
      suggestions.push('What medications am I taking?');
      suggestions.push('When was my last appointment?');
      break;
    case 'appointments':
      suggestions.push('When was my last appointment?');
      suggestions.push('What meds am I on?');
      break;
    case 'insurance':
      suggestions.push('Who is on my care team?');
      suggestions.push('Any outstanding bills?');
      break;
    case 'care_team':
      suggestions.push('What is my insurance?');
      suggestions.push('When is my next appointment?');
      break;
    case 'surgeries':
      suggestions.push('What conditions do I have?');
      suggestions.push('What medications am I taking?');
      break;
    case 'preventive':
      suggestions.push('When was my last appointment?');
      suggestions.push('What medications am I taking?');
      break;
    case 'billing':
      suggestions.push('What is my insurance?');
      suggestions.push('What is my member ID?');
      break;
    default:
      break;
  }
  return suggestions.slice(0, 3);
}

// ── Response factory ───────────────────────────────────────────────────────

function blankResponse(query: string, shortAnswer: string): AskResponse {
  return {
    query,
    shortAnswer,
    cards: [],
    tableCards: [],
    trendCharts: [],
    comparisonTables: [],
    summaryLists: [],
    timelines: [],
    suggestedFollowUps: [],
    noResults: false,
    gapAction: null,
  };
}

function emptyResponse(
  query: string,
  shortAnswer: string,
  suggestedFollowUps: string[] = [],
  gapAction: GapAction | null = null,
): AskResponse {
  return {
    ...blankResponse(query, shortAnswer),
    suggestedFollowUps,
    noResults: true,
    gapAction,
  };
}

/** Convenience: build an empty response with the standard intent gap action. */
function emptyResponseForIntent(
  query: string,
  shortAnswer: string,
  intent: AskIntent,
  profileIndex: ProfileIndex,
  options: { entity?: string | null; followUps?: string[] } = {},
): AskResponse {
  const gap = gapActionForIntent(intent, {
    profileId: profileIndex.profileId,
    entity: options.entity ?? null,
  });
  return emptyResponse(query, shortAnswer, options.followUps ?? [], gap);
}

// ── Lab panel grouping (table format) ──────────────────────────────────────

interface PanelGroup {
  resultId: string;
  testName: string;
  observations: CanonicalFact[];
  date: string | null;
}

function groupLabObservationsByPanel(observations: CanonicalFact[]): PanelGroup[] {
  const byResult = new Map<string, PanelGroup>();
  const orphans: CanonicalFact[] = [];

  for (const obs of observations) {
    const val = obs.value as Record<string, unknown> | null;
    const parentTest = val ? ((val.parentTestName as string | null) ?? null) : null;
    const parentId = obs.sourceId; // result_items id

    if (!parentId || !parentTest) {
      orphans.push(obs);
      continue;
    }

    if (!byResult.has(parentId)) {
      byResult.set(parentId, {
        resultId: parentId,
        testName: parentTest,
        observations: [],
        date: obs.dateRelevant,
      });
    }
    const group = byResult.get(parentId)!;
    group.observations.push(obs);
    if (obs.dateRelevant && (!group.date || obs.dateRelevant > group.date)) {
      group.date = obs.dateRelevant;
    }
  }

  const panels = Array.from(byResult.values())
    .filter((g) => g.observations.length >= 2)
    .sort((a, b) => {
      const aT = a.date ? new Date(a.date).getTime() : 0;
      const bT = b.date ? new Date(b.date).getTime() : 0;
      return bT - aT;
    });

  // Treat single-observation result groups as orphans too (display as cards).
  for (const group of byResult.values()) {
    if (group.observations.length < 2) {
      orphans.push(...group.observations);
    }
  }

  return panels.concat(
    orphans.length > 0
      ? [
          {
            resultId: '__orphans__',
            testName: '__orphans__',
            observations: orphans,
            date: null,
          },
        ]
      : [],
  );
}

function panelToTableCard(panel: PanelGroup): TableCard {
  const columns: TableColumn[] = [
    { key: 'analyte', label: 'Analyte', align: 'left' },
    { key: 'value', label: 'Value', align: 'left' },
    { key: 'ref', label: 'Reference', align: 'left' },
    { key: 'flag', label: 'Flag', align: 'right' },
  ];

  const rows: TableRow[] = panel.observations.map((obs) => {
    const val = obs.value as Record<string, unknown>;
    const valueText = (val.valueText as string | null) ?? null;
    const unit = (val.unit as string | null) ?? null;
    const ref = (val.refRangeText as string | null) ?? null;
    const flag = (val.flag as string | null) ?? null;
    const displayFlag =
      flag && flag.toLowerCase() !== 'normal'
        ? flag.charAt(0).toUpperCase() + flag.slice(1).toLowerCase()
        : flag
        ? 'Normal'
        : '—';
    return {
      values: {
        analyte: obs.displayName,
        value: formatLabValue(valueText, unit) || '—',
        ref: ref ?? '—',
        flag: displayFlag,
      },
      flag,
      flagColor: flagToColor(flag),
    };
  });

  const first = panel.observations[0];
  return {
    id: `table:${panel.resultId}`,
    title: panel.testName,
    domain: 'labs',
    columns,
    rows,
    provenance: first.provenance,
    dateRelevant: panel.date,
    sourceId: panel.resultId,
    sourceType: 'result_items',
    actions: [
      {
        type: 'view_source',
        label: 'View source',
        targetId: panel.resultId,
        targetRoute: `/(main)/results/${panel.resultId}`,
      },
    ],
  };
}

// ── Trend chart ────────────────────────────────────────────────────────────

function buildTrendChart(
  facts: CanonicalFact[],
  analyteName: string,
): TrendChartCard | null {
  const points: TrendDataPoint[] = [];
  let unit = '';
  let refLow: number | null = null;
  let refHigh: number | null = null;
  let latestProv: FactProvenance | null = null;

  const sorted = [...facts].sort((a, b) => {
    const aT = a.dateRelevant ? new Date(a.dateRelevant).getTime() : 0;
    const bT = b.dateRelevant ? new Date(b.dateRelevant).getTime() : 0;
    return aT - bT;
  });

  for (const f of sorted) {
    const v = f.value as Record<string, unknown>;
    const numeric = v?.numericValue as number | null;
    if (numeric == null || !f.dateRelevant) continue;
    points.push({
      date: f.dateRelevant,
      value: numeric,
      flag: (v?.flag as string | null) ?? null,
      sourceId: f.sourceId,
    });
    if (!unit && v?.unit) unit = v.unit as string;
    const low = v?.refRangeLow as number | null;
    const high = v?.refRangeHigh as number | null;
    if (low != null) refLow = low;
    if (high != null) refHigh = high;
    latestProv = f.provenance;
  }

  if (points.length === 0) return null;

  const latestFact = sorted[sorted.length - 1];
  return {
    id: `trend:${latestFact.factKey}:${Date.now()}`,
    title: `${analyteName.toUpperCase()} Over Time`,
    domain: 'labs',
    analyteName,
    unit,
    dataPoints: points,
    refRangeLow: refLow,
    refRangeHigh: refHigh,
    provenance: latestProv ?? systemProvenance('From your results'),
    actions: [],
  };
}

// ── Comparison table (CMP over time, etc.) ─────────────────────────────────

function buildComparisonTable(
  panels: PanelGroup[],
  title: string,
): ComparisonTableCard | null {
  if (panels.length < 2) return null;
  const limited = panels.slice(0, 5);

  const analyteSet = new Set<string>();
  for (const panel of limited) {
    for (const obs of panel.observations) analyteSet.add(obs.displayName);
  }
  const analyteNames = Array.from(analyteSet);
  const dates = limited
    .map((p) => formatDateShort(p.date))
    .reverse(); // oldest → newest

  const values: Record<string, Record<string, ComparisonCellValue>> = {};
  for (const name of analyteNames) values[name] = {};

  // Iterate limited oldest-to-newest so dates line up
  const ordered = [...limited].reverse();
  for (let i = 0; i < ordered.length; i++) {
    const panel = ordered[i];
    const dateKey = dates[i];
    for (const obs of panel.observations) {
      const v = obs.value as Record<string, unknown>;
      const valueText = (v.valueText as string | null) ?? null;
      const unit = (v.unit as string | null) ?? null;
      values[obs.displayName][dateKey] = {
        value: formatLabValue(valueText, unit) || '—',
        flag: (v.flag as string | null) ?? null,
      };
    }
  }

  const firstFact = limited[0].observations[0];
  return {
    id: `compare:${limited[0].resultId}`,
    title,
    domain: 'labs',
    dates,
    analyteNames,
    values,
    provenance: firstFact?.provenance ?? systemProvenance('From your results'),
    actions: [],
  };
}

// ── Summary list builders ──────────────────────────────────────────────────

function buildMedicationSummary(facts: CanonicalFact[]): SummaryListCard {
  const items: SummaryListItem[] = facts.map((f) => {
    const v = (f.value as Record<string, unknown>) ?? {};
    const dose = (v.dose as string | null) ?? null;
    const frequency = (v.frequency as string | null) ?? null;
    const prescriber = (v.prescriberName as string | null) ?? null;
    const detail = [dose, frequency].filter(Boolean).join(' — ') || 'Active';
    return {
      label: f.displayName,
      detail,
      secondary: prescriber ? `Dr. ${prescriber.replace(/^dr\.?\s*/i, '')}` : undefined,
      sourceId: f.sourceId,
      sourceType: f.sourceType,
      sourceRoute: routeForFact(f),
      status: f.status,
      conflictGroupId: f.conflictGroupId,
      lastUpdated: f.updatedAt,
      freshness: f.freshness,
    };
  });

  return {
    id: `summary:medications`,
    title: 'Current Medications',
    domain: 'medications',
    items,
    provenance: systemProvenance('From your medications'),
    actions: [],
  };
}

function buildAllergySummary(facts: CanonicalFact[]): SummaryListCard {
  const items: SummaryListItem[] = facts.map((f) => {
    const v = (f.value as Record<string, unknown>) ?? {};
    const reaction = (v.reaction as string | null) ?? 'No reaction noted';
    const severity = (v.severity as string | null) ?? null;
    const isSevere = severity && /severe|critical|anaphyla/i.test(severity);
    return {
      label: f.displayName,
      detail: reaction,
      secondary: severity ?? undefined,
      flag: isSevere ? severity : null,
      flagColor: isSevere ? 'critical' : undefined,
      sourceId: f.sourceId,
      sourceType: f.sourceType,
      sourceRoute: null,
      status: f.status,
      conflictGroupId: f.conflictGroupId,
      lastUpdated: f.updatedAt,
      freshness: f.freshness,
    };
  });

  return {
    id: `summary:allergies`,
    title: 'Allergies',
    domain: 'allergies',
    items,
    provenance: systemProvenance('From your profile'),
    actions: [],
  };
}

function buildConditionSummary(facts: CanonicalFact[]): SummaryListCard {
  const items: SummaryListItem[] = facts.map((f) => {
    const v = (f.value as Record<string, unknown>) ?? {};
    const status = (v.status as string | null) ?? null;
    const onset = (v.diagnosed_date as string | null) ?? (v.onset as string | null) ?? null;
    const detail = status ? status : onset ? `Since ${onset}` : 'On record';
    return {
      label: f.displayName,
      detail,
      secondary: status && onset ? `since ${onset}` : undefined,
      sourceId: f.sourceId,
      sourceType: f.sourceType,
      sourceRoute: null,
      status: f.status,
      conflictGroupId: f.conflictGroupId,
      lastUpdated: f.updatedAt,
      freshness: f.freshness,
    };
  });
  return {
    id: `summary:conditions`,
    title: 'Conditions',
    domain: 'conditions',
    items,
    provenance: systemProvenance('From your profile'),
    actions: [],
  };
}

function buildCareTeamSummary(facts: CanonicalFact[]): SummaryListCard {
  const items: SummaryListItem[] = facts.map((f) => {
    const v = (f.value as Record<string, unknown>) ?? {};
    const specialty = (v.specialty as string | null) ?? 'Provider';
    const phone = (v.phone as string | null) ?? null;
    const facility = (v.facility as string | null) ?? null;
    return {
      label: f.displayName,
      detail: specialty,
      secondary: phone ?? facility ?? undefined,
      sourceId: f.sourceId,
      sourceType: f.sourceType,
      status: f.status,
      conflictGroupId: f.conflictGroupId,
      lastUpdated: f.updatedAt,
      freshness: f.freshness,
    };
  });
  return {
    id: `summary:care_team`,
    title: 'Your Care Team',
    domain: 'care_team',
    items,
    provenance: systemProvenance('From your profile'),
    actions: [],
  };
}

function buildInsuranceSummary(facts: CanonicalFact[]): SummaryListCard {
  const items: SummaryListItem[] = facts.map((f) => {
    const v = (f.value as Record<string, unknown>) ?? {};
    const memberId = (v.member_id as string | null) ?? null;
    const group = (v.group_number as string | null) ?? null;
    const detail = memberId ? `Member ${memberId}` : 'On file';
    return {
      label: f.displayName,
      detail,
      secondary: group ? `Group ${group}` : undefined,
      sourceId: f.sourceId,
      sourceType: f.sourceType,
      status: f.status,
      conflictGroupId: f.conflictGroupId,
      lastUpdated: f.updatedAt,
      freshness: f.freshness,
    };
  });
  return {
    id: `summary:insurance`,
    title: 'Insurance',
    domain: 'insurance',
    items,
    provenance: systemProvenance('From your profile'),
    actions: [],
  };
}

function buildSurgerySummary(facts: CanonicalFact[]): SummaryListCard {
  const items: SummaryListItem[] = facts.map((f) => {
    const v = (f.value as Record<string, unknown>) ?? {};
    const date = (v.date as string | null) ?? null;
    const surgeon = (v.surgeon as string | null) ?? (v.provider as string | null) ?? null;
    const facility = (v.facility as string | null) ?? (v.location as string | null) ?? null;
    return {
      label: f.displayName,
      detail: date ? formatDate(date) ?? date : 'Surgery on record',
      secondary: surgeon ?? facility ?? undefined,
      sourceId: f.sourceId,
      sourceType: f.sourceType,
      status: f.status,
      conflictGroupId: f.conflictGroupId,
      lastUpdated: f.updatedAt,
      freshness: f.freshness,
    };
  });
  return {
    id: `summary:surgeries`,
    title: 'Surgical History',
    domain: 'surgeries',
    items,
    provenance: systemProvenance('From your profile'),
    actions: [],
  };
}

function buildPreventiveSummary(facts: CanonicalFact[]): SummaryListCard {
  const statusRank: Record<string, number> = {
    due: 0,
    overdue: 0,
    due_soon: 1,
    needs_review: 2,
    scheduled: 3,
    completed: 4,
    up_to_date: 5,
    deferred: 6,
    declined: 7,
  };
  const sorted = [...facts].sort((a, b) => {
    const aS = ((a.value as Record<string, unknown>)?.status as string) ?? 'needs_review';
    const bS = ((b.value as Record<string, unknown>)?.status as string) ?? 'needs_review';
    return (statusRank[aS] ?? 99) - (statusRank[bS] ?? 99);
  });

  const items: SummaryListItem[] = sorted.map((f) => {
    const v = (f.value as Record<string, unknown>) ?? {};
    const status = ((v.status as string | null) ?? 'needs_review').replace(/_/g, ' ');
    const due = (v.dueDate as string | null) ?? null;
    const flagColor: FlagColor | undefined =
      v.status === 'due' || v.status === 'overdue' ? 'critical'
      : v.status === 'due_soon' ? 'abnormal'
      : v.status === 'up_to_date' || v.status === 'completed' ? 'normal'
      : undefined;
    return {
      label: f.displayName,
      detail: due ? `Due ${formatDateShort(due)}` : status,
      secondary: status,
      flag: status,
      flagColor,
      sourceId: f.sourceId,
      sourceType: f.sourceType,
      sourceRoute: routeForFact(f),
      status: f.status,
      conflictGroupId: f.conflictGroupId,
    };
  });

  return {
    id: `summary:preventive`,
    title: 'Preventive Care',
    domain: 'preventive',
    items,
    provenance: systemProvenance('Guideline-based'),
    actions: [],
  };
}

// ── Timeline (appointments) ────────────────────────────────────────────────

function buildAppointmentsTimeline(facts: CanonicalFact[]): TimelineCard {
  const now = Date.now();
  const upcoming: TimelineItem[] = [];
  const past: TimelineItem[] = [];

  for (const f of facts) {
    const v = (f.value as Record<string, unknown>) ?? {};
    const provider = (v.provider as string | null) ?? null;
    const facility = (v.facility as string | null) ?? (v.location as string | null) ?? null;
    const label = provider ?? f.displayName;
    const sublabel = facility ?? (v.appointmentType as string | null) ?? '';
    const status = (v.status as string | null) ?? null;
    const t = f.dateRelevant ? new Date(f.dateRelevant).getTime() : 0;
    const item: TimelineItem = {
      label,
      sublabel,
      date: f.dateRelevant ? formatDateTime(f.dateRelevant) : '—',
      status: status ?? undefined,
      sourceId: f.sourceId,
      sourceType: f.sourceType,
      sourceRoute: routeForFact(f),
    };
    if (t >= now) upcoming.push(item);
    else past.push(item);
  }

  upcoming.sort((a, b) => (a.date > b.date ? 1 : -1));
  past.sort((a, b) => (a.date > b.date ? -1 : 1));

  return {
    id: `timeline:appointments:${Date.now()}`,
    title: 'Appointments',
    domain: 'appointments',
    upcoming,
    past: past.slice(0, 5),
    actions: [],
  };
}

// ── Partial-match responses ────────────────────────────────────────────────
//
// These fire when the user names a specific entity (e.g., "What's my
// Atorvastatin dose?", "What's my TSH?") and we don't have THAT entity but
// DO have other facts in the same domain. The response shows the existing
// list for context AND attaches a gap action that pre-fills the missing
// name — turning "I don't have that" into "here's what you have, want to
// add the missing one?".

function buildPartialMatchMedicationResponse(
  routed: RoutedQuery,
  index: ProfileIndex,
  intent: AskIntent,
): AskResponse {
  const meds = factsByDomain(index, 'medications');
  const entity = routed.entity ?? null;
  const entityLabel = entity
    ? entity.split(/\s+/).map((p) => (p ? p[0].toUpperCase() + p.slice(1) : p)).join(' ')
    : null;
  const gap = gapActionForIntent(intent, {
    profileId: index.profileId,
    entity,
  });

  if (meds.length === 0) {
    return emptyResponse(
      routed.originalQuery,
      entityLabel
        ? `${entityLabel} isn't in your medication list, and you don't have any other medications on file yet.`
        : "You don't have any medications on file yet.",
      [],
      gap,
    );
  }

  const sorted = sortForListAll(meds);
  const summary = buildMedicationSummary(sorted);
  const names = sorted.slice(0, 3).map((f) => f.displayName);
  const nameList =
    sorted.length <= 3 ? names.join(', ') : `${names.join(', ')}, and ${sorted.length - 3} more`;
  const shortAnswer = entityLabel
    ? `I don't see ${entityLabel} in your medication list. You're currently taking: ${nameList}.`
    : `That medication isn't in your list. You're currently taking: ${nameList}.`;

  return {
    ...blankResponse(routed.originalQuery, shortAnswer),
    summaryLists: [summary],
    suggestedFollowUps: suggestFollowUps('medications', sorted[0].displayName, 'list_all'),
    noResults: true,
    gapAction: gap,
  };
}

function buildPartialMatchLabResponse(
  routed: RoutedQuery,
  index: ProfileIndex,
  intent: AskIntent,
): AskResponse {
  const labs = factsByDomain(index, 'labs');
  const entity = routed.entity ?? null;
  const entityLabel = entity ? entity.toUpperCase() : null;
  const gap = gapActionForIntent(intent, {
    profileId: index.profileId,
    entity,
  });

  if (labs.length === 0) {
    return emptyResponse(
      routed.originalQuery,
      entityLabel
        ? `No ${entityLabel} results found. You don't have any other lab results on file yet either.`
        : 'No lab results found in your profile.',
      [],
      gap,
    );
  }

  // Pull recent distinct test names from existing labs to give context.
  const recentNames = new Set<string>();
  const sortedLabs = [...labs].sort(compareByDateDesc);
  for (const f of sortedLabs) {
    const v = f.value as Record<string, unknown> | null;
    const parent = (v?.parentTestName as string | null) ?? null;
    if (parent) recentNames.add(parent);
    if (recentNames.size >= 5) break;
  }
  const labelList = Array.from(recentNames).slice(0, 3).join(', ');

  const shortAnswer = entityLabel
    ? `No ${entityLabel} results found. Your most recent labs include: ${labelList || 'other panels'}.`
    : 'I don\'t have that result. Here are your recent labs.';

  return {
    ...blankResponse(routed.originalQuery, shortAnswer),
    suggestedFollowUps: suggestFollowUps('labs', null, intent.queryType),
    noResults: true,
    gapAction: gap,
  };
}

// ── Query executors ────────────────────────────────────────────────────────

function executeListAll(
  routed: RoutedQuery,
  index: ProfileIndex,
  intent: AskIntent,
): AskResponse {
  let facts = factsByDomain(index, intent.domain);
  if (intent.resultTypeFilter === 'imaging') {
    facts = facts.filter((f) => f.factType === 'imaging_result');
  }

  // Medications → single SummaryListCard (always, even for 1 item)
  if (intent.domain === 'medications' && facts.length > 0) {
    const sorted = sortForListAll(facts);
    const summary = buildMedicationSummary(sorted);
    const names = sorted.slice(0, 3).map((f) => f.displayName);
    const nameList =
      sorted.length <= 3
        ? names.join(', ')
        : `${names.join(', ')}, and ${sorted.length - 3} more`;
    const shortAnswer =
      sorted.length === 1
        ? `You're currently taking ${sorted[0].displayName}.`
        : `You're currently taking ${sorted.length} medications: ${nameList}.`;
    return {
      ...blankResponse(routed.originalQuery, shortAnswer),
      summaryLists: [summary],
      suggestedFollowUps: suggestFollowUps(intent.domain, sorted[0].displayName, 'list_all'),
    };
  }

  // Allergies → summary list (always)
  if (intent.domain === 'allergies' && facts.length > 0) {
    const sorted = sortForListAll(facts);
    return {
      ...blankResponse(
        routed.originalQuery,
        sorted.length === 1
          ? `You have 1 allergy on file: ${sorted[0].displayName}.`
          : `You have ${sorted.length} allergies on file.`,
      ),
      summaryLists: [buildAllergySummary(sorted)],
      suggestedFollowUps: suggestFollowUps('allergies', null, 'list_all'),
    };
  }

  // Conditions → summary list (always)
  if (intent.domain === 'conditions' && facts.length > 0) {
    const sorted = sortForListAll(facts);
    return {
      ...blankResponse(
        routed.originalQuery,
        sorted.length === 1
          ? `You have 1 condition on file: ${sorted[0].displayName}.`
          : `You have ${sorted.length} conditions on file.`,
      ),
      summaryLists: [buildConditionSummary(sorted)],
      suggestedFollowUps: suggestFollowUps('conditions', null, 'list_all'),
    };
  }

  // Care team → summary list (always)
  if (intent.domain === 'care_team' && facts.length > 0) {
    const sorted = sortForListAll(facts);
    return {
      ...blankResponse(
        routed.originalQuery,
        sorted.length === 1
          ? `Your care team: ${sorted[0].displayName}.`
          : `You have ${sorted.length} providers on your care team.`,
      ),
      summaryLists: [buildCareTeamSummary(sorted)],
      suggestedFollowUps: suggestFollowUps('care_team', null, 'list_all'),
    };
  }

  // Surgeries → summary list (always)
  if (intent.domain === 'surgeries' && facts.length > 0) {
    const sorted = sortForListAll(facts);
    return {
      ...blankResponse(
        routed.originalQuery,
        sorted.length === 1
          ? `You have 1 surgery on file: ${sorted[0].displayName}.`
          : `You have ${sorted.length} surgeries on file.`,
      ),
      summaryLists: [buildSurgerySummary(sorted)],
      suggestedFollowUps: suggestFollowUps('surgeries', null, 'list_all'),
    };
  }

  // Insurance → summary list (always, since keys are varied)
  if (intent.domain === 'insurance' && facts.length > 0) {
    const sorted = sortForListAll(facts);
    return {
      ...blankResponse(
        routed.originalQuery,
        sorted.length === 1
          ? `Your insurance is ${sorted[0].displayName}.`
          : `You have ${sorted.length} insurance records on file.`,
      ),
      summaryLists: [buildInsuranceSummary(sorted)],
      suggestedFollowUps: suggestFollowUps('insurance', null, 'list_all'),
    };
  }

  // Preventive → summary list
  if (intent.domain === 'preventive' && facts.length > 0) {
    return {
      ...blankResponse(
        routed.originalQuery,
        `You have ${facts.length} preventive care items.`,
      ),
      summaryLists: [buildPreventiveSummary(facts)],
      suggestedFollowUps: suggestFollowUps('preventive', null, 'list_all'),
    };
  }

  // Appointments list → timeline
  if (intent.domain === 'appointments' && facts.length > 0) {
    const timeline = buildAppointmentsTimeline(facts);
    const shortAnswer =
      timeline.upcoming.length > 0
        ? `You have ${timeline.upcoming.length} upcoming appointment${timeline.upcoming.length === 1 ? '' : 's'}.`
        : `No upcoming appointments. ${timeline.past.length} past on file.`;
    return {
      ...blankResponse(routed.originalQuery, shortAnswer),
      timelines: [timeline],
      suggestedFollowUps: suggestFollowUps('appointments', null, 'list_all'),
    };
  }

  // Labs / results → table panels
  if ((intent.domain === 'labs' || intent.domain === 'results') && facts.length > 0) {
    const labObs = factsByDomain(index, 'labs');
    const panels = groupLabObservationsByPanel(labObs);
    const realPanels = panels.filter((p) => p.resultId !== '__orphans__');
    const orphanGroup = panels.find((p) => p.resultId === '__orphans__');
    const imaging = facts.filter((f) => f.factType === 'imaging_result');

    // Panel-name detection — "my CMP", "comprehensive metabolic panel", etc.
    // return just the matching panel as a single TableCard.
    const queryLower = routed.normalizedQuery;
    const PANEL_MATCHERS: Array<{ query: string[]; testName: string[] }> = [
      { query: ['comprehensive metabolic', 'cmp'], testName: ['comprehensive metabolic', 'cmp'] },
      { query: ['basic metabolic', 'bmp'], testName: ['basic metabolic', 'bmp'] },
      { query: ['complete blood count', 'cbc'], testName: ['complete blood count', 'cbc'] },
      { query: ['lipid panel', 'lipid'], testName: ['lipid'] },
      { query: ['metabolic panel'], testName: ['metabolic'] },
    ];
    const panelMatcher = PANEL_MATCHERS.find((m) =>
      m.query.some((k) => {
        const padded = ` ${queryLower} `;
        return padded.includes(` ${k} `);
      }),
    );
    if (panelMatcher && realPanels.length > 0) {
      const matching = realPanels.filter((p) =>
        panelMatcher.testName.some((k) => p.testName.toLowerCase().includes(k)),
      );
      if (matching.length > 0) {
        const latest = matching[0];
        const table = panelToTableCard(latest);
        return {
          ...blankResponse(
            routed.originalQuery,
            `Here's your ${latest.testName}${latest.date ? ` from ${formatDateShort(latest.date)}` : ''}.`,
          ),
          tableCards: [table],
          suggestedFollowUps: suggestFollowUps('labs', latest.testName, 'list_all'),
        };
      }
    }

    const tableCards: TableCard[] = realPanels.slice(0, 3).map(panelToTableCard);
    const orphanCards: AnswerCard[] = (orphanGroup?.observations ?? [])
      .slice(0, 10)
      .map(buildCardFromFact);
    const imagingCards: AnswerCard[] = imaging.map(buildCardFromFact);

    if (tableCards.length === 0 && orphanCards.length === 0 && imagingCards.length === 0) {
      return emptyResponseForIntent(
        routed.originalQuery,
        `No ${domainLabelPlural(intent.domain)} found in your profile.`,
        intent,
        index,
        { followUps: suggestFollowUps(intent.domain, null, 'list_all') },
      );
    }

    const firstTable = tableCards[0];
    const shortAnswer = firstTable
      ? `Here's your ${firstTable.title}${
          firstTable.dateRelevant ? ` from ${formatDateShort(firstTable.dateRelevant)}` : ''
        }.`
      : `You have ${orphanCards.length + imagingCards.length} ${domainLabelPlural(intent.domain)} on file.`;

    return {
      ...blankResponse(routed.originalQuery, shortAnswer),
      tableCards,
      cards: [...orphanCards, ...imagingCards],
      suggestedFollowUps: suggestFollowUps(intent.domain, firstTable?.title ?? null, 'list_all'),
    };
  }

  // Default fallback — individual cards
  const sorted = sortForListAll(facts);
  const cards = sorted.map(buildCardFromFact);

  if (cards.length === 0) {
    return emptyResponseForIntent(
      routed.originalQuery,
      `No ${domainLabelPlural(intent.domain)} found in your profile.`,
      intent,
      index,
      { followUps: suggestFollowUps(intent.domain, null, 'list_all') },
    );
  }

  const label = cards.length === 1
    ? domainLabelSingular(intent.domain)
    : domainLabelPlural(intent.domain);
  return {
    ...blankResponse(
      routed.originalQuery,
      `You have ${cards.length} ${label} on file.`,
    ),
    cards,
    suggestedFollowUps: suggestFollowUps(intent.domain, cards[0].title, 'list_all'),
  };
}

function executeGetLatest(
  routed: RoutedQuery,
  index: ProfileIndex,
  intent: AskIntent,
): AskResponse {
  let facts = factsByDomain(index, intent.domain);

  // Appointments: still a timeline so user sees context
  if (intent.domain === 'appointments' && facts.length > 0) {
    const timeline = buildAppointmentsTimeline(facts);
    let shortAnswer: string;
    if (intent.direction === 'upcoming') {
      if (timeline.upcoming.length === 0) {
        return emptyResponseForIntent(
          routed.originalQuery,
          'No upcoming appointments on your calendar.',
          intent,
          index,
          { followUps: suggestFollowUps('appointments', null, 'get_latest') },
        );
      }
      const next = timeline.upcoming[0];
      shortAnswer = `Your next appointment is ${next.date}${next.label ? ` with ${next.label}` : ''}.`;
    } else if (intent.direction === 'past') {
      if (timeline.past.length === 0) {
        return emptyResponseForIntent(
          routed.originalQuery,
          "I don't have a record of a past appointment.",
          intent,
          index,
          { followUps: suggestFollowUps('appointments', null, 'get_latest') },
        );
      }
      const last = timeline.past[0];
      shortAnswer = `Your last appointment was ${last.date}${last.label ? ` with ${last.label}` : ''}.`;
    } else {
      shortAnswer = 'Here are your appointments.';
    }
    return {
      ...blankResponse(routed.originalQuery, shortAnswer),
      timelines: [timeline],
      suggestedFollowUps: suggestFollowUps('appointments', null, 'get_latest'),
    };
  }

  if (intent.direction === 'upcoming') {
    const now = Date.now();
    facts = facts
      .filter((f) => f.dateRelevant && new Date(f.dateRelevant).getTime() >= now)
      .sort((a, b) => {
        const aT = a.dateRelevant ? new Date(a.dateRelevant).getTime() : Infinity;
        const bT = b.dateRelevant ? new Date(b.dateRelevant).getTime() : Infinity;
        return aT - bT;
      });
  } else if (intent.direction === 'past') {
    const now = Date.now();
    facts = facts
      .filter((f) => f.dateRelevant && new Date(f.dateRelevant).getTime() < now)
      .sort(compareByDateDesc);
  } else {
    facts = [...facts].sort(compareByDateDesc);
  }

  if (intent.entityRequired && routed.entity) {
    facts = facts.filter((f) => fuzzyEntityMatch(f, routed.entity!));
  }

  const latest = facts[0];
  if (!latest) {
    const entityPart = routed.entity ? `${routed.entity} ` : '';
    // Partial-match: user named a specific lab/entity that isn't on file.
    // If other labs DO exist, show them as a summary list alongside the gap
    // action — gives the user context plus a one-tap route to add the missing one.
    if (intent.domain === 'labs' && routed.entity) {
      return buildPartialMatchLabResponse(routed, index, intent);
    }
    return emptyResponseForIntent(
      routed.originalQuery,
      `I don't have a record of ${entityPart}${domainLabelSingular(intent.domain)} in your profile.`,
      intent,
      index,
      {
        entity: routed.entity,
        followUps: suggestFollowUps(intent.domain, null, 'get_latest'),
      },
    );
  }

  // Latest lab for a named analyte: show a table if it's from a panel, else single card.
  if (intent.domain === 'labs' && routed.entity) {
    const val = latest.value as Record<string, unknown>;
    const parentTest = (val?.parentTestName as string | null) ?? null;
    const parentId = latest.sourceId;
    if (parentTest && parentId) {
      // Build a panel from the same result so user sees all analytes in context.
      const siblings = factsByDomain(index, 'labs').filter((f) => f.sourceId === parentId);
      if (siblings.length >= 2) {
        const panel: PanelGroup = {
          resultId: parentId,
          testName: parentTest,
          observations: siblings,
          date: latest.dateRelevant,
        };
        const table = panelToTableCard(panel);
        const when = formatDate(latest.dateRelevant);
        const value = cardPrimaryValue(latest);
        return {
          ...blankResponse(
            routed.originalQuery,
            `Your latest ${routed.entity.toUpperCase()} was ${value}${when ? ` on ${when}` : ''}. Here's the full panel:`,
          ),
          tableCards: [table],
          suggestedFollowUps: suggestFollowUps('labs', latest.displayName, 'get_latest'),
        };
      }
    }
  }

  const card = buildCardFromFact(latest);
  const when = formatDate(latest.dateRelevant);
  let shortAnswer: string;
  if (intent.domain === 'labs' && routed.entity) {
    const value = cardPrimaryValue(latest);
    shortAnswer = `Your latest ${routed.entity.toUpperCase()} was ${value}${when ? ` on ${when}` : ''}.`;
  } else {
    shortAnswer = `Most recent: ${latest.displayName}${when ? ` (${when})` : ''}.`;
  }

  return {
    ...blankResponse(routed.originalQuery, shortAnswer),
    cards: [card],
    suggestedFollowUps: suggestFollowUps(intent.domain, latest.displayName, 'get_latest'),
  };
}

function executeGetSpecific(
  routed: RoutedQuery,
  index: ProfileIndex,
  intent: AskIntent,
): AskResponse {
  if (!routed.entity) {
    return emptyResponseForIntent(
      routed.originalQuery,
      `Which ${domainLabelSingular(intent.domain)}? Try naming the one you're asking about.`,
      intent,
      index,
      { followUps: suggestFollowUps(intent.domain, null, 'get_specific') },
    );
  }

  const facts = factsByDomain(index, intent.domain).filter((f) =>
    fuzzyEntityMatch(f, routed.entity!),
  );
  const fact = facts[0];
  if (!fact) {
    // Partial-match: medication user asked about isn't in their list, but
    // others may be. Show the existing list for context plus a one-tap
    // gap action prefilled with the missing name.
    if (intent.domain === 'medications') {
      return buildPartialMatchMedicationResponse(routed, index, intent);
    }
    return emptyResponseForIntent(
      routed.originalQuery,
      `I don't have ${routed.entity} in your profile.`,
      intent,
      index,
      {
        entity: routed.entity,
        followUps: suggestFollowUps(intent.domain, null, 'get_specific'),
      },
    );
  }

  const card = buildCardFromFact(fact);
  const value = fact.value as Record<string, unknown> | null;
  let shortAnswer = card.primaryValue;

  if (intent.attribute === 'dose' && value) {
    const dose = (value.dose as string | null) ?? (value.strength as string | null) ?? null;
    const frequency = (value.frequency as string | null) ?? null;
    const combined = [dose, frequency].filter(Boolean).join(' — ');
    shortAnswer = combined
      ? `${fact.displayName}: ${combined}.`
      : `I don't have a dose on file for ${fact.displayName}.`;
  } else if (intent.attribute === 'prescriber' && value) {
    const prescriber = (value.prescriberName as string | null) ?? null;
    shortAnswer = prescriber
      ? `${fact.displayName} was prescribed by ${prescriber}.`
      : `I don't have a prescriber on file for ${fact.displayName}.`;
  } else if (intent.attribute === 'pharmacy' && value) {
    const pharmacy = (value.pharmacyName as string | null) ?? null;
    shortAnswer = pharmacy
      ? `${fact.displayName} is filled at ${pharmacy}.`
      : `I don't have a pharmacy on file for ${fact.displayName}.`;
  }

  return {
    ...blankResponse(routed.originalQuery, shortAnswer),
    cards: [card],
    suggestedFollowUps: suggestFollowUps(intent.domain, fact.displayName, 'get_specific'),
  };
}

function executeGetHistory(
  routed: RoutedQuery,
  index: ProfileIndex,
  intent: AskIntent,
): AskResponse {
  if (!routed.entity) {
    return emptyResponseForIntent(
      routed.originalQuery,
      `Which ${domainLabelSingular(intent.domain)}? Try naming it (e.g., "A1C history").`,
      intent,
      index,
      { followUps: suggestFollowUps(intent.domain, null, 'get_history') },
    );
  }

  const labObs = factsByDomain(index, 'labs');
  const matched = labObs
    .filter((f) => fuzzyEntityMatch(f, routed.entity!))
    .sort(compareByDateDesc);

  if (matched.length === 0) {
    return buildPartialMatchLabResponse(routed, index, intent);
  }

  // Single analyte requested — build a trend chart.
  const sample = matched[0];
  const val = sample.value as Record<string, unknown>;
  const hasNumeric = val?.numericValue != null;

  // "compare" or a panel-shaped question (multiple observations share parent panels)
  const uniquePanels = new Set(matched.map((f) => f.sourceId).filter(Boolean));
  const queryLower = routed.normalizedQuery;
  const wantsCompare =
    queryLower.includes('compare') || queryLower.includes('comparison');

  // If the user named a panel name (CMP, cbc, bmp, lipid) — comparison table
  const PANEL_HINTS = ['cmp', 'bmp', 'cbc', 'lipid', 'panel', 'metabolic'];
  const asksPanel = PANEL_HINTS.some((h) => queryLower.includes(h));

  if ((wantsCompare || asksPanel) && uniquePanels.size >= 2) {
    const panelsByResult = new Map<string, PanelGroup>();
    for (const obs of labObs) {
      const pid = obs.sourceId;
      const pTest = ((obs.value as Record<string, unknown>)?.parentTestName as string | null) ?? null;
      if (!pid || !pTest) continue;
      if (!panelsByResult.has(pid)) {
        panelsByResult.set(pid, {
          resultId: pid,
          testName: pTest,
          observations: [],
          date: obs.dateRelevant,
        });
      }
      const group = panelsByResult.get(pid)!;
      group.observations.push(obs);
    }
    const relevantPanels = Array.from(panelsByResult.values())
      .filter((p) => p.testName.toLowerCase().includes(routed.entity!.toLowerCase()))
      .sort((a, b) => {
        const aT = a.date ? new Date(a.date).getTime() : 0;
        const bT = b.date ? new Date(b.date).getTime() : 0;
        return bT - aT;
      });

    if (relevantPanels.length >= 2) {
      const comp = buildComparisonTable(
        relevantPanels,
        `${routed.entity.toUpperCase()} Comparison`,
      );
      if (comp) {
        return {
          ...blankResponse(
            routed.originalQuery,
            `Here's your ${routed.entity.toUpperCase()} across ${relevantPanels.slice(0, 5).length} visits:`,
          ),
          comparisonTables: [comp],
          suggestedFollowUps: suggestFollowUps('labs', routed.entity, 'get_history'),
        };
      }
    }
  }

  if (hasNumeric && matched.length >= 2) {
    const chart = buildTrendChart(matched, routed.entity);
    if (chart) {
      const latestVal = (matched[0].value as Record<string, unknown>)?.valueText as
        | string
        | null
        | undefined;
      const unit = (matched[0].value as Record<string, unknown>)?.unit as
        | string
        | null
        | undefined;
      const latestDisplay = formatLabValue(latestVal ?? null, unit ?? null);
      const latestDate = formatDate(matched[0].dateRelevant);
      return {
        ...blankResponse(
          routed.originalQuery,
          `${matched.length} ${routed.entity.toUpperCase()} readings on file. Latest: ${latestDisplay}${latestDate ? ` (${latestDate})` : ''}.`,
        ),
        trendCharts: [chart],
        suggestedFollowUps: suggestFollowUps('labs', routed.entity, 'get_history'),
      };
    }
  }

  // Fallback — individual cards (not enough numeric data for a chart)
  const cards = matched.map(buildCardFromFact);
  return {
    ...blankResponse(
      routed.originalQuery,
      cards.length === 1
        ? `1 ${routed.entity.toUpperCase()} result on file (not enough data for a trend).`
        : `Here are your ${routed.entity.toUpperCase()} results: ${cards.length} records.`,
    ),
    cards,
    suggestedFollowUps: suggestFollowUps('labs', matched[0].displayName, 'get_history'),
  };
}

function executeGetCount(
  routed: RoutedQuery,
  index: ProfileIndex,
  intent: AskIntent,
): AskResponse {
  const facts = factsByDomain(index, intent.domain);
  const count = facts.length;
  return {
    ...blankResponse(
      routed.originalQuery,
      `You have ${count} ${
        count === 1 ? domainLabelSingular(intent.domain) : domainLabelPlural(intent.domain)
      }.`,
    ),
    suggestedFollowUps: suggestFollowUps(intent.domain, null, 'get_count'),
    noResults: count === 0,
    gapAction:
      count === 0
        ? gapActionForIntent(intent, { profileId: index.profileId })
        : null,
  };
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface ExecuteQueryParams {
  routedQuery: RoutedQuery;
  profileIndex: ProfileIndex;
}

export function executeQuery({ routedQuery, profileIndex }: ExecuteQueryParams): AskResponse {
  const intent = routedQuery.intent;
  if (!intent) {
    return emptyResponse(
      routedQuery.originalQuery,
      "I'm not sure how to answer that from your profile yet.",
      [],
      gapActionForUnclassified(routedQuery.originalQuery, {
        profileId: profileIndex.profileId,
      }),
    );
  }

  switch (intent.queryType) {
    case 'list_all':
      return executeListAll(routedQuery, profileIndex, intent);
    case 'get_latest':
      return executeGetLatest(routedQuery, profileIndex, intent);
    case 'get_specific':
      return executeGetSpecific(routedQuery, profileIndex, intent);
    case 'get_history':
      return executeGetHistory(routedQuery, profileIndex, intent);
    case 'get_count':
      return executeGetCount(routedQuery, profileIndex, intent);
  }
}
