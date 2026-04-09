import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import {
  fetchTasks,
  fetchTaskDetail,
  createTask,
  updateTaskStatus,
  updateTask,
  fetchHouseholdMembers,
} from '@/services/tasks';
import {
  getTaskChain,
  createTaskChainFromTemplate,
} from '@/services/taskChains';
import type {
  TaskFilter,
  CreateTaskParams,
  UpdateTaskParams,
  TaskStatus,
  TaskChainTemplate,
} from '@/lib/types/tasks';

export function useTasks(profileId: string | null, filters?: TaskFilter) {
  return useQuery({
    queryKey: ['tasks', 'list', profileId, filters],
    queryFn: async () => {
      if (!profileId) return [];
      const result = await fetchTasks(profileId, filters);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!profileId,
  });
}

export function useTaskDetail(taskId: string | null) {
  return useQuery({
    queryKey: ['tasks', 'detail', taskId],
    queryFn: async () => {
      if (!taskId) throw new Error('No task ID');
      const result = await fetchTaskDetail(taskId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!taskId,
  });
}

export function useTaskChain(parentTaskId: string | null) {
  return useQuery({
    queryKey: ['tasks', 'chain', parentTaskId],
    queryFn: async () => {
      if (!parentTaskId) return [];
      const result = await getTaskChain(parentTaskId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!parentTaskId,
  });
}

export function useCreateTask() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (params: CreateTaskParams) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await createTask(params, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['tasks', 'list', data.profile_id] });
    },
  });
}

export function useCreateTaskChain() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      profileId,
      template,
      sourceRef,
    }: {
      profileId: string;
      template: TaskChainTemplate;
      sourceRef?: string;
    }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await createTaskChainFromTemplate(profileId, template, user.id, sourceRef);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      if (data.length > 0) {
        queryClient.invalidateQueries({ queryKey: ['tasks', 'list', data[0].profile_id] });
      }
    },
  });
}

export function useUpdateTaskStatus() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ taskId, status }: { taskId: string; status: TaskStatus }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await updateTaskStatus(taskId, status, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['tasks', 'list', data.profile_id] });
      queryClient.invalidateQueries({ queryKey: ['tasks', 'detail', data.id] });
      // Also invalidate chain queries in case chain progression happened
      if (data.parent_task_id) {
        queryClient.invalidateQueries({ queryKey: ['tasks', 'chain', data.parent_task_id] });
      }
    },
  });
}

export function useUpdateTask() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ taskId, params }: { taskId: string; params: UpdateTaskParams }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const result = await updateTask(taskId, params, user.id);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['tasks', 'list', data.profile_id] });
      queryClient.invalidateQueries({ queryKey: ['tasks', 'detail', data.id] });
    },
  });
}

export function useHouseholdMembers(householdId: string | null) {
  return useQuery({
    queryKey: ['household', 'members', householdId],
    queryFn: async () => {
      if (!householdId) return [];
      const result = await fetchHouseholdMembers(householdId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!householdId,
  });
}
