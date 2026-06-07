export interface LabelerOverview {
  heroStats: {
    weeklySubmitted: number;
    reviewPassRate: number;
    monthlyRewardEstimate: number;
    monthlyRewardDetails: LabelerOverviewRewardDetail[];
  };
  kpis: {
    activeTasks: number;
    submittedToday: number;
    returnedItems: number;
    avgDurationSec: number;
    todayReward: number;
  };
  todayProgress: {
    target: number;
    submitted: number;
    aiPassed: number;
    humanConfirmed: number;
    percent: number;
    avgDurationSec: number;
    estimatedFinishTime: string;
  };
  reviewDistribution: {
    aiPass: number;
    aiNeedHuman: number;
    aiReject: number;
    humanPass: number;
    humanReturned: number;
  };
  recentBatches: LabelerOverviewRecentBatch[];
  supportedItemTypes: LabelerOverviewSupportedItemType[];
  pendingTypeDistribution: LabelerOverviewPendingTypeDistribution[];
}

export interface LabelerOverviewRewardDetail {
  taskId: string;
  assignmentId: string;
  annotationId: string;
  taskTitle: string;
  itemId: string;
  itemIndex: number;
  itemTitle: string;
  acceptedAt: string;
  rewardPerItem: number;
}

export interface LabelerOverviewRecentBatch {
  taskId: string;
  assignmentId?: string;
  title: string;
  description: string;
  taskType: string;
  taskTypeKey: string;
  remainingQuota: number;
  totalQuota: number;
  deadline: string;
  rewardPerItem?: number | null;
  updatedAt: string;
}

export interface LabelerOverviewSupportedItemType {
  key: string;
  label: string;
}

export interface LabelerOverviewPendingTypeDistribution {
  key: string;
  label: string;
  count: number;
}
