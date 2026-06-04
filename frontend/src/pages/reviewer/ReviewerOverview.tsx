import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRightOutlined,
  AuditOutlined,
  BarChartOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  DownloadOutlined,
  ExclamationCircleFilled,
  LineChartOutlined,
} from '@ant-design/icons';
import {
  App as AntdApp,
  Button,
  Card,
  Col,
  Empty,
  Progress,
  Row,
  Segmented,
  Space,
  Tag,
  Typography,
} from 'antd';
import { useNavigate } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { AiAssistantIcon } from '../../components/icons';

import { reviewerApi } from '../../api/reviewer';
import type { ReviewBatch, ReviewerOverview as ReviewerOverviewMeta } from '../../types/reviewer';
import { useThemeColors } from '../../theme/useThemeColors';

/**
 * Reviewer 工作概览。
 * 计划书 4.5 / 4.6:展示待审批次、今日审核流转、抽检覆盖、争议样本、AI 通过率与一致率。
 */

const sampleOverview: ReviewerOverviewMeta = {
  rangeDays: 30,
  pendingBatches: 7,
  todayApproved: 112,
  todayReturned: 9,
  todayDisputes: 2,
  reviewedTotal: 1840,
  consistencyRate: 0.94,
  samplingCoverage: 0.12,
};

type ReviewerReportTrendPoint = {
  date: string;
  pass: number;
  return: number;
  dispute: number;
  total: number;
};

const reviewerReportTrend7: ReviewerReportTrendPoint[] = [
  { date: '2026-05-29', pass: 0, return: 0, dispute: 0, total: 0 },
  { date: '2026-05-30', pass: 30, return: 2, dispute: 1, total: 33 },
  { date: '2026-05-31', pass: 27, return: 7, dispute: 1, total: 35 },
  { date: '2026-06-01', pass: 5, return: 2, dispute: 0, total: 7 },
  { date: '2026-06-02', pass: 14, return: 1, dispute: 0, total: 15 },
  { date: '2026-06-03', pass: 0, return: 0, dispute: 0, total: 0 },
  { date: '2026-06-04', pass: 0, return: 0, dispute: 0, total: 0 },
];

const reviewerReportTrend30: ReviewerReportTrendPoint[] = Array.from({ length: 30 }, (_, index) => {
  const date = new Date(Date.UTC(2026, 4, 6 + index)).toISOString().slice(0, 10);
  const pass = index % 7 === 0 ? 0 : 8 + ((index * 7) % 18);
  const returned = index % 6 === 0 ? 1 : (index * 3) % 6;
  const dispute = index % 9 === 0 ? 2 : index % 5 === 0 ? 1 : 0;
  return {
    date,
    pass,
    return: returned,
    dispute,
    total: pass + returned + dispute,
  };
});

const reviewerReportTrendColors = {
  pass: '#22c55e',
  return: '#f59e0b',
  dispute: '#ef4444',
  total: '#94a3b8',
};

export default function ReviewerOverview() {
  const navigate = useNavigate();
  const themeColors = useThemeColors();
  const { message } = AntdApp.useApp();
  const [overview, setOverview] = useState<ReviewerOverviewMeta>(sampleOverview);
  const [batches, setBatches] = useState<ReviewBatch[]>([]);
  const [usingFallback, setUsingFallback] = useState(true);
  const [loading, setLoading] = useState(true);
  const [reportDays, setReportDays] = useState<7 | 30>(7);
  const [reportChartType, setReportChartType] = useState<'line' | 'bar'>('bar');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [ov, bt] = await Promise.all([
          reviewerApi.getOverview(),
          reviewerApi.listBatches({ status: 'pending', page: 1, pageSize: 5 }),
        ]);
        if (cancelled) return;
        setOverview(ov);
        setBatches(bt.items ?? []);
        setUsingFallback(false);
      } catch {
        try {
          const res = await fetch('/sample-datasets/reviewer-batches.json');
          const data = await res.json();
          if (cancelled) return;
          const items = (data.items as ReviewBatch[]).filter(
            (b) => b.status === 'pending' || b.status === 'in_review',
          );
          setBatches(items);
        } catch {
          // ignore
        }
        if (!cancelled) setUsingFallback(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const kpis = useMemo(
    () => [
      {
        key: 'pending',
        icon: <AuditOutlined />,
        title: '待审批次',
        value: overview.pendingBatches,
        accent: '#2f7bff',
      },
      {
        key: 'approved',
        icon: <CheckCircleFilled />,
        title: '今日通过',
        value: overview.todayApproved,
        accent: '#22c55e',
      },
      {
        key: 'returned',
        icon: <CloseCircleFilled />,
        title: '今日驳回',
        value: overview.todayReturned,
        accent: '#f59e0b',
      },
      {
        key: 'disputes',
        icon: <ExclamationCircleFilled />,
        title: '今日争议',
        value: overview.todayDisputes,
        accent: '#ef4444',
      },
    ],
    [overview],
  );

  const reportStats = useMemo(() => {
    const reviewedToday = overview.todayApproved + overview.todayReturned + overview.todayDisputes;
    const approveRate = reviewedToday === 0 ? 0 : overview.todayApproved / reviewedToday;
    const returnRate = reviewedToday === 0 ? 0 : overview.todayReturned / reviewedToday;
    const disputeRate = reviewedToday === 0 ? 0 : overview.todayDisputes / reviewedToday;
    return [
      {
        key: 'approve',
        label: '通过率',
        value: `${(approveRate * 100).toFixed(1)}%`,
        color: '#22c55e',
        icon: <CheckCircleFilled />,
      },
      {
        key: 'return',
        label: '打回率',
        value: `${(returnRate * 100).toFixed(1)}%`,
        color: '#f59e0b',
        icon: <CloseCircleFilled />,
      },
      {
        key: 'dispute',
        label: '争议率',
        value: `${(disputeRate * 100).toFixed(1)}%`,
        color: '#ef4444',
        icon: <ExclamationCircleFilled />,
      },
      {
        key: 'ai',
        label: 'AI 一致率',
        value: `${(overview.consistencyRate * 100).toFixed(1)}%`,
        color: '#2f7bff',
        icon: <AiAssistantIcon />,
      },
    ];
  }, [overview]);

  const reportTrendData = reportDays === 7 ? reviewerReportTrend7 : reviewerReportTrend30;

  function handleExportDetails() {
    message.info('审核明细导出接口已预留，后端接入后可导出 CSV。');
  }

  return (
    <Space direction="vertical" size="large" className="page-stack reviewer-overview">
      <div className="page-title-row">
        <Space direction="vertical" size={4}>
          <Typography.Title level={3}>审核员工作台</Typography.Title>
          <Typography.Text type="secondary">
            审核标注结果、处理争议样本,并沉淀质量反馈。状态机:SUBMITTED → AI_REVIEWING → REVIEWING → APPROVED / RETURNED。
          </Typography.Text>
        </Space>
        <Space>
          {usingFallback && <Tag color="gold">演示模式 · 接口未连接</Tag>}
          <Button type="primary" onClick={() => navigate('/reviewer/ai')}>
            领取审核任务
          </Button>
        </Space>
      </div>

      {/* 4 张 KPI */}
      <Row gutter={[16, 16]}>
        {kpis.map((k) => (
          <Col xs={12} md={6} key={k.key}>
            <Card className="reviewer-kpi">
              <div
                className="reviewer-kpi-icon"
                style={{ background: `${k.accent}15`, color: k.accent }}
              >
                {k.icon}
              </div>
              <div className="reviewer-kpi-value">{k.value}</div>
              <div className="reviewer-kpi-title">{k.title}</div>
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={15}>
          <Card
            title="待审队列"
            extra={
              <Button type="link" onClick={() => navigate('/reviewer/ai')}>
                查看全部 <ArrowRightOutlined />
              </Button>
            }
          >
            {loading ? (
              <div className="market-loading">加载待审批次...</div>
            ) : batches.length === 0 ? (
              <Empty description="暂时没有待审批次" />
            ) : (
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                {batches.slice(0, 4).map((batch) => {
                  const ratio =
                    batch.pending + batch.reviewed === 0
                      ? 0
                      : Math.round((batch.reviewed / (batch.pending + batch.reviewed)) * 100);
                  return (
                    <div key={batch.batchId} className="reviewer-batch-row">
                      <div className="reviewer-batch-head">
                        <Space size={8}>
                          <span className="reviewer-batch-title">{batch.taskTitle}</span>
                          <Tag className="reviewer-batch-type">{batch.taskType}</Tag>
                        </Space>
                        <Button
                          type="primary"
                          size="small"
                          onClick={() =>
                            navigate(`/reviewer/ai/${encodeURIComponent(batch.taskId)}`)
                          }
                        >
                          开始审核
                        </Button>
                      </div>
                      <div className="reviewer-batch-meta">
                        待审 <strong>{batch.pending}</strong> · 已审 {batch.reviewed} ·
                        其中 <strong>{batch.needHumanReview}</strong> 条 AI 标记需人工 · 抽检{' '}
                        {(batch.samplingRatio * 100).toFixed(0)}%
                      </div>
                      <Progress
                        percent={ratio}
                        showInfo={false}
                        size="small"
                        strokeColor={themeColors.progress}
                      />
                    </div>
                  );
                })}
              </Space>
            )}
          </Card>
        </Col>

        <Col xs={24} xl={9}>
          <Card title="质量指标">
            <Space direction="vertical" size={14} style={{ width: '100%' }}>
              <QualityRow
                label="双审一致率"
                value={`${(overview.consistencyRate * 100).toFixed(1)}%`}
                ratio={overview.consistencyRate}
                color="#22c55e"
              />
              <QualityRow
                label="抽检覆盖率"
                value={`${(overview.samplingCoverage * 100).toFixed(0)}%`}
                ratio={overview.samplingCoverage}
                color="#2f7bff"
              />
              <QualityRow
                label="累计已审"
                value={overview.reviewedTotal.toLocaleString()}
                ratio={Math.min(1, overview.reviewedTotal / 5000)}
                color="#a855f7"
              />
            </Space>
          </Card>
        </Col>
      </Row>

      <Card
        title="审核报表"
        extra={
          <Button type="primary" icon={<DownloadOutlined />} onClick={handleExportDetails}>
            导出审核明细
          </Button>
        }
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Row gutter={[16, 16]}>
            {reportStats.map((stat) => (
              <Col xs={12} md={6} key={stat.key}>
                <Card className="reviewer-kpi reviewer-report-kpi">
                  <div
                    className="reviewer-kpi-icon"
                    style={{ background: `${stat.color}15`, color: stat.color }}
                  >
                    {stat.icon}
                  </div>
                  <div className="reviewer-kpi-value">{stat.value}</div>
                  <div className="reviewer-kpi-title">{stat.label}</div>
                </Card>
              </Col>
            ))}
          </Row>

          <Card
            title="每日审核量趋势"
            extra={
              <Space size={8}>
                <Segmented
                  size="small"
                  value={reportDays}
                  onChange={(v) => setReportDays(v as 7 | 30)}
                  options={[
                    { label: '近 7 天', value: 7 },
                    { label: '近 30 天', value: 30 },
                  ]}
                />
                <Segmented
                  size="small"
                  value={reportChartType}
                  onChange={(v) => setReportChartType(v as 'line' | 'bar')}
                  options={[
                    { label: '折线图', value: 'line', icon: <LineChartOutlined /> },
                    { label: '柱状图', value: 'bar', icon: <BarChartOutlined /> },
                  ]}
                />
              </Space>
            }
          >
            <ResponsiveContainer width="100%" height={280}>
              {reportChartType === 'line' ? (
                <LineChart data={reportTrendData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f2f7" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="pass"
                    name="通过"
                    stroke={reviewerReportTrendColors.pass}
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="return"
                    name="打回"
                    stroke={reviewerReportTrendColors.return}
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="dispute"
                    name="争议"
                    stroke={reviewerReportTrendColors.dispute}
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="total"
                    name="总量"
                    stroke={reviewerReportTrendColors.total}
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={false}
                  />
                </LineChart>
              ) : (
                <BarChart
                  data={reportTrendData}
                  margin={{ top: 10, right: 12, left: -12, bottom: 0 }}
                  barGap={2}
                  barCategoryGap="24%"
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f2f7" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 12, fill: '#94a3b8' }}
                    axisLine={{ stroke: '#e2e8f0' }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 12, fill: '#94a3b8' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(47, 123, 255, 0.04)' }}
                    contentStyle={{ borderRadius: 10, border: '1px solid #eef0f5', fontSize: 12 }}
                  />
                  <Bar
                    dataKey="pass"
                    name="通过"
                    fill={reviewerReportTrendColors.pass}
                    radius={[3, 3, 0, 0]}
                    maxBarSize={14}
                  />
                  <Bar
                    dataKey="return"
                    name="打回"
                    fill={reviewerReportTrendColors.return}
                    radius={[3, 3, 0, 0]}
                    maxBarSize={14}
                  />
                  <Bar
                    dataKey="dispute"
                    name="争议"
                    fill={reviewerReportTrendColors.dispute}
                    radius={[3, 3, 0, 0]}
                    maxBarSize={14}
                  />
                  <Bar
                    dataKey="total"
                    name="总量"
                    fill={reviewerReportTrendColors.total}
                    radius={[3, 3, 0, 0]}
                    maxBarSize={14}
                  />
                </BarChart>
              )}
            </ResponsiveContainer>
            {reportChartType === 'bar' && (
              <div className="bar-legend">
                <span>
                  <i className="dot" style={{ background: reviewerReportTrendColors.pass }} />通过
                </span>
                <span>
                  <i className="dot" style={{ background: reviewerReportTrendColors.return }} />打回
                </span>
                <span>
                  <i className="dot" style={{ background: reviewerReportTrendColors.dispute }} />争议
                </span>
                <span>
                  <i className="dot" style={{ background: reviewerReportTrendColors.total }} />总量
                </span>
              </div>
            )}
          </Card>
        </Space>
      </Card>
    </Space>
  );
}

function QualityRow({
  label,
  value,
  ratio,
  color,
}: {
  label: string;
  value: string;
  ratio: number;
  color: string;
}) {
  return (
    <div>
      <div className="reviewer-quality-label">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <div className="reviewer-quality-bar">
        <span style={{ width: `${ratio * 100}%`, background: color }} />
      </div>
    </div>
  );
}
