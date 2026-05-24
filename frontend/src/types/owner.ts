export type OwnerTaskState = 'draft' | 'published' | 'paused' | 'ended';

export type OwnerAssignStrategy = 'first-come' | 'assigned' | 'quota';

export interface OwnerTask {
  taskId: string;
  title: string;
  taskType: string;
  schemaVersion: string;
  schemaVersionId: string;
  owner: string;
  state: OwnerTaskState;
  assignStrategy: OwnerAssignStrategy;
  quotaUsed: number;
  quotaTotal: number;
  createdAt: string;
  deadline?: string;
  reward?: string;
  tags: string[];
  description?: string;
  aiReviewEnabled: boolean;
}

export interface CreateOwnerTaskRequest {
  title: string;
  tags?: string[];
  reward?: string;
  quota?: number;
  deadline?: string;
  strategy?: OwnerAssignStrategy;
  schema?: string;
  aiReviewEnabled?: boolean;
  description?: string;
  taskType?: string;
  status: OwnerTaskState;
}

export interface UpdateOwnerTaskStateRequest {
  state: OwnerTaskState;
}

export interface PageResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
