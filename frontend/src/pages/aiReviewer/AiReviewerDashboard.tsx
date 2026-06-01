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

/** 决策颜色 */
const DECISION_COLORS: Record<string, string> = {
  PASS: '#22c55e',
  NEED_HUMAN_REVIEW: '#f59e0b',
  REJECT: '#ef4444',
};

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
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Space direction="vertical" size="large" className="page-stack ai-review-page">
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

  return (
    <AiReviewerShell
      title="AI 审核后台"
      description="AI Agent 作业运行统计、决策分布、趋势分析与任务维度对比。"
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
      <Row gutter={16} className="row-equal">
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

      {/* 图表行 2:决策分布环状图 + AI 通过率圆环 + 平均处理时长 */}
      <Row gutter={16}>
        <Col xs={24} lg={10}>
          <Card title="决策分布" loading={loading}>
            <Spin spinning={loading}>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={decisions}
                    dataKey="count"
                    nameKey="decision"
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={3}
                    label={({ name, value }) => `${decisionLabel(String(name))} ${value}`}
                  >
                    {decisions.map((entry) => (
                      <Cell key={entry.decision} fill={DECISION_COLORS[entry.decision] ?? '#94a3b8'} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value, name) => [value, decisionLabel(String(name))]} />
                  <Legend formatter={(value: string) => decisionLabel(value)} />
                </PieChart>
              </ResponsiveContainer>
            </Spin>
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title="AI 通过率" loading={loading}>
            <ResponsiveContainer width="100%" height={260}>
              <RadialBarChart
                cx="50%"
                cy="50%"
                innerRadius="60%"
                outerRadius="90%"
                data={passRateData}
                startAngle={90}
                endAngle={-270}
              >
                <RadialBar dataKey="value" cornerRadius={10} background={{ fill: '#f1f5f9' }} />
              </RadialBarChart>
            </ResponsiveContainer>
            <div style={{ textAlign: 'center', marginTop: -40, position: 'relative', zIndex: 1 }}>
              <Text style={{ fontSize: 32, fontWeight: 700, color: '#22c55e' }}>
                {Math.round((kpi?.passRate ?? 0) * 100)}%
              </Text>
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>PASS 占比</Text>
            </div>
          </Card>
        </Col>
        <Col xs={24} lg={6}>
          <Card title="处理效率" loading={loading}>
            <Space direction="vertical" size={24} style={{ width: '100%', paddingTop: 20 }}>
              <div style={{ textAlign: 'center' }}>
                <Text style={{ fontSize: 36, fontWeight: 700, color: '#1f2a44' }}>
                  {kpi?.avgDurationSec ? `${Math.round(kpi.avgDurationSec)}s` : '-'}
                </Text>
                <br />
                <Text type="secondary">平均处理时长</Text>
              </div>
              <div style={{ textAlign: 'center' }}>
                <Text style={{ fontSize: 36, fontWeight: 700, color: 'var(--lh-primary)' }}>
                  {kpi?.succeededJobs ?? 0}
                </Text>
                <br />
                <Text type="secondary">已完成审核</Text>
              </div>
            </Space>
          </Card>
        </Col>
      </Row>

      {/* 图表行 3:任务维度柱状图 */}
      <Card title="任务审核量对比" loading={loading}>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={taskVolumes} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f2f7" />
            <XAxis dataKey="taskTitle" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend />
            <Bar dataKey="pass" name="PASS" stackId="a" fill="#22c55e" radius={[0, 0, 0, 0]} />
            <Bar dataKey="needHuman" name="人工复核" stackId="a" fill="#f59e0b" />
            <Bar dataKey="reject" name="REJECT" stackId="a" fill="#ef4444" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>
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
