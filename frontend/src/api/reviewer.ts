/**
 * Reviewer 端 API 预留层。
 * 路径与 payload 对齐《项目实施计划书》5.2 / 4.5 / 4.4。
 * 后端 Spring Boot 落地后,前端不需要改任何调用方,只需通过 client.ts 切换 base URL。
 */

import { apiRequest } from './client';
import type {
  AiReviewResult,
  AiReviewTaskSummary,
  AnnotationToReview,
  DisputeDetail,
  DisputeItem,
  ReviewBatch,
  ReviewerReportSummary,
  ReviewerOverview,
  ReviewerPageResult,
  ReviewerReviewDetailExportParams,
  SubmitReviewRequest,
} from '../types/reviewer';
import { repairUtf8Mojibake } from '../utils/textEncoding';

function repairText(value: string | undefined) {
  return value === undefined ? value : repairUtf8Mojibake(value);
}

function normalizeAiReviewResult(result: AiReviewResult | undefined): AiReviewResult | undefined {
  if (!result) {
    return result;
  }

  return {
    ...result,
    scores: Object.fromEntries(
      Object.entries(result.scores ?? {}).map(([key, value]) => [repairUtf8Mojibake(key), value]),
    ),
    comment: repairUtf8Mojibake(result.comment),
    risk_flags: (result.risk_flags ?? []).map(repairUtf8Mojibake),
    evidence: (result.evidence ?? []).map(repairUtf8Mojibake),
    version: repairText(result.version),
    modelName: repairText(result.modelName),
  };
}

function normalizeAnnotation(item: AnnotationToReview): AnnotationToReview {
  return {
    ...item,
    taskTitle: repairText(item.taskTitle),
    labelerName: repairUtf8Mojibake(item.labelerName),
    aiResult: normalizeAiReviewResult(item.aiResult),
    humanReason: repairText(item.humanReason),
    humanReviewerName: repairText(item.humanReviewerName),
    reviewTimeline: item.reviewTimeline?.map((stage) => ({
      ...stage,
      title: repairUtf8Mojibake(stage.title),
      actor: repairUtf8Mojibake(stage.actor),
      decision: repairText(stage.decision),
      comment: repairText(stage.comment),
      reason: repairText(stage.reason),
    })),
  };
}

function normalizeDisputeItem(item: DisputeItem): DisputeItem {
  return {
    ...item,
    taskTitle: repairUtf8Mojibake(item.taskTitle),
    reason: repairUtf8Mojibake(item.reason),
    raisedBy: repairUtf8Mojibake(item.raisedBy),
    escalationStageLabel: repairText(item.escalationStageLabel),
  };
}

function normalizePage<T>(page: ReviewerPageResult<T>, normalizeItem: (item: T) => T): ReviewerPageResult<T> {
  return {
    ...page,
    items: page.items.map(normalizeItem),
  };
}

export const reviewerApi = {
  /** 工作概览 */
  getOverview(rangeDays = 30): Promise<ReviewerOverview> {
    return apiRequest<ReviewerOverview>(`/reviewer/overview?days=${rangeDays}`);
  },

  /** 审核报表汇总预留:后端接入后由工作概览报表模块使用 */
  getReportSummary(rangeDays = 30): Promise<ReviewerReportSummary> {
    return apiRequest<ReviewerReportSummary>(`/reviewer/reports/summary?days=${rangeDays}`);
  },

  /** 审核明细导出预留:后端接入后返回 CSV Blob */
  exportReviewDetails(params: ReviewerReviewDetailExportParams = {}): Promise<Blob> {
    const search = new URLSearchParams();
    search.set('format', params.format ?? 'csv');
    search.set('days', String(params.rangeDays ?? 30));
    if (params.taskId) search.set('taskId', params.taskId);
    if (params.decision && params.decision !== 'ALL') search.set('decision', params.decision);
    return apiRequest<Blob>(`/reviewer/reports/export?${search.toString()}`, {
      headers: { Accept: 'text/csv' },
      responseType: 'blob',
    });
  },

  /**
   * AI 预审 - 按任务聚合的任务列表。
   * 后端待实现:GET /reviewer/ai-review/tasks?decision=&keyword=&view=
   * decision 取值:all | PASS | NEED_HUMAN_REVIEW | REJECT
   * view 取值:pending(默认,未审)| reviewed(我已审)| all(全部)
   */
  async listAiReviewTasks(
    params: { decision?: string; keyword?: string; view?: 'pending' | 'reviewed' | 'all' } = {},
  ): Promise<ReviewerPageResult<AiReviewTaskSummary>> {
    const search = new URLSearchParams();
    if (params.decision && params.decision !== 'all') search.set('decision', params.decision);
    if (params.keyword) search.set('keyword', params.keyword);
    if (params.view && params.view !== 'pending') search.set('view', params.view);
    const qs = search.toString();
    const page = await apiRequest<ReviewerPageResult<AiReviewTaskSummary>>(
      `/reviewer/ai-review/tasks${qs ? `?${qs}` : ''}`,
    );
    return normalizePage(page, (item) => ({
      ...item,
      taskTitle: repairUtf8Mojibake(item.taskTitle),
    }));
  },

  /**
   * AI 预审 - 拉取某任务下已出 AI 结论的标注明细(展开任务时调用)。
   * 后端待实现:GET /reviewer/ai-review/tasks/{taskId}/annotations?decision=&page=&pageSize=&view=
   */
  async listAiReviewAnnotations(
    taskId: string,
    params: {
      decision?: string;
      keyword?: string;
      page?: number;
      pageSize?: number;
      view?: 'pending' | 'reviewed' | 'all';
    } = {},
  ): Promise<ReviewerPageResult<AnnotationToReview>> {
    const search = new URLSearchParams();
    if (params.decision && params.decision !== 'all') search.set('decision', params.decision);
    if (params.keyword) search.set('keyword', params.keyword);
    if (params.page) search.set('page', String(params.page));
    if (params.pageSize) search.set('pageSize', String(params.pageSize));
    if (params.view && params.view !== 'pending') search.set('view', params.view);
    const qs = search.toString();
    const page = await apiRequest<ReviewerPageResult<AnnotationToReview>>(
      `/reviewer/ai-review/tasks/${taskId}/annotations${qs ? `?${qs}` : ''}`,
    );
    return normalizePage(page, normalizeAnnotation);
  },

  /** 待审批次列表 */
  listBatches(
    params: {
      status?: 'pending' | 'in_review' | 'completed' | 'all';
      keyword?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ): Promise<ReviewerPageResult<ReviewBatch>> {
    const search = new URLSearchParams();
    if (params.status && params.status !== 'all') search.set('status', params.status);
    if (params.keyword) search.set('keyword', params.keyword);
    if (params.page) search.set('page', String(params.page));
    if (params.pageSize) search.set('pageSize', String(params.pageSize));
    const qs = search.toString();
    return apiRequest(`/reviewer/batches${qs ? `?${qs}` : ''}`);
  },

  /** 领取批次(指派制场景下,审核员主动 claim) */
  claimBatch(batchId: string): Promise<ReviewBatch> {
    return apiRequest(`/reviewer/batches/${batchId}/claim`, {
      method: 'POST',
    });
  },

  /** 拉取某批次内待审条目 */
  async listAnnotations(
    batchId: string,
    params: { decision?: string; page?: number; pageSize?: number } = {},
  ): Promise<ReviewerPageResult<AnnotationToReview>> {
    const search = new URLSearchParams();
    if (params.decision) search.set('decision', params.decision);
    if (params.page) search.set('page', String(params.page));
    if (params.pageSize) search.set('pageSize', String(params.pageSize));
    const qs = search.toString();
    const page = await apiRequest<ReviewerPageResult<AnnotationToReview>>(
      `/reviewer/batches/${batchId}/annotations${qs ? `?${qs}` : ''}`,
    );
    return normalizePage(page, normalizeAnnotation);
  },

  /** 提交单条审核结论 */
  submitReview(
    annotationId: string,
    payload: SubmitReviewRequest,
  ): Promise<AnnotationToReview> {
    return apiRequest(`/reviewer/annotations/${annotationId}/decision`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /** 争议样本列表 */
  async listDisputes(
    params: { status?: 'open' | 'resolved' | 'all'; page?: number; pageSize?: number } = {},
  ): Promise<ReviewerPageResult<DisputeItem>> {
    const search = new URLSearchParams();
    if (params.status && params.status !== 'all') search.set('status', params.status);
    if (params.page) search.set('page', String(params.page));
    if (params.pageSize) search.set('pageSize', String(params.pageSize));
    const qs = search.toString();
    const page = await apiRequest<ReviewerPageResult<DisputeItem>>(`/reviewer/disputes${qs ? `?${qs}` : ''}`);
    return normalizePage(page, normalizeDisputeItem);
  },

  /** 争议样本详情 */
  async getDisputeDetail(disputeId: string): Promise<DisputeDetail> {
    const detail = await apiRequest<DisputeDetail>(`/reviewer/disputes/${disputeId}`);
    return {
      dispute: normalizeDisputeItem(detail.dispute),
      annotation: normalizeAnnotation(detail.annotation),
    };
  },

  /** 解决争议样本 */
  resolveDispute(
    disputeId: string,
    payload: { resolution: 'approve' | 'reject'; note?: string },
  ): Promise<DisputeItem> {
    return apiRequest(`/reviewer/disputes/${disputeId}/resolve`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};
