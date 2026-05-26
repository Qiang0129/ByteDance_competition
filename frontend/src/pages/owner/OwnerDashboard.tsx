import { useEffect, useState } from 'react';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  BellOutlined,
  ClockCircleOutlined,
  DownloadOutlined,
  FlagOutlined,
  MoreOutlined,
  PlusOutlined,
  ProjectOutlined,
  RiseOutlined,
  RobotOutlined,
  SearchOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import {
  App as AntdApp,
  Avatar,
  Button,
  Card,
  Col,
  Input,
  Row,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';

import { dashboardApi } from '../../api/dashboard';
import type {
  DashboardOverview,
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
 *   - 接口接入 dashboardApi(全部留好,后端未实现时回落到样例数据)
 */

interface FallbackDashboard {
  overview: DashboardOverview;
  taskProgress: TaskProgress[];
  review: ReviewDistribution;
  performance: LabelerPerformance[];
  timeline: SubmissionTimelineMonth[];
  activities: RecentTaskActivity[];
  roles: RoleBreakdown[];
}

const sampleDashboard: FallbackDashboard = {
  overview: {
    rangeStart: '2026-04-25',
    rangeEnd: '2026-05-25',
    kpis: {
      activeTasks: 12,
      activeLabelers: 38,
      pendingReview: 126,
      submittedToday: 776,
      aiPassRate: 0.871,
      avgDurationSec: 18,
      deltas: {
        activeTasks: 5,
        activeLabelers: 3.2,
        pendingReview: -2,
        submittedToday: 8,
        aiPassRate: 1.4,
        avgDurationSec: -8,
      },
    },
  },
  taskProgress: [
    { taskId: 'T-2041', title: '商品标题清洗 v3', total: 380, approved: 240, returned: 60, pending: 80 },
    { taskId: 'T-2039', title: '短视频脚本对比', total: 260, approved: 180, returned: 30, pending: 50 },
    { taskId: 'T-2055', title: '交通标志 V4', total: 300, approved: 200, returned: 40, pending: 60 },
    { taskId: 'T-2058', title: '图文摘要质检', total: 240, approved: 160, returned: 20, pending: 60 },
    { taskId: 'T-2061', title: '客服安全合规', total: 200, approved: 130, returned: 40, pending: 30 },
    { taskId: 'T-2063', title: 'AIGC 图文打分', total: 350, approved: 220, returned: 60, pending: 70 },
    { taskId: 'T-2066', title: '视频字幕对齐', total: 280, approved: 190, returned: 30, pending: 60 },
    { taskId: 'T-2068', title: '电商问答评估', total: 320, approved: 220, returned: 40, pending: 60 },
    { taskId: 'T-2070', title: '安全 Prompt 审核', total: 240, approved: 160, returned: 30, pending: 50 },
  ],
  review: {
    aiPass: 64,
    aiNeedHuman: 18,
    aiReject: 6,
    humanPass: 9,
    humanReturned: 3,
  },
  performance: [
    { labelerId: 'L-001', name: 'Olivia Clark', role: 'QA Quality 主力', score: 0.83, submitted: 320, approved: 268, returned: 12, avgDurationSec: 14 },
    { labelerId: 'L-002', name: 'Michael Davis', role: 'Preference Compare', score: 0.37, submitted: 180, approved: 67, returned: 30, avgDurationSec: 22 },
    { labelerId: 'L-003', name: 'Wei Lan', role: 'Image Classification', score: 0.46, submitted: 220, approved: 102, returned: 40, avgDurationSec: 19 },
    { labelerId: 'L-004', name: 'David Wilson', role: 'Safety Tagging', score: 0.64, submitted: 280, approved: 180, returned: 28, avgDurationSec: 16 },
  ],
  timeline: [
    { month: 'Jan', onTime: 60, late: 20, absent: 20 },
    { month: 'Feb', onTime: 64, late: 18, absent: 18 },
    { month: 'Mar', onTime: 68, late: 18, absent: 14 },
    { month: 'Apr', onTime: 70, late: 16, absent: 14 },
    { month: 'May', onTime: 72, late: 14, absent: 14 },
    { month: 'Jun', onTime: 74, late: 14, absent: 12 },
    { month: 'Jul', onTime: 78, late: 12, absent: 10 },
    { month: 'Aug', onTime: 80, late: 10, absent: 10 },
    { month: 'Sep', onTime: 82, late: 10, absent: 8 },
    { month: 'Oct', onTime: 84, late: 8, absent: 8 },
    { month: 'Nov', onTime: 86, late: 8, absent: 6 },
    { month: 'Dec', onTime: 88, late: 6, absent: 6 },
  ],
  activities: [
    { taskId: 'T-2041', taskTitle: '商品标题清洗 v3', ownerName: 'Sophia Hall', status: 'pending', updatedAt: '今天 14:32' },
    { taskId: 'T-2039', taskTitle: '短视频脚本对齐评测', ownerName: 'Emma Smith', status: 'approved', updatedAt: '今天 11:08' },
    { taskId: 'T-2055', taskTitle: '图像分类 · 交通标志 V4', ownerName: 'Olivia Clark', status: 'rejected', updatedAt: '昨天 18:01' },
    { taskId: 'T-2058', taskTitle: '图文摘要质检', ownerName: 'Ava Lewis', status: 'pending', updatedAt: '昨天 16:42' },
    { taskId: 'T-2063', taskTitle: 'AIGC 图文质量打分', ownerName: 'Isabella Walker', status: 'approved', updatedAt: '昨天 09:55' },
  ],
  roles: [
    { role: 'QA Quality', memberCount: 14 },
    { role: 'Preference', memberCount: 9 },
    { role: 'Image Class.', memberCount: 7 },
    { role: 'Safety Tagging', memberCount: 5 },
    { role: 'AIGC 评估', memberCount: 3 },
  ],
};

const reviewLabels: Array<{ key: keyof ReviewDistribution; label: string; color: string }> = [
  { key: 'aiPass', label: 'AI 通过', color: '#2f7bff' },
  { key: 'aiNeedHuman', label: '需人工复核', color: '#a855f7' },
  { key: 'aiReject', label: 'AI 拒绝', color: '#ef4444' },
  { key: 'humanPass', label: '人工通过', color: '#22c55e' },
  { key: 'humanReturned', label: '打回修改', color: '#f59e0b' },
];

const roleColors = ['#2f7bff', '#22c55e', '#f59e0b', '#a855f7', '#ef4444'];

export default function OwnerDashboard() {
  const [data, setData] = useState<FallbackDashboard>(sampleDashboard);
  const [usingFallback, setUsingFallback] = useState(true);
  const [range, setRange] = useState<'7d' | '30d' | '90d'>('30d');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [overview, taskProgress, review, performance, timeline, activities, roles] =
          await Promise.all([
            dashboardApi.getOverview(range),
            dashboardApi.getTaskProgress(),
            dashboardApi.getReviewDistribution(range),
            dashboardApi.getLabelerPerformance(range),
            dashboardApi.getSubmissionTimeline(),
            dashboardApi.getRecentActivities(),
            dashboardApi.getRoleBreakdown(),
          ]);
        if (cancelled) return;
        setData({
          overview,
          taskProgress: taskProgress.items ?? [],
          review,
          performance: performance.items ?? [],
          timeline: timeline.items ?? [],
          activities: activities.items ?? [],
          roles: roles.items ?? [],
        });
        setUsingFallback(false);
      } catch {
        if (!cancelled) setUsingFallback(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [range]);

  return (
    <Space direction="vertical" size="large" className="page-stack dashboard-page">
      <DashboardHeader
        overview={data.overview}
        range={range}
        onRangeChange={setRange}
        usingFallback={usingFallback}
      />

      <KpiRow overview={data.overview} />

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={15}>
          <TaskProgressCard items={data.taskProgress} />
        </Col>
        <Col xs={24} xl={9}>
          <ReviewDistributionCard distribution={data.review} />
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
          <DisputeStatsCard />
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
    </Space>
  );
}

function DashboardHeader({
  overview,
  range,
  onRangeChange,
  usingFallback,
}: {
  overview: DashboardOverview;
  range: '7d' | '30d' | '90d';
  onRangeChange: (v: '7d' | '30d' | '90d') => void;
  usingFallback: boolean;
}) {
  return (
    <div className="page-title-row">
      <Space direction="vertical" size={4}>
        <Typography.Title level={3}>数据看板</Typography.Title>
        <Typography.Text type="secondary">
          统计周期:{overview.rangeStart} ~ {overview.rangeEnd}
        </Typography.Text>
      </Space>
      <Space>
        {usingFallback && <Tag color="gold">演示模式 · 接口未连接</Tag>}
        <Segmented
          options={[
            { label: '近 7 日', value: '7d' },
            { label: '近 30 日', value: '30d' },
            { label: '近 90 日', value: '90d' },
          ]}
          value={range}
          onChange={(v) => onRangeChange(v as '7d' | '30d' | '90d')}
        />
        <Button type="primary" icon={<PlusOutlined />}>
          发布公告
        </Button>
      </Space>
    </div>
  );
}

/* ============ KPI 卡 ============ */
function KpiRow({ overview }: { overview: DashboardOverview }) {
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
      icon: <RobotOutlined />,
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
              发布公告
            </Typography.Text>
            <Typography.Paragraph type="secondary" className="dashboard-announce-desc">
              发送任务变更或质检规范提醒。
            </Typography.Paragraph>
            <Button size="small" icon={<BellOutlined />}>
              立即发布
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

/* ============ 任务进度柱状图 ============ */
function TaskProgressCard({ items }: { items: TaskProgress[] }) {
  const maxBarValue = Math.max(...items.flatMap((it) => [it.approved, it.returned, it.pending]), 100);
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
      <div className="bar-chart">
        <div className="bar-chart-y">
          {[100, 80, 60, 40, 20, 0].map((tick) => (
            <span key={tick}>{Math.round((tick / 100) * maxBarValue)}</span>
          ))}
        </div>
        <div className="bar-chart-area">
          {items.map((it) => (
            <div key={it.taskId} className="bar-group" title={`${it.title} · 共 ${it.total} 条`}>
              <div className="bar-stack">
                <div
                  className="bar-seg approved"
                  style={{ height: `${(it.approved / maxBarValue) * 100}%` }}
                />
              </div>
              <div className="bar-stack">
                <div
                  className="bar-seg returned"
                  style={{ height: `${(it.returned / maxBarValue) * 100}%` }}
                />
              </div>
              <div className="bar-stack">
                <div
                  className="bar-seg pending"
                  style={{ height: `${(it.pending / maxBarValue) * 100}%` }}
                />
              </div>
              <div className="bar-label">{it.taskId.replace('T-', '')}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="bar-legend">
        <span><i className="dot" style={{ background: '#22c55e' }} />通过</span>
        <span><i className="dot" style={{ background: '#f59e0b' }} />打回</span>
        <span><i className="dot" style={{ background: '#94a3b8' }} />待处理</span>
      </div>
    </Card>
  );
}

/* ============ AI 审核分布(环形图) ============ */
function ReviewDistributionCard({ distribution }: { distribution: ReviewDistribution }) {
  const total = reviewLabels.reduce((sum, item) => sum + (distribution[item.key] ?? 0), 0);
  const strokeWidth = 14;
  const radius = 64;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <Card
      className="dashboard-card"
      title="AI 审核分布"
      extra={
        <Select
          size="small"
          defaultValue="2026"
          options={[
            { label: '2026', value: '2026' },
            { label: '2025', value: '2025' },
          ]}
          style={{ width: 80 }}
        />
      }
    >
      <Row gutter={[8, 8]} align="middle">
        <Col xs={24} md={12}>
          <div className="donut-wrapper">
            <svg viewBox="0 0 160 160" className="donut">
              <circle cx="80" cy="80" r={radius} fill="none" stroke="#f1f5f9" strokeWidth={strokeWidth} />
              {reviewLabels.map((seg) => {
                const value = distribution[seg.key] ?? 0;
                const length = (value / total) * circumference;
                const dash = `${length} ${circumference - length}`;
                const el = (
                  <circle
                    key={seg.key}
                    cx="80"
                    cy="80"
                    r={radius}
                    fill="none"
                    stroke={seg.color}
                    strokeWidth={strokeWidth}
                    strokeDasharray={dash}
                    strokeDashoffset={-offset}
                    strokeLinecap="butt"
                    transform="rotate(-90 80 80)"
                  />
                );
                offset += length;
                return el;
              })}
              <text x="80" y="78" textAnchor="middle" className="donut-total">
                {total}
              </text>
              <text x="80" y="96" textAnchor="middle" className="donut-sub">
                Total Reviews
              </text>
            </svg>
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
      <div className="dashboard-card-foot">
        <Typography.Text type="secondary" className="dashboard-foot-tip">
          周期内合计 {total} 条审核结果
        </Typography.Text>
        <Button type="primary" size="small" icon={<DownloadOutlined />}>
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
            <Avatar size={36} icon={<UserOutlined />} style={{ background: '#2f7bff' }} />
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
          <Avatar size={32} icon={<UserOutlined />} style={{ background: '#2f7bff' }} />
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

/* ============ 角色分布(环形) ============ */
function RoleDonutCard({ roles }: { roles: RoleBreakdown[] }) {
  const total = roles.reduce((sum, r) => sum + r.memberCount, 0);
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <Card className="dashboard-card" title="标注员角色分布">
      <div className="role-donut-wrap">
        <svg viewBox="0 0 140 140" className="donut">
          <circle cx="70" cy="70" r={radius} fill="none" stroke="#f1f5f9" strokeWidth={12} />
          {roles.map((role, idx) => {
            const length = (role.memberCount / total) * circumference;
            const el = (
              <circle
                key={role.role}
                cx="70"
                cy="70"
                r={radius}
                fill="none"
                stroke={roleColors[idx % roleColors.length]}
                strokeWidth={12}
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
                transform="rotate(-90 70 70)"
              />
            );
            offset += length;
            return el;
          })}
          <text x="70" y="68" textAnchor="middle" className="donut-total small">
            {total}
          </text>
          <text x="70" y="86" textAnchor="middle" className="donut-sub">
            Active
          </text>
        </svg>
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
function DisputeStatsCard() {
  // 计划书 4.5 / 4.6:抽检比例 + 双审一致率 + 争议数
  // 真实数据来自 GET /dashboard/disputes,演示数据展示 7/14/30 日趋势
  const sampling = 0.12; // 抽检比例
  const consistency = 0.94; // 双审一致率
  const disputed7 = 14;
  const disputed14 = 36;
  const disputed30 = 78;
  return (
    <Card className="dashboard-card" title="争议样本 & 抽检">
      <div className="dispute-grid">
        <div className="dispute-cell">
          <div className="dispute-label">抽检比例</div>
          <div className="dispute-value">{(sampling * 100).toFixed(0)}%</div>
          <div className="dispute-bar">
            <span style={{ width: `${sampling * 100}%`, background: '#2f7bff' }} />
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
          <strong>{disputed7}</strong>
        </div>
        <div className="dispute-trend-row">
          <span>近 14 日</span>
          <strong>{disputed14}</strong>
        </div>
        <div className="dispute-trend-row">
          <span>近 30 日</span>
          <strong>{disputed30}</strong>
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
            <Avatar size={36} icon={<UserOutlined />} style={{ background: '#2f7bff' }} />
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

/* ============ 月度提交时段(堆叠柱) ============ */
function SubmissionTimelineCard({ items }: { items: SubmissionTimelineMonth[] }) {
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
      <div className="bar-chart">
        <div className="bar-chart-y">
          {[100, 80, 60, 40, 20, 0].map((tick) => (
            <span key={tick}>{tick}%</span>
          ))}
        </div>
        <div className="bar-chart-area attendance">
          {items.map((it) => {
            const total = it.onTime + it.late + it.absent || 1;
            return (
              <div key={it.month} className="bar-group attendance-group">
                <div className="bar-stack attendance-stack">
                  <div
                    className="bar-seg absent"
                    style={{ height: `${(it.absent / total) * 100}%` }}
                  />
                  <div
                    className="bar-seg late"
                    style={{ height: `${(it.late / total) * 100}%` }}
                  />
                  <div
                    className="bar-seg ontime"
                    style={{ height: `${(it.onTime / total) * 100}%` }}
                  />
                </div>
                <div className="bar-label">{it.month}</div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="bar-legend">
        <span>
          <i className="dot" style={{ background: '#2f7bff' }} />准时
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
