import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircleFilled,
  CloseCircleFilled,
  ExclamationCircleFilled,
  ReloadOutlined,
  SearchOutlined,
  ThunderboltFilled,
} from '@ant-design/icons';
import {
  App as AntdApp,
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Collapse,
  Empty,
  Input,
  Progress,
  Row,
  Segmented,
  Space,
  Spin,
  Tag,
  Timeline,
  Typography,
} from 'antd';

import { aiReviewApi } from '../../api/aiReview';
import { getApiErrorMessage } from '../../api/client';
import type {
  AiDecision,
  AiReviewJob,
  AiReviewJobStatus,
  AiReviewJobTimelineItem,
  AiReviewResult,
} from '../../types/aiReview';

/**
 * AI 自动预审队列:三栏工作台。
 *
 * 对齐《项目实施计划书》4.4:
 *   - 左栏:待审 Job 列表(按状态分组 Tab + 搜索 + 统计)
 *   - 中栏:选中 Job 的 AI 审核依据(evidence)+ AI 维度评分可视化
 *   - 右栏:AI 评语 + Prompt 模板 + 处理日志/审计时间线
 *
 * 数据来源:
 *   - GET /ai-review/jobs (列表)
 *   - GET /ai-review/results/{annotationId} (单条 AI 预审结果)
 *   - GET /ai-review/jobs/{jobId}/timeline (同一 assignment 多轮 AI 预审日志)
 */

const { Text, Title, Paragraph } = Typography;

type StatusFilter = AiReviewJobStatus | 'all';
type EvidenceKind = 'relevance' | 'accuracy' | 'format' | 'safety' | 'evidence';

const statusMeta: Record<AiReviewJobStatus, { label: string; color: string }> = {
  pending: { label: '待审核', color: 'default' },
  running: { label: '执行中', color: 'processing' },
  success: { label: '已通过', color: 'success' },
  failed: { label: '失败', color: 'error' },
};

const decisionMeta: Record<AiDecision, { label: string; color: string }> = {
  PASS: { label: '建议通过', color: '#16a34a' },
  NEED_HUMAN_REVIEW: { label: '转人工', color: '#f59e0b' },
  REJECT: { label: '建议打回', color: '#dc2626' },
};

const evidenceKindMeta: Record<EvidenceKind, { label: string; color: string }> = {
  relevance: { label: '相关性', color: 'blue' },
  accuracy: { label: '准确性', color: 'red' },
  format: { label: '格式合规', color: 'orange' },
  safety: { label: '安全', color: 'green' },
  evidence: { label: '依据', color: 'default' },
};

export default function AiPreReviewQueue() {
  const { message } = AntdApp.useApp();
  const [jobs, setJobs] = useState<AiReviewJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [keyword, setKeyword] = useState('');
  const [selectedJob, setSelectedJob] = useState<AiReviewJob | null>(null);
  const [result, setResult] = useState<AiReviewResult | null>(null);
  const [resultLoading, setResultLoading] = useState(false);
  const [timelineItems, setTimelineItems] = useState<AiReviewJobTimelineItem[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);

  // 左栏高度动态跟随右栏:用 ResizeObserver 监听右栏高度变化,实时设置左栏 height
  const leftPanelRef = useRef<HTMLDivElement>(null);
  const rightPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const rightEl = rightPanelRef.current;
    const leftEl = leftPanelRef.current;
    if (!rightEl || !leftEl) return;
    const observer = new ResizeObserver(() => {
      const h = rightEl.offsetHeight;
      if (h > 0) {
        leftEl.style.height = `${h}px`;
      }
    });
    observer.observe(rightEl);
    // 初始同步一次
    const h = rightEl.offsetHeight;
    if (h > 0) leftEl.style.height = `${h}px`;
    return () => observer.disconnect();
  });

  /** 加载 Job 列表 */
  const loadJobs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await aiReviewApi.listJobs({
        status: statusFilter === 'all' ? undefined : statusFilter,
        page: 1,
        pageSize: 200,
      });
      setJobs(res.items ?? []);
      setListError(null);
    } catch (error) {
      const errorMessage = getApiErrorMessage(error, 'AI 预审队列加载失败');
      setListError(errorMessage);
      message.error(errorMessage);
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, message]);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  /** 选中 Job 后加载 AI 预审结果 */
  useEffect(() => {
    if (!selectedJob) {
      setResult(null);
      setResultLoading(false);
      setTimelineItems([]);
      setTimelineError(null);
      setTimelineLoading(false);
      return;
    }
    let cancelled = false;
    setResultLoading(true);
    setTimelineLoading(true);
    setTimelineError(null);
    (async () => {
      try {
        const [resultRes, timelineRes] = await Promise.allSettled([
          aiReviewApi.getJobResult(selectedJob.annotationId),
          aiReviewApi.getJobTimeline(selectedJob.jobId),
        ]);
        if (cancelled) return;
        if (resultRes.status === 'fulfilled') {
          setResult(resultRes.value);
        } else {
          setResult(null);
        }
        if (timelineRes.status === 'fulfilled') {
          setTimelineItems(timelineRes.value ?? []);
        } else {
          setTimelineItems([]);
          setTimelineError(getApiErrorMessage(timelineRes.reason, '处理日志加载失败'));
        }
      } finally {
        if (!cancelled) {
          setResultLoading(false);
          setTimelineLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [selectedJob]);

  /** 本地筛选 */
  const visibleJobs = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return jobs.filter((j) => {
      if (statusFilter !== 'all' && j.status !== statusFilter) return false;
      if (kw) {
        const blob = `${j.jobId} ${j.annotationId} ${j.taskTitle ?? ''} ${j.taskId}`.toLowerCase();
        if (!blob.includes(kw)) return false;
      }
      return true;
    });
  }, [jobs, statusFilter, keyword]);

  /** KPI 统计 */
  const stats = useMemo(() => {
    const total = jobs.length;
    const succeeded = jobs.filter((j) => j.status === 'success').length;
    const needHuman = jobs.filter((j) => j.decision === 'NEED_HUMAN_REVIEW').length;
    const failed = jobs.filter((j) => j.status === 'failed').length;
    return { total, succeeded, needHuman, failed };
  }, [jobs]);

  return (
    <Space direction="vertical" size="large" className="page-stack">
      {/* 标题 */}
      <div className="page-title-row">
        <Space direction="vertical" size={4}>
          <Title level={3}>AI 自动预审队列</Title>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            异步消费提交数据 → 按评分维度调用 LLM 结构化输出 → 通过 / 打回 / 转人工复核
          </Paragraph>
        </Space>
        <Space size={8}>
          <Tag color="green">服务在线</Tag>
        </Space>
      </div>

      {/* KPI 4 张 */}
      <Row gutter={16} className="row-equal">
        <Col xs={12} md={6}>
          <Card className="owner-stat-card" loading={loading}>
            <div className="owner-stat-label">作业总数</div>
            <div className="owner-stat-value owner-stat-primary">{stats.total}</div>
            <Tag className="owner-stat-trend">全部状态合计</Tag>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card className="owner-stat-card" loading={loading}>
            <div className="owner-stat-label">成功</div>
            <div className="owner-stat-value">{stats.succeeded}</div>
            <Tag color="success" className="owner-stat-trend">
              PASS / NEED_HUMAN / REJECT 已出
            </Tag>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card className="owner-stat-card" loading={loading}>
            <div className="owner-stat-label">需人工处理</div>
            <div className="owner-stat-value">{stats.needHuman}</div>
            <Tag color="warning" className="owner-stat-trend">
              去人工审核队列
            </Tag>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card className="owner-stat-card" loading={loading}>
            <div className="owner-stat-label">失败</div>
            <div className="owner-stat-value">{stats.failed}</div>
            <Tag color="error" className="owner-stat-trend">
              可重试
            </Tag>
          </Card>
        </Col>
      </Row>

      {/* 筛选条 */}
      <Card className="owner-toolbar">
        <Space size={12} wrap>
          <Segmented
            value={statusFilter}
            onChange={(v) => { setStatusFilter(v as StatusFilter); setSelectedJob(null); }}
            options={[
              { label: '全部', value: 'all' },
              { label: '排队中', value: 'pending' },
              { label: '执行中', value: 'running' },
              { label: '成功', value: 'success' },
              { label: '失败', value: 'failed' },
            ]}
          />
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索 Job ID / 任务名"
            style={{ width: 240 }}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void loadJobs()}>
            刷新
          </Button>
        </Space>
      </Card>

      {listError && (
        <Alert
          type="error"
          showIcon
          message="AI 预审队列加载失败"
          description={listError}
          action={<Button size="small" onClick={() => void loadJobs()}>重试</Button>}
        />
      )}

      {/* 三栏主体 */}
      <div className="ai-queue-layout">
        {/* 左栏:Job 列表,高度动态跟随右栏 */}
        <div className="ai-queue-left" ref={leftPanelRef}>
          <div className="ai-queue-left-header">
            <Text strong>
              待审核 ({visibleJobs.length})
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {stats.total > 0
                ? `${Math.round((stats.succeeded / stats.total) * 100)}% 通过率`
                : '-'}
            </Text>
          </div>
          <div className="ai-queue-left-list">
            <Spin spinning={loading}>
              {visibleJobs.length === 0 ? (
                <Empty description="暂无作业" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                visibleJobs.map((job) => (
                  <JobListItem
                    key={job.jobId}
                    job={job}
                    active={selectedJob?.jobId === job.jobId}
                    onClick={() => setSelectedJob(job)}
                  />
                ))
              )}
            </Spin>
          </div>
        </div>

        {/* 中栏 + 右栏:选中 Job 的详情 */}
        {selectedJob ? (
          <JobDetailPanel
            job={selectedJob}
            result={result}
            loading={resultLoading}
            timelineItems={timelineItems}
            timelineLoading={timelineLoading}
            timelineError={timelineError}
            rightRef={rightPanelRef}
          />
        ) : (
          <div className="ai-queue-empty-detail" ref={rightPanelRef}>
            <Empty description="点击左侧列表选择一条作业查看详情" />
          </div>
        )}
      </div>
    </Space>
  );
}

/* ============ 左栏列表项 ============ */

function JobListItem({
  job,
  active,
  onClick,
}: {
  job: AiReviewJob;
  active: boolean;
  onClick: () => void;
}) {
  const meta = statusMeta[job.status];
  const decision = job.decision ? decisionMeta[job.decision] : null;
  const roundTag = renderRoundTag(job.roundNo);
  // 题目标识:有 itemIndex 时显示「任务名 | 第 N 题」,否则回退到任务名
  const titleText = job.itemIndex
    ? `${job.taskTitle || job.taskId} | 第 ${job.itemIndex} 题`
    : job.taskTitle || `任务 ${job.taskId}`;

  return (
    <div
      className={`ai-queue-item ${active ? 'is-active' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onClick(); }}
    >
      <div className="ai-queue-item-top">
        <Text strong style={{ fontSize: 13 }}>
          {titleText}
        </Text>
        <Tag color={meta.color} style={{ borderRadius: 999, fontSize: 11 }}>
          {meta.label}
        </Tag>
      </div>
      <div className="ai-queue-item-meta">
        {decision && (
          <Badge
            color={decision.color}
            text={<Text style={{ fontSize: 11, color: decision.color }}>{decision.label}</Text>}
          />
        )}
        {roundTag}
      </div>
      <div className="ai-queue-item-bottom">
        <Text type="secondary" style={{ fontSize: 11 }}>
          {job.totalScore != null ? `分数 ${job.totalScore.toFixed(2)}` : ''}
        </Text>
        <Text type="secondary" style={{ fontSize: 11 }}>
          {job.createdAt}
        </Text>
      </div>
      {job.errorSummary && (
        <div className="ai-queue-item-error">
          <Text type="danger" style={{ fontSize: 11 }} ellipsis>
            {job.errorSummary}
          </Text>
        </div>
      )}
    </div>
  );
}

/* ============ 中栏 + 右栏详情面板 ============ */

function JobDetailPanel({
  job,
  result,
  loading,
  timelineItems,
  timelineLoading,
  timelineError,
  rightRef,
}: {
  job: AiReviewJob;
  result: AiReviewResult | null;
  loading: boolean;
  timelineItems: AiReviewJobTimelineItem[];
  timelineLoading: boolean;
  timelineError: string | null;
  rightRef?: React.Ref<HTMLDivElement>;
}) {
  const decision = job.decision ? decisionMeta[job.decision] : null;
  const roundTag = renderRoundTag(job.roundNo, 'detail');

  return (
    <div className="ai-queue-detail" ref={rightRef}>
      <Spin spinning={loading}>
        {/* 顶部:Job 标题 + AI 建议 */}
        <div className="ai-queue-detail-header">
          <div>
            <Title level={5} style={{ marginBottom: 4 }}>
              {job.taskTitle || `任务 ${job.taskId}`}
              {' | '}
              第 {job.itemIndex && job.itemIndex > 0 ? job.itemIndex : job.annotationId} 题
            </Title>
            <Text type="secondary" style={{ fontSize: 12 }}>
              提交于 {job.createdAt} · 规则 {job.ruleName ?? job.ruleId ?? '默认'}
              {job.finishedAt && ` · 完成于 ${job.finishedAt}`}
            </Text>
          </div>
          <Space size={8} wrap>
            {roundTag}
            {decision && (
              <Tag
                color={decision.color}
                icon={
                  job.decision === 'PASS' ? <CheckCircleFilled /> :
                  job.decision === 'REJECT' ? <CloseCircleFilled /> :
                  <ExclamationCircleFilled />
                }
                style={{ fontSize: 14, padding: '4px 12px', borderRadius: 999 }}
              >
                AI 建议: {decision.label} ({job.totalScore?.toFixed(2) ?? '-'})
              </Tag>
            )}
          </Space>
        </div>

        <Row gutter={16} style={{ marginTop: 16 }}>
          {/* 中栏:AI 审核依据 + 维度评分 */}
          <Col xs={24} lg={12}>
            <Card size="small" title="AI 审核依据" bordered={false} className="ai-queue-card">
              <EvidencePanel result={result} />
            </Card>

            {result && (
              <Card
                size="small"
                title={`维度评分 (共 ${Object.keys(result.scores).length} 项)`}
                bordered={false}
                className="ai-queue-card"
                style={{ marginTop: 12 }}
              >
                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                  {Object.entries(result.scores).map(([key, score]) => (
                    <div key={key} className="ai-queue-score-row">
                      <Text style={{ fontSize: 13, minWidth: 80 }}>{key}</Text>
                      <Progress
                        percent={clampScore(score ?? 0)}
                        size="small"
                        strokeColor={scoreColor(score ?? 0)}
                        style={{ flex: 1, margin: '0 12px' }}
                        format={(pct) => <Text strong>{pct}</Text>}
                      />
                    </div>
                  ))}
                  {/* 综合分 */}
                  <div className="ai-queue-score-row" style={{ borderTop: '1px solid #f0f2f7', paddingTop: 8 }}>
                    <Text strong style={{ fontSize: 13, minWidth: 80 }}>综合</Text>
                    <Progress
                      percent={clampScore(result.total_score)}
                      size="small"
                      strokeColor={scoreColor(result.total_score)}
                      style={{ flex: 1, margin: '0 12px' }}
                      format={(pct) => <Text strong>{pct}</Text>}
                    />
                  </div>
                </Space>
              </Card>
            )}
          </Col>

          {/* 右栏:AI 评语 + Prompt + 审计 */}
          <Col xs={24} lg={12}>
            {/* AI 评语 */}
            {result?.comment && (
              <Card size="small" title="AI 评语" bordered={false} className="ai-queue-card">
                {decision && (
                  <div className="ai-queue-verdict">
                    <ThunderboltFilled style={{ color: decision.color }} />
                    <Text strong style={{ color: decision.color }}>
                      {decision.label}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      阈值: PASS ≥ 80,人工复核 ≥ 70
                    </Text>
                  </div>
                )}
                <Paragraph style={{ marginTop: 8, marginBottom: 0, fontSize: 13 }}>
                  {result.comment}
                </Paragraph>
                {result.risk_flags && result.risk_flags.length > 0 && (
                  <Space size={4} wrap style={{ marginTop: 8 }}>
                    {result.risk_flags.map((flag) => (
                      <Tag key={flag} color="warning" style={{ borderRadius: 999 }}>
                        {flag}
                      </Tag>
                    ))}
                  </Space>
                )}
              </Card>
            )}

            {/* Prompt 模板 */}
            <Card
              size="small"
              title="审核 Prompt 模板"
              bordered={false}
              className="ai-queue-card"
              style={{ marginTop: 12 }}
              extra={
                job.ruleName ? (
                  <Tag color="processing" style={{ borderRadius: 999 }}>
                    规则: {job.ruleName}
                  </Tag>
                ) : null
              }
            >
              <pre className="ai-queue-prompt">
                {`你是电商商品标题审核员，请基于以下维度为提交内容打分（0-100）：\n[相关性] 标注结果与原始数据是否对齐\n[准确性] 关键词与商品实际是否一致\n[格式合规] 是否满足模板字段格式要求\n[安全性] 是否包含敏感信息\n\n请通过 function_call 返回 JSON:\n{"scores": {...}, "verdict": "pass"|"reject"|"manual", "reason": "..."}`}
              </pre>
            </Card>

            {/* 处理日志 */}
            <Card
              size="small"
              title="处理日志 / 审计"
              bordered={false}
              className="ai-queue-card"
              style={{ marginTop: 12 }}
            >
              {timelineError && (
                <Alert
                  type="warning"
                  showIcon
                  message="多轮日志加载失败"
                  description={timelineError}
                  style={{ marginBottom: 10 }}
                />
              )}
              <Spin spinning={timelineLoading}>
                <div className="ai-queue-timeline-scroll">
                  <Timeline
                    items={timelineItems.length > 0
                      ? buildTimelineFromRecords(timelineItems)
                      : buildTimeline(job)}
                  />
                </div>
              </Spin>
            </Card>
          </Col>
        </Row>
      </Spin>
    </div>
  );
}

/* ============ 工具函数 ============ */

function EvidencePanel({ result }: { result: AiReviewResult | null }) {
  const evidenceItems = normalizeEvidence(result?.evidence);
  const rawJson = JSON.stringify({ evidence: result?.evidence ?? [] }, null, 2);

  if (!result) {
    return (
      <div className="ai-queue-evidence-empty">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="AI 结果未生成" />
      </div>
    );
  }

  return (
    <div className="ai-queue-evidence">
      {evidenceItems.length > 0 ? (
        <div className="ai-queue-evidence-list">
          {evidenceItems.map((item, index) => {
            const kind = classifyEvidence(item);
            const meta = evidenceKindMeta[kind];
            return (
              <div key={`${index}-${item}`} className={`ai-queue-evidence-item is-${kind}`}>
                <span className="ai-queue-evidence-index">{index + 1}</span>
                <div className="ai-queue-evidence-main">
                  <div className="ai-queue-evidence-meta">
                    <Tag color={meta.color} className={`ai-queue-evidence-tag is-${kind}`}>
                      {meta.label}
                    </Tag>
                  </div>
                  <div className="ai-queue-evidence-text">{item}</div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="ai-queue-evidence-empty">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 AI 审核依据" />
        </div>
      )}

      <Collapse
        ghost
        size="small"
        className="ai-queue-evidence-raw"
        items={[
          {
            key: 'raw-evidence',
            label: '查看原始 evidence JSON',
            children: (
              <pre className="ai-queue-json ai-queue-evidence-json">
                {rawJson}
              </pre>
            ),
          },
        ]}
      />
    </div>
  );
}

function normalizeEvidence(evidence?: string[]): string[] {
  return (evidence ?? [])
    .map((item) => item.trim())
    .filter(Boolean);
}

function classifyEvidence(text: string): EvidenceKind {
  const normalized = text.toLowerCase();
  if (/(安全|敏感|风险|违规|禁用|safety|risk|unsafe|violation)/i.test(normalized)) {
    return 'safety';
  }
  if (/(格式|字段|模板|结构|schema|format|field|required)/i.test(normalized)) {
    return 'format';
  }
  if (/(准确|正确|错误|不一致|事实|accuracy|correct|wrong|incorrect)/i.test(normalized)) {
    return 'accuracy';
  }
  if (/(相关|匹配|对齐|无关|relevance|relevant|align|match)/i.test(normalized)) {
    return 'relevance';
  }
  return 'evidence';
}

function scoreColor(score: number): string {
  if (score >= 80) return '#16a34a';
  if (score >= 70) return '#f59e0b';
  return '#dc2626';
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function renderRoundTag(roundNo?: number, variant: 'list' | 'detail' = 'list') {
  if (!roundNo || roundNo < 1) return null;
  const isReworkRound = roundNo > 1;
  return (
    <Tag
      color={isReworkRound ? 'orange' : 'default'}
      style={{
        borderRadius: 999,
        fontSize: variant === 'detail' ? 13 : 11,
        marginInlineEnd: 0,
        padding: variant === 'detail' ? '3px 10px' : '0 8px',
      }}
    >
      第 {roundNo} 轮
    </Tag>
  );
}

function buildTimeline(job: AiReviewJob) {
  const items: Array<{ color: string; children: React.ReactNode }> = [];

  items.push({
    color: 'blue',
    children: (
      <span style={{ fontSize: 12 }}>
        <Text strong>queue</Text> 进入 BullMQ 队列 ai-prereview · 优先级 5
        <br />
        <Text type="secondary">{job.createdAt}</Text>
      </span>
    ),
  });

  if (job.startedAt) {
    items.push({
      color: 'blue',
      children: (
        <span style={{ fontSize: 12 }}>
          <Text strong>llm</Text> 调用模型 · tokens 估算
          <br />
          <Text type="secondary">{job.startedAt}</Text>
        </span>
      ),
    });
  }

  if (job.status === 'success' && job.decision) {
    items.push({
      color: job.decision === 'PASS' ? 'green' : job.decision === 'REJECT' ? 'red' : 'orange',
      children: (
        <span style={{ fontSize: 12 }}>
          <Text strong>verdict</Text> 结论: {job.decision} · 分数 {job.totalScore?.toFixed(2) ?? '-'}
          <br />
          <Text type="secondary">{job.finishedAt ?? ''}</Text>
        </span>
      ),
    });
  }

  if (job.status === 'failed') {
    items.push({
      color: 'red',
      children: (
        <span style={{ fontSize: 12 }}>
          <Text strong>error</Text> {job.errorSummary ?? job.lastError ?? '未知错误'}
          <br />
          <Text type="secondary">尝试 {job.retryCount ?? job.attempts ?? 0} 次</Text>
        </span>
      ),
    });
  }

  return items;
}

function buildTimelineFromRecords(records: AiReviewJobTimelineItem[]) {
  return records.map((item, index) => ({
    color: timelineColor(item),
    children: (
      <span style={{ fontSize: 12 }}>
        <Text strong>{item.title || item.stage}</Text>
        {item.message && <> {item.message}</>}
        <br />
        <Text type="secondary">{item.occurredAt || '等待记录时间'}</Text>
      </span>
    ),
    key: `${item.roundNo}-${item.stage}-${item.occurredAt ?? index}`,
  }));
}

function timelineColor(item: AiReviewJobTimelineItem): string {
  if (item.stage === 'error') return 'red';
  if (item.stage === 'verdict') {
    if (item.decision === 'PASS') return 'green';
    if (item.decision === 'REJECT') return 'red';
    return 'orange';
  }
  return 'blue';
}
