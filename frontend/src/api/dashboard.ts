/**
 * 数据看板 API 预留层,对齐《项目实施计划书》4.6 / 5.2。
 * 后端落地后无需修改前端调用方,只需要 Spring Boot 实现下列路径即可:
 *   GET /dashboard/overview?range=...
 *   GET /dashboard/task-progress
 *   GET /dashboard/review-distribution?range=...
 *   GET /dashboard/labeler-performance?range=...
 *   GET /dashboard/submission-timeline?year=...
 *   GET /dashboard/recent-activities
 *   GET /dashboard/role-breakdown
 *   GET /dashboard/disputes?days=7|14|30
 */

import { apiRequest } from './client';
import type {
  DashboardOverview,
  DashboardPageResult,
  DisputeStats,
  IssueFeedback,
  IssueFeedbackStatus,
  LabelerPerformance,
  RecentTaskActivity,
  ReviewDistribution,
  RoleBreakdown,
  SubmissionTimelineMonth,
  TaskProgress,
} from '../types/dashboard';

export const dashboardApi = {
  getOverview(range = '30d'): Promise<DashboardOverview> {
    return apiRequest<DashboardOverview>(`/dashboard/overview?range=${encodeURIComponent(range)}`);
  },

  getTaskProgress(): Promise<{ items: TaskProgress[] }> {
    return apiRequest('/dashboard/task-progress');
  },

  getReviewDistribution(range = '30d'): Promise<ReviewDistribution> {
    return apiRequest(`/dashboard/review-distribution?range=${encodeURIComponent(range)}`);
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

  getRecentActivities(): Promise<{ items: RecentTaskActivity[] }> {
    return apiRequest('/dashboard/recent-activities');
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
};
