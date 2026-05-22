/**
 * Labeler 端业务类型定义。
 * 字段以《LabelHub Project Implementation Plan EN》5.1 数据模型与 5.2 API spec 为准,
 * 后端实现完成后可直接对齐字段,无需重构调用层。
 */

/** 任务在市场中的可见状态(已发布且未结束才会出现在市场列表) */
export type TaskStatus = 'draft' | 'published' | 'paused' | 'ended';

/** 标注项在标注员侧的状态 */
export type ItemStatus = 'available' | 'claimed' | 'submitted' | 'returned' | 'accepted';

/** 标注答卷(annotation)的状态,呼应计划书 4.4/4.5 状态机 */
export type AnnotationStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'AI_REVIEWING'
  | 'REVIEWING'
  | 'RETURNED'
  | 'ACCEPTED'
  | 'EXPORTED';

/** 任务市场展示用的任务摘要 */
export interface MarketTask {
  taskId: string;
  title: string;
  taskType: string;
  description?: string;
  /** 标注模板 schema 版本,Renderer 渲染时按此版本拉取 */
  schemaVersionId: string;
  /** 计划书 6.1 Phase 2 所述 first-come-first-served 配额 */
  remainingQuota: number;
  totalQuota: number;
  deadline?: string;
  rewardPerItem?: number;
}

/** 用户已经认领的标注作业项 */
export interface Assignment {
  assignmentId: string;
  taskId: string;
  itemId: string;
  status: ItemStatus;
  lockedUntil?: string;
  schemaVersionId: string;
  /** 上一次提交的答卷,用于打回修改 */
  lastAnnotation?: Annotation;
}

/** 单条标注答卷 */
export interface Annotation {
  annotationId: string;
  assignmentId: string;
  schemaVersionId: string;
  answerJson: Record<string, unknown>;
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

/** 提交答卷请求体 */
export interface SubmitAnnotationRequest {
  schemaVersionId: string;
  answerJson: Record<string, unknown>;
  draftVersion?: number;
}

/** 任务市场分页查询参数 */
export interface MarketTasksQuery {
  keyword?: string;
  taskType?: string;
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
