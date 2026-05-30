/**
 * Owner 端「人工审核」业务类型定义。
 *
 * 字段命名严格对齐《项目实施计划书》4.5 / 4.6 / 5.1:
 *   - 状态机:DRAFT → SUBMITTED → AI_REVIEWING → REVIEWING → APPROVED / RETURNED / REVISED → ACCEPTED / EXPORTED
 *   - 审核阶段:initial(初审) / second(复审) / final(终审) / sampling(抽检)
 *   - 审核动作:APPROVE / RETURN / REVISE / ESCALATE
 *   - 4.6 数据看板核心指标:抽检比例、双审一致率、争议样本、返工率
 *
 * Owner 视角是「跟踪 + 审计」,不是替代审核员逐条裁决,因此:
 *   - 列表是按任务聚合的进度,而不是逐条标注;
 *   - 明细抽屉只读展示审核结果与状态机时间线;
 *   - 批量动作(批量通过 / 批量打回)留接口,前端先做交互骨架。
 */

import type { ReviewDecision } from './reviewer';

/** 审核阶段:对齐计划书 4.5 三段式审核流转 */
export type ReviewStage = 'initial' | 'second' | 'final' | 'sampling';

/** 审核员工作负载条目 */
export interface ReviewerWorkload {
  reviewerId: string;
  reviewerName: string;
  /** 待审条目数 */
  pending: number;
  /** 今日已审条目数 */
  reviewedToday: number;
  /** 平均处理时长(秒) */
  avgDurationSec: number;
  /** 与本组其他人对比的一致率 0-1 */
  consistencyRate: number;
}

/** Owner 审核总览 KPI */
export interface OwnerReviewOverview {
  /** 统计窗口天数,默认 30 */
  rangeDays: number;
  /** 全局待审条目数 */
  pendingAnnotations: number;
  /** 今日已通过 */
  todayApproved: number;
  /** 今日已打回 */
  todayReturned: number;
  /** 进行中的争议样本数 */
  todayDisputes: number;
  /** 当前抽检覆盖率 0-1 */
  samplingCoverage: number;
  /** 双审一致率 0-1 */
  consistencyRate: number;
  /** 累计返工率 0-1 */
  returnRate: number;
  /** 审核员工作负载 Top N */
  reviewerWorkloads: ReviewerWorkload[];
}

/** 单个阶段进度 */
export interface ReviewStageProgress {
  stage: ReviewStage;
  /** 待审条目数 */
  pending: number;
  /** 已审条目数 */
  reviewed: number;
  /** 通过条目数 */
  approved: number;
  /** 打回条目数 */
  returned: number;
}

/** 任务级审核进度行 */
export interface OwnerReviewTaskRow {
  taskId: string;
  taskTitle: string;
  taskType?: string;
  /** 任务总标注条目数 */
  totalAnnotations: number;
  /** 已通过条目数(终审通过 / 已接受) */
  approvedCount: number;
  /** 已打回条目数(任一阶段打回) */
  returnedCount: number;
  /** 进行中(还没走完三审) */
  inProgress: number;
  /** 争议样本数 */
  disputes: number;
  /** 抽检比例 0-1 */
  samplingRatio: number;
  /** 三阶段进度,允许部分缺失(任务未配置复审/终审时) */
  stages: ReviewStageProgress[];
  /** 当前主审核员显示名(可能多人) */
  reviewerNames?: string[];
  /** SLA 截止时间 */
  deadline?: string;
  /** 是否启用 AI 预审 */
  aiReviewEnabled: boolean;
  updatedAt: string;
}

/** 任务下的审核明细条目(只读) */
export interface OwnerReviewAnnotation {
  annotationId: string;
  itemId: string;
  labelerName: string;
  submittedAt: string;
  /** 当前生效的审核阶段 */
  currentStage: ReviewStage;
  /** 当前阶段是否已完成 */
  status: 'reviewing' | 'approved' | 'returned' | 'revised' | 'disputed';
  /** AI 预审决策 */
  aiDecision?: 'PASS' | 'REJECT' | 'NEED_HUMAN_REVIEW';
  /** 最近一次人工裁决 */
  lastDecision?: ReviewDecision;
  /** 最近一次人工审核员 */
  lastReviewer?: string;
  /** 最近一次更新时间 */
  updatedAt: string;
  /** 是否抽检命中 */
  sampling?: boolean;
}

/** 审计日志条目,对齐 5.1 audit_logs 表 */
export interface ReviewAuditLogEntry {
  logId: string;
  /** 实体类型:annotation / assignment / human_review / dispute */
  entityType: string;
  entityId: string;
  taskId?: string;
  taskTitle?: string;
  /** 操作者 */
  operatorName: string;
  operatorRole: 'owner' | 'labeler' | 'reviewer' | 'system_agent';
  /** 稳定动作名,如 annotation.review.approve */
  action: string;
  /** 迁移前状态 */
  fromState?: string;
  /** 迁移后状态 */
  toState?: string;
  /** 打回 / 争议原因 */
  reason?: string;
  occurredAt: string;
}

/** 通用分页 */
export interface OwnerReviewPageResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** Owner 审核任务列表查询参数 */
export interface OwnerReviewTasksQuery {
  /** 阶段过滤 */
  stage?: ReviewStage | 'all';
  /** 关键词:任务名 / 任务 ID / 审核员名 */
  keyword?: string;
  /** 状态过滤 */
  status?: 'in_progress' | 'completed' | 'has_disputes' | 'all';
  page?: number;
  pageSize?: number;
}

/** Owner 审核审计日志查询参数 */
export interface OwnerReviewAuditQuery {
  /** 任务过滤 */
  taskId?: string;
  /** 操作过滤 */
  action?: string;
  /** 操作者角色 */
  operatorRole?: ReviewAuditLogEntry['operatorRole'] | 'all';
  /** 时间范围天数 */
  days?: number;
  page?: number;
  pageSize?: number;
}

/** 批量审核动作请求 */
export interface OwnerReviewBatchDecisionRequest {
  annotationIds: string[];
  decision: ReviewDecision;
  reason?: string;
  note?: string;
}

/** 批量审核动作响应 */
export interface OwnerReviewBatchDecisionResponse {
  success: number;
  failed: number;
  failedIds?: string[];
}
