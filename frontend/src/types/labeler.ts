import type { SchemaField } from './schema';

/**
 * Labeler 端业务类型定义。
 * 字段以《LabelHub Project Implementation Plan EN》5.1 数据模型与 5.2 API spec 为准,
 * 后端实现完成后可直接对齐字段,无需重构调用层。
 */

/** 任务在市场中的可见状态(已发布且未结束才会出现在市场列表) */
export type TaskStatus = 'draft' | 'published' | 'paused' | 'ended';

/** 任务的分发策略:先到先得 / 指派 / 配额抢单(对齐计划书 4.1) */
export type AssignStrategy = 'first-come' | 'assigned' | 'quota';

/** 媒体类型,呼应 dataset.ts 中的同名定义 */
export type TaskMediaType = 'text' | 'image' | 'video' | 'markdown';

/** 标注项在标注员侧的状态 */
export type ItemStatus = 'available' | 'claimed' | 'submitted' | 'returned' | 'accepted' | 'voided';

/** 标注答卷(annotation)的状态,呼应计划书 4.4/4.5 状态机 */
export type AnnotationStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'AI_REVIEWING'
  | 'REVIEWING'
  | 'RETURNED'
  | 'ACCEPTED'
  | 'EXPORTED'
  | 'VOIDED';

/** 任务市场展示用的任务摘要 */
export interface MarketTask {
  taskId: string;
  title: string;
  taskType: string;
  /** 任务类型 key,用于按类型筛选;qa_quality / preference_compare / ... */
  taskTypeKey?: string;
  description?: string;
  /** 标签,与 Owner 端创建任务时填的 tags 对应 */
  tags?: string[];
  /** 标注模板 schema 版本,Renderer 渲染时按此版本拉取 */
  schemaVersionId: string;
  /** 计划书 6.1 Phase 2 所述 first-come-first-served 配额 */
  remainingQuota: number;
  totalQuota: number;
  deadline?: string;
  rewardPerItem?: number;
  /** 单条奖励上限说明,用于卡片角标 */
  rewardCap?: string;
  /** 分发策略:先到先得 / 指派 / 配额抢单 */
  assignStrategy: AssignStrategy;
  /** 主要媒体类型,用于过滤与卡片角标 */
  mediaTypes: TaskMediaType[];
  /** Owner 名 / 团队 */
  ownerName: string;
  /** 是否启用 AI 预审 */
  aiReviewEnabled: boolean;
  /** AI 预审规则名 */
  aiReviewRule?: string;
  /** 发布时间(ISO 字符串) */
  publishedAt: string;
  /** 标注员可领取的最大条数(超过则提示已达上限) */
  maxClaimPerUser?: number;
  /** 是否已被当前用户认领过(展示"继续作答" CTA) */
  claimedByMe?: boolean;
}

/** 用户已经认领的标注作业项 */
export interface Assignment {
  assignmentId: string;
  taskId: string;
  itemId: string;
  status: ItemStatus;
  lockedUntil?: string;
  schemaVersionId: string;
  /** 任务展示标题,用于"我的任务"列表 */
  taskTitle?: string;
  /** 任务类型展示名 */
  taskType?: string;
  /** 任务类型 key,用于筛选和样式 */
  taskTypeKey?: string;
  /** Owner 名 / 团队 */
  ownerName?: string;
  publishedAt?: string;
  deadline?: string;
  /** 当前任务已认领/总配额进度 */
  quotaUsed?: number;
  quotaTotal?: number;
  /** 是否已有草稿,用于区分开始答题和继续答题 */
  hasDraft?: boolean;
  /** 是否已有正式提交记录,用于区分作答入口和查看入口 */
  hasSubmittedAnnotation?: boolean;
  /** assignment 时间字段 */
  claimedAt?: string;
  submittedAt?: string;
  updatedAt?: string;
  /** 上一次提交的答卷,用于打回修改 */
  lastAnnotation?: Annotation;
}

/** 单条标注答卷 */
export interface Annotation {
  annotationId: string;
  assignmentId: string;
  schemaVersionId: string;
  answerJson: Record<string, unknown>;
  schemaSnapshot?: {
    fields?: SchemaField[];
    [key: string]: unknown;
  } | null;
  status: AnnotationStatus;
  revisionNo: number;
  /** 审核员驳回原因 */
  returnReason?: string;
}

/** 草稿(自动保存与离开页面保存) */
export interface Draft {
  assignmentId: string;
  answerJson: Record<string, unknown>;
  updatedAt: string;
}

/** 草稿箱列表项 */
export interface LabelerDraft {
  assignmentId: string;
  taskId: string;
  itemId: string;
  title: string;
  taskTitle: string;
  taskType: string;
  taskTypeKey: string;
  schemaVersionId: string;
  schemaVersion: string;
  updatedAt: string;
  editable: boolean;
}

/** 提交答卷请求体 */
export interface SubmitAnnotationRequest {
  schemaVersionId: string;
  answerJson: Record<string, unknown>;
  schemaDigest?: string;
  draftVersion?: number;
}

export interface BatchSubmitResponse {
  taskId: string;
  submittedCount: number;
  annotationIds: string[];
}

export interface BatchSubmitInvalidItem {
  assignmentId: string;
  itemId: string;
  index: number;
  reason: string;
  fieldErrors?: Record<string, string>;
}

/** 答题页拉取的题目内容(包含原题数据 + Schema 字段定义) */
export interface AssignmentItem {
  assignmentId: string;
  taskId: string;
  taskTitle: string;
  itemId: string;
  /** 当前作业项状态,用于区分可编辑答题和只读查看 */
  status: ItemStatus;
  /** 后端根据状态和任务截止时间计算出的编辑权限 */
  editable?: boolean;
  /** 任务截止时间,用于页面提示 */
  deadline?: string;
  schemaVersionId: string;
  schemaDigest?: string;
  /** 原题数据(根据 media_type 渲染:text / image / video / markdown) */
  rawPayload: {
    media_type: 'text' | 'image' | 'video' | 'markdown';
    media_url?: string;
    content_markdown?: string;
    /** 题目正文,例如 prompt / model_answer / origin_title */
    [key: string]: unknown;
  };
  /** Schema 字段定义,Renderer 按此渲染表单 */
  fields: SchemaField[];
  /** 当前 assignment 在批次中的索引,用于 prev/next 按钮 */
  position: {
    index: number;
    total: number;
    prevAssignmentId?: string;
    nextAssignmentId?: string;
    /** 该任务下当前标注员全部作业项的有序 id 列表,用于进度条点击任意题跳转 */
    assignmentIds?: string[];
    /** 与 assignmentIds 同序的逐题状态:completed 绿 / incomplete 黄 / empty 灰 */
    statuses?: Array<'completed' | 'incomplete' | 'empty'>;
  };
  /** 上一次提交被打回的备注(若有) */
  returnReason?: string;
  /** 当前已存的草稿(可空) */
  draft?: { answerJson: Record<string, unknown>; updatedAt: string };
  /** 最新一版正式提交答案,用于已提交题目回显和打回修改基线 */
  latestAnnotation?: Annotation | null;
}

/** 任务市场分页查询参数 */
export interface MarketTasksQuery {
  keyword?: string;
  taskType?: string;
  /** 分发策略过滤 */
  strategy?: AssignStrategy | '';
  /** 媒体类型过滤 */
  mediaType?: TaskMediaType | '';
  /** 是否启用 AI 预审过滤 */
  aiReview?: '' | 'enabled' | 'disabled';
  /** 排序字段:reward 单价 | deadline 截止时间 | quota 剩余配额 | publishedAt 发布时间 */
  sortBy?: 'reward' | 'deadline' | 'quota' | 'publishedAt';
  page?: number;
  pageSize?: number;
}

/** 通用分页结果 */
export interface PageResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
