/**
 * AI 审核仪表盘数据类型。
 * 对齐计划书 4.4 / 4.6:AI Agent 作业运行统计 + 决策分布 + 趋势 + 任务维度对比。
 */

/** 决策分布(环状图) */
export interface AiDecisionDistribution {
  decision: 'PASS' | 'NEED_HUMAN_REVIEW' | 'REJECT';
  count: number;
}

/** 每日审核量趋势(折线图) */
export interface AiDailyTrend {
  date: string; // YYYY-MM-DD
  total: number;
  pass: number;
  needHuman: number;
  reject: number;
}

/** 任务维度审核量(柱状图) */
export interface AiTaskVolume {
  taskId: string;
  taskTitle: string;
  total: number;
  pass: number;
  needHuman: number;
  reject: number;
}

/** 仪表盘 KPI 概览 */
export interface AiDashboardKpi {
  /** 总作业数 */
  totalJobs: number;
  /** 成功数 */
  succeededJobs: number;
  /** 失败数 */
  failedJobs: number;
  /** 排队中 */
  pendingJobs: number;
  /** 执行中 */
  runningJobs: number;
  /** 需人工复核 */
  needHumanJobs: number;
  /** AI 通过率 0-1 */
  passRate: number;
  /** 平均处理时长(秒) */
  avgDurationSec: number;
}

/** 仪表盘完整数据(聚合接口返回) */
export interface AiDashboardData {
  kpi: AiDashboardKpi;
  decisionDistribution: AiDecisionDistribution[];
  dailyTrend: AiDailyTrend[];
  taskVolumes: AiTaskVolume[];
}
