/**
 * Reviewer 端 API 预留层。
 * 路径与 payload 对齐《项目实施计划书》5.2 / 4.5 / 4.4。
 * 后端 Spring Boot 落地后,前端不需要改任何调用方,只需通过 client.ts 切换 base URL。
 */

import { apiRequest } from './client';
import type {
  AiReviewTaskSummary,
  AnnotationToReview,
  DisputeItem,
  ReviewBatch,
  ReviewerOverview,
  ReviewerPageResult,
  SubmitReviewRequest,
} from '../types/reviewer';

export const reviewerApi = {
  /** 工作概览 */
  getOverview(rangeDays = 30): Promise<ReviewerOverview> {
    return apiRequest<ReviewerOverview>(`/reviewer/overview?days=${rangeDays}`);
  },

  /**
   * AI 预审 - 按任务聚合的任务列表。
   * 后端待实现:GET /reviewer/ai-review/tasks?decision=&keyword=&view=
   * decision 取值:all | PASS | NEED_HUMAN_REVIEW | REJECT
   * view 取值:pending(默认,未审)| reviewed(我已审)| all(全部)
   */
  listAiReviewTasks(
    params: { decision?: string; keyword?: string; view?: 'pending' | 'reviewed' | 'all' } = {},
  ): Promise<ReviewerPageResult<AiReviewTaskSummary>> {
    const search = new URLSearchParams();
    if (params.decision && params.decision !== 'all') search.set('decision', params.decision);
    if (params.keyword) search.set('keyword', params.keyword);
    if (params.view && params.view !== 'pending') search.set('view', params.view);
    const qs = search.toString();
    return apiRequest(`/reviewer/ai-review/tasks${qs ? `?${qs}` : ''}`);
  },

  /**
   * AI 预审 - 拉取某任务下已出 AI 结论的标注明细(展开任务时调用)。
   * 后端待实现:GET /reviewer/ai-review/tasks/{taskId}/annotations?decision=&page=&pageSize=&view=
   */
  listAiReviewAnnotations(
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
    return apiRequest(
      `/reviewer/ai-review/tasks/${taskId}/annotations${qs ? `?${qs}` : ''}`,
    );
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
  listAnnotations(
    batchId: string,
    params: { decision?: string; page?: number; pageSize?: number } = {},
  ): Promise<ReviewerPageResult<AnnotationToReview>> {
    const search = new URLSearchParams();
    if (params.decision) search.set('decision', params.decision);
    if (params.page) search.set('page', String(params.page));
    if (params.pageSize) search.set('pageSize', String(params.pageSize));
    const qs = search.toString();
    return apiRequest(
      `/reviewer/batches/${batchId}/annotations${qs ? `?${qs}` : ''}`,
    );
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
  listDisputes(
    params: { status?: 'open' | 'resolved' | 'all'; page?: number; pageSize?: number } = {},
  ): Promise<ReviewerPageResult<DisputeItem>> {
    const search = new URLSearchParams();
    if (params.status && params.status !== 'all') search.set('status', params.status);
    if (params.page) search.set('page', String(params.page));
    if (params.pageSize) search.set('pageSize', String(params.pageSize));
    const qs = search.toString();
    return apiRequest(`/reviewer/disputes${qs ? `?${qs}` : ''}`);
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
