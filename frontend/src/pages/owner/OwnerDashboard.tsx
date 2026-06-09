import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  BarChartOutlined,
  ClockCircleOutlined,
  CopyOutlined,
  DownloadOutlined,
  FlagOutlined,
  LineChartOutlined,
  MoreOutlined,
  ProjectOutlined,
  RiseOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import {
  Alert,
  App as AntdApp,
  Avatar,
  Button,
  Card,
  Col,
  Drawer,
  Empty,
  List,
  Popover,
  Row,
  Segmented,
  Select,
  Skeleton,
  Space,
  Tag,
  Typography,
} from 'antd';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useNavigate } from 'react-router-dom';

import { buildPublicUrl, getApiErrorMessage } from '../../api/client';
import { authApi } from '../../api/auth';
import { dashboardApi } from '../../api/dashboard';
import { AiAssistantIcon } from '../../components/icons';
import type {
  DashboardOverview,
  DashboardRoleUser,
  DeadlineAlert,
  DisputeStats,
  IssueFeedback,
  LabelerPerformance,
  ReviewDistribution,
  RoleBreakdown,
  SubmissionTimelineMonth,
  TaskMilestone,
  TaskProgress,
} from '../../types/dashboard';

/**
 * Owner 数据看板。
 * 对齐《项目实施计划书》4.6:
 *   - 任务进度 / AI 通过率 / 标注员效率 / 争议样本
 *   - 接口接入 dashboardApi,失败时展示真实错误态
 */

interface DashboardData {
  overview: DashboardOverview;
  taskProgress: TaskProgress[];
  taskProgressChart: TaskProgress[];
  taskMilestones: TaskMilestone[];
  deadlineAlerts: DeadlineAlert[];
  review: ReviewDistribution;
  performance: LabelerPerformance[];
  timeline: SubmissionTimelineMonth[];
  roles: RoleBreakdown[];
  disputes7: DisputeStats;
  disputes14: DisputeStats;
  disputes30: DisputeStats;
}

type DashboardMobileChartKey =
  | 'taskProgress'
  | 'reviewDistribution'
  | 'roleDonut'
  | 'disputeStats'
  | 'taskTimeline'
  | 'deadlineAlerts'
  | 'performance'
  | 'submissionTimeline';

const DASHBOARD_MOBILE_CHART_OPTIONS: Array<{ label: string; value: DashboardMobileChartKey }> = [
  { label: '任务进度', value: 'taskProgress' },
  { label: '审核分布', value: 'reviewDistribution' },
  { label: '标注员任务类型分布', value: 'roleDonut' },
  { label: '争议样本 & 抽检', value: 'disputeStats' },
  { label: '任务关键节点', value: 'taskTimeline' },
  { label: '临近截止预警', value: 'deadlineAlerts' },
  { label: '标注员表现', value: 'performance' },
  { label: '月度提交时段', value: 'submissionTimeline' },
];

const reviewLabels: Array<{ key: keyof ReviewDistribution; label: string; color: string }> = [
  { key: 'aiPass', label: 'AI 通过', color: '#2f7bff' },
  { key: 'aiNeedHuman', label: '需人工复核', color: '#a855f7' },
  { key: 'aiReject', label: 'AI 拒绝', color: '#ef4444' },
  { key: 'humanPass', label: '人工通过', color: '#22c55e' },
  { key: 'humanReturned', label: '打回修改', color: '#f59e0b' },
  { key: 'humanDisputed', label: '升级争议', color: '#64748b' },
];

const roleColors = ['#2f7bff', '#22c55e', '#f59e0b', '#a855f7', '#ef4444'];
const currentYear = new Date().getFullYear();
const reviewYearOptions = Array.from({ length: 5 }, (_, index) => {
  const year = currentYear - index;
  return { label: String(year), value: year };
});
const ISSUE_FEEDBACK_PREVIEW_SIZE = 5;
type RoleUserKind = 'labeler' | 'reviewer';

const roleUserTitles: Record<RoleUserKind, string> = {
  labeler: '标注人员',
  reviewer: '审核人员',
};

type RoleUserState = {
  items: DashboardRoleUser[];
  loading: boolean;
  error: string | null;
  loaded: boolean;
};

type ReviewerInviteState = {
  link: string | null;
  expiresAt: string | null;
  loading: boolean;
  error: string | null;
};

const createInitialRoleUserState = (): Record<RoleUserKind, RoleUserState> => ({
  labeler: { items: [], loading: false, error: null, loaded: false },
  reviewer: { items: [], loading: false, error: null, loaded: false },
});

function issueStatusLabel(status: string) {
  if (status === 'open') return '待查看';
  if (status === 'viewed') return '已查看';
  return status;
}

export default function OwnerDashboard() {
  const { message } = AntdApp.useApp();
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [range, setRange] = useState<'7d' | '30d' | '90d'>('30d');
  const [reviewYear, setReviewYear] = useState(currentYear);
  const [mobileChartKey, setMobileChartKey] = useState<DashboardMobileChartKey>('taskProgress');
  const [dashboardExportDownloading, setDashboardExportDownloading] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [issueFeedback, setIssueFeedback] = useState<IssueFeedback[]>([]);
  const [issueTotal, setIssueTotal] = useState(0);
  const [issueLoading, setIssueLoading] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [roleUserState, setRoleUserState] = useState<Record<RoleUserKind, RoleUserState>>(
    createInitialRoleUserState,
  );
  const [reviewerInvite, setReviewerInvite] = useState<ReviewerInviteState>({
    link: null,
    expiresAt: null,
    loading: false,
    error: null,
  });
  const roleUserLoadingRef = useRef<Record<RoleUserKind, boolean>>({
    labeler: false,
    reviewer: false,
  });

  const handleFollowDeadline = useCallback((taskId: string) => {
    navigate(`/owner/tasks?focusTaskId=${encodeURIComponent(taskId)}`);
  }, [navigate]);

  const loadIssueFeedback = useCallback(async (options: { markViewed?: boolean; includeViewed?: boolean } = {}) => {
    setIssueLoading(true);
    setIssueError(null);
    try {
      const shouldIncludeViewed = options.includeViewed ?? false;
      const result = await dashboardApi.listIssueFeedback({
        page: 1,
        pageSize: ISSUE_FEEDBACK_PREVIEW_SIZE,
        status: shouldIncludeViewed ? 'all' : 'open',
      });
      const openResult = shouldIncludeViewed
        ? await dashboardApi.listIssueFeedback({ page: 1, pageSize: 1, status: 'open' })
        : result;
      const items = result.items ?? [];
      setIssueFeedback(items);
      setIssueTotal(openResult.total ?? 0);
      if (options.markViewed && items.length > 0) {
        const issueIds = items
          .filter((item) => item.status === 'open')
          .map((item) => item.issueId);
        const issueIdSet = new Set(issueIds);
        if (issueIds.length === 0) {
          return;
        }
        try {
          const viewedResult = await dashboardApi.markIssueFeedbackViewed(issueIds);
          const markedCount = viewedResult.markedCount ?? 0;
          if (markedCount > 0) {
            setIssueFeedback((currentItems) => currentItems.map((item) => (
              issueIdSet.has(item.issueId) ? { ...item, status: 'viewed' } : item
            )));
            setIssueTotal((currentTotal) => Math.max(currentTotal - markedCount, 0));
          }
        } catch (error) {
          message.warning(getApiErrorMessage(error, '题目反馈已加载,但标记已查看失败'));
        }
      }
    } catch (error) {
      setIssueFeedback([]);
      setIssueTotal(0);
      setIssueError(getApiErrorMessage(error, '题目反馈加载失败,请稍后重试'));
    } finally {
      setIssueLoading(false);
    }
  }, [message]);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setDashboardError(null);
    try {
      const [
        overview,
        taskProgress,
        taskProgressChart,
        taskMilestones,
        deadlineAlerts,
        review,
        performance,
        timeline,
        roles,
        disputes7,
        disputes14,
        disputes30,
      ] = await Promise.all([
        dashboardApi.getOverview(range),
        dashboardApi.getTaskProgress(),
        dashboardApi.getTaskProgressChart(),
        dashboardApi.getTaskMilestones(),
        dashboardApi.getDeadlineAlerts(),
        dashboardApi.getReviewDistribution({ year: reviewYear }),
        dashboardApi.getLabelerPerformance(range),
        dashboardApi.getSubmissionTimeline(),
        dashboardApi.getRoleBreakdown(),
        dashboardApi.getDisputes(7),
        dashboardApi.getDisputes(14),
        dashboardApi.getDisputes(30),
      ]);
      setData({
        overview,
        taskProgress: taskProgress.items ?? [],
        taskProgressChart: taskProgressChart.items ?? [],
        taskMilestones: taskMilestones.items ?? [],
        deadlineAlerts: deadlineAlerts.items ?? [],
        review,
        performance: performance.items ?? [],
        timeline: timeline.items ?? [],
        roles: roles.items ?? [],
        disputes7,
        disputes14,
        disputes30,
      });
    } catch (error) {
      setData(null);
      setDashboardError(getApiErrorMessage(error, '数据看板加载失败,请稍后重试'));
    } finally {
      setLoading(false);
    }
  }, [range, reviewYear]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    void loadIssueFeedback();
  }, [loadIssueFeedback]);

  const openIssueFeedback = () => {
    setFeedbackOpen(true);
    void loadIssueFeedback({ markViewed: true, includeViewed: true });
  };

  const loadRoleUsers = useCallback(async (role: RoleUserKind, options: { force?: boolean } = {}) => {
    const force = options.force ?? false;
    const currentRole = roleUserState[role];
    if (roleUserLoadingRef.current[role] || (!force && currentRole.loaded)) return;
    roleUserLoadingRef.current[role] = true;
    setRoleUserState((current) => ({
      ...current,
      [role]: {
        ...current[role],
        loading: true,
        error: null,
      },
    }));
    try {
      const result = await dashboardApi.getRoleUsers(role);
      setRoleUserState((current) => ({
        ...current,
        [role]: {
          items: result.items ?? [],
          loading: false,
          error: null,
          loaded: true,
        },
      }));
    } catch (error) {
      setRoleUserState((current) => ({
        ...current,
        [role]: {
          ...current[role],
          loading: false,
          error: getApiErrorMessage(error, '角色人员加载失败,请稍后重试'),
          loaded: true,
        },
      }));
    } finally {
      roleUserLoadingRef.current[role] = false;
    }
  }, [roleUserState]);

  const createReviewerInvite = useCallback(async () => {
    setReviewerInvite((current) => ({ ...current, loading: true, error: null }));
    try {
      const result = await authApi.createReviewerInvitation();
      const link = buildPublicUrl(`/login?reviewerInvite=${encodeURIComponent(result.token)}#signup`);
      setReviewerInvite({
        link,
        expiresAt: result.expiresAt,
        loading: false,
        error: null,
      });
    } catch (error) {
      setReviewerInvite((current) => ({
        ...current,
        loading: false,
        error: getApiErrorMessage(error, '审核员邀请链接生成失败'),
      }));
    }
  }, []);

  const copyReviewerInvite = useCallback(async () => {
    if (!reviewerInvite.link) return;
    try {
      await navigator.clipboard.writeText(reviewerInvite.link);
      message.success('邀请链接已复制');
    } catch {
      message.error('复制失败，请手动复制邀请链接');
    }
  }, [message, reviewerInvite.link]);

  const downloadDashboardExport = useCallback(async () => {
    setDashboardExportDownloading(true);
    try {
      await dashboardApi.downloadDashboardExport({ range, reviewYear });
      message.success('数据看板导出已开始下载');
    } catch (error) {
      message.error(getApiErrorMessage(error, '数据看板导出失败'));
    } finally {
      setDashboardExportDownloading(false);
    }
  }, [message, range, reviewYear]);

  function renderDashboardChartCard(chartKey: DashboardMobileChartKey, dashboardData: DashboardData) {
    switch (chartKey) {
      case 'reviewDistribution':
        return (
          <ReviewDistributionCard
            distribution={dashboardData.review}
            year={reviewYear}
            yearOptions={reviewYearOptions}
            onYearChange={setReviewYear}
          />
        );
      case 'roleDonut':
        return <RoleDonutCard roles={dashboardData.roles} />;
      case 'disputeStats':
        return (
          <DisputeStatsCard
            disputes7={dashboardData.disputes7}
            disputes14={dashboardData.disputes14}
            disputes30={dashboardData.disputes30}
          />
        );
      case 'taskTimeline':
        return <TaskTimelineCard items={dashboardData.taskMilestones} />;
      case 'deadlineAlerts':
        return <DeadlineAlertCard items={dashboardData.deadlineAlerts} onFollow={handleFollowDeadline} />;
      case 'performance':
        return <PerformanceCard performance={dashboardData.performance} />;
      case 'submissionTimeline':
        return <SubmissionTimelineCard items={dashboardData.timeline} />;
      case 'taskProgress':
      default:
        return <TaskProgressCard items={dashboardData.taskProgressChart} />;
    }
  }

  return (
    <>
      <Space direction="vertical" size="large" className="page-stack dashboard-page">
        <DashboardHeader
          overview={data?.overview}
          range={range}
          onRangeChange={setRange}
          issueTotal={issueTotal}
          onOpenFeedback={openIssueFeedback}
          onExport={downloadDashboardExport}
          exporting={dashboardExportDownloading}
        />

        {dashboardError ? (
          <Alert
            type="error"
            showIcon
            message="数据看板加载失败"
            description={dashboardError}
            action={
              <Button danger onClick={() => void loadDashboard()} loading={loading}>
                重试
              </Button>
            }
          />
        ) : null}

        {loading && !data ? <DashboardSkeleton /> : null}

        {data ? (
          <>
            <KpiRow
              overview={data.overview}
              issueTotal={issueTotal}
              issueLoading={issueLoading}
              onOpenFeedback={openIssueFeedback}
              roleUserState={roleUserState}
              onLoadRoleUsers={loadRoleUsers}
              reviewerInvite={reviewerInvite}
              onCreateReviewerInvite={createReviewerInvite}
              onCopyReviewerInvite={copyReviewerInvite}
            />

            <div className="dashboard-mobile-chart-panel">
              <div className="dashboard-mobile-chart-switcher">
                <Typography.Text strong>统计图表</Typography.Text>
                <Select
                  value={mobileChartKey}
                  options={DASHBOARD_MOBILE_CHART_OPTIONS}
                  onChange={(value) => setMobileChartKey(value as DashboardMobileChartKey)}
                />
              </div>
              {renderDashboardChartCard(mobileChartKey, data)}
            </div>

            <div className="dashboard-desktop-chart-stack">
              <Row gutter={[16, 16]}>
                <Col xs={24} xl={15}>
                  <TaskProgressCard items={data.taskProgressChart} />
                </Col>
                <Col xs={24} xl={9}>
                  <ReviewDistributionCard
                    distribution={data.review}
                    year={reviewYear}
                    yearOptions={reviewYearOptions}
                    onYearChange={setReviewYear}
                  />
                </Col>
              </Row>

              <Row gutter={[16, 16]}>
                <Col xs={24} md={12} xl={6}>
                  <RoleDonutCard roles={data.roles} />
                </Col>
                <Col xs={24} md={12} xl={6}>
                  <DisputeStatsCard
                    disputes7={data.disputes7}
                    disputes14={data.disputes14}
                    disputes30={data.disputes30}
                  />
                </Col>
                <Col xs={24} md={12} xl={6}>
                  <TaskTimelineCard items={data.taskMilestones} />
                </Col>
                <Col xs={24} md={12} xl={6}>
                  <DeadlineAlertCard items={data.deadlineAlerts} onFollow={handleFollowDeadline} />
                </Col>
              </Row>

              <Row gutter={[16, 16]}>
                <Col xs={24} xl={10}>
                  <PerformanceCard performance={data.performance} />
                </Col>
                <Col xs={24} xl={14}>
                  <SubmissionTimelineCard items={data.timeline} />
                </Col>
              </Row>
            </div>
          </>
        ) : null}
      </Space>
      <IssueFeedbackDrawer
        open={feedbackOpen}
        items={issueFeedback}
        total={issueTotal}
        loading={issueLoading}
        error={issueError}
        onClose={() => setFeedbackOpen(false)}
        onRetry={() => loadIssueFeedback({ markViewed: true, includeViewed: true })}
        previewSize={ISSUE_FEEDBACK_PREVIEW_SIZE}
      />
    </>
  );
}

function DashboardHeader({
  overview,
  range,
  onRangeChange,
  issueTotal,
  onOpenFeedback,
  onExport,
  exporting,
}: {
  overview?: DashboardOverview;
  range: '7d' | '30d' | '90d';
  onRangeChange: (v: '7d' | '30d' | '90d') => void;
  issueTotal: number;
  onOpenFeedback: () => void;
  onExport: () => void;
  exporting: boolean;
}) {
  return (
    <div className="page-title-row">
      <Space direction="vertical" size={4}>
        <Typography.Title level={3}>数据看板</Typography.Title>
        <Typography.Text type="secondary">
          {overview ? `统计周期:${overview.rangeStart} ~ ${overview.rangeEnd}` : '正在加载真实数据'}
        </Typography.Text>
      </Space>
      <Space className="dashboard-header-actions">
        <Segmented
          options={[
            { label: '近 7 日', value: '7d' },
            { label: '近 30 日', value: '30d' },
            { label: '近 90 日', value: '90d' },
          ]}
          value={range}
          onChange={(v) => onRangeChange(v as '7d' | '30d' | '90d')}
        />
        <Button icon={<DownloadOutlined />} onClick={onExport} loading={exporting}>
          导出数据
        </Button>
        <Button type="primary" icon={<FlagOutlined />} onClick={onOpenFeedback}>
          题目反馈{issueTotal > 0 ? `(${issueTotal})` : ''}
        </Button>
      </Space>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <>
      <Row gutter={[16, 16]} className="dashboard-kpi-row">
        {Array.from({ length: 6 }).map((_, index) => (
          <Col key={index} xs={12} md={8} xl={4}>
            <Card className="dashboard-kpi">
              <Skeleton active paragraph={{ rows: 3 }} title={false} />
            </Card>
          </Col>
        ))}
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={15}>
          <Card className="dashboard-card">
            <Skeleton active paragraph={{ rows: 8 }} />
          </Card>
        </Col>
        <Col xs={24} xl={9}>
          <Card className="dashboard-card">
            <Skeleton active paragraph={{ rows: 8 }} />
          </Card>
        </Col>
      </Row>
    </>
  );
}

/* ============ KPI 卡 ============ */
type KpiCardBase = {
  key: string;
  icon: ReactNode;
  title: string;
  value: number | string;
  bg: string;
  iconBg: string;
};

type KpiMetricCard = KpiCardBase & {
  kind: 'metric';
  delta: number | undefined;
};

type KpiRoleCard = KpiCardBase & {
  kind: 'role';
  note: string;
  roleUsers: RoleUserKind;
};

type KpiCardItem = KpiMetricCard | KpiRoleCard;

function KpiRow({
  overview,
  issueTotal,
  issueLoading,
  onOpenFeedback,
  roleUserState,
  onLoadRoleUsers,
  reviewerInvite,
  onCreateReviewerInvite,
  onCopyReviewerInvite,
}: {
  overview: DashboardOverview;
  issueTotal: number;
  issueLoading: boolean;
  onOpenFeedback: () => void;
  roleUserState: Record<RoleUserKind, RoleUserState>;
  onLoadRoleUsers: (role: RoleUserKind, options?: { force?: boolean }) => void;
  reviewerInvite: ReviewerInviteState;
  onCreateReviewerInvite: () => void;
  onCopyReviewerInvite: () => void;
}) {
  const { kpis } = overview;
  const cards: KpiCardItem[] = [
    {
      kind: 'metric',
      key: 'activeTasks',
      icon: <ProjectOutlined />,
      title: '活跃任务',
      value: kpis.activeTasks,
      delta: kpis.deltas.activeTasks,
      bg: '#fff7ed',
      iconBg: '#f59e0b',
    },
    {
      kind: 'role',
      key: 'labelerCount',
      icon: <TeamOutlined />,
      title: '标注员数量',
      value: kpis.labelerCount,
      note: '全平台可用角色',
      roleUsers: 'labeler' as const,
      bg: '#eff6ff',
      iconBg: '#2f7bff',
    },
    {
      kind: 'metric',
      key: 'pendingReview',
      icon: <FlagOutlined />,
      title: '待人工审核',
      value: kpis.pendingReview,
      delta: kpis.deltas.pendingReview,
      bg: '#fffbeb',
      iconBg: '#eab308',
    },
    {
      kind: 'role',
      key: 'reviewerCount',
      icon: <RiseOutlined />,
      title: '审核员数量',
      value: kpis.reviewerCount,
      note: '全平台可用角色',
      roleUsers: 'reviewer' as const,
      bg: '#ecfdf5',
      iconBg: '#22c55e',
    },
    {
      kind: 'metric',
      key: 'aiPassRate',
      icon: <AiAssistantIcon />,
      title: 'AI 通过率',
      value: `${(kpis.aiPassRate * 100).toFixed(1)}%`,
      delta: kpis.deltas.aiPassRate,
      bg: '#fef2f2',
      iconBg: '#ef4444',
    },
  ];

  return (
    <Row gutter={[16, 16]} className="dashboard-kpi-row">
      {cards.map((card) => (
        <Col key={card.key} xs={12} md={8} xl={4}>
          <Card className="dashboard-kpi" style={{ background: card.bg }}>
            {card.kind === 'role' ? (
              <Popover
                trigger="hover"
                placement="bottomLeft"
                arrow={false}
                mouseEnterDelay={0.12}
                mouseLeaveDelay={0.12}
                overlayClassName="dashboard-role-users-popover"
                onOpenChange={(open) => {
                  if (open) void onLoadRoleUsers(card.roleUsers);
                }}
                content={(
                  <RoleUsersPopoverContent
                    role={card.roleUsers}
                    state={roleUserState[card.roleUsers]}
                    onRetry={() => onLoadRoleUsers(card.roleUsers, { force: true })}
                    reviewerInvite={card.roleUsers === 'reviewer' ? reviewerInvite : undefined}
                    onCreateReviewerInvite={onCreateReviewerInvite}
                    onCopyReviewerInvite={onCopyReviewerInvite}
                  />
                )}
              >
                <button
                  type="button"
                  className="dashboard-kpi-icon dashboard-kpi-icon-trigger"
                  style={{ background: card.iconBg }}
                  aria-label={`悬停查看${card.title}人员列表`}
                >
                  {card.icon}
                </button>
              </Popover>
            ) : (
              <div className="dashboard-kpi-icon" style={{ background: card.iconBg }}>
                {card.icon}
              </div>
            )}
            <div className="dashboard-kpi-value">{card.value}</div>
            <div className="dashboard-kpi-title">{card.title}</div>
            {card.kind === 'role' ? (
              <Typography.Text type="secondary" className="dashboard-kpi-note">
                {card.note}
              </Typography.Text>
            ) : (
              <KpiDelta delta={card.delta} />
            )}
          </Card>
        </Col>
      ))}
      <Col xs={24} md={24} xl={4}>
        <Card className="dashboard-announce">
          <div>
            <Typography.Text strong className="dashboard-announce-title">
              题目反馈
            </Typography.Text>
            <div className="dashboard-feedback-count">
              {issueLoading ? '--' : issueTotal}
              <span>待查看</span>
            </div>
            <Typography.Paragraph type="secondary" className="dashboard-announce-desc">
              查看标注员在答题页提交的数据、模板或资源问题。
            </Typography.Paragraph>
            <Button size="small" icon={<FlagOutlined />} onClick={onOpenFeedback}>
              查看反馈
            </Button>
          </div>
        </Card>
      </Col>
    </Row>
  );
}

function KpiDelta({ delta }: { delta?: number }) {
  if (delta == null) return null;
  const positive = delta >= 0;
  return (
    <div className={`dashboard-kpi-delta ${positive ? 'is-up' : 'is-down'}`}>
      {positive ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
      {Math.abs(delta).toFixed(1)}% Last Period
    </div>
  );
}

function IssueFeedbackDrawer({
  open,
  items,
  total,
  loading,
  error,
  onClose,
  onRetry,
  previewSize,
}: {
  open: boolean;
  items: IssueFeedback[];
  total: number;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onRetry: () => void;
  previewSize: number;
}) {
  return (
    <Drawer
      title="题目反馈"
      open={open}
      onClose={onClose}
      width={560}
      extra={
        <Button size="small" onClick={() => void onRetry()} loading={loading}>
          刷新
        </Button>
      }
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Typography.Text type="secondary">
          当前共有 {total} 条待查看反馈,展示最近 {previewSize} 条反馈。
        </Typography.Text>
        {error && (
          <Alert
            type="error"
            showIcon
            message="题目反馈加载失败"
            description={error}
            action={
              <Button size="small" danger onClick={() => void onRetry()}>
                重试
              </Button>
            }
          />
        )}
        {!error && loading && !items.length ? (
          <Skeleton active paragraph={{ rows: 8 }} />
        ) : null}
        {!error && (!loading || items.length > 0) ? (
          <List<IssueFeedback>
            className="dashboard-feedback-list"
            loading={loading && items.length > 0}
            dataSource={items}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="暂无题目反馈"
                />
              ),
            }}
            renderItem={(item) => (
              <List.Item className="dashboard-feedback-item">
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  <Space wrap size={8}>
                    <Tag color="blue">{item.categoryLabel || item.category}</Tag>
                    <Tag>{issueStatusLabel(item.status)}</Tag>
                    <Typography.Text type="secondary">{item.createdAt}</Typography.Text>
                  </Space>
                  <Typography.Text strong>{item.taskTitle}</Typography.Text>
                  <Typography.Paragraph className="dashboard-feedback-desc">
                    {item.description}
                  </Typography.Paragraph>
                  <Space wrap size={[12, 4]} className="dashboard-feedback-meta">
                    <span>任务:{item.taskId}</span>
                    <span>题目:{item.itemId}</span>
                    <span>Labeler:{item.labelerName}</span>
                  </Space>
                </Space>
              </List.Item>
            )}
          />
        ) : null}
      </Space>
    </Drawer>
  );
}

function RoleUsersPopoverContent({
  role,
  state,
  onRetry,
  reviewerInvite,
  onCreateReviewerInvite,
  onCopyReviewerInvite,
}: {
  role: RoleUserKind;
  state: RoleUserState;
  onRetry: () => void;
  reviewerInvite?: ReviewerInviteState;
  onCreateReviewerInvite: () => void;
  onCopyReviewerInvite: () => void;
}) {
  const title = roleUserTitles[role];
  return (
    <div className="dashboard-role-users-popover-content">
      <div className="dashboard-role-users-popover-head">
        <Typography.Text strong>{title}</Typography.Text>
        <Typography.Text type="secondary">
          {state.loading && !state.loaded ? '加载中' : `共 ${state.items.length} 人`}
        </Typography.Text>
      </div>
      {state.error ? (
        <div className="dashboard-role-users-popover-error">
          <Typography.Text type="danger">{state.error}</Typography.Text>
          <Button size="small" danger onClick={() => void onRetry()}>
            重试
          </Button>
        </div>
      ) : (
        <List<DashboardRoleUser>
          className="dashboard-role-users-popover-list"
          loading={state.loading}
          dataSource={state.items}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={`暂无${title}`}
              />
            ),
          }}
          renderItem={(item) => (
            <List.Item className="dashboard-role-users-popover-item">
              <Avatar icon={<UserOutlined />} className="dashboard-role-users-popover-avatar" />
              <div className="dashboard-role-users-popover-main">
                <Space wrap size={8}>
                  <Typography.Text strong>{item.name || item.username}</Typography.Text>
                  <Tag color="green">{item.status}</Tag>
                </Space>
                <Typography.Text type="secondary" className="dashboard-role-users-popover-username">
                  @{item.username}
                </Typography.Text>
                <Space wrap size={[6, 4]} className="dashboard-role-users-popover-tags">
                  {item.roles.map((userRole) => (
                    <Tag key={userRole}>{userRole}</Tag>
                  ))}
                </Space>
              </div>
            </List.Item>
          )}
        />
      )}
      {role === 'reviewer' && reviewerInvite ? (
        <div className="dashboard-role-users-invite">
          <div className="dashboard-role-users-invite-head">
            <Typography.Text strong>审核员邀请</Typography.Text>
            <Button
              size="small"
              type="primary"
              loading={reviewerInvite.loading}
              onClick={() => void onCreateReviewerInvite()}
            >
              生成链接
            </Button>
          </div>
          <Typography.Text type="secondary" className="dashboard-role-users-invite-desc">
            链接 24 小时内有效，注册成功后失效。
          </Typography.Text>
          {reviewerInvite.error ? (
            <Typography.Text type="danger" className="dashboard-role-users-invite-error">
              {reviewerInvite.error}
            </Typography.Text>
          ) : null}
          {reviewerInvite.link ? (
            <div className="dashboard-role-users-invite-link">
              <Typography.Text ellipsis title={reviewerInvite.link}>
                {reviewerInvite.link}
              </Typography.Text>
              <Button
                size="small"
                icon={<CopyOutlined />}
                onClick={() => void onCopyReviewerInvite()}
                aria-label="复制审核员邀请链接"
              />
            </div>
          ) : null}
          {reviewerInvite.expiresAt ? (
            <Typography.Text type="secondary" className="dashboard-role-users-invite-expire">
              过期时间：{reviewerInvite.expiresAt}
            </Typography.Text>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ============ 任务进度图表(recharts) ============ */
function TaskProgressCard({ items }: { items: TaskProgress[] }) {
  const [chartType, setChartType] = useState<'line' | 'bar'>('line');
  // 整理成 Recharts 数据:X 轴用任务编号,tooltip 展示任务标题和各状态数量。
  const chartData = items.map((it) => ({
    name: it.taskId.replace('T-', ''),
    title: it.title,
    total: it.total,
    通过: it.approved,
    打回: it.returned,
    待处理: it.pending,
  }));
  return (
    <Card
      className="dashboard-card"
      title="任务进度"
      extra={
        <Space size={8} className="dashboard-chart-actions">
          <Segmented
            size="small"
            value={chartType}
            onChange={(value) => setChartType(value as 'line' | 'bar')}
            options={[
              { label: '折线图', value: 'line', icon: <LineChartOutlined /> },
              { label: '柱状图', value: 'bar', icon: <BarChartOutlined /> },
            ]}
          />
        </Space>
      }
    >
      <ResponsiveContainer width="100%" height={280}>
        {chartType === 'line' ? (
          <LineChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f2f7" />
            <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
            <YAxis tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
            <RechartsTooltip
              contentStyle={{ borderRadius: 10, border: '1px solid #eef0f5', fontSize: 12 }}
              labelFormatter={(label) => {
                const found = chartData.find((d) => d.name === label);
                return found ? `${found.title} · 共 ${found.total} 条` : label;
              }}
            />
            <Line type="monotone" dataKey="通过" stroke="#22c55e" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="打回" stroke="#f59e0b" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="待处理" stroke="#94a3b8" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="total" name="总量" stroke="var(--lh-primary)" strokeWidth={2} strokeDasharray="5 5" dot={false} />
          </LineChart>
        ) : (
          <BarChart data={chartData} margin={{ top: 10, right: 12, left: -12, bottom: 0 }} barGap={2} barCategoryGap="24%">
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f2f7" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
            <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
            <RechartsTooltip
              cursor={{ fill: 'rgba(47, 123, 255, 0.04)' }}
              contentStyle={{ borderRadius: 10, border: '1px solid #eef0f5', fontSize: 12 }}
              labelFormatter={(label) => {
                const found = chartData.find((d) => d.name === label);
                return found ? `${found.title} · 共 ${found.total} 条` : label;
              }}
            />
            <Bar dataKey="通过" fill="#22c55e" radius={[3, 3, 0, 0]} maxBarSize={14} />
            <Bar dataKey="打回" fill="#f59e0b" radius={[3, 3, 0, 0]} maxBarSize={14} />
            <Bar dataKey="待处理" fill="#94a3b8" radius={[3, 3, 0, 0]} maxBarSize={14} />
            <Bar dataKey="total" name="总量" fill="var(--lh-primary)" radius={[3, 3, 0, 0]} maxBarSize={14} />
          </BarChart>
        )}
      </ResponsiveContainer>
      <div className="bar-legend">
        <span><i className="dot" style={{ background: '#22c55e' }} />通过</span>
        <span><i className="dot" style={{ background: '#f59e0b' }} />打回</span>
        <span><i className="dot" style={{ background: '#94a3b8' }} />待处理</span>
        <span><i className="dot" style={{ background: 'var(--lh-primary)' }} />总量</span>
      </div>
    </Card>
  );
}

/* ============ 审核分布(环形图 recharts) ============ */
function ReviewDistributionCard({
  distribution,
  year,
  yearOptions,
  onYearChange,
}: {
  distribution: ReviewDistribution;
  year: number;
  yearOptions: Array<{ label: string; value: number }>;
  onYearChange: (year: number) => void;
}) {
  const total = reviewLabels.reduce((sum, item) => sum + (distribution[item.key] ?? 0), 0);
  // 整理成 recharts Pie 数据
  const pieData = reviewLabels.map((seg) => ({
    key: seg.key,
    label: seg.label,
    color: seg.color,
    value: distribution[seg.key] ?? 0,
  }));
  return (
    <Card
      className="dashboard-card"
      title="审核分布"
      extra={
        <Select
          size="small"
          value={year}
          options={yearOptions}
          onChange={onYearChange}
          style={{ width: 80 }}
        />
      }
    >
      <Row gutter={[8, 8]} align="middle" style={{ paddingTop: 16, paddingBottom: 8 }}>
        <Col xs={24} md={12}>
          <div style={{ position: 'relative', width: '100%', height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  innerRadius={58}
                  outerRadius={80}
                  paddingAngle={2}
                  stroke="none"
                >
                  {pieData.map((seg) => (
                    <Cell key={seg.key} fill={seg.color} />
                  ))}
                </Pie>
                <RechartsTooltip
                  contentStyle={{ borderRadius: 10, border: '1px solid #eef0f5', fontSize: 12 }}
                  formatter={(value, name) => [value as number, name as string]}
                />
              </PieChart>
            </ResponsiveContainer>
            {/* 中心文字:绝对定位覆盖在环形中央 */}
            <div className="donut-center-text">
              <div className="donut-center-total">{total}</div>
              <div className="donut-center-sub">Total Reviews</div>
            </div>
          </div>
        </Col>
        <Col xs={24} md={12}>
          <ul className="donut-legend">
            {reviewLabels.map((seg) => {
              const value = distribution[seg.key] ?? 0;
              const ratio = total === 0 ? 0 : (value / total) * 100;
              return (
                <li key={seg.key}>
                  <span className="donut-dot" style={{ background: seg.color }} />
                  <span className="donut-percent">{ratio.toFixed(0)}%</span>
                  <span className="donut-label">{seg.label}</span>
                </li>
              );
            })}
          </ul>
        </Col>
      </Row>
      <div className="dashboard-card-foot" style={{ marginTop: 28 }}>
        <Typography.Text type="secondary" className="dashboard-foot-tip">
          周期内合计 {total} 条审核结果
        </Typography.Text>
      </div>
    </Card>
  );
}

/* ============ 角色分布(环形 recharts) ============ */
function RoleDonutCard({ roles }: { roles: RoleBreakdown[] }) {
  const total = roles.reduce((sum, r) => sum + r.memberCount, 0);
  const pieData = roles.map((role, idx) => ({
    label: role.role,
    value: role.memberCount,
    color: roleColors[idx % roleColors.length],
  }));
  if (total === 0) {
    return (
      <Card className="dashboard-card" title="标注员任务类型分布">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无任务类型分布" />
      </Card>
    );
  }
  return (
    <Card className="dashboard-card" title="标注员任务类型分布">
      <div style={{ position: 'relative', width: '100%', height: 150 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={pieData}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius={44}
              outerRadius={62}
              paddingAngle={2}
              stroke="none"
            >
              {pieData.map((seg) => (
                <Cell key={seg.label} fill={seg.color} />
              ))}
            </Pie>
            <RechartsTooltip
              contentStyle={{ borderRadius: 10, border: '1px solid #eef0f5', fontSize: 12 }}
              formatter={(value, name) => [value as number, name as string]}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="donut-center-text">
          <div className="donut-center-total small">{total}</div>
          <div className="donut-center-sub">Active Labelers</div>
        </div>
      </div>
      <ul className="role-legend">
        {roles.map((role, idx) => (
          <li key={role.role}>
            <span className="donut-dot" style={{ background: roleColors[idx % roleColors.length] }} />
            <span>
              <strong>{role.memberCount}</strong> {role.role}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ============ 争议样本与抽检 ============ */
function DisputeStatsCard({
  disputes7,
  disputes14,
  disputes30,
}: {
  disputes7: DisputeStats;
  disputes14: DisputeStats;
  disputes30: DisputeStats;
}) {
  const sampling = Math.max(0, Math.min(1, disputes30.samplingRatio));
  const consistency = Math.max(0, Math.min(1, disputes30.consistencyRate));
  const hasDisputeData =
    disputes7.disputed > 0 ||
    disputes14.disputed > 0 ||
    disputes30.disputed > 0 ||
    disputes30.samplingRatio > 0 ||
    disputes30.consistencyRate > 0;
  if (!hasDisputeData) {
    return (
      <Card className="dashboard-card" title="争议样本 & 抽检">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无争议或抽检数据" />
      </Card>
    );
  }
  return (
    <Card className="dashboard-card" title="争议样本 & 抽检">
      <div className="dispute-grid">
        <div className="dispute-cell">
          <div className="dispute-label">抽检比例</div>
          <div className="dispute-value">{(sampling * 100).toFixed(0)}%</div>
          <div className="dispute-bar">
            <span style={{ width: `${sampling * 100}%`, background: 'var(--lh-primary)' }} />
          </div>
        </div>
        <div className="dispute-cell">
          <div className="dispute-label">双审一致率</div>
          <div className="dispute-value">{(consistency * 100).toFixed(1)}%</div>
          <div className="dispute-bar">
            <span style={{ width: `${consistency * 100}%`, background: '#22c55e' }} />
          </div>
        </div>
      </div>
      <div className="dispute-trend">
        <div className="dispute-trend-row">
          <span>近 7 日争议</span>
          <strong>{disputes7.disputed}</strong>
        </div>
        <div className="dispute-trend-row">
          <span>近 14 日</span>
          <strong>{disputes14.disputed}</strong>
        </div>
        <div className="dispute-trend-row">
          <span>近 30 日</span>
          <strong>{disputes30.disputed}</strong>
        </div>
      </div>
    </Card>
  );
}

/* ============ 任务节点时间线 ============ */
function TaskTimelineCard({ items }: { items: TaskMilestone[] }) {
  const phases: Array<{ key: TaskMilestone['currentPhase']; label: string }> = [
    { key: 'published', label: '已发布' },
    { key: 'ai_review', label: 'AI 预审' },
    { key: 'human_review', label: '人工审核' },
    { key: 'delivered', label: '已交付' },
  ];
  if (items.length === 0) {
    return (
      <Card className="dashboard-card" title="任务关键节点">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无任务节点数据" />
      </Card>
    );
  }
  return (
    <Card className="dashboard-card" title="任务关键节点">
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        {items.map((task) => {
          const phaseIdx = Math.max(0, phases.findIndex((phase) => phase.key === task.currentPhase));
          return (
            <div key={task.taskId} className="timeline-row">
              <div className="timeline-head">
                <span className="timeline-task-id">{task.taskId}</span>
                <Tag>{phases[phaseIdx]?.label ?? '已发布'}</Tag>
              </div>
              <div className="timeline-task-title">{task.title}</div>
              <div className="timeline-bar">
                {phases.map((phase, i) => (
                  <span
                    key={phase.key}
                    className={`timeline-dot ${i <= phaseIdx ? 'is-done' : ''}`}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </Space>
    </Card>
  );
}

/* ============ 任务截止预警 ============ */
function DeadlineAlertCard({
  items,
  onFollow,
}: {
  items: DeadlineAlert[];
  onFollow: (taskId: string) => void;
}) {
  if (items.length === 0) {
    return (
      <Card className="dashboard-card" title="临近截止预警">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无临近截止任务" />
      </Card>
    );
  }
  return (
    <Card className="dashboard-card" title="临近截止预警">
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        {items.map((alert) => {
          const tone = alert.riskLevel === 'critical' || alert.riskLevel === 'warn'
            ? alert.riskLevel
            : 'normal';
          return (
            <div key={alert.taskId} className={`deadline-row tone-${tone}`}>
              <div className="deadline-icon">
                <ClockCircleOutlined />
              </div>
              <div className="deadline-text">
                <div className="deadline-title">{alert.title}</div>
                <div className="deadline-sub">
                  剩余 {alert.pending} 条 · 还有 {alert.hoursLeft} 小时
                </div>
                <div className="deadline-sub">截止 {alert.deadline}</div>
              </div>
              <Button type="link" size="small" onClick={() => onFollow(alert.taskId)}>
                跟进
              </Button>
            </div>
          );
        })}
      </Space>
    </Card>
  );
}

/* ============ 标注员绩效 ============ */
function PerformanceCard({ performance }: { performance: LabelerPerformance[] }) {
  return (
    <Card
      className="dashboard-card"
      title="标注员绩效"
      extra={
        <Select
          size="small"
          defaultValue="last30"
          options={[
            { label: '近 30 日', value: 'last30' },
            { label: '近 7 日', value: 'last7' },
          ]}
          style={{ width: 100 }}
        />
      }
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        {performance.map((p) => (
          <div key={p.labelerId} className="perf-row">
            <Avatar size={36} icon={<UserOutlined />} style={{ background: 'var(--lh-primary)' }} />
            <div className="perf-text">
              <div className="perf-name">{p.name}</div>
              <div className="perf-role">{p.role}</div>
            </div>
            <ScoreRing score={p.score} />
            <Popover
              trigger="click"
              placement="left"
              arrow={false}
              overlayClassName="dashboard-performance-popover"
              title={`${p.name} 绩效详情`}
              content={<PerformanceDetailContent performance={p} />}
            >
              <Button
                type="text"
                className="perf-more-btn"
                icon={<MoreOutlined />}
                aria-label={`查看${p.name}绩效详情`}
                title="查看绩效详情"
              />
            </Popover>
          </div>
        ))}
      </Space>
    </Card>
  );
}

function PerformanceDetailContent({ performance }: { performance: LabelerPerformance }) {
  const submittedCount = safeMetricCount(performance.submittedCount);
  const approvedCount = safeMetricCount(performance.approvedCount);
  const returnedCount = safeMetricCount(performance.returnedCount);
  const passRate = performance.passRate ?? performance.score;
  return (
    <div className="perf-detail-content">
      <div className="perf-detail-grid">
        <PerformanceMetric label="提交数" value={submittedCount.toLocaleString()} />
        <PerformanceMetric label="通过数" value={approvedCount.toLocaleString()} />
        <PerformanceMetric label="打回数" value={returnedCount.toLocaleString()} />
        <PerformanceMetric label="通过率" value={formatPerformanceRate(passRate)} />
        <PerformanceMetric label="平均耗时" value={formatPerformanceDuration(performance.avgDurationSec)} />
        <PerformanceMetric label="综合得分" value={formatPerformanceScore(performance.score)} />
      </div>
    </div>
  );
}

function PerformanceMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="perf-detail-metric">
      <span className="perf-detail-label">{label}</span>
      <strong className="perf-detail-value">{value}</strong>
    </div>
  );
}

function safeMetricCount(value?: number) {
  return Math.max(0, Math.round(value ?? 0));
}

function formatPerformanceRate(value?: number) {
  const safeValue = Math.max(0, Math.min(1, value ?? 0));
  return `${(safeValue * 100).toFixed(1)}%`;
}

function formatPerformanceScore(value?: number) {
  const safeValue = Math.max(0, Math.min(1, value ?? 0));
  return `${(safeValue * 100).toFixed(1)} 分`;
}

function formatPerformanceDuration(value?: number) {
  const seconds = Math.max(0, Math.round(value ?? 0));
  if (seconds === 0) return '-';
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const restSeconds = seconds % 60;
    return restSeconds > 0 ? `${minutes} 分 ${restSeconds} 秒` : `${minutes} 分`;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return minutes > 0 ? `${hours} 时 ${minutes} 分` : `${hours} 时`;
}

function ScoreRing({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(1, score));
  const color = pct >= 0.7 ? '#22c55e' : pct >= 0.5 ? '#f59e0b' : '#ef4444';
  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="score-ring">
      <svg viewBox="0 0 60 60">
        <circle
          className="score-ring-track"
          cx="30"
          cy="30"
          r={radius}
          fill="none"
          stroke="#f1f5f9"
          strokeWidth="6"
        />
        <circle
          cx="30"
          cy="30"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeDasharray={`${pct * circumference} ${circumference}`}
          strokeLinecap="round"
          transform="rotate(-90 30 30)"
        />
        <text x="30" y="34" textAnchor="middle" className="score-text">
          {Math.round(pct * 100)}%
        </text>
      </svg>
    </div>
  );
}

/* ============ 月度提交时段(堆叠柱 recharts) ============ */
function SubmissionTimelineCard({ items }: { items: SubmissionTimelineMonth[] }) {
  // 转成百分比堆叠数据,与原手写图一致(各月归一化到 100%)
  const chartData = items.map((it) => {
    const total = it.onTime + it.late + it.absent || 1;
    return {
      month: it.month,
      准时: Math.round((it.onTime / total) * 100),
      延迟: Math.round((it.late / total) * 100),
      缺席: Math.round((it.absent / total) * 100),
    };
  });
  return (
    <Card
      className="dashboard-card"
      title="月度准时提交率"
    >
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={chartData} margin={{ top: 10, right: 12, left: -12, bottom: 0 }} barCategoryGap="28%">
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f2f7" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
          <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
          <RechartsTooltip
            cursor={{ fill: 'rgba(47, 123, 255, 0.04)' }}
            contentStyle={{ borderRadius: 10, border: '1px solid #eef0f5', fontSize: 12 }}
            formatter={(value, name) => [`${value as number}%`, name as string]}
          />
          <Bar dataKey="准时" stackId="a" fill="var(--lh-primary)" maxBarSize={26} />
          <Bar dataKey="延迟" stackId="a" fill="#f59e0b" maxBarSize={26} />
          <Bar dataKey="缺席" stackId="a" fill="#94a3b8" maxBarSize={26} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <div className="bar-legend">
        <span>
          <i className="dot" style={{ background: 'var(--lh-primary)' }} />准时
        </span>
        <span>
          <i className="dot" style={{ background: '#f59e0b' }} />延迟
        </span>
        <span>
          <i className="dot" style={{ background: '#94a3b8' }} />缺席
        </span>
      </div>
    </Card>
  );
}
