/**
 * AI 审核仪表盘 API。
 * 拆成多个小接口,后端可按需实现,前端并行请求:
 *   - GET /ai-review/dashboard/kpi          KPI 概览
 *   - GET /ai-review/dashboard/decisions    决策分布
 *   - GET /ai-review/dashboard/trend        每日趋势(支持 days 参数)
 *   - GET /ai-review/dashboard/tasks        任务维度审核量
 */

import { apiRequest } from './client';
import type {
  AiDailyTrend,
  AiDashboardKpi,
  AiDecisionDistribution,
  AiTaskVolume,
} from '../types/aiDashboard';

export const aiDashboardApi = {
  /** KPI 概览 */
  getKpi(): Promise<AiDashboardKpi> {
    return apiRequest<AiDashboardKpi>('/ai-review/dashboard/kpi');
  },

  /** 决策分布(环状图) */
  getDecisionDistribution(): Promise<AiDecisionDistribution[]> {
    return apiRequest<AiDecisionDistribution[]>('/ai-review/dashboard/decisions');
  },

  /** 每日审核量趋势(折线图) */
  getDailyTrend(days = 7): Promise<AiDailyTrend[]> {
    return apiRequest<AiDailyTrend[]>(`/ai-review/dashboard/trend?days=${days}`);
  },

  /** 任务维度审核量(柱状图) */
  getTaskVolumes(): Promise<AiTaskVolume[]> {
    return apiRequest<AiTaskVolume[]>('/ai-review/dashboard/tasks');
  },
};
