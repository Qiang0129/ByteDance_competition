/**
 * 数据看板类型定义,字段命名对齐《项目实施计划书》4.6:
 *   - 任务进度:每个任务的提交 / 通过 / 打回数
 *   - AI 通过率:PASS / REJECT / NEED_HUMAN_REVIEW(对齐 4.4 AIReviewResult.decision)
 *   - 人工审核结果:APPROVED / RETURNED / REVISED(对齐 4.5 状态机)
 *   - 标注员效率:人均提交、平均耗时、通过率、争议数
 *   - 争议样本:近 7 / 14 / 30 日 disputed_count
 */

export interface DashboardOverview {
  rangeStart: string;
  rangeEnd: string;
  /** KPI 列表:活跃任务 / 标注员数量 / 待人工审核 / 审核员数量 / AI 通过率 / 平均耗时 */
  kpis: {
    activeTasks: number;
    labelerCount: number;
    pendingReview: number;
    reviewerCount: number;
    aiPassRate: number;
    avgDurationSec: number;
    /** 与上一周期的环比百分比变化,正数为增长 */
    deltas: {
      activeTasks?: number;
      pendingReview?: number;
      aiPassRate?: number;
      avgDurationSec?: number;
    };
  };
}

/** 任务进度条目,用于柱状图 */
export interface TaskProgress {
  taskId: string;
  title: string;
  total: number;
  approved: number;
  returned: number;
  pending: number;
}

export type TaskMilestonePhase = 'published' | 'ai_review' | 'human_review' | 'delivered';

export interface TaskMilestone {
  taskId: string;
  title: string;
  total: number;
  approved: number;
  returned: number;
  pending: number;
  status: string;
  reviewStatus: string;
  currentPhase: TaskMilestonePhase;
}

export interface DeadlineAlert {
  taskId: string;
  title: string;
  pending: number;
  deadline: string;
  hoursLeft: number;
  riskLevel: 'normal' | 'warn' | 'critical' | string;
}

/** 审核分布(用于环形图) */
export interface ReviewDistribution {
  aiPass: number;
  aiNeedHuman: number;
  aiReject: number;
  humanPass: number;
  humanReturned: number;
  humanDisputed: number;
}

/** 标注员绩效条目 */
export interface LabelerPerformance {
  labelerId: string;
  name: string;
  role: string;
  avatar?: string;
  /** 综合得分,由后端按标注质量和通过率口径计算 */
  score: number;
  submittedCount?: number;
  approvedCount?: number;
  returnedCount?: number;
  avgDurationSec?: number;
  passRate?: number;
}

/** 提交时段堆叠(每月 OnTime / Late / Absent) */
export interface SubmissionTimelineMonth {
  month: string;
  onTime: number;
  late: number;
  absent: number;
}

/** 团队 / 角色分布 */
export interface RoleBreakdown {
  role: string;
  memberCount: number;
}

/** Owner KPI 角色人数弹窗条目 */
export interface DashboardRoleUser {
  id: string;
  username: string;
  name: string;
  status: string;
  roles: string[];
}

/** 争议样本统计 */
export interface DisputeStats {
  rangeDays: 7 | 14 | 30;
  disputed: number;
  resolved: number;
  pending: number;
  samplingRatio: number;
  consistencyRate: number;
}

/** 通用分页结果 */
export interface DashboardPageResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export type IssueFeedbackStatus = 'open' | 'viewed' | 'all';

/** Owner 数据看板「题目反馈」条目 */
export interface IssueFeedback {
  issueId: string;
  assignmentId: string;
  taskId: string;
  taskTitle: string;
  itemId: string;
  labelerId: string;
  labelerName: string;
  category: string;
  categoryLabel: string;
  description: string;
  status: 'open' | 'viewed' | string;
  createdAt: string;
}
