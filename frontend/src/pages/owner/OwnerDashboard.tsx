import { useCallback, useEffect, useState } from 'react';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  ClockCircleOutlined,
  DownloadOutlined,
  FlagOutlined,
  MoreOutlined,
  ProjectOutlined,
  RiseOutlined,
  SearchOutlined,
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
  Input,
  List,
  Row,
  Segmented,
  Select,
  Skeleton,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { getApiErrorMessage } from '../../api/client';
import { dashboardApi } from '../../api/dashboard';
import { AiAssistantIcon } from '../../components/icons';
import type {
  DashboardOverview,
  DisputeStats,
  IssueFeedback,
  LabelerPerformance,
  RecentTaskActivity,
  ReviewDistribution,
  RoleBreakdown,
  SubmissionTimelineMonth,
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
  review: ReviewDistribution;
  performance: LabelerPerformance[];
  timeline: SubmissionTimelineMonth[];
  activities: RecentTaskActivity[];
  roles: RoleBreakdown[];
  disputes7: DisputeStats;
  disputes14: DisputeStats;
  disputes30: DisputeStats;
}

const reviewLabels: Array<{ key: keyof ReviewDistribution; label: string; color: string }> = [
  { key: 'aiPass', label: 'AI 通过', color: '#2f7bff' },
  { key: 'aiNeedHuman', label: '需人工复核', color: '#a855f7' },
  { key: 'aiReject', label: 'AI 拒绝', color: '#ef4444' },
  { key: 'humanPass', label: '人工通过', color: '#22c55e' },
  { key: 'humanReturned', label: '打回修改', color: '#f59e0b' },
];

const roleColors = ['#2f7bff', '#22c55e', '#f59e0b', '#a855f7', '#ef4444'];
const currentYear = new Date().getFullYear();
const reviewYearOptions = Array.from({ length: 5 }, (_, index) => {
  const year = currentYear - index;
  return { label: String(year), value: year };
});
const ISSUE_FEEDBACK_PREVIEW_SIZE = 5;

function issueStatusLabel(status: string) {
  if (status === 'open') return '待查看';
  if (status === 'viewed') return '已查看';
  return status;
}

export default function OwnerDashboard() {
  const { message } = AntdApp.useApp();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [range, setRange] = useState<'7d' | '30d' | '90d'>('30d');
  const [reviewYear, setReviewYear] = useState(currentYear);
  const [reviewReportDownloading, setReviewReportDownloading] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [issueFeedback, setIssueFeedback] = useState<IssueFeedback[]>([]);
  const [issueTotal, setIssueTotal] = useState(0);
  const [issueLoading, setIssueLoading] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);

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
        review,
        performance,
        timeline,
        activities,
        roles,
        disputes7,
        disputes14,
        disputes30,
      ] = await Promise.all([
        dashboardApi.getOverview(range),
        dashboardApi.getTaskProgress(),
        dashboardApi.getReviewDistribution({ year: reviewYear }),
        dashboardApi.getLabelerPerformance(range),
        dashboardApi.getSubmissionTimeline(),
        dashboardApi.getRecentActivities(),
        dashboardApi.getRoleBreakdown(),
        dashboardApi.getDisputes(7),
        dashboardApi.getDisputes(14),
        dashboardApi.getDisputes(30),
      ]);
      setData({
        overview,
        taskProgress: taskProgress.items ?? [],
        review,
        performance: performance.items ?? [],
        timeline: timeline.items ?? [],
        activities: activities.items ?? [],
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

  const downloadReviewReport = useCallback(async () => {
    setReviewReportDownloading(true);
    try {
      await dashboardApi.downloadReviewDistributionReport(reviewYear);
      message.success(`${reviewYear} 年 AI 审核分布报告已开始下载`);
    } catch (error) {
      message.error(getApiErrorMessage(error, 'AI 审核分布报告下载失败'));
    } finally {
      setReviewReportDownloading(false);
    }
  }, [message, reviewYear]);

  return (
    <>
      <Space direction="vertical" size="large" className="page-stack dashboard-page">
        <DashboardHeader
          overview={data?.overview}
          range={range}
          onRangeChange={setRange}
          issueTotal={issueTotal}
          onOpenFeedback={openIssueFeedback}
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
            />

            <Row gutter={[16, 16]}>
              <Col xs={24} xl={15}>
                <TaskProgressCard items={data.taskProgress} />
              </Col>
              <Col xs={24} xl={9}>
                <ReviewDistributionCard
                  distribution={data.review}
                  year={reviewYear}
                  yearOptions={reviewYearOptions}
                  onYearChange={setReviewYear}
                  onDownload={downloadReviewReport}
                  downloading={reviewReportDownloading}
                />
              </Col>
            </Row>

            <Row gutter={[16, 16]}>
              <Col xs={24} xl={9}>
                <RecentActivitiesCard items={data.activities} />
              </Col>
              <Col xs={24} xl={15}>
                <LeaveTableCard performance={data.performance} />
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
                <TaskTimelineCard items={data.taskProgress} />
              </Col>
              <Col xs={24} md={12} xl={6}>
                <DeadlineAlertCard items={data.taskProgress} />
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
}: {
  overview?: DashboardOverview;
  range: '7d' | '30d' | '90d';
  onRangeChange: (v: '7d' | '30d' | '90d') => void;
  issueTotal: number;
  onOpenFeedback: () => void;
}) {
  return (
    <div className="page-title-row">
      <Space direction="vertical" size={4}>
        <Typography.Title level={3}>数据看板</Typography.Title>
        <Typography.Text type="secondary">
          {overview ? `统计周期:${overview.rangeStart} ~ ${overview.rangeEnd}` : '正在加载真实数据'}
        </Typography.Text>
      </Space>
      <Space>
        <Segmented
          options={[
            { label: '近 7 日', value: '7d' },
            { label: '近 30 日', value: '30d' },
            { label: '近 90 日', value: '90d' },
          ]}
          value={range}
          onChange={(v) => onRangeChange(v as '7d' | '30d' | '90d')}
        />
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
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={9}>
          <Card className="dashboard-card">
            <Skeleton active paragraph={{ rows: 6 }} />
          </Card>
        </Col>
        <Col xs={24} xl={15}>
          <Card className="dashboard-card">
            <Skeleton active paragraph={{ rows: 6 }} />
          </Card>
        </Col>
      </Row>
    </>
  );
}

/* ============ KPI 卡 ============ */
function KpiRow({
  overview,
  issueTotal,
  issueLoading,
  onOpenFeedback,
}: {
  overview: DashboardOverview;
  issueTotal: number;
  issueLoading: boolean;
  onOpenFeedback: () => void;
}) {
  const { kpis } = overview;
  const cards = [
    {
      key: 'activeTasks',
      icon: <ProjectOutlined />,
      title: '活跃任务',
      value: kpis.activeTasks,
      delta: kpis.deltas.activeTasks,
      bg: '#fff7ed',
      iconBg: '#f59e0b',
    },
    {
      key: 'activeLabelers',
      icon: <TeamOutlined />,
      title: '活跃标注员',
      value: kpis.activeLabelers,
      delta: kpis.deltas.activeLabelers,
      bg: '#eff6ff',
      iconBg: '#2f7bff',
    },
    {
      key: 'pendingReview',
      icon: <FlagOutlined />,
      title: '待人工审核',
      value: kpis.pendingReview,
      delta: kpis.deltas.pendingReview,
      bg: '#fffbeb',
      iconBg: '#eab308',
    },
    {
      key: 'submittedToday',
      icon: <RiseOutlined />,
      title: '今日新增提交',
      value: kpis.submittedToday,
      delta: kpis.deltas.submittedToday,
      bg: '#ecfdf5',
      iconBg: '#22c55e',
    },
    {
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
            <div className="dashboard-kpi-icon" style={{ background: card.iconBg }}>
              {card.icon}
            </div>
            <div className="dashboard-kpi-value">{card.value}</div>
            <div className="dashboard-kpi-title">{card.title}</div>
            <KpiDelta delta={card.delta} />
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

/* ============ 任务进度柱状图(recharts) ============ */
function TaskProgressCard({ items }: { items: TaskProgress[] }) {
  // 整理成 recharts 数据:X 轴用任务编号(去掉 T- 前缀),三个系列 通过/打回/待处理
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
        <Button size="small" icon={<DownloadOutlined />}>
          下载报告
        </Button>
      }
    >
      <ResponsiveContainer width="100%" height={280}>
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
        </BarChart>
      </ResponsiveContainer>
      <div className="bar-legend">
        <span><i className="dot" style={{ background: '#22c55e' }} />通过</span>
        <span><i className="dot" style={{ background: '#f59e0b' }} />打回</span>
        <span><i className="dot" style={{ background: '#94a3b8' }} />待处理</span>
      </div>
    </Card>
  );
}

/* ============ AI 审核分布(环形图 recharts) ============ */
function ReviewDistributionCard({
  distribution,
  year,
  yearOptions,
  onYearChange,
  onDownload,
  downloading,
}: {
  distribution: ReviewDistribution;
  year: number;
  yearOptions: Array<{ label: string; value: number }>;
  onYearChange: (year: number) => void;
  onDownload: () => void;
  downloading: boolean;
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
      title="AI 审核分布"
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
        <Button
          type="primary"
          size="small"
          icon={<DownloadOutlined />}
          onClick={onDownload}
          loading={downloading}
        >
          下载报告
        </Button>
      </div>
    </Card>
  );
}

/* ============ 近期活动 ============ */
function RecentActivitiesCard({ items }: { items: RecentTaskActivity[] }) {
  const statusMeta: Record<RecentTaskActivity['status'], { label: string; color: string }> = {
    pending: { label: 'Pending', color: 'processing' },
    approved: { label: 'Approved', color: 'success' },
    rejected: { label: 'Rejected', color: 'error' },
  };
  return (
    <Card
      className="dashboard-card"
      title="近期任务申报"
      extra={
        <Button type="link" size="small">
          查看全部
        </Button>
      }
    >
      <Space direction="vertical" size={0} style={{ width: '100%' }}>
        {items.map((item) => (
          <div key={item.taskId} className="activity-row">
            <Avatar size={36} icon={<UserOutlined />} style={{ background: 'var(--lh-primary)' }} />
            <div className="activity-text">
              <div className="activity-name">{item.ownerName}</div>
              <div className="activity-task">{item.taskTitle}</div>
            </div>
            <Tag color={statusMeta[item.status].color}>{statusMeta[item.status].label}</Tag>
          </div>
        ))}
      </Space>
    </Card>
  );
}

/* ============ 标注员审核流转表 ============ */
function LeaveTableCard({ performance }: { performance: LabelerPerformance[] }) {
  const columns: ColumnsType<LabelerPerformance> = [
    {
      title: 'Name',
      dataIndex: 'name',
      sorter: (a, b) => a.name.localeCompare(b.name),
      render: (_, record) => (
        <Space>
          <Avatar size={32} icon={<UserOutlined />} style={{ background: 'var(--lh-primary)' }} />
          <div>
            <div className="leave-name">{record.name}</div>
            <div className="leave-role">{record.role}</div>
          </div>
        </Space>
      ),
    },
    {
      title: 'Submitted',
      dataIndex: 'submitted',
      sorter: (a, b) => a.submitted - b.submitted,
    },
    {
      title: 'Approved',
      dataIndex: 'approved',
      sorter: (a, b) => a.approved - b.approved,
    },
    {
      title: 'Returned',
      dataIndex: 'returned',
      sorter: (a, b) => a.returned - b.returned,
    },
    {
      title: 'Avg Time',
      dataIndex: 'avgDurationSec',
      render: (val: number) => `${val} 秒/条`,
    },
    {
      title: 'Status',
      key: 'status',
      render: (_, record) => {
        const ratio = record.approved / Math.max(1, record.submitted);
        const isHigh = ratio >= 0.7;
        return <Tag color={isHigh ? 'success' : 'warning'}>{isHigh ? 'Approved' : 'Pending'}</Tag>;
      },
    },
  ];

  return (
    <Card
      className="dashboard-card"
      title="标注员审核流转"
      extra={
        <Input
          prefix={<SearchOutlined />}
          placeholder="Search"
          allowClear
          style={{ width: 200 }}
        />
      }
    >
      <Table<LabelerPerformance>
        rowKey="labelerId"
        columns={columns}
        dataSource={performance}
        pagination={false}
        size="middle"
      />
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
  return (
    <Card className="dashboard-card" title="标注员角色分布">
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
          <div className="donut-center-sub">Active</div>
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
function TaskTimelineCard({ items }: { items: TaskProgress[] }) {
  // 抽几条任务,展示从发布 → AI 预审 → 人工审核 → 终评的关键节点
  const sample = items.slice(0, 4);
  const phases = ['已发布', 'AI 预审', '人工审核', '已交付'];
  return (
    <Card className="dashboard-card" title="任务关键节点">
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        {sample.map((task, idx) => {
          // 当前阶段:用 approved 比例粗估,真实数据来自后端
          const ratio = task.approved / Math.max(1, task.total);
          const phaseIdx = ratio >= 0.8 ? 3 : ratio >= 0.4 ? 2 : ratio >= 0.1 ? 1 : 0;
          return (
            <div key={task.taskId} className="timeline-row">
              <div className="timeline-head">
                <span className="timeline-task-id">{task.taskId}</span>
                <Tag>{phases[phaseIdx]}</Tag>
              </div>
              <div className="timeline-task-title">{task.title}</div>
              <div className="timeline-bar">
                {phases.map((_, i) => (
                  <span
                    key={i}
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
function DeadlineAlertCard({ items }: { items: TaskProgress[] }) {
  // 演示数据:挑出 pending > 0 的任务并标记紧急级别(真实数据走 GET /dashboard/overview deadlines)
  const alerts = items
    .filter((t) => t.pending > 0)
    .slice(0, 4)
    .map((t, idx) => ({
      taskId: t.taskId,
      title: t.title,
      pending: t.pending,
      hoursLeft: 48 - idx * 12,
    }));
  return (
    <Card className="dashboard-card" title="临近截止预警">
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        {alerts.map((alert) => {
          const tone = alert.hoursLeft <= 12 ? 'critical' : alert.hoursLeft <= 24 ? 'warn' : 'normal';
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
              </div>
              <Button type="link" size="small">
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
            <Button type="text" icon={<MoreOutlined />} />
          </div>
        ))}
      </Space>
    </Card>
  );
}

function ScoreRing({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(1, score));
  const color = pct >= 0.7 ? '#22c55e' : pct >= 0.5 ? '#f59e0b' : '#ef4444';
  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="score-ring">
      <svg viewBox="0 0 60 60">
        <circle cx="30" cy="30" r={radius} fill="none" stroke="#f1f5f9" strokeWidth="6" />
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
      extra={
        <Button size="small" icon={<DownloadOutlined />}>
          下载报告
        </Button>
      }
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
