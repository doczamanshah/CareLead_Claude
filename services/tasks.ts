import { supabase } from '@/lib/supabase';
import { onTaskCompleted } from '@/services/taskChains';
import type {
  Task,
  CreateTaskParams,
  UpdateTaskParams,
  TaskFilter,
  TaskStatus,
} from '@/lib/types/tasks';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

/**
 * Fetch tasks for a profile with optional filters.
 */
export async function fetchTasks(
  profileId: string,
  filters?: TaskFilter,
): Promise<ServiceResult<Task[]>> {
  let query = supabase
    .from('tasks')
    .select('*')
    .eq('profile_id', profileId)
    .is('deleted_at', null);

  if (filters?.status) {
    if (Array.isArray(filters.status)) {
      query = query.in('status', filters.status);
    } else {
      query = query.eq('status', filters.status);
    }
  }

  if (filters?.priority) {
    query = query.eq('priority', filters.priority);
  }

  if (filters?.dueBefore) {
    query = query.lte('due_date', filters.dueBefore);
  }

  if (filters?.dueAfter) {
    query = query.gte('due_date', filters.dueAfter);
  }

  if (filters?.assignedTo) {
    query = query.eq('assigned_to_user_id', filters.assignedTo);
  }

  if (filters?.parentTaskId) {
    query = query.eq('parent_task_id', filters.parentTaskId);
  }

  if (filters?.triggerType) {
    query = query.eq('trigger_type', filters.triggerType);
  }

  const { data, error } = await query
    .order('priority', { ascending: true })
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data: (data ?? []) as Task[] };
}

/**
 * Fetch a single task by ID.
 */
export async function fetchTaskDetail(
  taskId: string,
): Promise<ServiceResult<Task>> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .is('deleted_at', null)
    .single();

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data: data as Task };
}

/**
 * Create a new task (manual or programmatic).
 */
export async function createTask(
  params: CreateTaskParams,
  userId: string,
): Promise<ServiceResult<Task>> {
  const { data, error } = await supabase
    .from('tasks')
    .insert({
      profile_id: params.profile_id,
      title: params.title,
      description: params.description ?? null,
      due_date: params.due_date ?? null,
      priority: params.priority ?? 'medium',
      reminder_at: params.reminder_at ?? null,
      source_type: params.source_type ?? 'manual',
      source_ref: params.source_ref ?? null,
      status: 'pending',
      created_by: userId,
      context_json: params.context_json ?? null,
      parent_task_id: params.parent_task_id ?? null,
      chain_order: params.chain_order ?? null,
      depends_on_task_id: params.depends_on_task_id ?? null,
      dependency_status: params.dependency_status ?? null,
      assigned_to_user_id: params.assigned_to_user_id ?? null,
      recurrence_rule: params.recurrence_rule ?? null,
      next_recurrence_at: params.next_recurrence_at ?? null,
      trigger_type: params.trigger_type ?? 'manual',
      trigger_source: params.trigger_source ?? null,
    })
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  // Log audit event
  await supabase.from('audit_events').insert({
    profile_id: params.profile_id,
    actor_id: userId,
    event_type: 'task.created',
    metadata: {
      task_id: data.id,
      source: params.source_type ?? 'manual',
      trigger_type: params.trigger_type ?? 'manual',
    },
  });

  return { success: true, data: data as Task };
}

/**
 * Update the status of a task. Handles chain progression on completion.
 */
export async function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  userId: string,
): Promise<ServiceResult<Task>> {
  const updateData: Record<string, unknown> = { status };

  if (status === 'completed' || status === 'dismissed') {
    updateData.completed_at = new Date().toISOString();
  }

  if (status === 'pending' || status === 'in_progress') {
    updateData.completed_at = null;
  }

  const { data, error } = await supabase
    .from('tasks')
    .update(updateData)
    .eq('id', taskId)
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  // Log audit event
  await supabase.from('audit_events').insert({
    profile_id: data.profile_id,
    actor_id: userId,
    event_type: `task.${status}`,
    metadata: {
      task_id: taskId,
      new_status: status,
    },
  });

  // Handle chain progression and recurrence on completion
  if (status === 'completed') {
    await onTaskCompleted(taskId, userId);
  }

  return { success: true, data: data as Task };
}

/**
 * Update task details (title, description, due date, priority, reminder, assignment, context).
 */
export async function updateTask(
  taskId: string,
  params: UpdateTaskParams,
  userId: string,
): Promise<ServiceResult<Task>> {
  const { data, error } = await supabase
    .from('tasks')
    .update(params)
    .eq('id', taskId)
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  await supabase.from('audit_events').insert({
    profile_id: data.profile_id,
    actor_id: userId,
    event_type: 'task.updated',
    metadata: {
      task_id: taskId,
      updated_fields: Object.keys(params),
    },
  });

  return { success: true, data: data as Task };
}

/**
 * Fetch household members for the task assignee picker.
 */
export async function fetchHouseholdMembers(
  householdId: string,
): Promise<ServiceResult<{ user_id: string; display_name: string; role: string }[]>> {
  // Get household members with their profile info
  const { data: members, error } = await supabase
    .from('household_members')
    .select(`
      user_id,
      role,
      profiles!inner(display_name)
    `)
    .eq('household_id', householdId)
    .eq('status', 'active')
    .not('user_id', 'is', null);

  if (error) {
    return { success: false, error: error.message };
  }

  const result = (members ?? []).map((m: Record<string, unknown>) => {
    const profiles = m.profiles as Record<string, unknown> | Record<string, unknown>[];
    const profile = Array.isArray(profiles) ? profiles[0] : profiles;
    return {
      user_id: m.user_id as string,
      display_name: (profile?.display_name as string) ?? 'Unknown',
      role: m.role as string,
    };
  });

  return { success: true, data: result };
}
