/**
 * Task Chains — create, manage, and progress linked task sequences.
 *
 * A task chain is a sequence of tasks where each depends on the previous one.
 * The first task starts as 'ready', the rest as 'blocked'.
 */

import { supabase } from '@/lib/supabase';
import type { Task, TaskChainTemplate, CreateTaskParams } from '@/lib/types/tasks';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

function addDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(17, 0, 0, 0);
  return date.toISOString();
}

/**
 * Create a task chain from a template.
 * First task is 'ready', all others are 'blocked' until the previous one completes.
 */
export async function createTaskChainFromTemplate(
  profileId: string,
  template: TaskChainTemplate,
  userId: string,
  sourceRef?: string,
): Promise<ServiceResult<Task[]>> {
  const createdTasks: Task[] = [];
  let parentTaskId: string | null = null;
  let previousTaskId: string | null = null;

  for (let i = 0; i < template.steps.length; i++) {
    const step = template.steps[i];
    const isFirst = i === 0;

    const insertData: Record<string, unknown> = {
      profile_id: profileId,
      title: step.title,
      description: step.description,
      priority: step.priority,
      status: 'pending',
      due_date: addDays(step.due_days_offset),
      source_type: 'intent_sheet',
      source_ref: sourceRef ?? null,
      created_by: userId,
      trigger_type: 'chain',
      trigger_source: `${template.name} — Step ${i + 1} of ${template.steps.length}`,
      context_json: step.context_json ?? null,
      chain_order: i + 1,
      dependency_status: isFirst ? 'ready' : 'blocked',
    };

    // First task becomes the parent of the chain
    if (parentTaskId) {
      insertData.parent_task_id = parentTaskId;
    }

    // Each task after the first depends on the previous one
    if (previousTaskId) {
      insertData.depends_on_task_id = previousTaskId;
    }

    const { data, error } = await supabase
      .from('tasks')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      return { success: false, error: `Failed to create step ${i + 1}: ${error.message}` };
    }

    const task = data as Task;
    createdTasks.push(task);

    // The first task becomes the parent for all subsequent tasks
    if (isFirst) {
      parentTaskId = task.id;
      // Update the first task to be its own parent (chain root)
      await supabase
        .from('tasks')
        .update({ parent_task_id: task.id })
        .eq('id', task.id);
    }

    previousTaskId = task.id;
  }

  // Log audit event for chain creation
  if (createdTasks.length > 0) {
    await supabase.from('audit_events').insert({
      profile_id: profileId,
      actor_id: userId,
      event_type: 'task_chain.created',
      metadata: {
        chain_name: template.name,
        chain_id: template.id,
        task_count: createdTasks.length,
        parent_task_id: parentTaskId,
      },
    });
  }

  return { success: true, data: createdTasks };
}

/**
 * Create an ad-hoc task chain from an array of task params.
 */
export async function createTaskChain(
  profileId: string,
  tasks: Omit<CreateTaskParams, 'profile_id'>[],
  userId: string,
): Promise<ServiceResult<Task[]>> {
  const createdTasks: Task[] = [];
  let parentTaskId: string | null = null;
  let previousTaskId: string | null = null;

  for (let i = 0; i < tasks.length; i++) {
    const taskParams = tasks[i];
    const isFirst = i === 0;

    const insertData: Record<string, unknown> = {
      profile_id: profileId,
      title: taskParams.title,
      description: taskParams.description ?? null,
      priority: taskParams.priority ?? 'medium',
      status: 'pending',
      due_date: taskParams.due_date ?? null,
      source_type: taskParams.source_type ?? 'manual',
      source_ref: taskParams.source_ref ?? null,
      created_by: userId,
      trigger_type: 'chain',
      trigger_source: taskParams.trigger_source ?? `Task chain — Step ${i + 1} of ${tasks.length}`,
      context_json: taskParams.context_json ?? null,
      chain_order: i + 1,
      dependency_status: isFirst ? 'ready' : 'blocked',
    };

    if (parentTaskId) {
      insertData.parent_task_id = parentTaskId;
    }
    if (previousTaskId) {
      insertData.depends_on_task_id = previousTaskId;
    }

    const { data, error } = await supabase
      .from('tasks')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      return { success: false, error: `Failed to create step ${i + 1}: ${error.message}` };
    }

    const task = data as Task;
    createdTasks.push(task);

    if (isFirst) {
      parentTaskId = task.id;
      await supabase
        .from('tasks')
        .update({ parent_task_id: task.id })
        .eq('id', task.id);
    }

    previousTaskId = task.id;
  }

  return { success: true, data: createdTasks };
}

/**
 * When a task is completed, unblock dependent tasks and handle recurrence.
 */
export async function onTaskCompleted(
  taskId: string,
  userId: string,
): Promise<ServiceResult<{ unblockedCount: number; recurredTaskId: string | null }>> {
  // 1. Find tasks that depend on this one
  const { data: dependents, error: depError } = await supabase
    .from('tasks')
    .select('id')
    .eq('depends_on_task_id', taskId)
    .eq('dependency_status', 'blocked')
    .is('deleted_at', null);

  if (depError) {
    return { success: false, error: depError.message };
  }

  let unblockedCount = 0;

  // 2. Unblock dependent tasks
  if (dependents && dependents.length > 0) {
    const depIds = dependents.map((d) => d.id);
    const { error: updateError } = await supabase
      .from('tasks')
      .update({ dependency_status: 'ready' })
      .in('id', depIds);

    if (!updateError) {
      unblockedCount = depIds.length;
    }
  }

  // 3. Handle recurrence — create next occurrence if applicable
  let recurredTaskId: string | null = null;

  const { data: completedTask } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .single();

  if (completedTask?.recurrence_rule) {
    const task = completedTask as Task;
    const nextDueDate = calculateNextRecurrence(
      task.due_date ?? new Date().toISOString(),
      task.recurrence_rule!,
    );

    const { data: newTask, error: recurError } = await supabase
      .from('tasks')
      .insert({
        profile_id: task.profile_id,
        title: task.title,
        description: task.description,
        priority: task.priority,
        status: 'pending',
        due_date: nextDueDate,
        source_type: task.source_type,
        source_ref: task.source_ref,
        created_by: userId,
        trigger_type: 'time_based',
        trigger_source: `Recurring: ${task.recurrence_rule}`,
        context_json: task.context_json,
        recurrence_rule: task.recurrence_rule,
        assigned_to_user_id: task.assigned_to_user_id,
      })
      .select('id')
      .single();

    if (!recurError && newTask) {
      recurredTaskId = newTask.id;

      await supabase.from('audit_events').insert({
        profile_id: task.profile_id,
        actor_id: userId,
        event_type: 'task.recurred',
        metadata: {
          original_task_id: taskId,
          new_task_id: recurredTaskId,
          recurrence_rule: task.recurrence_rule,
        },
      });
    }
  }

  return {
    success: true,
    data: { unblockedCount, recurredTaskId },
  };
}

/**
 * Fetch all tasks in a chain by parent task ID.
 */
export async function getTaskChain(
  parentTaskId: string,
): Promise<ServiceResult<Task[]>> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('parent_task_id', parentTaskId)
    .is('deleted_at', null)
    .order('chain_order', { ascending: true });

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, data: (data ?? []) as Task[] };
}

function calculateNextRecurrence(currentDueDate: string, rule: string): string {
  const date = new Date(currentDueDate);

  switch (rule) {
    case 'daily':
      date.setDate(date.getDate() + 1);
      break;
    case 'weekly':
      date.setDate(date.getDate() + 7);
      break;
    case 'monthly':
      date.setMonth(date.getMonth() + 1);
      break;
    case 'every_3_months':
      date.setMonth(date.getMonth() + 3);
      break;
    case 'every_6_months':
      date.setMonth(date.getMonth() + 6);
      break;
    case 'yearly':
      date.setFullYear(date.getFullYear() + 1);
      break;
    default:
      date.setDate(date.getDate() + 7);
  }

  return date.toISOString();
}
