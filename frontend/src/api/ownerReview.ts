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
 *   - GET    /reviews/tasks/{taskId}/audit-log/export 任务日志导出
 *   - GET    /reviews/audit-log               审计日志
 *
 * 与 Reviewer 端 `/reviewer/*` 区别:
 *   - Owner 端是横向看「所有任务 / 所有审核员」的进度;
 *   - Reviewer 端是纵向看「我领取的批次」做逐条裁决。
 */

import { ApiError, apiRequest, buildApiUrl, getAuthToken } from './client';
import type {
  OwnerReviewAnnotation,
  OwnerReviewAuditLogExportScope,
  OwnerReviewAuditQuery,
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

function parseFilename(contentDisposition: string | null) {
  if (!contentDisposition) return null;

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].replace(/"/g, ''));
    } catch {
      return utf8Match[1].replace(/"/g, '');
    }
  }

  const plainMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
  return plainMatch?.[1] ?? null;
}

async function throwDownloadError(response: Response): Promise<never> {
  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();
  throw new ApiError(response.status, response.statusText, payload);
}

function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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

  async downloadTaskAuditLog(
    taskId: string,
    scope: OwnerReviewAuditLogExportScope,
  ): Promise<void> {
    const headers = new Headers();
    const token = getAuthToken();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const response = await fetch(
      buildApiUrl(
        `/reviews/tasks/${encodeURIComponent(taskId)}/audit-log/export?scope=${encodeURIComponent(scope)}`,
      ),
      { headers },
    );
    if (!response.ok) {
      await throwDownloadError(response);
    }

    const blob = await response.blob();
    const filename =
      parseFilename(response.headers.get('content-disposition')) ??
      `review-task-${taskId}-${scope}-audit-log.csv`;
    triggerBrowserDownload(blob, filename);
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
};
