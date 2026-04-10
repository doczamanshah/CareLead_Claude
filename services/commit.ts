/**
 * Commit Engine — takes accepted/edited intent items and writes them
 * to verified profile_facts, auto-generates tasks silently, and logs audit events.
 *
 * This is the SINGLE source of AI-suggested task generation.
 * The Intent Sheet is purely for fact verification — no task items.
 */

import { supabase } from '@/lib/supabase';
import { getCategoryFromFieldKey } from '@/lib/utils/fieldLabels';
import { getCareGuidanceLevel } from '@/services/preferences';
import { findExistingProfileFact, describeFactChanges, getIdentifyingFieldForCategory } from '@/services/profileFactUpsert';
import { createMedicationFromExtraction } from '@/services/medicationSync';
import type { IntentItem, IntentSheet } from '@/lib/types/intent-sheet';
import type { ProfileFactCategory } from '@/lib/types/profile';
import type { TaskContextJson, TaskPriority } from '@/lib/types/tasks';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

export interface CommitSummary {
  factsCreated: number;
  tasksCreated: number;
  intentSheetId: string;
  createdTaskIds: string[];
  /** Fields committed, for the Smart Follow-Up card */
  committedItems: CommittedItemInfo[];
  /** Gaps detected during commit that couldn't generate tasks */
  detectedGaps: DetectedGap[];
}

export interface CommittedItemInfo {
  category: string;
  fieldKey: string;
  value: Record<string, unknown>;
  factId: string;
}

export interface DetectedGap {
  category: string;
  missingField: string;
  reason: string;
  relatedFactId: string;
}

/**
 * Task tier type matching the extraction tier system.
 */
type TaskTier = 'critical' | 'important' | 'helpful';

interface SmartTaskDef {
  title: string;
  description: string;
  priority: TaskPriority;
  tier: TaskTier;
  dueDays: number;
  triggerSource: string;
  contextJson?: TaskContextJson;
  /** Context requirements that must be met to generate this task */
  requires?: TaskContextRequirement;
}

interface TaskContextRequirement {
  /** Fields that must be present in the committed value */
  valueFields?: string[];
  /** Profile categories that must have at least one fact */
  profileCategories?: string[];
  /** If requirements aren't met, what gap to report */
  gapField: string;
  gapReason: string;
}

/**
 * Category-specific smart task generators.
 * Each task now includes context requirements (Part 3: Task Generation Gates).
 */
const CATEGORY_TASK_GENERATORS: Record<
  string,
  (value: Record<string, unknown>, profileId: string) => SmartTaskDef[]
> = {
  medication: (value) => {
    const drugName = (value.drug_name as string) || (value.name as string) || 'medication';
    const tasks: SmartTaskDef[] = [
      {
        title: `Set up medication schedule for ${drugName}`,
        description: `Set up a recurring reminder to take ${drugName} as prescribed${value.frequency ? ` (${value.frequency})` : ''}.`,
        priority: 'high',
        tier: 'critical',
        dueDays: 1,
        triggerSource: `New medication: ${drugName}`,
        contextJson: {
          tier: 'critical',
          instructions: [
            `Set a recurring alarm for ${value.frequency || 'the prescribed schedule'}`,
            `Label it "${drugName}${value.dose ? ` ${value.dose}` : ''}"`,
          ],
        },
        requires: {
          valueFields: ['drug_name'],
          gapField: 'dose_or_frequency',
          gapReason: 'dose and frequency needed for medication schedule',
        },
      },
      {
        title: `Fill prescription for ${drugName}`,
        description: `Ensure your prescription for ${drugName} is filled and ready for pickup.`,
        priority: 'high',
        tier: 'critical',
        dueDays: 1,
        triggerSource: `New medication: ${drugName}`,
        contextJson: {
          tier: 'critical',
          instructions: [
            `Check if ${drugName} has been sent to your pharmacy`,
            `Call pharmacy to confirm it's ready or request a fill`,
          ],
          contact_info: (value.pharmacy_name || value.pharmacy_phone)
            ? {
                name: (value.pharmacy_name as string) || 'Pharmacy',
                phone: value.pharmacy_phone as string,
                role: 'Pharmacy',
              }
            : undefined,
          reference_numbers: value.rx_number ? [value.rx_number as string] : undefined,
        },
        requires: {
          profileCategories: ['pharmacy'],
          gapField: 'pharmacy',
          gapReason: 'pharmacy information needed for prescription fill reminders',
        },
      },
    ];

    tasks.push({
      title: `Research side effects for ${drugName}`,
      description: `Review common side effects and interactions for ${drugName}.`,
      priority: 'low',
      tier: 'helpful',
      dueDays: 7,
      triggerSource: `New medication: ${drugName}`,
      contextJson: {
        tier: 'helpful',
        instructions: [
          `Look up ${drugName} on a reputable drug info site`,
          `Note common side effects to watch for`,
        ],
      },
    });

    return tasks;
  },

  allergy: (value) => {
    const substance = (value.substance as string) || 'allergen';
    return [
      {
        title: `Inform current providers about ${substance} allergy`,
        description: `Make sure your doctors, dentist, and pharmacy know about your allergy to ${substance}${value.reaction ? ` (reaction: ${value.reaction})` : ''}.`,
        priority: 'high',
        tier: 'important',
        dueDays: 3,
        triggerSource: `New allergy: ${substance}`,
        contextJson: {
          tier: 'important',
          instructions: [
            `Call each of your healthcare providers`,
            `Ask them to update your allergy list with: ${substance}`,
            value.reaction ? `Mention the reaction: ${value.reaction}` : null,
            value.severity ? `Note severity: ${value.severity}` : null,
          ].filter(Boolean) as string[],
        },
        requires: {
          profileCategories: ['care_team'],
          gapField: 'care_team',
          gapReason: 'no care team members on file to notify about allergy',
        },
      },
    ];
  },

  insurance: (value) => {
    const planName = (value.payer_name as string) || (value.plan_name as string) || 'insurance';
    return [
      {
        title: `Update pharmacy with new insurance`,
        description: `Bring your new ${planName} card to the pharmacy so they can bill correctly.`,
        priority: 'medium',
        tier: 'important',
        dueDays: 3,
        triggerSource: `New insurance: ${planName}`,
        contextJson: {
          tier: 'important',
          instructions: [
            `Visit or call your pharmacy`,
            `Provide new insurance: ${planName}`,
            value.member_id ? `Member ID: ${value.member_id}` : null,
            value.group_number ? `Group #: ${value.group_number}` : null,
            value.rx_bin ? `RX BIN: ${value.rx_bin}` : null,
          ].filter(Boolean) as string[],
          reference_numbers: [
            value.member_id as string,
            value.group_number as string,
          ].filter(Boolean),
          contact_info: value.phone_member_services
            ? { name: planName, phone: value.phone_member_services as string, role: 'Member Services' }
            : undefined,
        },
        requires: {
          profileCategories: ['pharmacy'],
          gapField: 'pharmacy',
          gapReason: 'no pharmacy on file to update with new insurance',
        },
      },
    ];
  },

  condition: (value) => {
    const conditionName = (value.name as string) || (value.condition_name as string) || 'condition';
    return [
      {
        title: `Discuss management plan for ${conditionName} at next appointment`,
        description: `Talk to your doctor about treatment options, monitoring, and lifestyle changes for ${conditionName}.`,
        priority: 'medium',
        tier: 'important',
        dueDays: 7,
        triggerSource: `New diagnosis: ${conditionName}`,
        contextJson: {
          tier: 'important',
          instructions: [
            `What are my treatment options?`,
            `Are there lifestyle changes that would help?`,
            `How often should I be monitored?`,
            `What warning signs should I watch for?`,
          ],
        },
      },
      {
        title: `Research ${conditionName}`,
        description: `Learn about ${conditionName}, its management, and what questions to ask your doctor.`,
        priority: 'low',
        tier: 'helpful',
        dueDays: 7,
        triggerSource: `New diagnosis: ${conditionName}`,
        contextJson: {
          tier: 'helpful',
          instructions: [
            `Look up ${conditionName} on reputable medical sites (Mayo Clinic, NIH, CDC)`,
            `Note key symptoms to watch for`,
          ],
        },
      },
    ];
  },

  care_team: (value) => {
    const providerName = (value.name as string) || 'provider';
    if (!value.phone) return [];
    return [
      {
        title: `Save ${providerName}'s contact in phone`,
        description: `Add ${providerName}${value.specialty ? ` (${value.specialty})` : ''} to your contacts.`,
        priority: 'low',
        tier: 'helpful',
        dueDays: 1,
        triggerSource: `New provider: ${providerName}`,
        contextJson: {
          tier: 'helpful',
          contact_info: {
            name: providerName,
            phone: value.phone as string,
            role: (value.specialty as string) || 'Healthcare Provider',
          },
        },
      },
    ];
  },
};

/** Care guidance level — controls which task tiers are auto-generated */
export type CareGuidanceLevel = 'essentials' | 'balanced' | 'comprehensive';

/** Get allowed tiers based on guidance level */
function getAllowedTiers(level: CareGuidanceLevel): TaskTier[] {
  switch (level) {
    case 'essentials':
      return ['critical'];
    case 'balanced':
      return ['critical', 'important'];
    case 'comprehensive':
      return ['critical', 'important', 'helpful'];
  }
}

function addDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(17, 0, 0, 0);
  return date.toISOString();
}

const VALID_CATEGORIES: ProfileFactCategory[] = [
  'condition', 'allergy', 'medication', 'surgery', 'family_history',
  'insurance', 'care_team', 'pharmacy', 'emergency_contact', 'goal', 'measurement',
];

function isValidCategory(cat: string): cat is ProfileFactCategory {
  return VALID_CATEGORIES.includes(cat as ProfileFactCategory);
}


/**
 * Check if a similar task already exists for this profile.
 * Prevents duplicate task generation.
 */
async function taskExists(
  profileId: string,
  title: string,
  sourceRef: string | null,
): Promise<boolean> {
  // Check by title (active tasks only)
  const { data } = await supabase
    .from('tasks')
    .select('id')
    .eq('profile_id', profileId)
    .eq('title', title)
    .in('status', ['pending', 'in_progress'])
    .is('deleted_at', null)
    .limit(1);

  if (data && data.length > 0) return true;

  // Also check by source_ref if provided
  if (sourceRef) {
    const { data: refData } = await supabase
      .from('tasks')
      .select('id')
      .eq('profile_id', profileId)
      .eq('source_ref', sourceRef)
      .in('status', ['pending', 'in_progress'])
      .is('deleted_at', null)
      .limit(1);

    if (refData && refData.length > 0) return true;
  }

  return false;
}

/**
 * Check if the profile has at least one fact in the given category.
 */
async function profileHasCategory(profileId: string, category: string): Promise<boolean> {
  const { data } = await supabase
    .from('profile_facts')
    .select('id')
    .eq('profile_id', profileId)
    .eq('category', category)
    .is('deleted_at', null)
    .limit(1);

  return !!(data && data.length > 0);
}

/**
 * Check if a task meets its context requirements.
 * Returns true if the task should be generated, false if context is insufficient.
 */
async function meetsContextRequirements(
  task: SmartTaskDef,
  value: Record<string, unknown>,
  profileId: string,
): Promise<{ met: boolean; missingField?: string; reason?: string }> {
  if (!task.requires) return { met: true };

  const req = task.requires;

  // Check required value fields
  if (req.valueFields) {
    for (const field of req.valueFields) {
      const v = value[field];
      if (v === null || v === undefined || v === '') {
        return { met: false, missingField: req.gapField, reason: req.gapReason };
      }
    }
  }

  // Special gate for medication schedule: need dose OR frequency
  if (task.title.includes('Set up medication schedule')) {
    const hasDose = value.dose !== null && value.dose !== undefined && value.dose !== '';
    const hasFrequency = value.frequency !== null && value.frequency !== undefined && value.frequency !== '';
    if (!hasDose && !hasFrequency) {
      return { met: false, missingField: 'dose_or_frequency', reason: 'dose or frequency needed for medication schedule' };
    }
  }

  // Check required profile categories
  if (req.profileCategories) {
    for (const cat of req.profileCategories) {
      const hasCat = await profileHasCategory(profileId, cat);
      if (!hasCat) {
        return { met: false, missingField: req.gapField, reason: req.gapReason };
      }
    }
  }

  return { met: true };
}

/**
 * Commit all accepted/edited intent items for an intent sheet.
 *
 * For each accepted item:
 * - Profile facts -> creates profile_fact with verification_status='verified'
 * - Auto-generates smart tasks silently based on care guidance level
 * - Applies context gates — insufficient context creates profile gaps instead of low-quality tasks
 * - Deduplicates tasks — won't create if similar task already exists
 * - Logs audit events for each committed change
 */
export async function commitIntentSheet(
  intentSheetId: string,
): Promise<ServiceResult<CommitSummary>> {
  // 1. Get the intent sheet
  const { data: sheet, error: sheetError } = await supabase
    .from('intent_sheets')
    .select('*')
    .eq('id', intentSheetId)
    .single();

  if (sheetError || !sheet) {
    return { success: false, error: sheetError?.message ?? 'Intent sheet not found' };
  }

  // 2. Get all accepted/edited items (only data items, not task items)
  const { data: items, error: itemsError } = await supabase
    .from('intent_items')
    .select('*')
    .eq('intent_sheet_id', intentSheetId)
    .in('status', ['accepted', 'edited']);

  if (itemsError) {
    return { success: false, error: itemsError.message };
  }

  if (!items || items.length === 0) {
    return { success: false, error: 'No accepted items to commit' };
  }

  // 3. Get the current user and their care guidance preference
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id;
  if (!userId) {
    return { success: false, error: 'Not authenticated' };
  }

  const guidanceResult = await getCareGuidanceLevel(userId);
  const careGuidanceLevel: CareGuidanceLevel = guidanceResult.success
    ? guidanceResult.data
    : 'balanced';

  const typedSheet = sheet as IntentSheet;
  const typedItems = (items as IntentItem[]).filter(
    (item) => item.item_type !== 'task' && item.item_type !== 'reminder',
  );
  const now = new Date().toISOString();

  let factsCreated = 0;
  let tasksCreated = 0;
  const createdTaskIds: string[] = [];
  const committedItems: CommittedItemInfo[] = [];
  const detectedGaps: DetectedGap[] = [];

  // 4. Process each accepted data item
  for (const item of typedItems) {
    const finalValue = item.edited_value ?? item.proposed_value;
    const category = getCategoryFromFieldKey(item.field_key);

    if (!category || !isValidCategory(category)) continue;

    // Check if an existing fact with the same identifier already exists
    const existingFact = await findExistingProfileFact(
      typedSheet.profile_id,
      category,
      finalValue as Record<string, unknown>,
    );

    let factId: string;
    let isUpdate = false;

    if (existingFact) {
      // UPDATE existing fact — merge new values into existing
      const mergedValue = { ...existingFact.value_json, ...(finalValue as Record<string, unknown>) };
      const { error: updateError } = await supabase
        .from('profile_facts')
        .update({
          value_json: mergedValue,
          source_type: 'document',
          source_ref: typedSheet.artifact_id,
          verification_status: 'verified',
          verified_at: now,
          verified_by: userId,
          actor_id: userId,
          updated_at: now,
        })
        .eq('id', existingFact.id);

      if (updateError) continue;

      factId = existingFact.id;
      isUpdate = true;

      const identifyingField = getIdentifyingFieldForCategory(category);
      const identifierName =
        identifyingField && (finalValue as Record<string, unknown>)[identifyingField]
          ? String((finalValue as Record<string, unknown>)[identifyingField])
          : category;

      await supabase.from('audit_events').insert({
        profile_id: typedSheet.profile_id,
        actor_id: userId,
        event_type: 'profile_fact.updated',
        metadata: {
          profile_fact_id: existingFact.id,
          intent_item_id: item.id,
          intent_sheet_id: intentSheetId,
          category,
          field_key: item.field_key,
          source: 'intent_sheet_commit',
          change_description: describeFactChanges(
            identifierName,
            existingFact.value_json,
            finalValue as Record<string, unknown>,
          ),
        },
      });
    } else {
      // INSERT new fact
      const { data: factData, error: factError } = await supabase
        .from('profile_facts')
        .insert({
          profile_id: typedSheet.profile_id,
          category,
          field_key: item.field_key ?? `${category}.unknown`,
          value_json: finalValue,
          source_type: 'document',
          source_ref: typedSheet.artifact_id,
          verification_status: 'verified',
          verified_at: now,
          verified_by: userId,
          actor_id: userId,
        })
        .select('id')
        .single();

      if (factError || !factData) continue;

      factId = factData.id;

      await supabase.from('audit_events').insert({
        profile_id: typedSheet.profile_id,
        actor_id: userId,
        event_type: 'profile_fact.created',
        metadata: {
          profile_fact_id: factData.id,
          intent_item_id: item.id,
          intent_sheet_id: intentSheetId,
          category,
          field_key: item.field_key,
          source: 'intent_sheet_commit',
        },
      });
    }

    factsCreated++;
    committedItems.push({
      category,
      fieldKey: item.field_key ?? `${category}.entry`,
      value: finalValue as Record<string, unknown>,
      factId,
    });

    // Create dedicated medication record alongside the profile fact
    if (category === 'medication' && !isUpdate) {
      await createMedicationFromExtraction(
        typedSheet.profile_id,
        finalValue as Record<string, unknown>,
        factId,
        userId,
      );
    }

    // Skip smart task generation for updates — only generate for new facts
    if (!isUpdate) {
      // ── Generate smart tasks (filtered by tier + context gates + dedup) ──
      const generator = CATEGORY_TASK_GENERATORS[category];
      if (generator) {
        const allowedTiers = getAllowedTiers(careGuidanceLevel);
        const smartTasks = generator(
          finalValue as Record<string, unknown>,
          typedSheet.profile_id,
        ).filter((st) => allowedTiers.includes(st.tier));

        for (const st of smartTasks) {
          // Check context requirements
          const contextCheck = await meetsContextRequirements(
            st,
            finalValue as Record<string, unknown>,
            typedSheet.profile_id,
          );

          if (!contextCheck.met) {
            // Log gap instead of creating low-quality task
            detectedGaps.push({
              category,
              missingField: contextCheck.missingField!,
              reason: contextCheck.reason!,
              relatedFactId: factId,
            });

            // Audit: task not generated due to insufficient context
            await supabase.from('audit_events').insert({
              profile_id: typedSheet.profile_id,
              actor_id: userId,
              event_type: 'task.generation_skipped',
              metadata: {
                task_title: st.title,
                category,
                missing_field: contextCheck.missingField,
                reason: contextCheck.reason,
                profile_fact_id: factId,
              },
            });

            continue;
          }

          // Deduplication check
          const isDuplicate = await taskExists(
            typedSheet.profile_id,
            st.title,
            intentSheetId,
          );

          if (isDuplicate) continue;

          const { data: stData, error: stError } = await supabase
            .from('tasks')
            .insert({
              profile_id: typedSheet.profile_id,
              title: st.title,
              description: st.description,
              priority: st.priority,
              status: 'pending',
              due_date: addDays(st.dueDays),
              source_type: 'intent_sheet',
              source_ref: intentSheetId,
              created_by: userId,
              trigger_type: 'extraction',
              trigger_source: st.triggerSource,
              context_json: st.contextJson ?? null,
            })
            .select('id')
            .single();

          if (!stError && stData) {
            tasksCreated++;
            createdTaskIds.push(stData.id);

            await supabase.from('audit_events').insert({
              profile_id: typedSheet.profile_id,
              actor_id: userId,
              event_type: 'task.created',
              metadata: {
                task_id: stData.id,
                profile_fact_id: factId,
                category,
                source: 'smart_generation',
                trigger_source: st.triggerSource,
              },
            });
          }
        }
      }
    }

    // Mark the intent item as committed
    await supabase
      .from('intent_items')
      .update({ committed_at: now })
      .eq('id', item.id);
  }

  // 5. Update intent sheet status to 'committed'
  await supabase
    .from('intent_sheets')
    .update({ status: 'committed', updated_at: now })
    .eq('id', intentSheetId);

  // 6. Update the artifact processing_status to 'completed' if there's an artifact
  if (typedSheet.artifact_id) {
    await supabase
      .from('artifacts')
      .update({ processing_status: 'completed', updated_at: now })
      .eq('id', typedSheet.artifact_id);
  }

  // 7. Log the overall commit audit event
  await supabase.from('audit_events').insert({
    profile_id: typedSheet.profile_id,
    actor_id: userId,
    event_type: 'intent_sheet.committed',
    metadata: {
      intent_sheet_id: intentSheetId,
      facts_created: factsCreated,
      tasks_created: tasksCreated,
      items_committed: typedItems.length,
      gaps_detected: detectedGaps.length,
    },
  });

  return {
    success: true,
    data: {
      factsCreated,
      tasksCreated,
      intentSheetId,
      createdTaskIds,
      committedItems,
      detectedGaps,
    },
  };
}

/**
 * Update the status of a single intent item (accept, edit, or reject).
 */
export async function updateIntentItemStatus(
  itemId: string,
  status: 'accepted' | 'edited' | 'rejected',
  editedValue?: Record<string, unknown>,
): Promise<ServiceResult<null>> {
  const updateData: Record<string, unknown> = { status };
  if (status === 'edited' && editedValue) {
    updateData.edited_value = editedValue;
  }

  const { error } = await supabase
    .from('intent_items')
    .update(updateData)
    .eq('id', itemId);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, data: null };
}
