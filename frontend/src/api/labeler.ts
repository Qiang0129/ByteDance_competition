/**
 * Labeler 端 API 预留层。
 * 路径与 payload 对齐《LabelHub Project Implementation Plan EN》5.2:
 *   GET    /market/tasks
 *   POST   /tasks/{id}/claim
 *   PUT    /assignments/{id}/draft
 *   POST   /assignments/{id}/submit
 * 后端 Spring Boot 接口落地后,无需修改前端调用方,只需在 client.ts 中切换基础 URL。
 */

import { ApiError, apiRequest, buildApiUrl, getAuthToken } from './client';
import type {
  Annotation,
  Assignment,
  AssistantAskRequest,
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

export interface AssistantStreamHandlers {
  onDelta: (delta: string) => void;
  onDone?: () => void;
  onError?: (error: Error) => void;
  signal?: AbortSignal;
}

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

  /** 打回项:区分人工审核正式打回与 AI 预打回建议 */
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

  /** LLM 标注助手:直接读取 text/event-stream,不做普通 JSON 回退 */
  async streamAssistant(
    assignmentId: string,
    payload: AssistantAskRequest,
    handlers: AssistantStreamHandlers,
  ): Promise<void> {
    const response = await fetch(buildApiUrl(`/labeler/assignments/${assignmentId}/assistant`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: handlers.signal,
    });
    if (!response.ok) {
      const contentType = response.headers.get('content-type') ?? '';
      const errorPayload = contentType.includes('application/json')
        ? await response.json()
        : await response.text();
      throw new ApiError(response.status, response.statusText, errorPayload);
    }
    if (!response.body) {
      throw new Error('浏览器不支持流式响应');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let doneEventReceived = false;

    const flushEvents = (chunk: string) => {
      buffer += chunk;
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? '';
      for (const rawEvent of events) {
        const parsed = parseSseEvent(rawEvent);
        if (!parsed) continue;
        if (parsed.event === 'delta') {
          handlers.onDelta(parsed.data);
        } else if (parsed.event === 'done') {
          doneEventReceived = true;
          handlers.onDone?.();
        } else if (parsed.event === 'error') {
          const error = new Error(parsed.data || 'AI 助手请求失败');
          handlers.onError?.(error);
          throw error;
        }
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      flushEvents(decoder.decode(value, { stream: true }));
      if (doneEventReceived) break;
    }
    const tail = decoder.decode();
    if (!doneEventReceived && tail) flushEvents(tail);
    if (!doneEventReceived && buffer.trim()) {
      const parsed = parseSseEvent(buffer);
      if (parsed?.event === 'delta') handlers.onDelta(parsed.data);
      if (parsed?.event === 'done') handlers.onDone?.();
      if (parsed?.event === 'error') throw new Error(parsed.data || 'AI 助手请求失败');
    }
    reader.releaseLock();
  },
};

function parseSseEvent(rawEvent: string): { event: string; data: string } | null {
  const lines = rawEvent.split(/\r?\n/);
  let event = 'message';
  const data: string[] = [];
  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      data.push(line.slice('data:'.length).replace(/^ /, ''));
    }
  }
  if (!event && data.length === 0) return null;
  return { event, data: data.join('\n') };
}
