/**
 * AI 预审规则类型定义。
 * 对齐《项目实施计划书》4.4 与《LabelHub 课题实现要求》:
 *   - Prompt 模板 + 评分维度 + 判定阈值 + 失败重试策略
 *   - 输出对齐 AIReviewResult.decision = PASS | REJECT | NEED_HUMAN_REVIEW
 *   - Phase 5 实现后端,前端先落契约
 */

import type { AiDecision, AiReviewResult } from './reviewer';

export type { AiDecision, AiReviewResult };

/** 规则启停状态 */
export type AiReviewRuleStatus = 'enabled' | 'disabled';

/** 评分维度:key 为占位符名,label 为展示名,weight 加权,maxScore 维度满分 */
export interface AiReviewDimension {
  key: string;
  label: string;
  weight: number;
  maxScore: number;
}

/** AI 预审规则:Owner 维护 */
export interface AiReviewRule {
  ruleId: string;
  /** 规则名称 */
  name: string;
  /** 作用范围:某个任务,空表示全局默认规则 */
  scopeTaskId?: string;
  scopeTaskTitle?: string;
  /** Prompt 模板,内嵌 {{rawPayload}} / {{answer}} / {{schema}} 占位符 */
  promptTemplate: string;
  /** 评分维度集合 */
  dimensions: AiReviewDimension[];
  /** 判定阈值:total_score >= passThreshold 为 PASS;
   *  needHumanThreshold <= total_score < passThreshold 为 NEED_HUMAN_REVIEW;
   *  低于 needHumanThreshold 为 REJECT */
  passThreshold: number;
  needHumanThreshold: number;
  /** 失败重试上限 */
  maxRetry: number;
  /** 重试退避秒数 */
  retryBackoffSec: number;
  status: AiReviewRuleStatus;
  /** 当前版本号(乐观锁,更新时后端校验) */
  version: number;
  updatedAt: string;
  createdBy: string;
}

/** 创建/更新规则的请求体(后端基于 ruleId 区分) */
export interface AiReviewRuleRequest {
  name: string;
  scopeTaskId?: string;
  promptTemplate: string;
  dimensions: AiReviewDimension[];
  passThreshold: number;
  needHumanThreshold: number;
  maxRetry: number;
  retryBackoffSec: number;
  status: AiReviewRuleStatus;
}

/** 单次 AI 预审作业(对应 ai_review_jobs 表) */
export type AiReviewJobStatus = 'pending' | 'running' | 'success' | 'failed';

export interface AiReviewJob {
  jobId: string;
  annotationId: string;
  taskId: string;
  taskTitle: string;
  ruleId?: string;
  ruleName?: string;
  status: AiReviewJobStatus;
  /** 终态时存在的判定结论 */
  decision?: AiDecision;
  totalScore?: number;
  /** 已尝试次数 */
  attempts: number;
  /** 失败时的最后一次错误信息 */
  lastError?: string;
  createdAt: string;
  finishedAt?: string;
}

/** 通用分页结果 */
export interface AiReviewPageResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** 规则列表查询参数 */
export interface ListAiReviewRulesQuery {
  status?: AiReviewRuleStatus;
  taskId?: string;
  page?: number;
  pageSize?: number;
}

/** 作业列表查询参数 */
export interface ListAiReviewJobsQuery {
  status?: AiReviewJobStatus;
  ruleId?: string;
  taskId?: string;
  /** 起止时间 ISO 字符串 */
  startAt?: string;
  endAt?: string;
  page?: number;
  pageSize?: number;
}
