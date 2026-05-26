import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  RobotOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import {
  App as AntdApp,
  Button,
  Card,
  Col,
  Empty,
  Input,
  Modal,
  Row,
  Segmented,
  Space,
  Tag,
  Typography,
} from 'antd';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { reviewerApi } from '../../api/reviewer';
import type {
  AiReviewResult,
  AnnotationToReview,
  ReviewBatch,
} from '../../types/reviewer';

/**
 * Reviewer 待审队列。
 * 两态切换:无 batchId → 批次列表;有 batchId → 进入条目逐条审核台。
 * 计划书 4.5:审核流转 APPROVE / RETURN / REVISE / ESCALATE,提交后写入 audit log。
 */

export default function ReviewerQueue() {
  const [searchParams] = useSearchParams();
  const batchId = searchParams.get('batchId');
  if (batchId) {
    return <BatchReviewPanel batchId={batchId} />;
  }
  return <BatchListPanel />;
}

/* ============ 批次列表 ============ */
function BatchListPanel() {
  const navigate = useNavigate();
  const [batches, setBatches] = useState<ReviewBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'in_review' | 'completed'>(
    'all',
  );
  const [keyword, setKeyword] = useState('');
  const [usingFallback, setUsingFallback] = useState(false);
  const { message } = AntdApp.useApp();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const resp = await reviewerApi.listBatches({ status: 'all', page: 1, pageSize: 50 });
        if (cancelled) return;
        setBatches(resp.items ?? []);
        setUsingFallback(false);
      } catch {
        try {
          const res = await fetch('/sample-datasets/reviewer-batches.json');
          const data = await res.json();
          if (cancelled) return;
          setBatches((data.items as ReviewBatch[]) ?? []);
          setUsingFallback(true);
        } catch {
          if (!cancelled) message.error('加载待审队列失败');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [message]);

  const filtered = useMemo(() => {
    return batches.filter((b) => {
      if (statusFilter !== 'all' && b.status !== statusFilter) return false;
      if (keyword) {
        const kw = keyword.toLowerCase();
        if (!`${b.taskTitle} ${b.batchId} ${b.taskType}`.toLowerCase().includes(kw)) {
          return false;
        }
      }
      return true;
    });
  }, [batches, statusFilter, keyword]);

  return (
    <Space direction="vertical" size="large" className="page-stack">
      <div className="page-title-row">
        <Space direction="vertical" size={4}>
          <Typography.Title level={3}>待审队列</Typography.Title>
          <Typography.Text type="secondary">
            浏览批次,选择优先级高或 AI 信号强的批次进入逐条审核台。
          </Typography.Text>
        </Space>
        {usingFallback && <Tag color="gold">演示模式 · 接口未连接</Tag>}
      </div>

      <Card>
        <Space size={12} wrap>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索任务名 / 批次 ID / 类型"
            style={{ width: 280 }}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          <Segmented
            options={[
              { label: '全部', value: 'all' },
              { label: '待领取', value: 'pending' },
              { label: '审核中', value: 'in_review' },
              { label: '已完成', value: 'completed' },
            ]}
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as typeof statusFilter)}
          />
        </Space>
      </Card>

      {loading ? (
        <Card>
          <div className="market-loading">加载待审队列...</div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <Empty description="没有匹配的批次" />
        </Card>
      ) : (
        <Row gutter={[16, 16]}>
          {filtered.map((batch) => (
            <Col xs={24} md={12} xl={8} key={batch.batchId}>
              <BatchCard
                batch={batch}
                onOpen={() => navigate(`/reviewer/queue?batchId=${batch.batchId}`)}
              />
            </Col>
          ))}
        </Row>
      )}
    </Space>
  );
}

function BatchCard({ batch, onOpen }: { batch: ReviewBatch; onOpen: () => void }) {
  const total = batch.pending + batch.reviewed;
  const ratio = total === 0 ? 0 : Math.round((batch.reviewed / total) * 100);
  const statusLabel: Record<ReviewBatch['status'], { color: string; text: string }> = {
    pending: { color: 'processing', text: '待领取' },
    in_review: { color: 'blue', text: '审核中' },
    completed: { color: 'success', text: '已完成' },
  };

  return (
    <Card className="reviewer-batch-card" onClick={onOpen}>
      <div className="reviewer-batch-head">
        <Space size={8} wrap>
          <span className="reviewer-batch-title">{batch.taskTitle}</span>
          <Tag className="reviewer-batch-type">{batch.taskType}</Tag>
        </Space>
        <Tag color={batch.priority === 'high' ? 'red' : 'default'}>
          {batch.priority === 'high' ? '高优先级' : '普通'}
        </Tag>
      </div>
      <div className="reviewer-batch-meta">
        待审 <strong>{batch.pending}</strong> · 已审 {batch.reviewed} · 需人工{' '}
        <strong>{batch.needHumanReview}</strong>
      </div>
      <div className="reviewer-batch-meta">
        抽检 {(batch.samplingRatio * 100).toFixed(0)}% · 截止 {batch.deadline ?? '未设置'}
      </div>
      <div className="reviewer-batch-bar">
        <span style={{ width: `${ratio}%` }} />
      </div>
      <div className="reviewer-batch-foot">
        <Tag color={statusLabel[batch.status].color}>{statusLabel[batch.status].text}</Tag>
        <Button type="primary" size="small">
          {batch.status === 'completed' ? '查看记录' : '开始审核'} <ArrowRightOutlined />
        </Button>
      </div>
    </Card>
  );
}

/* ============ 进入条目逐条审核 ============ */
function BatchReviewPanel({ batchId }: { batchId: string }) {
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const [items, setItems] = useState<AnnotationToReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeIdx, setActiveIdx] = useState(0);
  const [returnReason, setReturnReason] = useState('');
  const [returnOpen, setReturnOpen] = useState(false);
  const [usingFallback, setUsingFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const resp = await reviewerApi.listAnnotations(batchId, { pageSize: 50 });
        if (cancelled) return;
        setItems(resp.items ?? []);
        setUsingFallback(false);
      } catch {
        try {
          const res = await fetch('/sample-datasets/reviewer-annotations.json');
          const data = await res.json();
          if (cancelled) return;
          setItems((data.items as AnnotationToReview[]) ?? []);
          setUsingFallback(true);
        } catch {
          if (!cancelled) message.error('加载条目失败');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [batchId, message]);

  const current = items[activeIdx];

  function moveTo(idx: number) {
    if (idx < 0) return;
    if (idx >= items.length) {
      message.success('该批次审核完成');
      navigate('/reviewer/queue');
      return;
    }
    setActiveIdx(idx);
  }

  async function commitDecision(
    decision: 'APPROVE' | 'RETURN' | 'REVISE' | 'ESCALATE',
    reason?: string,
  ) {
    if (!current) return;
    try {
      await reviewerApi.submitReview(current.annotationId, { decision, reason });
      message.success(decisionMessage(decision));
    } catch {
      message.success(`${decisionMessage(decision)}(演示模式)`);
    }
    // 标记本地状态后跳到下一条
    setItems((prev) =>
      prev.map((it, idx) =>
        idx === activeIdx ? { ...it, decision } : it,
      ),
    );
    moveTo(activeIdx + 1);
  }

  if (loading) {
    return (
      <Card className="reviewer-batch-load">
        <div className="market-loading">加载条目...</div>
      </Card>
    );
  }

  if (!current) {
    return (
      <Space direction="vertical" size="large" className="page-stack">
        <div className="page-title-row">
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/reviewer/queue')}>
            返回批次列表
          </Button>
        </div>
        <Card>
          <Empty description="该批次暂无可审条目" />
        </Card>
      </Space>
    );
  }

  return (
    <Space direction="vertical" size="large" className="page-stack reviewer-review-panel">
      <div className="page-title-row">
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/reviewer/queue')}>
            返回批次列表
          </Button>
          <Typography.Title level={4} style={{ margin: 0 }}>
            批次 {batchId} · 第 {activeIdx + 1} / {items.length} 条
          </Typography.Title>
          {usingFallback && <Tag color="gold">演示模式</Tag>}
        </Space>
        <Space>
          <Button onClick={() => moveTo(activeIdx - 1)} disabled={activeIdx === 0}>
            上一条
          </Button>
          <Button onClick={() => moveTo(activeIdx + 1)}>
            跳过 <ArrowRightOutlined />
          </Button>
        </Space>
      </div>

      <Row gutter={[16, 16]}>
        {/* 左:原题 + 标注答案 */}
        <Col xs={24} xl={15}>
          <Card title={`条目 ${current.itemId} · Schema ${current.schemaVersionId}`}>
            <div className="review-section-label">原题数据 (rawPayload)</div>
            <pre className="review-json">{stringify(current.rawPayload)}</pre>

            <div className="review-section-label">
              标注员答案 (answerJson) · {current.labelerName} · 提交于 {current.submittedAt}
            </div>
            <pre className="review-json highlight">{stringify(current.answerJson)}</pre>

            {current.revisionNo > 1 && (
              <Tag color="warning" className="review-revision-tag">
                第 {current.revisionNo} 次返修
              </Tag>
            )}
          </Card>
        </Col>

        {/* 右:AI 结果 + 决策 */}
        <Col xs={24} xl={9}>
          <Card
            title={
              <Space size={8}>
                <RobotOutlined style={{ color: '#2f7bff' }} />
                AI 预审结果
              </Space>
            }
          >
            {current.aiResult ? (
              <AiResultBlock result={current.aiResult} />
            ) : (
              <Empty description="AI 结果尚未就绪,可凭人工经验直接审核" />
            )}
          </Card>

          <Card title="审核决定" style={{ marginTop: 16 }} className="review-decision-card">
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Button
                type="primary"
                icon={<CheckCircleFilled />}
                size="large"
                block
                onClick={() => void commitDecision('APPROVE')}
              >
                通过 (APPROVE)
              </Button>
              <Button
                danger
                icon={<CloseCircleOutlined />}
                size="large"
                block
                onClick={() => setReturnOpen(true)}
              >
                打回 (RETURN)
              </Button>
              <Button
                icon={<ExclamationCircleOutlined />}
                size="large"
                block
                onClick={() => void commitDecision('ESCALATE', '升级到争议样本审议')}
              >
                升级争议 (ESCALATE)
              </Button>
              <div className="review-shortcut-tip">
                <ClockCircleOutlined /> 平均处理时长 30 秒/条;批量场景建议先看 AI 评分,优先处理 NEED_HUMAN_REVIEW。
              </div>
            </Space>
          </Card>
        </Col>
      </Row>

      <Modal
        title="打回原因"
        open={returnOpen}
        onCancel={() => setReturnOpen(false)}
        onOk={() => {
          if (!returnReason.trim()) {
            message.warning('打回必须填写原因(对齐计划书 4.5)');
            return;
          }
          setReturnOpen(false);
          void commitDecision('RETURN', returnReason);
          setReturnReason('');
        }}
        okText="确认打回"
      >
        <Typography.Paragraph type="secondary">
          原因将写入 audit log,标注员在「打回项」可以看到。
        </Typography.Paragraph>
        <Input.TextArea
          rows={4}
          placeholder="例如:cleaned_title 缺失关键卖点「加厚保暖」,请补充后重新提交。"
          value={returnReason}
          onChange={(e) => setReturnReason(e.target.value)}
        />
      </Modal>
    </Space>
  );
}

function AiResultBlock({ result }: { result: AiReviewResult }) {
  const decisionMeta: Record<
    AiReviewResult['decision'],
    { color: string; label: string }
  > = {
    PASS: { color: 'success', label: 'PASS · AI 通过' },
    REJECT: { color: 'error', label: 'REJECT · AI 拒绝' },
    NEED_HUMAN_REVIEW: { color: 'warning', label: 'NEED_HUMAN_REVIEW · 需人工' },
  };
  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <div className="ai-score-grid">
        {Object.entries(result.scores).map(([key, value]) =>
          typeof value === 'number' ? (
            <div key={key} className="ai-score-cell">
              <div className="ai-score-key">{key}</div>
              <div className="ai-score-value">{value}</div>
            </div>
          ) : null,
        )}
      </div>
      <div className="ai-total-row">
        <Tag color={decisionMeta[result.decision].color}>
          {decisionMeta[result.decision].label}
        </Tag>
        <span>
          总分 <strong>{result.total_score}</strong>
        </span>
      </div>
      <div>
        <div className="review-section-label">AI 评语</div>
        <Typography.Paragraph className="ai-comment">{result.comment}</Typography.Paragraph>
      </div>
      {result.risk_flags.length > 0 && (
        <div>
          <div className="review-section-label">风险标记</div>
          <Space size={6} wrap>
            {result.risk_flags.map((flag) => (
              <Tag key={flag} color="orange">
                {flag}
              </Tag>
            ))}
          </Space>
        </div>
      )}
      {result.evidence.length > 0 && (
        <div>
          <div className="review-section-label">证据</div>
          <Space size={6} wrap>
            {result.evidence.map((ev) => (
              <Tag key={ev}>{ev}</Tag>
            ))}
          </Space>
        </div>
      )}
    </Space>
  );
}

function decisionMessage(decision: 'APPROVE' | 'RETURN' | 'REVISE' | 'ESCALATE') {
  return {
    APPROVE: '已通过',
    RETURN: '已打回',
    REVISE: '已要求重做',
    ESCALATE: '已升级到争议样本',
  }[decision];
}

function stringify(value: unknown) {
  return JSON.stringify(value, null, 2);
}
