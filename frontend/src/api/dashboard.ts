/**
 * 数据看板 API 预留层,对齐《项目实施计划书》4.6 / 5.2。
 * 后端落地后无需修改前端调用方,只需要 Spring Boot 实现下列路径即可:
 *   GET /dashboard/overview?range=...
 *   GET /dashboard/task-progress
 *   GET /dashboard/review-distribution?range=...
 *   GET /dashboard/review-distribution?year=...
 *   GET /dashboard/review-distribution/report?year=...
 *   GET /dashboard/labeler-performance?range=...
 *   GET /dashboard/submission-timeline?year=...
 *   GET /dashboard/role-breakdown
 *   GET /dashboard/disputes?days=7|14|30
 */

import { ApiError, apiRequest, buildApiUrl, getAuthToken } from './client';
import type {
  DashboardOverview,
  DashboardPageResult,
  DisputeStats,
  IssueFeedback,
  IssueFeedbackStatus,
  LabelerPerformance,
  ReviewDistribution,
  RoleBreakdown,
  SubmissionTimelineMonth,
  TaskProgress,
} from '../types/dashboard';

type ReviewDistributionParams =
  | string
  | {
      range?: string;
      year?: number;
    };

function buildReviewDistributionQuery(params: ReviewDistributionParams) {
  const searchParams = new URLSearchParams();
  if (typeof params === 'string') {
    searchParams.set('range', params);
  } else {
    if (params.range) searchParams.set('range', params.range);
    if (params.year) searchParams.set('year', String(params.year));
  }
  const query = searchParams.toString();
  return query ? `?${query}` : '';
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

export const dashboardApi = {
  getOverview(range = '30d'): Promise<DashboardOverview> {
    return apiRequest<DashboardOverview>(`/dashboard/overview?range=${encodeURIComponent(range)}`);
  },

  getTaskProgress(): Promise<{ items: TaskProgress[] }> {
    return apiRequest('/dashboard/task-progress');
  },

  getReviewDistribution(params: ReviewDistributionParams = '30d'): Promise<ReviewDistribution> {
    return apiRequest(`/dashboard/review-distribution${buildReviewDistributionQuery(params)}`);
  },

  async downloadReviewDistributionReport(year: number): Promise<void> {
    const headers = new Headers();
    const token = getAuthToken();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const response = await fetch(
      buildApiUrl(`/dashboard/review-distribution/report?year=${encodeURIComponent(year)}`),
      { headers },
    );
    if (!response.ok) {
      await throwDownloadError(response);
    }

    const blob = await response.blob();
    const filename =
      parseFilename(response.headers.get('content-disposition')) ??
      `review-distribution-${year}.csv`;
    triggerBrowserDownload(blob, filename);
  },

  getLabelerPerformance(range = '30d'): Promise<{ items: LabelerPerformance[] }> {
    return apiRequest(
      `/dashboard/labeler-performance?range=${encodeURIComponent(range)}`,
    );
  },

  getSubmissionTimeline(year?: number): Promise<{ items: SubmissionTimelineMonth[] }> {
    const qs = year ? `?year=${year}` : '';
    return apiRequest(`/dashboard/submission-timeline${qs}`);
  },

  getRoleBreakdown(): Promise<{ items: RoleBreakdown[] }> {
    return apiRequest('/dashboard/role-breakdown');
  },

  getDisputes(days: 7 | 14 | 30 = 7): Promise<DisputeStats> {
    return apiRequest(`/dashboard/disputes?days=${days}`);
  },

  listIssueFeedback(params: {
    page?: number;
    pageSize?: number;
    status?: IssueFeedbackStatus;
  } = {}): Promise<DashboardPageResult<IssueFeedback>> {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.set('page', String(params.page));
    if (params.pageSize) searchParams.set('pageSize', String(params.pageSize));
    if (params.status) searchParams.set('status', params.status);
    const query = searchParams.toString();
    return apiRequest(`/dashboard/issue-feedback${query ? `?${query}` : ''}`);
  },

  markIssueFeedbackViewed(issueIds: string[]): Promise<{ markedCount: number }> {
    return apiRequest('/dashboard/issue-feedback/viewed', {
      method: 'PATCH',
      body: JSON.stringify({ issueIds }),
    });
  },
};
