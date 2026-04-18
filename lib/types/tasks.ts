// ── Task Types ─────────────────────────────────────────────────────────────

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'dismissed';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TaskSourceType = 'manual' | 'intent_sheet' | 'appointment' | 'medication' | 'billing' | 'preventive';
export type TaskDependencyStatus = 'blocked' | 'ready';
export type TaskTriggerType = 'manual' | 'extraction' | 'proactive' | 'time_based' | 'chain';
export type TaskRecurrenceRule = 'daily' | 'weekly' | 'monthly' | 'every_3_months' | 'every_6_months' | 'yearly';

export interface TaskContactInfo {
  name: string;
  phone?: string;
  role?: string;
}

export type TaskTier = 'critical' | 'important' | 'helpful';

export interface TaskContextJson {
  call_script?: string;
  contact_info?: TaskContactInfo;
  document_refs?: string[];
  profile_refs?: string[];
  instructions?: string[];
  reference_numbers?: string[];
  tier?: TaskTier;
}

export interface Task {
  id: string;
  profile_id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  source_type: TaskSourceType;
  source_ref: string | null;
  assigned_to: string | null;
  reminder_at: string | null;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  // Enhanced fields
  context_json: TaskContextJson | null;
  parent_task_id: string | null;
  chain_order: number | null;
  depends_on_task_id: string | null;
  dependency_status: TaskDependencyStatus | null;
  assigned_to_user_id: string | null;
  recurrence_rule: TaskRecurrenceRule | null;
  next_recurrence_at: string | null;
  trigger_type: TaskTriggerType | null;
  trigger_source: string | null;
}

export interface CreateTaskParams {
  profile_id: string;
  title: string;
  description?: string;
  due_date?: string;
  priority?: TaskPriority;
  reminder_at?: string;
  context_json?: TaskContextJson;
  parent_task_id?: string;
  chain_order?: number;
  depends_on_task_id?: string;
  dependency_status?: TaskDependencyStatus;
  assigned_to_user_id?: string;
  recurrence_rule?: TaskRecurrenceRule;
  next_recurrence_at?: string;
  trigger_type?: TaskTriggerType;
  trigger_source?: string;
  source_type?: TaskSourceType;
  source_ref?: string;
}

export interface UpdateTaskParams {
  title?: string;
  description?: string | null;
  due_date?: string | null;
  priority?: TaskPriority;
  reminder_at?: string | null;
  context_json?: TaskContextJson | null;
  assigned_to_user_id?: string | null;
}

export interface TaskFilter {
  status?: TaskStatus | TaskStatus[];
  priority?: TaskPriority;
  dueBefore?: string;
  dueAfter?: string;
  assignedTo?: string;
  parentTaskId?: string;
  triggerType?: TaskTriggerType;
}

/** Priority sort order — urgent first */
export const PRIORITY_ORDER: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

/** Suggested task from AI extraction */
export interface SuggestedTask {
  title: string;
  description: string;
  priority: TaskPriority;
  suggested_due_days: number;
  category: string;
  context_json?: TaskContextJson;
}

/** Task chain template definition */
export interface TaskChainTemplate {
  id: string;
  name: string;
  description: string;
  steps: TaskChainStep[];
}

export interface TaskChainStep {
  title: string;
  description: string;
  priority: TaskPriority;
  due_days_offset: number;
  context_json?: TaskContextJson;
}

/** Proactive suggestion shown on home screen */
export interface ProactiveSuggestion {
  id: string;
  title: string;
  description: string;
  priority: TaskPriority;
  category: string;
  trigger_source: string;
  context_json?: TaskContextJson;
  due_days?: number;
}
