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
  Spin,
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

import { getApiErrorMessage } from '../../api/client';
import { reviewerApi } from '../../api/reviewer';
import type {
  ReviewBatch,
  ReviewerOverview as ReviewerOverviewMeta,
  ReviewerReportSummary,
} from '../../types/reviewer';
import { useThemeColors } from '../../theme/useThemeColors';

/**
 * Reviewer 工作概览。
 * 计划书 4.5 / 4.6:展示待审批次、今日审核流转、抽检覆盖、争议样本、AI 通过率与一致率。
 */

const emptyOverview: ReviewerOverviewMeta = {
  rangeDays: 30,
  pendingBatches: 0,
  todayApproved: 0,
  todayReturned: 0,
  todayDisputes: 0,
  reviewedTotal: 0,
  consistencyRate: 0,
  samplingCoverage: 0,
};

type ReviewerReportTrendPoint = {
  date: string;
  pass: number;
  return: number;
  dispute: number;
  total: number;
};

const reviewerReportTrendColors = {
  pass: '#22c55e',
  return: '#f59e0b',
  dispute: '#ef4444',
  total: '#94a3b8',
};

function mapReportTrend(summary: ReviewerReportSummary | null): ReviewerReportTrendPoint[] {
  return (summary?.trend ?? []).map((item) => ({
    date: item.label,
    pass: item.approve,
    return: item.return,
    dispute: item.dispute,
    total: item.approve + item.return + item.dispute,
  }));
}

export default function ReviewerOverview() {
  const navigate = useNavigate();
  const themeColors = useThemeColors();
  const { message } = AntdApp.useApp();
  const [overview, setOverview] = useState<ReviewerOverviewMeta>(emptyOverview);
  const [batches, setBatches] = useState<ReviewBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [reportSummary, setReportSummary] = useState<ReviewerReportSummary | null>(null);
  const [reportLoading, setReportLoading] = useState(true);
  const [reportExporting, setReportExporting] = useState(false);
  const [reportDays, setReportDays] = useState<7 | 30>(30);
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
      } catch (error) {
        if (cancelled) return;
        setOverview(emptyOverview);
        setBatches([]);
        message.warning(getApiErrorMessage(error, '审核员工作台加载失败'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [message]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setReportLoading(true);
      try {
        const summary = await reviewerApi.getReportSummary(reportDays);
        if (cancelled) return;
        setReportSummary(summary);
      } catch (error) {
        if (cancelled) return;
        setReportSummary(null);
        message.warning(getApiErrorMessage(error, '审核报表加载失败'));
      } finally {
        if (!cancelled) setReportLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [message, reportDays]);

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
    return [
      {
        key: 'approve',
        label: '通过率',
        value: reportSummary ? `${(reportSummary.approveRate * 100).toFixed(1)}%` : '-',
        color: '#22c55e',
        icon: <CheckCircleFilled />,
      },
      {
        key: 'return',
        label: '打回率',
        value: reportSummary ? `${(reportSummary.returnRate * 100).toFixed(1)}%` : '-',
        color: '#f59e0b',
        icon: <CloseCircleFilled />,
      },
      {
        key: 'dispute',
        label: '争议率',
        value: reportSummary ? `${(reportSummary.disputeRate * 100).toFixed(1)}%` : '-',
        color: '#ef4444',
        icon: <ExclamationCircleFilled />,
      },
      {
        key: 'ai',
        label: 'AI 一致率',
        value: reportSummary ? `${(reportSummary.aiConsistencyRate * 100).toFixed(1)}%` : '-',
        color: '#2f7bff',
        icon: <AiAssistantIcon />,
      },
    ];
  }, [reportSummary]);

  const reportTrendData = useMemo(() => mapReportTrend(reportSummary), [reportSummary]);

  async function handleExportDetails() {
    setReportExporting(true);
    try {
      const blob = await reviewerApi.exportReviewDetails({ rangeDays: reportDays, format: 'csv' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `reviewer-review-details-${reportDays}d.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      message.success('审核明细已开始下载');
    } catch (error) {
      message.error(getApiErrorMessage(error, '导出审核明细失败'));
    } finally {
      setReportExporting(false);
    }
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
              <div className="reviewer-kpi-value">{loading ? '-' : k.value}</div>
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
                value={loading ? '-' : `${(overview.consistencyRate * 100).toFixed(1)}%`}
                ratio={loading ? 0 : overview.consistencyRate}
                color="#22c55e"
              />
              <QualityRow
                label="抽检覆盖率"
                value={loading ? '-' : `${(overview.samplingCoverage * 100).toFixed(0)}%`}
                ratio={loading ? 0 : overview.samplingCoverage}
                color="#2f7bff"
              />
              <QualityRow
                label="累计已审"
                value={loading ? '-' : overview.reviewedTotal.toLocaleString()}
                ratio={loading ? 0 : Math.min(1, overview.reviewedTotal / 5000)}
                color="#a855f7"
              />
            </Space>
          </Card>
        </Col>
      </Row>

      <Card
        title="审核报表"
        extra={
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            loading={reportExporting}
            onClick={handleExportDetails}
          >
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
            <Spin spinning={reportLoading}>
              <div
                key={`${reportDays}-${reportChartType}`}
                className="reviewer-report-chart-transition"
              >
                {reportTrendData.length === 0 ? (
                  <div className="reviewer-report-empty">
                    <Empty description="暂无审核报表数据" />
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    {reportChartType === 'line' ? (
                      <LineChart
                        data={reportTrendData}
                        margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                      >
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
                          contentStyle={{
                            borderRadius: 10,
                            border: '1px solid #eef0f5',
                            fontSize: 12,
                          }}
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
                )}
              </div>
              {reportChartType === 'bar' && reportTrendData.length > 0 && (
                <div className="bar-legend">
                  <span>
                    <i className="dot" style={{ background: reviewerReportTrendColors.pass }} />
                    通过
                  </span>
                  <span>
                    <i className="dot" style={{ background: reviewerReportTrendColors.return }} />
                    打回
                  </span>
                  <span>
                    <i className="dot" style={{ background: reviewerReportTrendColors.dispute }} />
                    争议
                  </span>
                  <span>
                    <i className="dot" style={{ background: reviewerReportTrendColors.total }} />
                    总量
                  </span>
                </div>
              )}
            </Spin>
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
