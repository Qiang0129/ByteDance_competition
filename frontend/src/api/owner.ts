import { apiRequest } from './client';
import type {
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

  updateTaskState(taskId: string, state: OwnerTaskState): Promise<OwnerTask> {
    return apiRequest<OwnerTask>(`/tasks/${taskId}/state`, {
      method: 'PUT',
      body: JSON.stringify({ state }),
    });
  },
};
