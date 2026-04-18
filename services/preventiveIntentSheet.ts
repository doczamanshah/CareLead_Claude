/**
 * Preventive Intent Sheet generator — turns selected preventive_items into
 * a reviewable plan of proposed tasks and reminders. Pure function, no IO.
 *
 * The generator picks task titles, descriptions, tiers, and relative due
 * offsets based on the rule's category (or specific rule code where the
 * prep copy varies, e.g. CRC vs. mammogram).
 */

import type {
  PreventiveItemWithRule,
  PreventiveIntentSheetContent,
  PreventiveIntentSheetItem,
  PreventiveProposedTask,
  PreventiveProposedReminder,
  PreventiveCategory,
} from '@/lib/types/preventive';

function cancerPrepDescription(ruleCode: string): string {
  if (ruleCode === 'crc_screening') {
    return 'Follow prep instructions from your provider. This may include dietary changes and a bowel prep solution.';
  }
  if (ruleCode === 'breast_cancer_screening') {
    return 'No special preparation needed. Avoid deodorant on the day of the exam.';
  }
  if (ruleCode === 'cervical_cancer_screening') {
    return 'Schedule for a time when you are not menstruating. No special prep needed.';
  }
  // Sensible fallback for any future cancer screenings.
  return 'Follow any prep instructions your provider gives you ahead of the appointment.';
}

function tasksForItem(item: PreventiveItemWithRule): PreventiveProposedTask[] {
  const title = item.rule.title;
  const category = item.rule.category as PreventiveCategory;

  if (category === 'cancer_screening') {
    return [
      {
        title: `Schedule ${title}`,
        description: `Call your doctor's office or use their portal to schedule your ${title}. Bring your insurance card and any prep instructions.`,
        tier: 'important',
        dueInDays: 14,
      },
      {
        title: `Complete ${title} prep`,
        description: cancerPrepDescription(item.rule.code),
        tier: 'helpful',
        dueInDays: null,
      },
    ];
  }

  if (category === 'immunization') {
    return [
      {
        title: `Get ${title}`,
        description: `You can get this at your doctor's office, pharmacy, or local health department. Check with your insurance about coverage.`,
        tier: 'important',
        dueInDays: 14,
      },
    ];
  }

  // cardiovascular, metabolic, bone_health, other
  return [
    {
      title: `Schedule ${title}`,
      description: `This can be done at your next doctor's visit or scheduled separately. Ask your doctor if fasting is required.`,
      tier: 'helpful',
      dueInDays: 30,
    },
  ];
}

function remindersForItem(item: PreventiveItemWithRule): PreventiveProposedReminder[] {
  const title = item.rule.title;
  const category = item.rule.category as PreventiveCategory;

  if (category === 'cancer_screening') {
    return [{ title: `Don't forget: ${title} is due`, remindInDays: 7 }];
  }
  if (category === 'immunization') {
    return [{ title: `${title} is due`, remindInDays: 7 }];
  }
  return [{ title: `${title} coming up`, remindInDays: 14 }];
}

/**
 * Build intent sheet content from a set of selected preventive items.
 * The caller is responsible for filtering to due/due_soon items; the
 * generator will not reject any input status, so callers can also use
 * this for needs_review or scheduled items if needed later.
 */
export function generatePreventiveIntentSheet(params: {
  profileId: string;
  householdId: string;
  selectedItems: PreventiveItemWithRule[];
}): PreventiveIntentSheetContent {
  const items: PreventiveIntentSheetItem[] = params.selectedItems.map((item) => ({
    preventiveItemId: item.id,
    ruleCode: item.rule.code,
    title: item.rule.title,
    currentStatus: item.status,
    proposedStatus: 'scheduled' as const,
    proposedTasks: tasksForItem(item),
    proposedReminders: remindersForItem(item),
  }));

  return { items };
}
