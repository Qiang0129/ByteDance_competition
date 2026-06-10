import { apiRequest } from './client';
import type {
  AiModelConfig,
  AiModelConfigRequest,
  AiModelModelsRequest,
  AiModelModelsResponse,
  AiReviewBatchDeleteResponse,
  AiReviewJob,
  AiReviewJobTimelineItem,
  AiReviewPageResult,
  AiReviewResult,
  AiReviewRule,
  AiReviewRuleRequest,
  AiReviewRuleStatus,
  ListAiReviewJobsQuery,
  ListAiReviewRulesQuery,
} from '../types/aiReview';
import { repairUtf8Mojibake } from '../utils/textEncoding';

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

function normalizeRuleText(value: string | undefined) {
  return value === undefined ? value : repairUtf8Mojibake(value);
}

function normalizeAiReviewRule(rule: AiReviewRule): AiReviewRule {
  return {
    ...rule,
    name: normalizeRuleText(rule.name) ?? rule.name,
    scopeTaskTitle: normalizeRuleText(rule.scopeTaskTitle),
    promptTemplate: normalizeRuleText(rule.promptTemplate) ?? rule.promptTemplate,
    createdBy: normalizeRuleText(rule.createdBy) ?? rule.createdBy,
    dimensions: rule.dimensions.map((dimension) => ({
      ...dimension,
      label: normalizeRuleText(dimension.label) ?? dimension.label,
    })),
  };
}

function normalizeAiReviewRulePage(page: AiReviewPageResult<AiReviewRule>) {
  return {
    ...page,
    items: page.items.map(normalizeAiReviewRule),
  };
}

function normalizeAiReviewJob(job: AiReviewJob): AiReviewJob {
  return {
    ...job,
    taskTitle: normalizeRuleText(job.taskTitle) ?? job.taskTitle,
    ruleName: normalizeRuleText(job.ruleName),
    lastError: normalizeRuleText(job.lastError),
    errorSummary: normalizeRuleText(job.errorSummary),
  };
}

function normalizeAiReviewJobPage(page: AiReviewPageResult<AiReviewJob>) {
  return {
    ...page,
    items: page.items.map(normalizeAiReviewJob),
  };
}

function normalizeAiReviewResult(result: AiReviewResult): AiReviewResult {
  return {
    ...result,
    scores: Object.fromEntries(
      Object.entries(result.scores ?? {}).map(([key, value]) => [repairUtf8Mojibake(key), value]),
    ),
    comment: repairUtf8Mojibake(result.comment ?? ''),
    risk_flags: (result.risk_flags ?? []).map(repairUtf8Mojibake),
    evidence: (result.evidence ?? []).map(repairUtf8Mojibake),
    promptSnapshot: normalizeRuleText(result.promptSnapshot),
    modelName: normalizeRuleText(result.modelName),
    version: normalizeRuleText(result.version),
  };
}

function normalizeAiReviewTimeline(items: AiReviewJobTimelineItem[]) {
  return items.map((item) => ({
    ...item,
    title: repairUtf8Mojibake(item.title),
    status: repairUtf8Mojibake(item.status),
    message: normalizeRuleText(item.message),
  }));
}

export const aiReviewApi = {
  async listRules(query: ListAiReviewRulesQuery = {}): Promise<AiReviewPageResult<AiReviewRule>> {
    const page = await apiRequest<AiReviewPageResult<AiReviewRule>>(
      `/ai-review/rules${buildQuery(query as Record<string, unknown>)}`,
    );
    return normalizeAiReviewRulePage(page);
  },

  async getRule(ruleId: string): Promise<AiReviewRule> {
    const rule = await apiRequest<AiReviewRule>(`/ai-review/rules/${ruleId}`);
    return normalizeAiReviewRule(rule);
  },

  async createRule(payload: AiReviewRuleRequest): Promise<AiReviewRule> {
    const rule = await apiRequest<AiReviewRule>('/ai-review/rules', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return normalizeAiReviewRule(rule);
  },

  async updateRule(ruleId: string, payload: AiReviewRuleRequest): Promise<AiReviewRule> {
    const rule = await apiRequest<AiReviewRule>(`/ai-review/rules/${ruleId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    return normalizeAiReviewRule(rule);
  },

  deleteRule(ruleId: string): Promise<void> {
    return apiRequest<void>(`/ai-review/rules/${ruleId}`, { method: 'DELETE' });
  },

  async toggleRule(ruleId: string, status: AiReviewRuleStatus): Promise<AiReviewRule> {
    const rule = await apiRequest<AiReviewRule>(`/ai-review/rules/${ruleId}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    });
    return normalizeAiReviewRule(rule);
  },

  async listJobs(query: ListAiReviewJobsQuery = {}): Promise<AiReviewPageResult<AiReviewJob>> {
    const page = await apiRequest<AiReviewPageResult<AiReviewJob>>(
      `/ai-review/jobs${buildQuery(query as Record<string, unknown>)}`,
    );
    return normalizeAiReviewJobPage(page);
  },

  async retryJob(jobId: string): Promise<AiReviewJob> {
    const job = await apiRequest<AiReviewJob>(`/ai-review/jobs/${jobId}/retry`, {
      method: 'POST',
    });
    return normalizeAiReviewJob(job);
  },

  /** 批量删除作业(按 jobId 列表) */
  deleteJobs(jobIds: string[]): Promise<AiReviewBatchDeleteResponse> {
    return apiRequest<AiReviewBatchDeleteResponse>('/ai-review/jobs/batch-delete', {
      method: 'POST',
      body: JSON.stringify({ jobIds }),
    });
  },

  async cancelJob(jobId: string, reason = 'manual cancel and requeue'): Promise<AiReviewJob> {
    const job = await apiRequest<AiReviewJob>(`/ai-review/jobs/${jobId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    return normalizeAiReviewJob(job);
  },

  async getJobResult(annotationId: string): Promise<AiReviewResult> {
    const result = await apiRequest<AiReviewResult>(`/ai-review/results/${annotationId}`);
    return normalizeAiReviewResult(result);
  },

  async getJobTimeline(jobId: string): Promise<AiReviewJobTimelineItem[]> {
    const items = await apiRequest<AiReviewJobTimelineItem[]>(`/ai-review/jobs/${jobId}/timeline`);
    return normalizeAiReviewTimeline(items);
  },

  /** 兼容旧接口:获取当前激活的单个配置(Agent 运行时使用) */
  getModelConfig(): Promise<AiModelConfig | null> {
    return apiRequest<AiModelConfig | null>('/ai-review/model-config');
  },

  /** 兼容旧接口:保存/更新当前激活配置 */
  saveModelConfig(payload: AiModelConfigRequest): Promise<AiModelConfig> {
    return apiRequest<AiModelConfig>('/ai-review/model-config', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  /* ========== 多配置管理接口(新) ========== */

  /** 获取所有模型配置列表 */
  listModelConfigs(): Promise<AiModelConfig[]> {
    return apiRequest<AiModelConfig[]>('/ai-review/model-configs');
  },

  /** 新建模型配置 */
  createModelConfig(payload: AiModelConfigRequest): Promise<AiModelConfig> {
    return apiRequest<AiModelConfig>('/ai-review/model-configs', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /** 更新指定配置 */
  updateModelConfig(configId: string, payload: AiModelConfigRequest): Promise<AiModelConfig> {
    return apiRequest<AiModelConfig>(`/ai-review/model-configs/${configId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  /** 删除指定配置(不能删除当前激活的) */
  deleteModelConfig(configId: string): Promise<void> {
    return apiRequest<void>(`/ai-review/model-configs/${configId}`, {
      method: 'DELETE',
    });
  },

  /** 激活指定配置(同时把其他配置设为 inactive) */
  activateModelConfig(configId: string): Promise<AiModelConfig> {
    return apiRequest<AiModelConfig>(`/ai-review/model-configs/${configId}/activate`, {
      method: 'POST',
    });
  },

  listProviderModels(payload: AiModelModelsRequest): Promise<AiModelModelsResponse> {
    return apiRequest<AiModelModelsResponse>('/ai-review/model-config/models', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};
