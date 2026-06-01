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
  AssistantAskRequest,
  AssistantAskResponse,
  AssignmentItem,
  BatchSubmitResponse,
  Draft,
  LabelerDraft,
  LabelerReturnedItem,
  MarketTask,
  MarketTasksQuery,
  PageResult,
  ReportIssueRequest,
  ReportIssueResponse,
  ReturnedItemSource,
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

function toPageQueryString(query?: { page?: number; pageSize?: number }): string {
  if (!query) return '';
  const search = new URLSearchParams();
  if (query.page) search.set('page', String(query.page));
  if (query.pageSize) search.set('pageSize', String(query.pageSize));
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

function toReturnedItemsQueryString(query?: {
  source?: ReturnedItemSource;
  page?: number;
  pageSize?: number;
}): string {
  if (!query) return '';
  const search = new URLSearchParams();
  if (query.source) search.set('source', query.source);
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

  /** 获取作业题目内容(原题 + Schema 字段定义),Renderer 渲染时调用 */
  getAssignmentItem(assignmentId: string): Promise<AssignmentItem> {
    return apiRequest<AssignmentItem>(`/assignments/${assignmentId}/item`);
  },

  /** 拉取草稿(进入答题页时调用) */
  getDraft(assignmentId: string): Promise<Draft | null> {
    return apiRequest<Draft | null>(`/assignments/${assignmentId}/draft`);
  },

  /** 自动保存草稿 */
  saveDraft(
    assignmentId: string,
    answerJson: Record<string, unknown>,
    schemaDigest?: string,
  ): Promise<Draft> {
    return apiRequest<Draft>(`/assignments/${assignmentId}/draft`, {
      method: 'PUT',
      body: JSON.stringify({ answerJson, schemaDigest }),
    });
  },

  /** 草稿箱:拉取当前标注员全部未提交草稿 */
  listDrafts(query?: { page?: number; pageSize?: number }): Promise<PageResult<LabelerDraft>> {
    return apiRequest<PageResult<LabelerDraft>>(`/labeler/drafts${toPageQueryString(query)}`);
  },

  /** 草稿箱:仅删除草稿记录,不删除 assignment */
  deleteDraft(assignmentId: string): Promise<void> {
    return apiRequest<void>(`/assignments/${assignmentId}/draft`, {
      method: 'DELETE',
    });
  },

  /** 打回项:区分人工复审正式打回与 AI 预打回建议 */
  listReturnedItems(query?: {
    source?: ReturnedItemSource;
    page?: number;
    pageSize?: number;
  }): Promise<PageResult<LabelerReturnedItem>> {
    return apiRequest<PageResult<LabelerReturnedItem>>(
      `/labeler/returned-items${toReturnedItemsQueryString(query)}`,
    );
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

  /** 提交当前任务下已领取的全部草稿,统一进入 AI 预审 */
  submitTaskAssignments(taskId: string): Promise<BatchSubmitResponse> {
    return apiRequest<BatchSubmitResponse>(`/tasks/${taskId}/assignments/submit`, {
      method: 'POST',
    });
  },

  /**
   * 答题页「报告问题」:Labeler 在作答过程中发现题目数据 / 模板 / 多模态等问题时主动上报。
   * 后端真实落库到 issues / audit_logs,由 Owner 数据看板「题目反馈」查看。
   */
  reportIssue(
    assignmentId: string,
    payload: ReportIssueRequest,
  ): Promise<ReportIssueResponse> {
    return apiRequest<ReportIssueResponse>(`/assignments/${assignmentId}/issues`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /** LLM 答题助手:只返回参考思路,不会直接写入答案字段 */
  askAssistant(
    assignmentId: string,
    payload: AssistantAskRequest,
  ): Promise<AssistantAskResponse> {
    return apiRequest<AssistantAskResponse>(`/labeler/assignments/${assignmentId}/assistant`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};
