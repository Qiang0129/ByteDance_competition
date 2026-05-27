import { apiRequest } from './client';
import type {
  AssignableLabeler,
  CreateOwnerTaskRequest,
  OwnerTask,
  OwnerTaskState,
  PageResult,
} from '../types/owner';

export const ownerApi = {
  listTasks(): Promise<PageResult<OwnerTask>> {
    return apiRequest<PageResult<OwnerTask>>('/tasks');
  },

  createTask(payload: CreateOwnerTaskRequest): Promise<OwnerTask> {
    return apiRequest<OwnerTask>('/tasks', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateTask(taskId: string, payload: CreateOwnerTaskRequest): Promise<OwnerTask> {
    return apiRequest<OwnerTask>(`/tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  updateTaskState(taskId: string, state: OwnerTaskState): Promise<OwnerTask> {
    return apiRequest<OwnerTask>(`/tasks/${taskId}/state`, {
      method: 'PUT',
      body: JSON.stringify({ state }),
    });
  },

  /** 删除任务(仅草稿/已结束状态允许删除) */
  deleteTask(taskId: string): Promise<void> {
    return apiRequest<void>(`/tasks/${taskId}`, {
      method: 'DELETE',
    });
  },

  listAssignableLabelers(): Promise<AssignableLabeler[]> {
    return apiRequest<AssignableLabeler[]>('/tasks/assignable-labelers');
  },
};
