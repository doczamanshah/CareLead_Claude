/**
 * Commit Engine — takes accepted/edited intent items and writes them
 * to verified profile_facts, creates follow-up tasks, and logs audit events.
 *
 * This is the core "confirm & save" action in the Capture → Extract → Review → Commit loop.
 */

import { supabase } from '@/lib/supabase';
import { getCategoryFromFieldKey } from '@/lib/utils/fieldLabels';
import type { IntentItem, IntentSheet } from '@/lib/types/intent-sheet';
import type { ProfileFactCategory } from '@/lib/types/profile';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

export interface CommitSummary {
  factsCreated: number;
  tasksCreated: number;
  intentSheetId: string;
}

/** Field keys whose proposed values imply a follow-up task should be created. */
const TASK_TRIGGER_PATTERNS = [
  'follow_up',
  'follow-up',
  'appointment',
  'schedule',
  'refill',
  'renew',
  'update_pharmacy',
  'update pharmacy',
];

function shouldCreateTask(item: IntentItem): boolean {
  // Items explicitly typed as 'task' or 'reminder'
  if (item.item_type === 'task' || item.item_type === 'reminder') return true;

  // Check if the field key or proposed value text suggests a follow-up action
  const fieldKey = (item.field_key ?? '').toLowerCase();
  const valueStr = JSON.stringify(item.proposed_value).toLowerCase();

  return TASK_TRIGGER_PATTERNS.some(
    (pattern) => fieldKey.includes(pattern) || valueStr.includes(pattern),
  );
}

function deriveTaskTitle(item: IntentItem): string {
  const value = item.edited_value ?? item.proposed_value;

  // If the proposed value has a title or description field, use it
  if (typeof value === 'object' && value !== null) {
    const v = value as Record<string, unknown>;
    if (typeof v.title === 'string') return v.title;
    if (typeof v.description === 'string') return v.description;
    if (typeof v.name === 'string') return `Follow up: ${v.name}`;
    if (typeof v.value === 'string') return v.value;
  }

  // Generic fallback
  const category = getCategoryFromFieldKey(item.field_key);
  return category
    ? `Follow up on ${category.replace('_', ' ')}`
    : 'Follow-up task';
}

function deriveSourceType(sheet: IntentSheet): 'document' | 'voice' | 'photo' {
  if (sheet.source_type === 'voice') return 'voice';
  // Default to 'document' for extraction / manual / reconciliation
  return 'document';
}

const VALID_CATEGORIES: ProfileFactCategory[] = [
  'condition', 'allergy', 'medication', 'surgery', 'family_history',
  'insurance', 'care_team', 'pharmacy', 'emergency_contact', 'goal', 'measurement',
];

function isValidCategory(cat: string): cat is ProfileFactCategory {
  return VALID_CATEGORIES.includes(cat as ProfileFactCategory);
}

/**
 * Commit all accepted/edited intent items for an intent sheet.
 *
 * For each accepted item:
 * - Creates a profile_fact with verification_status='verified'
 * - If the item implies a follow-up action, creates a task
 * - Logs an audit_event for each committed change
 *
 * Updates the intent_sheet status to 'committed' and the artifact to 'completed'.
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

  // 2. Get all accepted/edited items
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

  // 3. Get the current user
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id;
  if (!userId) {
    return { success: false, error: 'Not authenticated' };
  }

  const typedSheet = sheet as IntentSheet;
  const typedItems = items as IntentItem[];
  const sourceType = deriveSourceType(typedSheet);
  const now = new Date().toISOString();

  let factsCreated = 0;
  let tasksCreated = 0;

  // 4. Process each accepted item
  for (const item of typedItems) {
    const finalValue = item.edited_value ?? item.proposed_value;
    const category = getCategoryFromFieldKey(item.field_key);

    // Create profile_fact for profile_fact items with a valid category
    if (
      (item.item_type === 'profile_fact' || item.item_type === 'medication') &&
      category &&
      isValidCategory(category)
    ) {
      const { error: factError } = await supabase.from('profile_facts').insert({
        profile_id: typedSheet.profile_id,
        category,
        field_key: item.field_key ?? `${category}.unknown`,
        value_json: finalValue,
        source_type: sourceType,
        source_ref: typedSheet.artifact_id,
        verification_status: 'verified',
        verified_at: now,
        verified_by: userId,
        actor_id: userId,
      });

      if (!factError) {
        factsCreated++;

        // Audit event for fact creation
        await supabase.from('audit_events').insert({
          profile_id: typedSheet.profile_id,
          actor_id: userId,
          event_type: 'profile_fact.created',
          metadata: {
            intent_item_id: item.id,
            intent_sheet_id: intentSheetId,
            category,
            field_key: item.field_key,
            source: 'intent_sheet_commit',
          },
        });
      }
    }

    // Create task if the item implies follow-up
    if (shouldCreateTask(item)) {
      const taskTitle = deriveTaskTitle(item);

      const { error: taskError } = await supabase.from('tasks').insert({
        profile_id: typedSheet.profile_id,
        title: taskTitle,
        description: `Auto-created from document review`,
        priority: 'medium',
        status: 'pending',
        source_type: 'intent_sheet',
        source_ref: intentSheetId,
        created_by: userId,
      });

      if (!taskError) {
        tasksCreated++;

        await supabase.from('audit_events').insert({
          profile_id: typedSheet.profile_id,
          actor_id: userId,
          event_type: 'task.created',
          metadata: {
            intent_item_id: item.id,
            intent_sheet_id: intentSheetId,
            source: 'intent_sheet_commit',
          },
        });
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
    },
  });

  return {
    success: true,
    data: {
      factsCreated,
      tasksCreated,
      intentSheetId,
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
