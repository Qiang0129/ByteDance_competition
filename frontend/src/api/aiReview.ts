import { apiRequest } from './client';
import type {
  AiReviewJob,
  AiReviewPageResult,
  AiReviewResult,
  AiReviewRule,
  AiReviewRuleRequest,
  AiReviewRuleStatus,
  ListAiReviewJobsQuery,
  ListAiReviewRulesQuery,
} from '../types/aiReview';

/**
 * AI 预审规则 / 作业 API。
 * 对应计划书 4.4 与 5.2,后端 Phase 5 实现:
 *   - GET    /api/ai-review/rules                  规则列表
 *   - POST   /api/ai-review/rules                  新建规则
 *   - GET    /api/ai-review/rules/{ruleId}         规则详情
 *   - PUT    /api/ai-review/rules/{ruleId}         更新规则
 *   - DELETE /api/ai-review/rules/{ruleId}         删除规则
 *   - POST   /api/ai-review/rules/{ruleId}/toggle  启停切换
 *   - GET    /api/ai-review/jobs                   作业列表
 *   - POST   /api/ai-review/jobs/{jobId}/retry     重试失败作业
 *   - GET    /api/ai-review/results/{annotationId} 单条 AI 预审结果
 */

function buildQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    search.set(key, String(value));
  });
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export const aiReviewApi = {
  listRules(query: ListAiReviewRulesQuery = {}): Promise<AiReviewPageResult<AiReviewRule>> {
    return apiRequest<AiReviewPageResult<AiReviewRule>>(
      `/ai-review/rules${buildQuery(query as Record<string, unknown>)}`,
    );
  },

  getRule(ruleId: string): Promise<AiReviewRule> {
    return apiRequest<AiReviewRule>(`/ai-review/rules/${ruleId}`);
  },

  createRule(payload: AiReviewRuleRequest): Promise<AiReviewRule> {
    return apiRequest<AiReviewRule>('/ai-review/rules', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateRule(ruleId: string, payload: AiReviewRuleRequest): Promise<AiReviewRule> {
    return apiRequest<AiReviewRule>(`/ai-review/rules/${ruleId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  deleteRule(ruleId: string): Promise<void> {
    return apiRequest<void>(`/ai-review/rules/${ruleId}`, { method: 'DELETE' });
  },

  toggleRule(ruleId: string, status: AiReviewRuleStatus): Promise<AiReviewRule> {
    return apiRequest<AiReviewRule>(`/ai-review/rules/${ruleId}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    });
  },

  listJobs(query: ListAiReviewJobsQuery = {}): Promise<AiReviewPageResult<AiReviewJob>> {
    return apiRequest<AiReviewPageResult<AiReviewJob>>(
      `/ai-review/jobs${buildQuery(query as Record<string, unknown>)}`,
    );
  },

  retryJob(jobId: string): Promise<AiReviewJob> {
    return apiRequest<AiReviewJob>(`/ai-review/jobs/${jobId}/retry`, {
      method: 'POST',
    });
  },

  getJobResult(annotationId: string): Promise<AiReviewResult> {
    return apiRequest<AiReviewResult>(`/ai-review/results/${annotationId}`);
  },
};
