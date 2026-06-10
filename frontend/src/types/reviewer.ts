/**
 * Reviewer 端业务类型定义。
 * 字段命名严格对齐《项目实施计划书》4.5 / 5.1 / 5.2 与《LabelHub 课题实现要求》:
 *   - 状态机:DRAFT → SUBMITTED → AI_REVIEWING → REVIEWING → APPROVED / RETURNED / REVISED → ACCEPTED / EXPORTED
 *   - 审核动作:APPROVE / RETURN / REVISE / ESCALATE_TO_DISPUTE
 *   - 抽检比例 / 双审一致率 / 争议样本是 4.6 数据看板的核心指标
 */

import type { SchemaField, SchemaTab } from './schema';

export type ReviewDecision = 'APPROVE' | 'RETURN' | 'REVISE' | 'ESCALATE';

export type ReviewBatchStatus = 'pending' | 'in_review' | 'completed';

export type AiDecision = 'PASS' | 'REJECT' | 'NEED_HUMAN_REVIEW';

/** 审核优先级(用于队列排序) */
export type ReviewPriority = 'high' | 'normal' | 'low';

/** 待审批次摘要(队列卡片用) */
export interface ReviewBatch {
  batchId: string;
  taskId: string;
  taskTitle: string;
  taskType: string;
  /** 该批次待审条目总数 */
  pending: number;
  /** 已审条目数 */
  reviewed: number;
  /** AI 标记需人工复核数 */
  needHumanReview: number;
  /** 抽检比例(0-1) */
  samplingRatio: number;
  /** 优先级 */
  priority: ReviewPriority;
  status: ReviewBatchStatus;
  /** 审核员 ID(指派制) */
  reviewerId?: string;
  /** SLA 截止时间 */
  deadline?: string;
  updatedAt: string;
}

/** 单条待审注释(进入审核台逐条 review) */
export interface AnnotationToReview {
  annotationId: string;
  assignmentId: string;
  itemId: string;
  schemaVersionId: string;
  labelerName: string;
  submittedAt: string;
  /** 所属任务(AI 预审按任务分组展示用) */
  taskId?: string;
  taskTitle?: string;
  taskType?: string;
  /** 该题在当前标注员任务作业中的序号(1-based),用于和 Labeler 答题页题序对齐 */
  itemIndex?: number;
  /** 标注员实际填写的 answer */
  answerJson: Record<string, unknown>;
  /** 上一轮提交的答案(多轮复审对比用,首轮为空) */
  previousAnswerJson?: Record<string, unknown>;
  /** 原始题目展示数据 */
  rawPayload: Record<string, unknown>;
  /** 提交时的 Schema Tab 快照,用于 Reviewer 修订时保持与 Labeler 一致的表单分组 */
  schemaTabs?: SchemaTab[];
  /** 提交时的 Schema 字段快照,用于 Reviewer 直接修订 */
  schemaFields?: SchemaField[];
  /** AI 预审结果(可能为空,代表 AI 还在排队) */
  aiResult?: AiReviewResult;
  /** 人工审核状态:null = 还没审 */
  decision?: ReviewDecision;
  revisionNo: number;
  /** 是否被标为争议样本 */
  isDispute?: boolean;
  /** 审核阶段时间线:按 assignment 聚合的多轮 AI 预审与人工审核 */
  reviewTimeline?: ReviewTimelineStage[];
  /** 已完成视图回填:最后一轮人工裁决理由 */
  humanReason?: string;
  /** 已完成视图回填:最后一轮人工裁决时间(yyyy-MM-dd HH:mm:ss) */
  humanReviewedAt?: string;
  /** 已完成视图回填:最后一轮人工裁决审核员姓名 */
  humanReviewerName?: string;
}

/** 待审/已完成/全部 视图,用于切换 AI 预审任务列表过滤 */
export type ReviewerListView = 'pending' | 'reviewed' | 'all';

export interface ReviewTimelineStage {
  roundNo: number;
  stage: 'ai_review' | 'human_review';
  title: string;
  status: 'pending' | 'completed' | 'failed';
  actor: string;
  decision?: string;
  score?: number;
  comment?: string;
  reason?: string;
  occurredAt?: string;
}

/**
 * AI 预审「按任务」聚合摘要,用于 AI 预审页的任务列表(可展开)。
 * 后端建议端点:GET /reviewer/ai-review/tasks
 */
export interface AiReviewTaskSummary {
  taskId: string;
  taskTitle: string;
  taskType?: string;
  /** 该任务下已出 AI 结论的标注总数 */
  total: number;
  /** 各决策计数 */
  passCount: number;
  needHumanCount: number;
  rejectCount: number;
  /** 尚未人工裁决的条数(用于角标提示) */
  pendingHuman: number;
  /** 当前 reviewer 已审过的条数(view=reviewed/all 时有效) */
  reviewedCount?: number;
  updatedAt?: string;
}

/** AI 预审结果,字段对齐计划书 4.4 AIReviewResult */
export interface AiReviewResult {
  scores: {
    relevance?: number;
    accuracy?: number;
    format_compliance?: number;
    safety?: number;
    [key: string]: number | undefined;
  };
  total_score: number;
  decision: AiDecision;
  comment: string;
  risk_flags: string[];
  evidence: string[];
  /** AI 规则/模型版本标识(如 v2.3 · doubao-pro-32k),展示用 */
  version?: string;
  modelName?: string;
  /** Agent 完成本轮审核时使用的规则快照,AI Reviewer 详情页展示用 */
  promptSnapshot?: string;
}

/** 提交审核结论的请求体 */
export interface SubmitReviewRequest {
  decision: ReviewDecision;
  /** 驳回时必填:具体原因 */
  reason?: string;
  /** 备注 */
  note?: string;
  /** 是否升级到争议样本审议 */
  escalate?: boolean;
  /** 直接修订时提交的修订后答案 */
  answerJson?: Record<string, unknown>;
}

/** 争议样本 */
export interface DisputeItem {
  disputeId: string;
  annotationId: string;
  taskId: string;
  taskTitle: string;
  reason: string;
  /** 升级争议的 Reviewer ID */
  raisedById?: string;
  raisedBy: string;
  raisedAt: string;
  /** 当前状态 */
  status: 'open' | 'resolved';
  /** 升级发生在初审或复审阶段 */
  escalationStageLabel?: string;
  /** 当前 Reviewer 是否可终审该争议 */
  canResolve?: boolean;
  /** 该样本经历的审核轮次 */
  rounds: number;
}

export interface DisputeDetail {
  dispute: DisputeItem;
  annotation: AnnotationToReview;
}

/** 通用分页 */
export interface ReviewerPageResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** Reviewer 看板概览(用于工作概览页) */
export interface ReviewerOverview {
  rangeDays: number;
  pendingBatches: number;
  todayApproved: number;
  todayReturned: number;
  todayDisputes: number;
  /** 我审核的累计条数 */
  reviewedTotal: number;
  /** 与本组其他人对比的一致率 */
  consistencyRate: number;
  /** 抽检覆盖率 */
  samplingCoverage: number;
}

/** Reviewer 审核报表汇总,后端真实报表接口接入后使用 */
export interface ReviewerReportSummary {
  rangeDays: number;
  approveRate: number;
  returnRate: number;
  disputeRate: number;
  aiConsistencyRate: number;
  reviewedTotal: number;
  trend: Array<{
    label: string;
    approve: number;
    return: number;
    dispute: number;
  }>;
}

/** Reviewer 审核明细导出参数 */
export interface ReviewerReviewDetailExportParams {
  rangeDays?: number;
  format?: 'csv';
  taskId?: string;
  decision?: ReviewDecision | 'ALL';
}
