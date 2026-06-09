import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChartOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  CloseCircleFilled,
  DashboardOutlined,
  ExclamationCircleFilled,
  LineChartOutlined,
  ReloadOutlined,
  ThunderboltFilled,
} from '@ant-design/icons';
import {
  App as AntdApp,
  Button,
  Card,
  Col,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { aiReviewApi } from '../../api/aiReview';
import { aiDashboardApi } from '../../api/aiDashboard';
import { JobsPanel } from '../owner/OwnerAiReview';
import type { AiReviewJob } from '../../types/aiReview';
import type {
  AiDailyTrend,
  AiDashboardKpi,
  AiDecisionDistribution,
  AiTaskVolume,
} from '../../types/aiDashboard';
import { AiAssistantIcon } from '../../components/icons';

const { Paragraph, Text, Title } = Typography;

/**
 * AI 审核后台 · 作业概览(数据仪表盘)。
 *
 * 对齐计划书 4.4 / 4.6:
 *   - KPI 概览:总作业 / 成功 / 失败 / 排队 / 执行中 / 需人工
 *   - 决策分布环状图:PASS / NEED_HUMAN / REJECT 占比
 *   - 每日趋势折线图:近 7/30 天每日处理量(按决策分色)
 *   - 任务维度柱状图:各任务审核量对比
 *   - AI 通过率圆环进度图
 *   - 最近作业列表
 *
 * 后端接口(拆成 4 个小接口):
 *   GET /ai-review/dashboard/kpi
 *   GET /ai-review/dashboard/decisions
 *   GET /ai-review/dashboard/trend?days=7
 *   GET /ai-review/dashboard/tasks
 *
 * 后端未实现时从现有 GET /ai-review/jobs 本地计算回落。
 */

/** 决策颜色:与 Owner 数据看板配色系一致,柔和不刺眼 */
const DECISION_COLORS: Record<string, string> = {
  PASS: '#22c55e',
  NEED_HUMAN_REVIEW: '#a855f7',
  REJECT: '#ef4444',
};

type AiOverviewChartKey = 'trend' | 'decisions' | 'passRate' | 'efficiency' | 'tasks';

const AI_OVERVIEW_CHART_OPTIONS: { label: string; value: AiOverviewChartKey }[] = [
  { label: '每日审核量趋势', value: 'trend' },
  { label: '决策分布', value: 'decisions' },
  { label: 'AI 通过率', value: 'passRate' },
  { label: '处理效率', value: 'efficiency' },
  { label: '任务审核量对比', value: 'tasks' },
];

export default function AiReviewerDashboard() {
  const location = useLocation();

  if (location.pathname.endsWith('/jobs')) {
    return (
      <AiReviewerShell title="Job 队列" description="查看 Agent 领取、执行、失败重试和完成状态。">
        <JobsPanel />
      </AiReviewerShell>
    );
  }
  return <AiReviewerOverview />;
}

function AiReviewerShell({
  title,
  description,
  className,
  children,
}: {
  title: string;
  description: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Space
      direction="vertical"
      size="large"
      className={`page-stack ai-review-page${className ? ` ${className}` : ''}`}
    >
      <div className="page-title-row">
        <Space direction="vertical" size={4}>
          <Title level={3}>{title}</Title>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            {description}
          </Paragraph>
        </Space>
        <Tag color="processing" icon={<AiAssistantIcon />}>
          AI Reviewer
        </Tag>
      </div>
      {children}
    </Space>
  );
}

/* ============ 作业概览仪表盘 ============ */

function AiReviewerOverview() {
  const { message } = AntdApp.useApp();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  /** 趋势图单独的加载态:切换近 7/30 天时只让趋势卡片转圈,其它卡片不动 */
  const [trendLoading, setTrendLoading] = useState(false);
  const [usingFallback, setUsingFallback] = useState(false);
  const [trendDays, setTrendDays] = useState<7 | 30>(7);
  /** 每日趋势图表类型:折线图 / 柱状图 */
  const [trendChartType, setTrendChartType] = useState<'line' | 'bar'>('line');
  /** 手机端图表区仅展示当前选中的一张图表 */
  const [mobileChartKey, setMobileChartKey] = useState<AiOverviewChartKey>('trend');

  // 数据
  const [kpi, setKpi] = useState<AiDashboardKpi | null>(null);
  const [decisions, setDecisions] = useState<AiDecisionDistribution[]>([]);
  const [trend, setTrend] = useState<AiDailyTrend[]>([]);
  const [taskVolumes, setTaskVolumes] = useState<AiTaskVolume[]>([]);
  const [jobs, setJobs] = useState<AiReviewJob[]>([]);

  /** 从仪表盘接口加载,失败时回落到 jobs 列表本地计算 */
  const load = useCallback(async (days: number) => {
    setLoading(true);
    try {
      const [kpiRes, decRes, trendRes, taskRes] = await Promise.all([
        aiDashboardApi.getKpi(),
        aiDashboardApi.getDecisionDistribution(),
        aiDashboardApi.getDailyTrend(days),
        aiDashboardApi.getTaskVolumes(),
      ]);
      setKpi(kpiRes);
      setDecisions(decRes);
      setTrend(trendRes);
      setTaskVolumes(taskRes);
      setUsingFallback(false);
    } catch {
      // 后端仪表盘接口未实现,回落到 jobs 列表本地计算
      try {
        const jobPage = await aiReviewApi.listJobs({ page: 1, pageSize: 200 });
        const items = jobPage.items ?? [];
        setJobs(items);
        setKpi(computeKpiFromJobs(items));
        setDecisions(computeDecisionsFromJobs(items));
        setTrend(computeTrendFromJobs(items, days));
        setTaskVolumes(computeTaskVolumesFromJobs(items));
        setUsingFallback(true);
      } catch (error) {
        message.error(error instanceof Error ? error.message : 'AI 审核数据加载失败');
      }
    } finally {
      setLoading(false);
    }
  }, [message]);

  /**
   * 仅刷新「每日审核量趋势」数据。
   * 切换近 7/30 天时调用,只翻转 trendLoading,不触发整页 loading,
   * 因此其它卡片(KPI、决策分布、通过率、任务对比)不会重新进入加载态。
   */
  const loadTrend = useCallback(async (days: number) => {
    setTrendLoading(true);
    try {
      const trendRes = await aiDashboardApi.getDailyTrend(days);
      setTrend(trendRes);
    } catch {
      // 仪表盘趋势接口未实现,回落到 jobs 列表本地计算
      try {
        const jobPage = await aiReviewApi.listJobs({ page: 1, pageSize: 200 });
        const items = jobPage.items ?? [];
        setTrend(computeTrendFromJobs(items, days));
      } catch (error) {
        message.error(error instanceof Error ? error.message : '趋势数据加载失败');
      }
    } finally {
      setTrendLoading(false);
    }
  }, [message]);

  // 仅首次挂载时整页加载一次;后续切换近 7/30 天只刷新趋势卡片
  useEffect(() => {
    void load(trendDays);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 切换近 7/30 天:只刷新趋势数据,其它卡片保持不动 */
  const handleTrendDaysChange = useCallback((days: 7 | 30) => {
    setTrendDays(days);
    void loadTrend(days);
  }, [loadTrend]);

  /** 通过率圆环数据 */
  const passRateData = useMemo(() => {
    const rate = kpi?.passRate ?? 0;
    return [
      { name: '通过率', value: Math.round(rate * 100), fill: '#22c55e' },
      { name: '其他', value: 100 - Math.round(rate * 100), fill: '#f1f5f9' },
    ];
  }, [kpi]);

  const renderTrendChartCard = () => (
    <Card
      title="每日审核量趋势"
      extra={
        <Space size={8} wrap>
          <Segmented
            size="small"
            value={trendDays}
            onChange={(v) => handleTrendDaysChange(v as 7 | 30)}
            options={[
              { label: '近 7 天', value: 7 },
              { label: '近 30 天', value: 30 },
            ]}
          />
          <Segmented
            size="small"
            value={trendChartType}
            onChange={(v) => setTrendChartType(v as 'line' | 'bar')}
            options={[
              { label: '折线图', value: 'line', icon: <LineChartOutlined /> },
              { label: '柱状图', value: 'bar', icon: <BarChartOutlined /> },
            ]}
          />
        </Space>
      }
      className="ai-overview-chart-card"
    >
      <Spin spinning={trendLoading}>
        <ResponsiveContainer width="100%" height={280}>
          {trendChartType === 'line' ? (
            <LineChart data={trend} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f2f7" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="pass" name="PASS" stroke="#22c55e" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="needHuman" name="人工复核" stroke="#f59e0b" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="reject" name="REJECT" stroke="#ef4444" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="total" name="总量" stroke="var(--lh-primary)" strokeWidth={2} strokeDasharray="5 5" dot={false} />
            </LineChart>
          ) : (
            <BarChart
              data={trend}
              margin={{ top: 10, right: 12, left: -12, bottom: 0 }}
              barGap={2}
              barCategoryGap="24%"
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f2f7" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <Tooltip
                cursor={{ fill: 'rgba(47, 123, 255, 0.04)' }}
                contentStyle={{ borderRadius: 10, border: '1px solid #eef0f5', fontSize: 12 }}
              />
              <Bar dataKey="pass" name="PASS" fill="#22c55e" radius={[3, 3, 0, 0]} maxBarSize={14} />
              <Bar dataKey="needHuman" name="人工复核" fill="#f59e0b" radius={[3, 3, 0, 0]} maxBarSize={14} />
              <Bar dataKey="reject" name="REJECT" fill="#ef4444" radius={[3, 3, 0, 0]} maxBarSize={14} />
              <Bar dataKey="total" name="总量" fill="#94a3b8" radius={[3, 3, 0, 0]} maxBarSize={14} />
            </BarChart>
          )}
        </ResponsiveContainer>
        {trendChartType === 'bar' && (
          <div className="bar-legend">
            <span><i className="dot" style={{ background: '#22c55e' }} />PASS</span>
            <span><i className="dot" style={{ background: '#f59e0b' }} />人工复核</span>
            <span><i className="dot" style={{ background: '#ef4444' }} />REJECT</span>
            <span><i className="dot" style={{ background: '#94a3b8' }} />总量</span>
          </div>
        )}
      </Spin>
    </Card>
  );

  const renderDecisionChartCard = () => (
    <Card title="决策分布" loading={loading} className="ai-overview-chart-card">
      <Row gutter={[8, 8]} align="middle" style={{ paddingTop: 8 }}>
        <Col xs={24} md={13}>
          <div style={{ position: 'relative', width: '100%', height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={decisions}
                  dataKey="count"
                  nameKey="decision"
                  cx="50%"
                  cy="50%"
                  innerRadius={58}
                  outerRadius={80}
                  paddingAngle={2}
                  stroke="none"
                >
                  {decisions.map((entry) => (
                    <Cell key={entry.decision} fill={DECISION_COLORS[entry.decision] ?? '#94a3b8'} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ borderRadius: 10, border: '1px solid #eef0f5', fontSize: 12 }}
                  formatter={(value, name) => [value as number, decisionLabel(String(name))]}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="donut-center-text">
              <div className="donut-center-total">
                {decisions.reduce((s, d) => s + d.count, 0)}
              </div>
              <div className="donut-center-sub">Total</div>
            </div>
          </div>
        </Col>
        <Col xs={24} md={11}>
          <ul className="donut-legend">
            {decisions.map((d) => {
              const total = decisions.reduce((s, x) => s + x.count, 0);
              const ratio = total === 0 ? 0 : (d.count / total) * 100;
              return (
                <li key={d.decision}>
                  <span
                    className="donut-dot"
                    style={{ background: DECISION_COLORS[d.decision] ?? '#94a3b8' }}
                  />
                  <span className="donut-percent">{ratio.toFixed(0)}%</span>
                  <span className="donut-label">{decisionLabel(d.decision)}</span>
                </li>
              );
            })}
          </ul>
        </Col>
      </Row>
    </Card>
  );

  const renderPassRateChartCard = () => (
    <Card title="AI 通过率" loading={loading} className="ai-overview-chart-card">
      <div style={{ position: 'relative', width: '100%', height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            cx="50%"
            cy="50%"
            innerRadius="68%"
            outerRadius="92%"
            data={passRateData}
            startAngle={90}
            endAngle={-270}
          >
            <RadialBar dataKey="value" cornerRadius={12} background={{ fill: '#f1f5f9' }} />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="donut-center-text">
          <div className="ai-overview-pass-rate">
            {Math.round((kpi?.passRate ?? 0) * 100)}%
          </div>
          <div className="donut-center-sub">PASS 占比</div>
        </div>
      </div>
      <div className="ai-overview-pass-foot">
        <span>
          成功 <strong>{kpi?.succeededJobs ?? 0}</strong>
        </span>
        <span style={{ color: '#cbd5e1' }}>·</span>
        <span>
          总数 <strong>{kpi?.totalJobs ?? 0}</strong>
        </span>
      </div>
    </Card>
  );

  const renderEfficiencyChartCard = () => (
    <Card title="处理效率" loading={loading} className="ai-overview-chart-card">
      <div className="ai-overview-eff-grid">
        <div className="ai-overview-eff-cell">
          <ClockCircleOutlined className="ai-overview-eff-icon is-clock" />
          <div className="ai-overview-eff-value">
            {kpi?.avgDurationSec ? `${Math.round(kpi.avgDurationSec)}s` : '-'}
          </div>
          <div className="ai-overview-eff-label">平均处理时长</div>
        </div>
        <div className="ai-overview-eff-cell">
          <CheckCircleFilled className="ai-overview-eff-icon is-success" />
          <div className="ai-overview-eff-value">{kpi?.succeededJobs ?? 0}</div>
          <div className="ai-overview-eff-label">已完成审核</div>
        </div>
      </div>
    </Card>
  );

  const renderTaskVolumeChartCard = () => (
    <Card title="任务审核量对比" loading={loading} className="ai-overview-chart-card">
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={taskVolumes} margin={{ top: 10, right: 30, left: 0, bottom: 0 }} barCategoryGap="32%">
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f2f7" vertical={false} />
          <XAxis
            dataKey="taskTitle"
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            axisLine={{ stroke: '#e2e8f0' }}
            tickLine={false}
          />
          <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
          <Tooltip
            cursor={{ fill: 'rgba(47, 123, 255, 0.04)' }}
            contentStyle={{ borderRadius: 10, border: '1px solid #eef0f5', fontSize: 12 }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="pass" name="通过" stackId="a" fill="#22c55e" maxBarSize={32} />
          <Bar dataKey="needHuman" name="人工复核" stackId="a" fill="#a855f7" maxBarSize={32} />
          <Bar dataKey="reject" name="打回" stackId="a" fill="#ef4444" maxBarSize={32} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );

  const renderOverviewChartCard = (chartKey: AiOverviewChartKey) => {
    switch (chartKey) {
      case 'decisions':
        return renderDecisionChartCard();
      case 'passRate':
        return renderPassRateChartCard();
      case 'efficiency':
        return renderEfficiencyChartCard();
      case 'tasks':
        return renderTaskVolumeChartCard();
      case 'trend':
      default:
        return renderTrendChartCard();
    }
  };

  return (
    <AiReviewerShell
      title="AI 审核后台"
      description="AI Agent 作业运行统计、决策分布、趋势分析与任务维度对比。"
      className="ai-reviewer-overview-page"
    >
      {/* 顶部操作 */}
      <Space wrap>
        <Button type="primary" icon={<AiAssistantIcon />} onClick={() => navigate('/ai-reviewer/jobs')}>
          查看 Job 队列
        </Button>
        <Button icon={<ReloadOutlined />} onClick={() => void load(trendDays)}>
          刷新
        </Button>
        {usingFallback && <Tag color="gold">本地计算模式 · 仪表盘接口未就绪</Tag>}
      </Space>

      {/* KPI 行 */}
      <Row gutter={16} className="row-equal ai-reviewer-overview-kpi-row">
        <Col xs={12} md={4}>
          <Card className="owner-stat-card" loading={loading}>
            <div className="owner-stat-label"><DashboardOutlined /> 总作业</div>
            <div className="owner-stat-value owner-stat-primary">{kpi?.totalJobs ?? 0}</div>
          </Card>
        </Col>
        <Col xs={12} md={4}>
          <Card className="owner-stat-card" loading={loading}>
            <div className="owner-stat-label"><CheckCircleFilled style={{ color: '#22c55e' }} /> 成功</div>
            <div className="owner-stat-value">{kpi?.succeededJobs ?? 0}</div>
          </Card>
        </Col>
        <Col xs={12} md={4}>
          <Card className="owner-stat-card" loading={loading}>
            <div className="owner-stat-label"><CloseCircleFilled style={{ color: '#ef4444' }} /> 失败</div>
            <div className="owner-stat-value">{kpi?.failedJobs ?? 0}</div>
          </Card>
        </Col>
        <Col xs={12} md={4}>
          <Card className="owner-stat-card" loading={loading}>
            <div className="owner-stat-label"><ExclamationCircleFilled style={{ color: '#f59e0b' }} /> 需人工</div>
            <div className="owner-stat-value">{kpi?.needHumanJobs ?? 0}</div>
          </Card>
        </Col>
        <Col xs={12} md={4}>
          <Card className="owner-stat-card" loading={loading}>
            <div className="owner-stat-label"><ClockCircleOutlined /> 排队中</div>
            <div className="owner-stat-value">{kpi?.pendingJobs ?? 0}</div>
          </Card>
        </Col>
        <Col xs={12} md={4}>
          <Card className="owner-stat-card" loading={loading}>
            <div className="owner-stat-label"><ThunderboltFilled style={{ color: 'var(--lh-primary)' }} /> 执行中</div>
            <div className="owner-stat-value">{kpi?.runningJobs ?? 0}</div>
          </Card>
        </Col>
      </Row>

      <div className="ai-reviewer-mobile-chart-panel">
        <div className="ai-reviewer-mobile-chart-switcher">
          <Text strong>统计图表</Text>
          <Select
            value={mobileChartKey}
            onChange={(value) => setMobileChartKey(value as AiOverviewChartKey)}
            options={AI_OVERVIEW_CHART_OPTIONS}
          />
        </div>
        {renderOverviewChartCard(mobileChartKey)}
      </div>

      <div className="ai-reviewer-desktop-chart-stack">
      {/* 图表行 1:每日审核量趋势(支持折线图/柱状图切换) */}
      <Card
        title="每日审核量趋势"
        extra={
          <Space size={8}>
            <Segmented
              size="small"
              value={trendDays}
              onChange={(v) => handleTrendDaysChange(v as 7 | 30)}
              options={[
                { label: '近 7 天', value: 7 },
                { label: '近 30 天', value: 30 },
              ]}
            />
            <Segmented
              size="small"
              value={trendChartType}
              onChange={(v) => setTrendChartType(v as 'line' | 'bar')}
              options={[
                { label: '折线图', value: 'line', icon: <LineChartOutlined /> },
                { label: '柱状图', value: 'bar', icon: <BarChartOutlined /> },
              ]}
            />
          </Space>
        }
      >
        <Spin spinning={trendLoading}>
          <ResponsiveContainer width="100%" height={280}>
            {trendChartType === 'line' ? (
              <LineChart data={trend} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f2f7" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="pass" name="PASS" stroke="#22c55e" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="needHuman" name="人工复核" stroke="#f59e0b" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="reject" name="REJECT" stroke="#ef4444" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="total" name="总量" stroke="var(--lh-primary)" strokeWidth={2} strokeDasharray="5 5" dot={false} />
              </LineChart>
            ) : (
              <BarChart
                data={trend}
                margin={{ top: 10, right: 12, left: -12, bottom: 0 }}
                barGap={2}
                barCategoryGap="24%"
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f2f7" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <Tooltip
                  cursor={{ fill: 'rgba(47, 123, 255, 0.04)' }}
                  contentStyle={{ borderRadius: 10, border: '1px solid #eef0f5', fontSize: 12 }}
                />
                <Bar dataKey="pass" name="PASS" fill="#22c55e" radius={[3, 3, 0, 0]} maxBarSize={14} />
                <Bar dataKey="needHuman" name="人工复核" fill="#f59e0b" radius={[3, 3, 0, 0]} maxBarSize={14} />
                <Bar dataKey="reject" name="REJECT" fill="#ef4444" radius={[3, 3, 0, 0]} maxBarSize={14} />
                <Bar dataKey="total" name="总量" fill="#94a3b8" radius={[3, 3, 0, 0]} maxBarSize={14} />
              </BarChart>
            )}
          </ResponsiveContainer>
          {trendChartType === 'bar' && (
            <div className="bar-legend">
              <span><i className="dot" style={{ background: '#22c55e' }} />PASS</span>
              <span><i className="dot" style={{ background: '#f59e0b' }} />人工复核</span>
              <span><i className="dot" style={{ background: '#ef4444' }} />REJECT</span>
              <span><i className="dot" style={{ background: '#94a3b8' }} />总量</span>
            </div>
          )}
        </Spin>
      </Card>

      {/* 图表行 2:决策分布环状图 + AI 通过率圆环 + 处理效率 */}
      <Row gutter={16}>
        {/* 决策分布:左圆环 + 右图例(参考 Owner 看板 ReviewDistributionCard) */}
        <Col xs={24} lg={10}>
          <Card title="决策分布" loading={loading} className="ai-overview-chart-card">
            <Row gutter={[8, 8]} align="middle" style={{ paddingTop: 8 }}>
              <Col xs={24} md={13}>
                <div style={{ position: 'relative', width: '100%', height: 200 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={decisions}
                        dataKey="count"
                        nameKey="decision"
                        cx="50%"
                        cy="50%"
                        innerRadius={58}
                        outerRadius={80}
                        paddingAngle={2}
                        stroke="none"
                      >
                        {decisions.map((entry) => (
                          <Cell key={entry.decision} fill={DECISION_COLORS[entry.decision] ?? '#94a3b8'} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ borderRadius: 10, border: '1px solid #eef0f5', fontSize: 12 }}
                        formatter={(value, name) => [value as number, decisionLabel(String(name))]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="donut-center-text">
                    <div className="donut-center-total">
                      {decisions.reduce((s, d) => s + d.count, 0)}
                    </div>
                    <div className="donut-center-sub">Total</div>
                  </div>
                </div>
              </Col>
              <Col xs={24} md={11}>
                <ul className="donut-legend">
                  {decisions.map((d) => {
                    const total = decisions.reduce((s, x) => s + x.count, 0);
                    const ratio = total === 0 ? 0 : (d.count / total) * 100;
                    return (
                      <li key={d.decision}>
                        <span
                          className="donut-dot"
                          style={{ background: DECISION_COLORS[d.decision] ?? '#94a3b8' }}
                        />
                        <span className="donut-percent">{ratio.toFixed(0)}%</span>
                        <span className="donut-label">{decisionLabel(d.decision)}</span>
                      </li>
                    );
                  })}
                </ul>
              </Col>
            </Row>
          </Card>
        </Col>

        {/* AI 通过率:圆环 + 中心大字 + 下方说明 */}
        <Col xs={24} lg={8}>
          <Card title="AI 通过率" loading={loading} className="ai-overview-chart-card">
            <div style={{ position: 'relative', width: '100%', height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <RadialBarChart
                  cx="50%"
                  cy="50%"
                  innerRadius="68%"
                  outerRadius="92%"
                  data={passRateData}
                  startAngle={90}
                  endAngle={-270}
                >
                  <RadialBar dataKey="value" cornerRadius={12} background={{ fill: '#f1f5f9' }} />
                </RadialBarChart>
              </ResponsiveContainer>
              <div className="donut-center-text">
                <div className="ai-overview-pass-rate">
                  {Math.round((kpi?.passRate ?? 0) * 100)}%
                </div>
                <div className="donut-center-sub">PASS 占比</div>
              </div>
            </div>
            <div className="ai-overview-pass-foot">
              <span>
                成功 <strong>{kpi?.succeededJobs ?? 0}</strong>
              </span>
              <span style={{ color: '#cbd5e1' }}>·</span>
              <span>
                总数 <strong>{kpi?.totalJobs ?? 0}</strong>
              </span>
            </div>
          </Card>
        </Col>

        {/* 处理效率:左右两个迷你指标卡 */}
        <Col xs={24} lg={6}>
          <Card title="处理效率" loading={loading} className="ai-overview-chart-card">
            <div className="ai-overview-eff-grid">
              <div className="ai-overview-eff-cell">
                <ClockCircleOutlined className="ai-overview-eff-icon is-clock" />
                <div className="ai-overview-eff-value">
                  {kpi?.avgDurationSec ? `${Math.round(kpi.avgDurationSec)}s` : '-'}
                </div>
                <div className="ai-overview-eff-label">平均处理时长</div>
              </div>
              <div className="ai-overview-eff-cell">
                <CheckCircleFilled className="ai-overview-eff-icon is-success" />
                <div className="ai-overview-eff-value">{kpi?.succeededJobs ?? 0}</div>
                <div className="ai-overview-eff-label">已完成审核</div>
              </div>
            </div>
          </Card>
        </Col>
      </Row>

      {/* 图表行 3:任务维度柱状图 */}
      <Card title="任务审核量对比" loading={loading} className="ai-overview-chart-card">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={taskVolumes} margin={{ top: 10, right: 30, left: 0, bottom: 0 }} barCategoryGap="32%">
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f2f7" vertical={false} />
            <XAxis
              dataKey="taskTitle"
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              axisLine={{ stroke: '#e2e8f0' }}
              tickLine={false}
            />
            <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
            <Tooltip
              cursor={{ fill: 'rgba(47, 123, 255, 0.04)' }}
              contentStyle={{ borderRadius: 10, border: '1px solid #eef0f5', fontSize: 12 }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="pass" name="通过" stackId="a" fill="#22c55e" maxBarSize={32} />
            <Bar dataKey="needHuman" name="人工复核" stackId="a" fill="#a855f7" maxBarSize={32} />
            <Bar dataKey="reject" name="打回" stackId="a" fill="#ef4444" maxBarSize={32} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>
      </div>
    </AiReviewerShell>
  );
}

/* ============ 工具函数:从 jobs 列表本地计算仪表盘数据(后端未实现时回落) ============ */

function computeKpiFromJobs(jobs: AiReviewJob[]): AiDashboardKpi {
  const total = jobs.length;
  const succeeded = jobs.filter((j) => j.status === 'success').length;
  const failed = jobs.filter((j) => j.status === 'failed').length;
  const pending = jobs.filter((j) => j.status === 'pending').length;
  const running = jobs.filter((j) => j.status === 'running').length;
  const needHuman = jobs.filter((j) => j.decision === 'NEED_HUMAN_REVIEW').length;
  const passCount = jobs.filter((j) => j.decision === 'PASS').length;
  const passRate = succeeded > 0 ? passCount / succeeded : 0;
  return {
    totalJobs: total,
    succeededJobs: succeeded,
    failedJobs: failed,
    pendingJobs: pending,
    runningJobs: running,
    needHumanJobs: needHuman,
    passRate,
    avgDurationSec: 0, // 无法从 jobs 列表计算
  };
}

function computeDecisionsFromJobs(jobs: AiReviewJob[]): AiDecisionDistribution[] {
  const pass = jobs.filter((j) => j.decision === 'PASS').length;
  const needHuman = jobs.filter((j) => j.decision === 'NEED_HUMAN_REVIEW').length;
  const reject = jobs.filter((j) => j.decision === 'REJECT').length;
  return [
    { decision: 'PASS', count: pass },
    { decision: 'NEED_HUMAN_REVIEW', count: needHuman },
    { decision: 'REJECT', count: reject },
  ];
}

function computeTrendFromJobs(jobs: AiReviewJob[], days: number): AiDailyTrend[] {
  // 按 createdAt 日期分组(简化:只取日期前 10 位)
  const map = new Map<string, AiDailyTrend>();
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    map.set(key, { date: key, total: 0, pass: 0, needHuman: 0, reject: 0 });
  }
  for (const job of jobs) {
    const dateStr = (job.createdAt ?? '').slice(0, 10);
    const entry = map.get(dateStr);
    if (!entry) continue;
    entry.total += 1;
    if (job.decision === 'PASS') entry.pass += 1;
    else if (job.decision === 'NEED_HUMAN_REVIEW') entry.needHuman += 1;
    else if (job.decision === 'REJECT') entry.reject += 1;
  }
  return Array.from(map.values());
}

function computeTaskVolumesFromJobs(jobs: AiReviewJob[]): AiTaskVolume[] {
  const map = new Map<string, AiTaskVolume>();
  for (const job of jobs) {
    const key = job.taskId;
    let entry = map.get(key);
    if (!entry) {
      entry = { taskId: key, taskTitle: job.taskTitle || key, total: 0, pass: 0, needHuman: 0, reject: 0 };
      map.set(key, entry);
    }
    entry.total += 1;
    if (job.decision === 'PASS') entry.pass += 1;
    else if (job.decision === 'NEED_HUMAN_REVIEW') entry.needHuman += 1;
    else if (job.decision === 'REJECT') entry.reject += 1;
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total).slice(0, 10);
}

function decisionLabel(decision: string): string {
  if (decision === 'PASS') return '通过';
  if (decision === 'NEED_HUMAN_REVIEW') return '人工复核';
  if (decision === 'REJECT') return '打回';
  return decision;
}
