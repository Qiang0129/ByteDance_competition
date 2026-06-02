/**
 * Owner 端「人工审核」API 预留层。
 *
 * 路径与 payload 严格对齐《项目实施计划书》4.5 / 4.6 / 5.2,
 * 后端 Spring Boot 落地后,前端无需调整调用方式。
 *
 * Owner 视角接口设计为「跟踪 + 审计」:
 *   - GET    /reviews/overview                Owner 审核总览 KPI
 *   - GET    /reviews/tasks                   按任务聚合的审核进度列表
 *   - GET    /reviews/tasks/{taskId}/annotations 任务下条目明细(只读)
 *   - GET    /reviews/audit-log               审计日志
 *   - POST   /reviews/batch-decision          预留兼容方法,当前 Owner 页不接入后端裁决
 *
 * 与 Reviewer 端 `/reviewer/*` 区别:
 *   - Owner 端是横向看「所有任务 / 所有审核员」的进度;
 *   - Reviewer 端是纵向看「我领取的批次」做逐条裁决。
 */

import { apiRequest } from './client';
import type {
  OwnerReviewAnnotation,
  OwnerReviewAuditQuery,
  OwnerReviewBatchDecisionRequest,
  OwnerReviewBatchDecisionResponse,
  OwnerReviewOverview,
  OwnerReviewPageResult,
  OwnerReviewReviewer,
  OwnerReviewTaskRow,
  OwnerReviewTasksQuery,
  ReviewAuditItemTimeline,
  ReviewAuditLogEntry,
} from '../types/ownerReview';

function buildQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (value === 'all') return;
    search.set(key, String(value));
  });
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export const ownerReviewApi = {
  /** Owner 审核总览 KPI */
  getOverview(rangeDays = 30): Promise<OwnerReviewOverview> {
    return apiRequest<OwnerReviewOverview>(`/reviews/overview?days=${rangeDays}`);
  },

  /** 按任务聚合的审核进度列表 */
  listTasks(
    query: OwnerReviewTasksQuery = {},
  ): Promise<OwnerReviewPageResult<OwnerReviewTaskRow>> {
    return apiRequest<OwnerReviewPageResult<OwnerReviewTaskRow>>(
      `/reviews/tasks${buildQuery(query as Record<string, unknown>)}`,
    );
  },

  /** 系统内所有人工审核员 */
  listReviewers(): Promise<OwnerReviewReviewer[]> {
    return apiRequest<OwnerReviewReviewer[]>('/reviews/reviewers');
  },

  /** 单任务下的条目明细(只读) */
  listTaskAnnotations(
    taskId: string,
    query: { page?: number; pageSize?: number; status?: string } = {},
  ): Promise<OwnerReviewPageResult<OwnerReviewAnnotation>> {
    return apiRequest<OwnerReviewPageResult<OwnerReviewAnnotation>>(
      `/reviews/tasks/${taskId}/annotations${buildQuery(query as Record<string, unknown>)}`,
    );
  },

  /** 审计日志 */
  listAuditLog(
    query: OwnerReviewAuditQuery = {},
  ): Promise<OwnerReviewPageResult<ReviewAuditLogEntry>> {
    return apiRequest<OwnerReviewPageResult<ReviewAuditLogEntry>>(
      `/reviews/audit-log${buildQuery(query as Record<string, unknown>)}`,
    );
  },

  /** 单条审计日志对应题目的全链路日志 */
  getAuditLogItemTimeline(logId: string): Promise<ReviewAuditItemTimeline> {
    return apiRequest<ReviewAuditItemTimeline>(
      `/reviews/audit-log/${logId}/item-timeline`,
    );
  },

  /** 预留兼容方法:当前 Owner 人工审核页只读,不调用该接口。 */
  batchDecision(
    payload: OwnerReviewBatchDecisionRequest,
  ): Promise<OwnerReviewBatchDecisionResponse> {
    return apiRequest<OwnerReviewBatchDecisionResponse>('/reviews/batch-decision', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};
