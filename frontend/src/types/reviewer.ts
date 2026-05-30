/**
 * Reviewer 端业务类型定义。
 * 字段命名严格对齐《项目实施计划书》4.5 / 5.1 / 5.2 与《LabelHub 课题实现要求》:
 *   - 状态机:DRAFT → SUBMITTED → AI_REVIEWING → REVIEWING → APPROVED / RETURNED / REVISED → ACCEPTED / EXPORTED
 *   - 审核动作:APPROVE / RETURN / REVISE / ESCALATE_TO_DISPUTE
 *   - 抽检比例 / 双审一致率 / 争议样本是 4.6 数据看板的核心指标
 */

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
  /** 标注员实际填写的 answer */
  answerJson: Record<string, unknown>;
  /** 上一轮提交的答案(多轮复审对比用,首轮为空) */
  previousAnswerJson?: Record<string, unknown>;
  /** 原始题目展示数据 */
  rawPayload: Record<string, unknown>;
  /** AI 预审结果(可能为空,代表 AI 还在排队) */
  aiResult?: AiReviewResult;
  /** 人工审核状态:null = 还没审 */
  decision?: ReviewDecision;
  revisionNo: number;
  /** 是否被标为争议样本 */
  isDispute?: boolean;
  /** 审核阶段时间线:第一轮 AI 预审,第二轮人工复审 */
  reviewTimeline?: ReviewTimelineStage[];
}

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
}

/** 争议样本 */
export interface DisputeItem {
  disputeId: string;
  annotationId: string;
  taskId: string;
  taskTitle: string;
  reason: string;
  raisedBy: string;
  raisedAt: string;
  /** 当前状态 */
  status: 'open' | 'resolved';
  /** 该样本经历的审核轮次 */
  rounds: number;
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
