export type OwnerTaskState = 'draft' | 'published' | 'paused' | 'ended';

export type OwnerAssignStrategy = 'first-come' | 'assigned' | 'quota';
export type OwnerItemSelectionMode = 'all' | 'partial';
export type OwnerTaskReviewStatus =
  | 'not_started'
  | 'ai_prereviewing'
  | 'human_first_review'
  | 'human_second_review'
  | 'human_final_review'
  | 'completed';

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
  annotatedItemCount: number;
  publishedItemTotal: number;
  reviewStatus: OwnerTaskReviewStatus;
  reviewRound?: number | null;
  maxClaimPerUser?: number;
  assignedLabelerIds: string[];
  createdAt: string;
  deadline?: string;
  reward?: string;
  tags: string[];
  description?: string;
  aiReviewEnabled: boolean;
  aiReviewRuleId?: string;
  aiReviewRuleName?: string;
  /**
   * 是否为标注员开启 LLM 标注助手:
   *   - 开启时,标注员答题页右下角出现 AI 助手浮动按钮,可向 LLM 问"如何理解这道题"。
   *   - 关闭时(默认),标注员看不到助手入口,适合人类偏好对比等需要纯主观判断、避免污染的任务。
   */
  llmAssistEnabled?: boolean;
}

export interface TaskUserAllocation {
  userId: string;
  username?: string;
  displayName?: string;
  itemCount: number;
}

export interface OwnerTaskDetail {
  task: OwnerTask;
  itemSelectionMode: OwnerItemSelectionMode;
  selectedItemIds: string[];
  labelerAllocations: TaskUserAllocation[];
  reviewerAllocations: TaskUserAllocation[];
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
  schemaVersionId?: string;
  aiReviewEnabled?: boolean;
  aiReviewRuleId?: string;
  /** 是否为标注员开启 LLM 标注助手(参见 OwnerTask.llmAssistEnabled 注释) */
  llmAssistEnabled?: boolean;
  itemSelectionMode?: OwnerItemSelectionMode;
  selectedItemIds?: string[];
  labelerAllocations?: TaskUserAllocation[];
  reviewerAllocations?: TaskUserAllocation[];
  description?: string;
  taskType?: string;
  status: OwnerTaskState;
}

export interface AssignableLabeler {
  userId: string;
  username: string;
  displayName: string;
  monthlyAcceptedReward?: number | null;
  monthlyPendingReward?: number | null;
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
