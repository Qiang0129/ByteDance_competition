import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRightOutlined,
  AuditOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  ExclamationCircleFilled,
  RobotOutlined,
  ThunderboltFilled,
} from '@ant-design/icons';
import {
  App as AntdApp,
  Button,
  Card,
  Col,
  Empty,
  Progress,
  Row,
  Space,
  Tag,
  Typography,
} from 'antd';
import { useNavigate } from 'react-router-dom';

import { reviewerApi } from '../../api/reviewer';
import type { ReviewBatch, ReviewerOverview as ReviewerOverviewMeta } from '../../types/reviewer';

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

export default function ReviewerOverview() {
  const navigate = useNavigate();
  const [overview, setOverview] = useState<ReviewerOverviewMeta>(sampleOverview);
  const [batches, setBatches] = useState<ReviewBatch[]>([]);
  const [usingFallback, setUsingFallback] = useState(true);
  const [loading, setLoading] = useState(true);
  AntdApp.useApp();

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
          <Button type="primary" onClick={() => navigate('/reviewer/queue')}>
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
              <Button type="link" onClick={() => navigate('/reviewer/queue')}>
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
                          <Tag color={batch.priority === 'high' ? 'red' : 'default'}>
                            {batch.priority === 'high' ? '高优先级' : '普通'}
                          </Tag>
                        </Space>
                        <Button
                          type="primary"
                          size="small"
                          onClick={() =>
                            navigate(`/reviewer/queue?batchId=${batch.batchId}`)
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
                        strokeColor={{ from: '#6fb6ff', to: '#2f7bff' }}
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
            <div className="reviewer-quality-tip">
              <ThunderboltFilled /> 一致率低于 90% 时建议复盘审核标准;抽检覆盖率<10% 时升级到全量审核。
            </div>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <Card title="质量规则与接口预留">
            <Typography.Paragraph type="secondary">
              后端落地后,Reviewer 端将通过下列接口拉取队列、AI 结果与争议样本,并提交审核结论。前端调用方已在 <code>api/reviewer.ts</code> 中预留。
            </Typography.Paragraph>
            <Space wrap size={6}>
              <Tag color="blue">GET /reviewer/batches</Tag>
              <Tag color="blue">GET /reviewer/batches/{'{id}'}/annotations</Tag>
              <Tag color="green">POST /reviewer/annotations/{'{id}'}/decision</Tag>
              <Tag color="purple">GET /reviewer/disputes</Tag>
              <Tag color="orange">POST /reviewer/disputes/{'{id}'}/resolve</Tag>
            </Space>
          </Card>
        </Col>

        <Col xs={24} xl={12}>
          <Card title="工作建议">
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              <Tip
                icon={<RobotOutlined />}
                color="#2f7bff"
                text="优先处理 AI 标记 NEED_HUMAN_REVIEW 的条目,这部分信号最强。"
              />
              <Tip
                icon={<ExclamationCircleFilled />}
                color="#ef4444"
                text="争议样本走单独流程:进入「争议样本」页用终审决定。"
              />
              <Tip
                icon={<CheckCircleFilled />}
                color="#22c55e"
                text="审核通过后任务自动进入 ACCEPTED → 可被 Owner 导出。"
              />
            </Space>
          </Card>
        </Col>
      </Row>
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

function Tip({
  icon,
  text,
  color,
}: {
  icon: React.ReactNode;
  text: string;
  color: string;
}) {
  return (
    <div className="reviewer-tip-row">
      <span className="reviewer-tip-icon" style={{ background: `${color}15`, color }}>
        {icon}
      </span>
      <span className="reviewer-tip-text">{text}</span>
    </div>
  );
}
