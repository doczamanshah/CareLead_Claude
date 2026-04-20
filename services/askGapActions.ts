/**
 * Voice Retrieval ("Ask Profile") — Gap Actions
 *
 * When an Ask query returns nothing (or returns a partial match for a
 * specific named entity like "Atorvastatin"), the engine attaches a
 * GapAction to the response so the user can jump straight from the answer
 * to the relevant entry/capture screen — no detour through menus.
 *
 * Pure data: no I/O, no React. All routes refer to existing screens; new
 * route params (`prefillName`, `resultType`, `prefillTestName`) are wired
 * up in the corresponding screen files.
 */

import type { GapAction } from '@/lib/types/ask';
import type { AskIntent } from '@/services/askIntents';

interface GapActionContext {
  profileId: string;
  /** Free-text entity from the user's question (e.g., "Atorvastatin", "TSH"). */
  entity?: string | null;
}

/** Title-case for prefilling fields from a normalized query token. */
function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((part) => (part.length === 0 ? part : part[0].toUpperCase() + part.slice(1)))
    .join(' ');
}

/** Route placeholder — `[profileId]` is substituted in the Ask screen handler. */
const PROFILE_ADD_FACT_ROUTE = '/(main)/profile/[profileId]/add-fact';

/**
 * Map an intent ID to the corresponding gap action. Returns null when the
 * intent is purely informational and there's nothing reasonable to add
 * (e.g., GET_BILLING — bills come from documents, not manual entry here).
 */
export function gapActionForIntent(
  intent: AskIntent,
  ctx: GapActionContext,
): GapAction | null {
  const entity = ctx.entity?.trim();
  const entityLabel = entity ? titleCase(entity) : null;

  switch (intent.id) {
    case 'GET_ACTIVE_MEDS':
      return {
        message: "You don't have any medications on file yet.",
        actionLabel: 'Add a medication',
        actionRoute: '/(main)/medications/create',
      };

    case 'GET_MED_DOSE':
    case 'GET_MED_PRESCRIBER':
    case 'GET_MED_FREQUENCY':
    case 'GET_MED_PHARMACY':
    case 'GET_MED_DURATION':
    case 'IS_TAKING_MED':
      // Partial match: user named a specific medication that's not on file.
      // Prefill the name so they don't have to retype.
      return {
        message: entityLabel
          ? `${entityLabel} isn't in your medication list.`
          : "That medication isn't in your list.",
        actionLabel: entityLabel ? `Add ${entityLabel}` : 'Add a medication',
        actionRoute: '/(main)/medications/create',
        actionParams: entityLabel ? { prefillName: entityLabel } : undefined,
      };

    case 'GET_LATEST_LAB':
    case 'GET_LAB_HISTORY':
    case 'IS_LAB_NORMAL':
      return {
        message: entityLabel
          ? `No ${entityLabel.toUpperCase()} results found.`
          : 'No lab results found.',
        actionLabel: entityLabel ? `Add a ${entityLabel.toUpperCase()} result` : 'Add a lab result',
        actionRoute: '/(main)/results/add-typed',
        actionParams: {
          resultType: 'lab',
          ...(entityLabel ? { prefillTestName: entityLabel } : {}),
        },
        secondaryLabel: 'Upload a report',
        secondaryRoute: '/(main)/results/add-upload',
        secondaryParams: { resultType: 'lab' },
      };

    case 'GET_ALL_RESULTS':
      return {
        message: 'No lab results found.',
        actionLabel: 'Add a lab result',
        actionRoute: '/(main)/results/add',
        actionParams: { resultType: 'lab' },
      };

    case 'GET_IMAGING':
      return {
        message: 'No imaging results found.',
        actionLabel: 'Add an imaging result',
        actionRoute: '/(main)/results/add',
        actionParams: { resultType: 'imaging' },
        secondaryLabel: 'Upload a report',
        secondaryRoute: '/(main)/results/add-upload',
        secondaryParams: { resultType: 'imaging' },
      };

    case 'GET_ALLERGIES':
      return {
        message: 'No allergies on file.',
        actionLabel: 'Add an allergy',
        actionRoute: PROFILE_ADD_FACT_ROUTE,
        actionParams: { profileId: ctx.profileId, category: 'allergy' },
      };

    case 'GET_CONDITIONS':
      return {
        message: 'No conditions on file.',
        actionLabel: 'Add a condition',
        actionRoute: PROFILE_ADD_FACT_ROUTE,
        actionParams: { profileId: ctx.profileId, category: 'condition' },
      };

    case 'GET_CARE_TEAM':
      return {
        message: 'No care team members on file.',
        actionLabel: 'Add a provider',
        actionRoute: PROFILE_ADD_FACT_ROUTE,
        actionParams: { profileId: ctx.profileId, category: 'care_team' },
      };

    case 'GET_INSURANCE':
      return {
        message: 'No insurance information on file.',
        actionLabel: 'Snap your insurance card',
        actionRoute: '/(main)/capture/camera',
        secondaryLabel: 'Add manually',
        secondaryRoute: PROFILE_ADD_FACT_ROUTE,
        secondaryParams: { profileId: ctx.profileId, category: 'insurance' },
      };

    case 'GET_NEXT_APPOINTMENT':
    case 'GET_LAST_APPOINTMENT':
    case 'GET_APPOINTMENTS':
      return {
        message:
          intent.id === 'GET_LAST_APPOINTMENT'
            ? 'No past appointments on file.'
            : 'No appointments on file.',
        actionLabel: 'Add an appointment',
        actionRoute: '/(main)/appointments/create',
      };

    case 'GET_SURGERIES':
      return {
        message: 'No surgical history on file.',
        actionLabel: 'Add a surgery',
        actionRoute: PROFILE_ADD_FACT_ROUTE,
        actionParams: { profileId: ctx.profileId, category: 'surgery' },
      };

    case 'GET_PREVENTIVE_STATUS':
      return {
        message: 'No preventive care items checked yet.',
        actionLabel: 'Run a preventive check',
        actionRoute: '/(main)/preventive',
      };

    case 'GET_BILLING':
      return null;

    default:
      return null;
  }
}

// ── Keyword-based gap detection for AI fallback / unclassified queries ────

const KEYWORD_RULES: Array<{
  keywords: RegExp;
  build: (query: string, ctx: GapActionContext) => GapAction;
}> = [
  {
    keywords: /\b(medication|medicine|drug|pill|dose|dosage|prescription|rx|refill)\b/i,
    build: () => ({
      message: "I don't have that medication info in your profile.",
      actionLabel: 'Add a medication',
      actionRoute: '/(main)/medications/create',
    }),
  },
  {
    keywords: /\b(lab|test|result|a1c|cholesterol|glucose|tsh|panel|cbc|cmp|bmp|ldl|hdl|hemoglobin|blood)\b/i,
    build: () => ({
      message: "I don't have that result in your profile.",
      actionLabel: 'Add a lab result',
      actionRoute: '/(main)/results/add',
      actionParams: { resultType: 'lab' },
      secondaryLabel: 'Upload a report',
      secondaryRoute: '/(main)/results/add-upload',
    }),
  },
  {
    keywords: /\b(allerg|reaction)/i,
    build: (_q, ctx) => ({
      message: "I don't have allergy info on file.",
      actionLabel: 'Add an allergy',
      actionRoute: PROFILE_ADD_FACT_ROUTE,
      actionParams: { profileId: ctx.profileId, category: 'allergy' },
    }),
  },
  {
    keywords: /\b(condition|diagnos|disease|problem)/i,
    build: (_q, ctx) => ({
      message: "I don't have that condition on file.",
      actionLabel: 'Add a condition',
      actionRoute: PROFILE_ADD_FACT_ROUTE,
      actionParams: { profileId: ctx.profileId, category: 'condition' },
    }),
  },
  {
    keywords: /\b(appointment|visit|schedul)/i,
    build: () => ({
      message: 'No appointments on file matching that.',
      actionLabel: 'Add an appointment',
      actionRoute: '/(main)/appointments/create',
    }),
  },
  {
    keywords: /\b(insurance|coverage|member|plan|payer|group number)/i,
    build: (_q, ctx) => ({
      message: "I don't have that insurance info on file.",
      actionLabel: 'Snap your insurance card',
      actionRoute: '/(main)/capture/camera',
      secondaryLabel: 'Add manually',
      secondaryRoute: PROFILE_ADD_FACT_ROUTE,
      secondaryParams: { profileId: ctx.profileId, category: 'insurance' },
    }),
  },
  {
    keywords: /\b(imaging|x-ray|xray|mri|ct scan|ultrasound|radiology)\b/i,
    build: () => ({
      message: 'No imaging on file matching that.',
      actionLabel: 'Add an imaging result',
      actionRoute: '/(main)/results/add',
      actionParams: { resultType: 'imaging' },
    }),
  },
  {
    keywords: /\b(care team|doctor|provider|specialist|pcp)\b/i,
    build: (_q, ctx) => ({
      message: "That provider isn't on your care team yet.",
      actionLabel: 'Add a provider',
      actionRoute: PROFILE_ADD_FACT_ROUTE,
      actionParams: { profileId: ctx.profileId, category: 'care_team' },
    }),
  },
  {
    keywords: /\b(surgery|operation|procedure)\b/i,
    build: (_q, ctx) => ({
      message: 'No surgical history on file.',
      actionLabel: 'Add a surgery',
      actionRoute: PROFILE_ADD_FACT_ROUTE,
      actionParams: { profileId: ctx.profileId, category: 'surgery' },
    }),
  },
];

/** Default action for unclassified queries — let the user upload a document. */
const DEFAULT_GAP: GapAction = {
  message: "I don't have that in your profile yet.",
  actionLabel: 'Upload a document',
  actionRoute: '/(main)/capture/upload',
};

export function gapActionForUnclassified(
  query: string,
  ctx: GapActionContext,
): GapAction {
  for (const rule of KEYWORD_RULES) {
    if (rule.keywords.test(query)) {
      return rule.build(query, ctx);
    }
  }
  return DEFAULT_GAP;
}
