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
  datasetId?: string;
  quotaUsed: number;
  quotaTotal: number;
  maxClaimPerUser?: number;
  assignedLabelerIds: string[];
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
  datasetId?: string;
  strategy?: OwnerAssignStrategy;
  maxClaimPerUser?: number;
  assignedLabelerIds?: string[];
  schema?: string;
  aiReviewEnabled?: boolean;
  description?: string;
  taskType?: string;
  status: OwnerTaskState;
}

export interface AssignableLabeler {
  userId: string;
  username: string;
  displayName: string;
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
