/**
 * Labeler 端 API 预留层。
 * 路径与 payload 对齐《LabelHub Project Implementation Plan EN》5.2:
 *   GET    /market/tasks
 *   POST   /tasks/{id}/claim
 *   PUT    /assignments/{id}/draft
 *   POST   /assignments/{id}/submit
 * 后端 Spring Boot 接口落地后,无需修改前端调用方,只需在 client.ts 中切换基础 URL。
 */

import { apiRequest } from './client';
import type {
  Annotation,
  Assignment,
  Draft,
  MarketTask,
  MarketTasksQuery,
  PageResult,
  SubmitAnnotationRequest,
} from '../types/labeler';

function toQueryString(query?: MarketTasksQuery): string {
  if (!query) return '';
  const search = new URLSearchParams();
  if (query.keyword) search.set('keyword', query.keyword);
  if (query.taskType) search.set('taskType', query.taskType);
  if (query.strategy) search.set('strategy', query.strategy);
  if (query.mediaType) search.set('mediaType', query.mediaType);
  if (query.aiReview) search.set('aiReview', query.aiReview);
  if (query.sortBy) search.set('sortBy', query.sortBy);
  if (query.page) search.set('page', String(query.page));
  if (query.pageSize) search.set('pageSize', String(query.pageSize));
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export const labelerApi = {
  /** 任务市场:浏览已发布且未结束的任务 */
  listMarketTasks(query?: MarketTasksQuery): Promise<PageResult<MarketTask>> {
    return apiRequest<PageResult<MarketTask>>(`/market/tasks${toQueryString(query)}`);
  },

  /** 认领任务中的一个标注项,后端按 task_id+item_id 唯一约束保证不重复 */
  claimTask(taskId: string): Promise<Assignment> {
    return apiRequest<Assignment>(`/tasks/${taskId}/claim`, {
      method: 'POST',
    });
  },

  /** 我的认领列表(用于"我的任务"和"打回项"两个 Tab,使用 status 过滤) */
  listMyAssignments(status?: string): Promise<PageResult<Assignment>> {
    const qs = status ? `?status=${encodeURIComponent(status)}` : '';
    return apiRequest<PageResult<Assignment>>(`/assignments/mine${qs}`);
  },

  /** 拉取草稿(进入答题页时调用) */
  getDraft(assignmentId: string): Promise<Draft | null> {
    return apiRequest<Draft | null>(`/assignments/${assignmentId}/draft`);
  },

  /** 自动保存草稿 */
  saveDraft(assignmentId: string, answerJson: Record<string, unknown>): Promise<Draft> {
    return apiRequest<Draft>(`/assignments/${assignmentId}/draft`, {
      method: 'PUT',
      body: JSON.stringify({ answerJson }),
    });
  },

  /** 提交答卷,触发后端校验与 AI 预审入队 */
  submitAnnotation(
    assignmentId: string,
    payload: SubmitAnnotationRequest,
  ): Promise<Annotation> {
    return apiRequest<Annotation>(`/assignments/${assignmentId}/submit`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};
