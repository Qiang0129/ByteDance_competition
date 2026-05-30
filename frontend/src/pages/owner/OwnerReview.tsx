import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AuditOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  CloseCircleFilled,
  ExclamationCircleFilled,
  EyeOutlined,
  FileSearchOutlined,
  ReloadOutlined,
  SearchOutlined,
  TeamOutlined,
  ThunderboltFilled,
} from '@ant-design/icons';
import {
  App as AntdApp,
  Button,
  Card,
  Col,
  Drawer,
  Empty,
  Input,
  Progress,
  Row,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Timeline,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';

import { ownerReviewApi } from '../../api/ownerReview';
import { getApiErrorMessage } from '../../api/client';
import type {
  OwnerReviewAnnotation,
  OwnerReviewOverview,
  OwnerReviewTaskRow,
  ReviewAuditLogEntry,
  ReviewStage,
  ReviewStageProgress,
} from '../../types/ownerReview';

/**
 * Owner 端「人工审核」页面。
 *
 * 对齐《项目实施计划书》4.5 / 4.6:
 *   - Owner 视角是「跟踪 + 审计」,不是替代 Reviewer 逐条裁决;
 *   - 顶部 KPI 概览 (待审、今日通过/打回、争议、抽检覆盖、双审一致率、返工率);
 *   - 任务级进度表 (初审 / 复审 / 终审 三段进度条 + 抽检比例 + SLA);
 *   - 任务详情抽屉:阶段汇总卡 + 条目明细表 (只读);
 *   - 审计日志侧栏:操作时间线,可按操作者角色过滤。
 *
 * 后端接口未实现时回落到 public/sample-datasets/owner-review-*.json,
 * 顶部用 Tag 标记演示模式,所有交互保持可演示。
 */

const { Title, Paragraph, Text } = Typography;

const stageLabel: Record<ReviewStage, string> = {
  initial: '初审',
  second: '复审',
  final: '终审',
  sampling: '抽检',
};

const stageColor: Record<ReviewStage, string> = {
  initial: '#3b82f6',
  second: '#6366f1',
  final: '#16a34a',
  sampling: '#f59e0b',
};

const annotationStatusMeta: Record<
  OwnerReviewAnnotation['status'],
  { label: string; color: string }
> = {
  reviewing: { label: '审核中', color: 'processing' },
  approved: { label: '已通过', color: 'success' },
  returned: { label: '已打回', color: 'error' },
  revised: { label: '已修订', color: 'warning' },
  disputed: { label: '争议中', color: 'magenta' },
};

const operatorRoleLabel: Record<ReviewAuditLogEntry['operatorRole'], string> = {
  owner: '任务负责人',
  labeler: '标注员',
  reviewer: '审核员',
  system_agent: '系统/AI',
};

/** 把 0-1 的小数格式化为百分比文本 */
function pct(value: number, fractionDigits = 1) {
  if (Number.isNaN(value) || !Number.isFinite(value)) return '0%';
  return `${(value * 100).toFixed(fractionDigits)}%`;
}

/** 从任务的 stages 数组里安全取某阶段进度,缺失时返回零值 */
function pickStage(
  stages: ReviewStageProgress[],
  stage: ReviewStage,
): ReviewStageProgress {
  return (
    stages.find((s) => s.stage === stage) ?? {
      stage,
      pending: 0,
      reviewed: 0,
      approved: 0,
      returned: 0,
    }
  );
}

export default function OwnerReview() {
  const { message } = AntdApp.useApp();

  const [overview, setOverview] = useState<OwnerReviewOverview | null>(null);
  const [tasks, setTasks] = useState<OwnerReviewTaskRow[]>([]);
  const [auditLog, setAuditLog] = useState<ReviewAuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [usingFallback, setUsingFallback] = useState(false);

  /** 任务表筛选 */
  const [keyword, setKeyword] = useState('');
  const [stageFilter, setStageFilter] = useState<ReviewStage | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'in_progress' | 'completed' | 'has_disputes'
  >('all');

  /** 审计日志筛选 */
  const [auditRole, setAuditRole] = useState<
    ReviewAuditLogEntry['operatorRole'] | 'all'
  >('all');

  /** 任务详情抽屉 */
  const [detailTask, setDetailTask] = useState<OwnerReviewTaskRow | null>(null);
  const [detailAnnotations, setDetailAnnotations] = useState<
    OwnerReviewAnnotation[]
  >([]);
  const [detailLoading, setDetailLoading] = useState(false);

  /** 拉取 KPI + 任务列表 + 审计日志,后端不可用时回落样例 */
  const loadAll = useCallback(async () => {
    setLoading(true);
    let fallback = false;
    try {
      const [overviewRes, tasksRes, auditRes] = await Promise.all([
        ownerReviewApi.getOverview(30),
        ownerReviewApi.listTasks({ stage: 'all', status: 'all' }),
        ownerReviewApi.listAuditLog({ days: 7 }),
      ]);
      setOverview(overviewRes);
      setTasks(tasksRes.items ?? []);
      setAuditLog(auditRes.items ?? []);
    } catch {
      // 后端未就绪:并行拉三份样例 JSON,保证页面可演示
      fallback = true;
      try {
        const [ov, tk, al] = await Promise.all([
          fetch('/sample-datasets/owner-review-overview.json').then((r) => r.json()),
          fetch('/sample-datasets/owner-review-tasks.json').then((r) => r.json()),
          fetch('/sample-datasets/owner-review-audit-log.json').then((r) => r.json()),
        ]);
        setOverview(ov as OwnerReviewOverview);
        setTasks((tk?.items ?? []) as OwnerReviewTaskRow[]);
        setAuditLog((al?.items ?? []) as ReviewAuditLogEntry[]);
      } catch (error) {
        message.error(getApiErrorMessage(error, '人工审核数据加载失败,且无法读取样例'));
      }
    } finally {
      setUsingFallback(fallback);
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  /** 打开任务详情抽屉时拉条目明细 */
  const openTaskDetail = async (task: OwnerReviewTaskRow) => {
    setDetailTask(task);
    setDetailAnnotations([]);
    setDetailLoading(true);
    try {
      const res = await ownerReviewApi.listTaskAnnotations(task.taskId, {
        page: 1,
        pageSize: 50,
      });
      setDetailAnnotations(res.items ?? []);
    } catch {
      try {
        const sample = await fetch(
          '/sample-datasets/owner-review-annotations.json',
        ).then((r) => r.json());
        setDetailAnnotations((sample?.items ?? []) as OwnerReviewAnnotation[]);
      } catch (error) {
        message.error(getApiErrorMessage(error, '加载条目明细失败'));
      }
    } finally {
      setDetailLoading(false);
    }
  };

  /** 任务表筛选(本地) */
  const visibleTasks = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return tasks.filter((t) => {
      if (kw) {
        const reviewerNames = (t.reviewerNames ?? []).join(' ').toLowerCase();
        const blob = `${t.taskId} ${t.taskTitle} ${t.taskType ?? ''} ${reviewerNames}`.toLowerCase();
        if (!blob.includes(kw)) return false;
      }
      if (stageFilter !== 'all') {
        const stage = pickStage(t.stages, stageFilter);
        if (stage.pending <= 0 && stage.reviewed <= 0) return false;
      }
      if (statusFilter === 'in_progress' && t.inProgress <= 0) return false;
      if (statusFilter === 'completed' && t.inProgress > 0) return false;
      if (statusFilter === 'has_disputes' && t.disputes <= 0) return false;
      return true;
    });
  }, [tasks, keyword, stageFilter, statusFilter]);

  /** 审计日志按角色过滤 */
  const visibleAuditLog = useMemo(() => {
    if (auditRole === 'all') return auditLog;
    return auditLog.filter((l) => l.operatorRole === auditRole);
  }, [auditLog, auditRole]);

  /* ============== 任务表列定义 ============== */
  const taskColumns: ColumnsType<OwnerReviewTaskRow> = [
    {
      title: '任务',
      dataIndex: 'taskTitle',
      width: 240,
      render: (_, row) => (
        <Space direction="vertical" size={2}>
          <Text strong>{row.taskTitle}</Text>
          <Space size={6} wrap>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {row.taskId}
            </Text>
            {row.taskType && (
              <Tag color="blue" style={{ marginInlineEnd: 0 }}>
                {row.taskType}
              </Tag>
            )}
            {row.aiReviewEnabled && (
              <Tooltip title="任务启用了 AI 预审">
                <Tag
                  icon={<ThunderboltFilled />}
                  color="processing"
                  style={{ marginInlineEnd: 0 }}
                >
                  AI
                </Tag>
              </Tooltip>
            )}
          </Space>
        </Space>
      ),
    },
    {
      title: '三阶段审核进度',
      width: 280,
      render: (_, row) => <StageProgressBar task={row} />,
    },
    {
      title: '通过 / 打回 / 进行中',
      width: 180,
      render: (_, row) => (
        <Space direction="vertical" size={2}>
          <span>
            <Text type="success">
              <CheckCircleFilled /> {row.approvedCount}
            </Text>
            <Text type="secondary"> · </Text>
            <Text type="danger">
              <CloseCircleFilled /> {row.returnedCount}
            </Text>
            <Text type="secondary"> · </Text>
            <Text style={{ color: '#f59e0b' }}>
              <ClockCircleOutlined /> {row.inProgress}
            </Text>
          </span>
          <Text type="secondary" style={{ fontSize: 12 }}>
            共 {row.totalAnnotations} 条
          </Text>
        </Space>
      ),
    },
    {
      title: '抽检 / 争议',
      width: 140,
      render: (_, row) => (
        <Space size={4} wrap>
          <Tag className="owner-review-meta-tag is-sampling">
            抽检 {pct(row.samplingRatio, 0)}
          </Tag>
          {row.disputes > 0 && (
            <Tag color="magenta" style={{ borderRadius: 999 }}>
              争议 {row.disputes}
            </Tag>
          )}
        </Space>
      ),
    },
    {
      title: '审核员',
      width: 160,
      render: (_, row) => {
        const names = row.reviewerNames ?? [];
        if (names.length === 0) return <Text type="secondary">未指派</Text>;
        return (
          <Space size={4} wrap>
            {names.slice(0, 2).map((n) => (
              <Tag key={n} style={{ borderRadius: 999 }}>
                {n}
              </Tag>
            ))}
            {names.length > 2 && (
              <Tooltip title={names.slice(2).join('、')}>
                <Tag style={{ borderRadius: 999 }}>+{names.length - 2}</Tag>
              </Tooltip>
            )}
          </Space>
        );
      },
    },
    {
      title: 'SLA / 更新',
      width: 160,
      render: (_, row) => (
        <Space direction="vertical" size={2}>
          {row.deadline && (
            <Tag className="owner-review-meta-tag is-deadline">
              截止 {row.deadline}
            </Tag>
          )}
          <Text type="secondary" style={{ fontSize: 12 }}>
            更新 {row.updatedAt}
          </Text>
        </Space>
      ),
    },
    {
      title: '操作',
      width: 90,
      align: 'center',
      render: (_, row) => (
        <Tooltip title="查看条目明细与审核时间线">
          <Button
            type="text"
            size="small"
            icon={<EyeOutlined />}
            aria-label="查看任务详情"
            onClick={() => void openTaskDetail(row)}
          />
        </Tooltip>
      ),
    },
  ];

  return (
    <Space direction="vertical" size="large" className="page-stack">
      {/* 标题 + 阶段标识 */}
      <div className="page-title-row">
        <Space direction="vertical" size={4}>
          <Title level={3}>人工审核</Title>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            跟踪初审 / 复审 / 终审进度,支持批量通过与打回,审计日志可追溯到具体审核员。
          </Paragraph>
        </Space>
        <Space size={8}>
          {usingFallback && <Tag color="gold">演示模式 · 后端未就绪</Tag>}
          <Tag color="processing" icon={<ThunderboltFilled />}>
            Phase 5 · AI 与人工审核
          </Tag>
        </Space>
      </div>

      {/* 顶部 KPI 概览 */}
      <OverviewKpi overview={overview} loading={loading} />

      {/* 主区:左侧任务进度表(占比 16/24),右侧审核员负载 + 审计日志(8/24) */}
      <Row gutter={16}>
        <Col xs={24} xl={16}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            {/* 工具条 */}
            <Card className="owner-toolbar">
              <Space size={12} wrap>
                <Input
                  allowClear
                  prefix={<SearchOutlined />}
                  placeholder="搜索任务名 / ID / 审核员"
                  style={{ width: 280 }}
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                />
                <Segmented
                  value={stageFilter}
                  onChange={(v) => setStageFilter(v as ReviewStage | 'all')}
                  options={[
                    { label: '全部阶段', value: 'all' },
                    { label: '初审', value: 'initial' },
                    { label: '复审', value: 'second' },
                    { label: '终审', value: 'final' },
                  ]}
                />
                <Select
                  value={statusFilter}
                  onChange={(v) => setStatusFilter(v)}
                  style={{ width: 140 }}
                  options={[
                    { label: '全部状态', value: 'all' },
                    { label: '进行中', value: 'in_progress' },
                    { label: '已完成', value: 'completed' },
                    { label: '有争议', value: 'has_disputes' },
                  ]}
                />
                <Button icon={<ReloadOutlined />} onClick={() => void loadAll()}>
                  刷新
                </Button>
              </Space>
            </Card>

            {/* 任务进度表 */}
            <Card className="owner-table-card" loading={loading}>
              <Table<OwnerReviewTaskRow>
                rowKey="taskId"
                columns={taskColumns}
                dataSource={visibleTasks}
                locale={{ emptyText: <Empty description="暂无审核任务" /> }}
                pagination={{
                  defaultPageSize: 10,
                  showSizeChanger: true,
                  showTotal: (total) => `共 ${total} 个任务`,
                  pageSizeOptions: ['10', '20', '50', '100'],
                }}
              />
            </Card>
          </Space>
        </Col>

        <Col xs={24} xl={8}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <ReviewerWorkloadCard overview={overview} loading={loading} />
            <AuditLogCard
              entries={visibleAuditLog}
              loading={loading}
              roleFilter={auditRole}
              onRoleChange={setAuditRole}
            />
          </Space>
        </Col>
      </Row>

      {/* 任务详情抽屉 */}
      <TaskDetailDrawer
        task={detailTask}
        annotations={detailAnnotations}
        loading={detailLoading}
        onClose={() => setDetailTask(null)}
      />
    </Space>
  );
}

/* =============== 顶部 KPI =============== */

function OverviewKpi({
  overview,
  loading,
}: {
  overview: OwnerReviewOverview | null;
  loading: boolean;
}) {
  // 占位:数据未到位时给 0,避免 KPI 卡塌陷
  const safe = overview ?? {
    pendingAnnotations: 0,
    todayApproved: 0,
    todayReturned: 0,
    todayDisputes: 0,
    samplingCoverage: 0,
    consistencyRate: 0,
    returnRate: 0,
  };

  return (
    <Row gutter={16} className="row-equal owner-review-kpi-row">
      <Col xs={24} sm={12} xl={6}>
        <Card className="owner-stat-card" loading={loading}>
          <div className="owner-stat-label">
            <FileSearchOutlined /> 待审条目
          </div>
          <div className="owner-stat-value owner-stat-primary">
            {safe.pendingAnnotations}
          </div>
          <div className="owner-review-kpi-meta">
            <Tag className="owner-stat-trend">
              今日通过 {safe.todayApproved} · 打回 {safe.todayReturned}
            </Tag>
          </div>
        </Card>
      </Col>
      <Col xs={24} sm={12} xl={6}>
        <Card className="owner-stat-card" loading={loading}>
          <div className="owner-stat-label">
            <ExclamationCircleFilled style={{ color: '#d946ef' }} /> 进行中争议
          </div>
          <div className="owner-stat-value">{safe.todayDisputes}</div>
          <div className="owner-review-kpi-meta">
            <Tag color={safe.todayDisputes > 0 ? 'magenta' : 'default'}>
              对应计划书 4.5 ESCALATE 流转
            </Tag>
          </div>
        </Card>
      </Col>
      <Col xs={24} sm={12} xl={6}>
        <Card className="owner-stat-card" loading={loading}>
          <div className="owner-stat-label">
            <AuditOutlined /> 抽检覆盖率
          </div>
          <div className="owner-stat-value">{pct(safe.samplingCoverage)}</div>
          <div className="owner-review-kpi-meta">
            <Tag color="processing">计划书 4.6 抽检比例</Tag>
          </div>
        </Card>
      </Col>
      <Col xs={24} sm={12} xl={6}>
        <Card className="owner-stat-card" loading={loading}>
          <div className="owner-stat-label">
            <TeamOutlined /> 双审一致率 / 返工率
          </div>
          <div className="owner-stat-value">
            {pct(safe.consistencyRate)}
            <Text
              type="secondary"
              style={{ fontSize: 14, marginLeft: 8, fontWeight: 400 }}
            >
              / {pct(safe.returnRate)}
            </Text>
          </div>
          <div className="owner-review-kpi-meta">
            <Tag color={safe.returnRate < 0.1 ? 'success' : 'warning'}>
              一致率越高、返工率越低越好
            </Tag>
          </div>
        </Card>
      </Col>
    </Row>
  );
}

/* =============== 三阶段进度条 =============== */

/**
 * 三阶段进度条组件:
 *   - 每段宽度按该阶段的总条目数(reviewed + pending)在任务总条目数中的占比;
 *   - 已审部分用主色实色,待审部分用 hatch 斜纹;
 *   - 鼠标悬停显示该阶段的具体数字,便于 Owner 一眼定位瓶颈。
 */
function StageProgressBar({ task }: { task: OwnerReviewTaskRow }) {
  // 三阶段总量 = reviewed + pending,缺失阶段为 0
  // pickStage 已经把 stage 字段写入返回值,这里再 spread 即可,
  // 不重复写 stage 避免 TS2783 spread 覆盖告警
  const stageData = (['initial', 'second', 'final'] as ReviewStage[]).map(
    (stage) => {
      const s = pickStage(task.stages, stage);
      const total = s.reviewed + s.pending;
      return { ...s, total };
    },
  );

  const grandTotal = stageData.reduce((sum, s) => sum + s.total, 0) || 1;

  return (
    <div className="owner-review-stage-bar">
      <div className="owner-review-stage-bar-track">
        {stageData.map((s) => {
          if (s.total <= 0) return null;
          const widthPct = (s.total / grandTotal) * 100;
          // 这里用 stage 名做样式钩子,reviewed/pending 比例用渐变叠加
          return (
            <Tooltip
              key={s.stage}
              title={
                <Space direction="vertical" size={0}>
                  <span>
                    <strong>{stageLabel[s.stage]}</strong> · {s.reviewed} / {s.total} 已审
                  </span>
                  <span>
                    通过 {s.approved} · 打回 {s.returned}
                  </span>
                </Space>
              }
            >
              <span
                className={`owner-review-stage-seg is-${s.stage}`}
                style={{ width: `${widthPct}%` }}
              />
            </Tooltip>
          );
        })}
      </div>
      <div className="owner-review-stage-legend">
        {stageData.map((s) => (
          <span key={s.stage} className="owner-review-stage-legend-item">
            <span
              className="owner-review-stage-legend-dot"
              style={{ background: stageColor[s.stage] }}
            />
            {stageLabel[s.stage]} {s.reviewed}/{s.total}
          </span>
        ))}
      </div>
    </div>
  );
}

/* =============== 审核员负载 =============== */

function ReviewerWorkloadCard({
  overview,
  loading,
}: {
  overview: OwnerReviewOverview | null;
  loading: boolean;
}) {
  const list = overview?.reviewerWorkloads ?? [];
  return (
    <Card title="审核员当日负载" loading={loading} bordered={false}>
      {list.length === 0 ? (
        <Empty description="暂无审核员数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <div className="owner-review-workload-list">
          {list.map((w) => (
            <div key={w.reviewerId} className="owner-review-workload-item">
              <Space direction="vertical" size={2}>
                <span className="owner-review-workload-name">{w.reviewerName}</span>
                <span className="owner-review-workload-meta">
                  <span>
                    待审 <strong>{w.pending}</strong>
                  </span>
                  <span>
                    今日已审 <strong>{w.reviewedToday}</strong>
                  </span>
                </span>
              </Space>
              <Tooltip
                title={`平均处理 ${Math.round(w.avgDurationSec)} 秒 / 条`}
              >
                <Progress
                  type="circle"
                  size={48}
                  percent={Math.round(w.consistencyRate * 100)}
                  format={(p) => (
                    <span style={{ fontSize: 12 }}>{p}%</span>
                  )}
                />
              </Tooltip>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* =============== 审计日志侧栏 =============== */

function AuditLogCard({
  entries,
  loading,
  roleFilter,
  onRoleChange,
}: {
  entries: ReviewAuditLogEntry[];
  loading: boolean;
  roleFilter: ReviewAuditLogEntry['operatorRole'] | 'all';
  onRoleChange: (v: ReviewAuditLogEntry['operatorRole'] | 'all') => void;
}) {
  return (
    <Card
      className="owner-review-audit-card"
      title="审计日志"
      extra={
        <Select
          size="small"
          value={roleFilter}
          onChange={onRoleChange}
          style={{ width: 130 }}
          options={[
            { label: '全部角色', value: 'all' },
            { label: '审核员', value: 'reviewer' },
            { label: '负责人', value: 'owner' },
            { label: '系统/AI', value: 'system_agent' },
            { label: '标注员', value: 'labeler' },
          ]}
        />
      }
      loading={loading}
      bordered={false}
    >
      {entries.length === 0 ? (
        <Empty
          description="近 7 天暂无审核流转日志"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      ) : (
        <Timeline
          mode="left"
          items={entries.slice(0, 12).map((entry) => ({
            color: timelineColorOf(entry),
            children: <AuditEntryLine entry={entry} />,
          }))}
        />
      )}
    </Card>
  );
}

function timelineColorOf(entry: ReviewAuditLogEntry) {
  const action = entry.action.toLowerCase();
  if (action.includes('approve') || action.includes('accept')) return 'green';
  if (action.includes('return') || action.includes('reject')) return 'red';
  if (action.includes('escalate') || action.includes('dispute')) return 'purple';
  if (entry.operatorRole === 'system_agent') return 'gray';
  return 'blue';
}

function AuditEntryLine({ entry }: { entry: ReviewAuditLogEntry }) {
  return (
    <div className="owner-review-audit-row">
      <span className="owner-review-audit-action">
        {prettifyAction(entry.action)}
      </span>
      <Text type="secondary" className="owner-review-audit-meta">
        {entry.operatorName}
        <Text type="secondary" style={{ margin: '0 4px' }}>
          ·
        </Text>
        {operatorRoleLabel[entry.operatorRole]}
        {entry.taskTitle && (
          <>
            <Text type="secondary" style={{ margin: '0 4px' }}>
              ·
            </Text>
            {entry.taskTitle}
          </>
        )}
      </Text>
      <Text type="secondary" style={{ fontSize: 12 }}>
        {entry.entityType} · {entry.entityId}
        {entry.fromState && entry.toState && (
          <>
            <Text type="secondary" style={{ margin: '0 4px' }}>
              ·
            </Text>
            {entry.fromState} → {entry.toState}
          </>
        )}
        <Text type="secondary" style={{ marginLeft: 8 }}>
          {entry.occurredAt}
        </Text>
      </Text>
      {entry.reason && (
        <div className="owner-review-audit-reason">原因:{entry.reason}</div>
      )}
    </div>
  );
}

/** 把 annotation.review.approve 这种 action 转成可读中文 */
function prettifyAction(action: string): string {
  const map: Record<string, string> = {
    'annotation.review.approve': '审核通过',
    'annotation.review.return': '审核打回',
    'annotation.review.revise': '重新提交',
    'annotation.review.escalate': '升级到争议样本',
    'annotation.submit': '标注员提交答案',
    'ai_review.complete': 'AI 预审完成',
    'ai_review.fail': 'AI 预审失败',
    'export.complete': '导出完成',
  };
  return map[action] ?? action;
}

/* =============== 任务详情抽屉 =============== */

function TaskDetailDrawer({
  task,
  annotations,
  loading,
  onClose,
}: {
  task: OwnerReviewTaskRow | null;
  annotations: OwnerReviewAnnotation[];
  loading: boolean;
  onClose: () => void;
}) {
  // 只读条目表
  const columns: ColumnsType<OwnerReviewAnnotation> = [
    {
      title: 'Annotation',
      dataIndex: 'annotationId',
      width: 130,
      render: (text: string) => <Text code>{text}</Text>,
    },
    {
      title: 'Item / 标注员',
      width: 180,
      render: (_, row) => (
        <Space direction="vertical" size={2}>
          <Text>{row.itemId}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {row.labelerName}
          </Text>
        </Space>
      ),
    },
    {
      title: '当前阶段',
      width: 90,
      render: (_, row) => (
        <Tag color="processing" style={{ borderRadius: 999 }}>
          {stageLabel[row.currentStage]}
        </Tag>
      ),
    },
    {
      title: '状态',
      width: 100,
      render: (_, row) => {
        const meta = annotationStatusMeta[row.status];
        return (
          <Space size={4} wrap>
            <Tag color={meta.color} style={{ borderRadius: 999 }}>
              {meta.label}
            </Tag>
            {row.sampling && (
              <Tag className="owner-review-meta-tag is-sampling">抽检</Tag>
            )}
          </Space>
        );
      },
    },
    {
      title: 'AI 预审',
      width: 130,
      render: (_, row) =>
        row.aiDecision ? (
          <Tag
            color={
              row.aiDecision === 'PASS'
                ? 'success'
                : row.aiDecision === 'REJECT'
                  ? 'error'
                  : 'warning'
            }
            style={{ borderRadius: 999 }}
          >
            {row.aiDecision}
          </Tag>
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
    {
      title: '最近裁决',
      width: 130,
      render: (_, row) => (
        <Space direction="vertical" size={2}>
          <Text>{row.lastDecision ?? '-'}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {row.lastReviewer ?? '-'}
          </Text>
        </Space>
      ),
    },
    {
      title: '更新',
      dataIndex: 'updatedAt',
      width: 110,
      render: (text: string) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {text}
        </Text>
      ),
    },
  ];

  return (
    <Drawer
      open={!!task}
      onClose={onClose}
      width={Math.min(960, window.innerWidth * 0.9)}
      title={
        task ? (
          <Space direction="vertical" size={2}>
            <Text strong>{task.taskTitle}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {task.taskId}
              {task.taskType && (
                <>
                  <Text type="secondary" style={{ margin: '0 4px' }}>
                    ·
                  </Text>
                  {task.taskType}
                </>
              )}
              {task.deadline && (
                <>
                  <Text type="secondary" style={{ margin: '0 4px' }}>
                    ·
                  </Text>
                  截止 {task.deadline}
                </>
              )}
            </Text>
          </Space>
        ) : (
          '任务详情'
        )
      }
      destroyOnClose
    >
      {task && (
        <>
          {/* 三阶段汇总卡 */}
          <div className="owner-review-stage-cards">
            {(['initial', 'second', 'final'] as ReviewStage[]).map((stage) => {
              const s = pickStage(task.stages, stage);
              const total = s.reviewed + s.pending;
              const reviewedPct =
                total > 0 ? Math.round((s.reviewed / total) * 100) : 0;
              return (
                <div key={stage} className="owner-review-stage-card">
                  <div className="owner-review-stage-card-title">
                    <span
                      className="owner-review-stage-legend-dot"
                      style={{ background: stageColor[stage] }}
                    />
                    {stageLabel[stage]}
                  </div>
                  <div className="owner-review-stage-card-value">
                    {reviewedPct}%
                  </div>
                  <div className="owner-review-stage-card-meta">
                    <span>
                      已审 <strong>{s.reviewed}</strong>
                    </span>
                    <span>
                      待审 <strong>{s.pending}</strong>
                    </span>
                    <span>
                      打回 <strong>{s.returned}</strong>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 条目明细表 */}
          <Card
            size="small"
            title="条目明细"
            extra={
              <Text type="secondary" style={{ fontSize: 12 }}>
                共 {annotations.length} 条 · 仅展示最近 50 条
              </Text>
            }
            bordered={false}
          >
            <Table<OwnerReviewAnnotation>
              rowKey="annotationId"
              columns={columns}
              dataSource={annotations}
              loading={loading}
              size="small"
              locale={{ emptyText: <Empty description="暂无条目" /> }}
              pagination={{
                defaultPageSize: 10,
                showSizeChanger: true,
                pageSizeOptions: ['10', '20', '50'],
              }}
            />
          </Card>
        </>
      )}
    </Drawer>
  );
}
