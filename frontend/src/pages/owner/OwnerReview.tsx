import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
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
  Alert,
  Button,
  Card,
  Col,
  Drawer,
  Empty,
  Input,
  Pagination,
  Popover,
  Progress,
  Row,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Timeline,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { PaginationProps } from 'antd';

import { ownerReviewApi } from '../../api/ownerReview';
import { getApiErrorMessage } from '../../api/client';
import type {
  OwnerReviewAnnotation,
  OwnerReviewOverview,
  OwnerReviewReviewer,
  OwnerReviewTaskRow,
  ReviewAuditItemTimeline,
  ReviewAuditLogEntry,
} from '../../types/ownerReview';

/**
 * Owner 端「人工审核」页面。
 *
 * 对齐《项目实施计划书》4.5 / 4.6:
 *   - Owner 视角是「跟踪 + 审计」,不是替代 Reviewer 逐条裁决;
 *   - 顶部 KPI 概览 (待审、今日通过/打回、争议、抽检覆盖、双审一致率、返工率);
 *   - 任务级进度表:审核结果计数 + 抽检比例 + SLA;
 *   - 任务详情抽屉:条目明细表 (只读);
 *   - 审计日志侧栏:操作时间线,可按审核员过滤。
 *
 * 后端接口失败时显示真实错误态,不再回落演示样例。
 */

const { Title, Paragraph, Text } = Typography;

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

const MOBILE_REVIEW_DETAIL_PAGE_SIZE = 10;

/** 把 0-1 的小数格式化为百分比文本 */
function pct(value: number, fractionDigits = 1) {
  if (Number.isNaN(value) || !Number.isFinite(value)) return '0%';
  return `${(value * 100).toFixed(fractionDigits)}%`;
}

export default function OwnerReview() {
  const { message } = AntdApp.useApp();

  const [overview, setOverview] = useState<OwnerReviewOverview | null>(null);
  const [tasks, setTasks] = useState<OwnerReviewTaskRow[]>([]);
  const [auditLog, setAuditLog] = useState<ReviewAuditLogEntry[]>([]);
  const [reviewers, setReviewers] = useState<OwnerReviewReviewer[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** 任务表筛选 */
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'in_progress' | 'completed' | 'has_disputes'
  >('all');

  /** 审计日志筛选 */
  const [auditReviewerId, setAuditReviewerId] = useState<string>('all');

  /** 任务详情抽屉 */
  const [detailTask, setDetailTask] = useState<OwnerReviewTaskRow | null>(null);
  const [detailAnnotations, setDetailAnnotations] = useState<
    OwnerReviewAnnotation[]
  >([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  /** 全量审计日志 Drawer */
  const [auditDrawerOpen, setAuditDrawerOpen] = useState(false);
  const [auditDrawerPage, setAuditDrawerPage] = useState(1);
  const [auditDrawerItems, setAuditDrawerItems] = useState<ReviewAuditLogEntry[]>([]);
  const [auditDrawerTotal, setAuditDrawerTotal] = useState(0);
  const [auditDrawerLoading, setAuditDrawerLoading] = useState(false);
  const [auditDrawerError, setAuditDrawerError] = useState<string | null>(null);
  const [auditItemTimelineCache, setAuditItemTimelineCache] = useState<
    Record<string, ReviewAuditItemTimeline>
  >({});
  const [auditItemTimelineLoading, setAuditItemTimelineLoading] = useState<
    Record<string, boolean>
  >({});
  const [auditItemTimelineErrors, setAuditItemTimelineErrors] = useState<
    Record<string, string>
  >({});
  const [auditItemDrawerOpen, setAuditItemDrawerOpen] = useState(false);
  const [activeAuditItemTimeline, setActiveAuditItemTimeline] =
    useState<ReviewAuditItemTimeline | null>(null);
  const taskTableCardMeasureRef = useRef<HTMLDivElement | null>(null);
  const reviewerWorkloadMeasureRef = useRef<HTMLDivElement | null>(null);
  const auditLogMeasureRef = useRef<HTMLDivElement | null>(null);
  const [auditLogCardHeight, setAuditLogCardHeight] = useState<number | null>(null);
  const [isMobileAuditInteraction, setIsMobileAuditInteraction] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(max-width: 768px)');
    const syncMobileAuditInteraction = () => {
      setIsMobileAuditInteraction(mql.matches);
    };
    syncMobileAuditInteraction();
    mql.addEventListener('change', syncMobileAuditInteraction);
    return () => {
      mql.removeEventListener('change', syncMobileAuditInteraction);
    };
  }, []);

  useEffect(() => {
    const taskTableEl = taskTableCardMeasureRef.current;
    const reviewerWorkloadEl = reviewerWorkloadMeasureRef.current;
    const auditLogEl = auditLogMeasureRef.current;
    if (
      !taskTableEl
      || !reviewerWorkloadEl
      || !auditLogEl
      || typeof ResizeObserver === 'undefined'
    ) {
      setAuditLogCardHeight(null);
      return;
    }

    let frameId = 0;
    const syncAuditLogCardHeight = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        const taskTableRect = taskTableEl.getBoundingClientRect();
        const auditLogRect = auditLogEl.getBoundingClientRect();
        const nextHeight = Math.round(taskTableRect.bottom - auditLogRect.top);
        setAuditLogCardHeight((prevHeight) => {
          if (nextHeight <= 0) return prevHeight === null ? prevHeight : null;
          return prevHeight === nextHeight ? prevHeight : nextHeight;
        });
      });
    };

    const observer = new ResizeObserver(syncAuditLogCardHeight);
    observer.observe(taskTableEl);
    observer.observe(reviewerWorkloadEl);
    observer.observe(auditLogEl);
    syncAuditLogCardHeight();

    return () => {
      window.cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, []);

  /** 拉取 KPI + 任务列表 + 审计日志 */
  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [overviewRes, tasksRes, auditRes, reviewerRes] = await Promise.all([
        ownerReviewApi.getOverview(30),
        ownerReviewApi.listTasks({ status: 'all' }),
        ownerReviewApi.listAuditLog({
          days: 7,
          reviewerId: auditReviewerId === 'all' ? undefined : auditReviewerId,
        }),
        ownerReviewApi.listReviewers(),
      ]);
      setOverview(overviewRes);
      setTasks(tasksRes.items ?? []);
      setAuditLog(auditRes.items ?? []);
      setReviewers(reviewerRes ?? []);
    } catch (error) {
      setOverview(null);
      setTasks([]);
      setAuditLog([]);
      setReviewers([]);
      setLoadError(getApiErrorMessage(error, '人工审核数据加载失败'));
    } finally {
      setLoading(false);
    }
  }, [auditReviewerId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  /** 打开任务详情抽屉时拉条目明细 */
  const openTaskDetail = async (task: OwnerReviewTaskRow) => {
    setDetailTask(task);
    setDetailAnnotations([]);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const res = await ownerReviewApi.listTaskAnnotations(task.taskId, {
        page: 1,
        pageSize: 50,
      });
      setDetailAnnotations(res.items ?? []);
    } catch (error) {
      setDetailAnnotations([]);
      setDetailError(getApiErrorMessage(error, '加载条目明细失败'));
      message.error(getApiErrorMessage(error, '加载条目明细失败'));
    } finally {
      setDetailLoading(false);
    }
  };

  const auditReviewerName = useMemo(() => {
    if (auditReviewerId === 'all') return '全部审核员';
    return reviewers.find((reviewer) => reviewer.reviewerId === auditReviewerId)
      ?.reviewerName ?? '指定审核员';
  }, [auditReviewerId, reviewers]);

  const loadAuditDrawer = useCallback(
    async (page = 1) => {
      setAuditDrawerLoading(true);
      setAuditDrawerError(null);
      try {
        const res = await ownerReviewApi.listAuditLog({
          days: 365,
          reviewerId: auditReviewerId === 'all' ? undefined : auditReviewerId,
          page,
          pageSize: 20,
        });
        setAuditDrawerItems(res.items ?? []);
        setAuditDrawerTotal(res.total ?? 0);
        setAuditDrawerPage(res.page ?? page);
      } catch (error) {
        setAuditDrawerItems([]);
        setAuditDrawerTotal(0);
        setAuditDrawerError(getApiErrorMessage(error, '加载全部审计日志失败'));
      } finally {
        setAuditDrawerLoading(false);
      }
    },
    [auditReviewerId],
  );

  const openAuditDrawer = () => {
    setAuditDrawerOpen(true);
    void loadAuditDrawer(1);
  };

  const closeAuditDrawer = () => {
    setAuditDrawerOpen(false);
  };

  const handleAuditDrawerPageChange: PaginationProps['onChange'] = (page) => {
    void loadAuditDrawer(page);
  };

  const ensureAuditItemTimeline = useCallback(
    async (entry: ReviewAuditLogEntry, force = false) => {
      if (!force && auditItemTimelineCache[entry.logId]) {
        return auditItemTimelineCache[entry.logId];
      }
      if (!force && auditItemTimelineLoading[entry.logId]) {
        return null;
      }
      setAuditItemTimelineLoading((prev) => ({ ...prev, [entry.logId]: true }));
      setAuditItemTimelineErrors((prev) => {
        const next = { ...prev };
        delete next[entry.logId];
        return next;
      });
      try {
        const res = await ownerReviewApi.getAuditLogItemTimeline(entry.logId);
        setAuditItemTimelineCache((prev) => ({ ...prev, [entry.logId]: res }));
        return res;
      } catch (error) {
        setAuditItemTimelineErrors((prev) => ({
          ...prev,
          [entry.logId]: getApiErrorMessage(error, '加载同题日志失败'),
        }));
        throw error;
      } finally {
        setAuditItemTimelineLoading((prev) => ({
          ...prev,
          [entry.logId]: false,
        }));
      }
    },
    [auditItemTimelineCache, auditItemTimelineLoading],
  );

  const previewAuditItemTimeline = useCallback(
    (entry: ReviewAuditLogEntry) => {
      void ensureAuditItemTimeline(entry).catch(() => undefined);
    },
    [ensureAuditItemTimeline],
  );

  const retryAuditItemTimeline = useCallback(
    (entry: ReviewAuditLogEntry) => {
      void ensureAuditItemTimeline(entry, true).catch(() => undefined);
    },
    [ensureAuditItemTimeline],
  );

  const openAuditItemDrawerFromEntry = useCallback(
    async (entry: ReviewAuditLogEntry) => {
      try {
        const timeline = await ensureAuditItemTimeline(entry);
        if (timeline) {
          setActiveAuditItemTimeline(timeline);
          setAuditItemDrawerOpen(true);
        }
      } catch (error) {
        message.error(getApiErrorMessage(error, '加载同题日志失败'));
      }
    },
    [ensureAuditItemTimeline, message],
  );

  const auditEntryInteractionMode = isMobileAuditInteraction ? 'drawer' : 'popover';

  const openAuditItemDrawer = (timeline: ReviewAuditItemTimeline) => {
    setActiveAuditItemTimeline(timeline);
    setAuditItemDrawerOpen(true);
  };

  const closeAuditItemDrawer = () => {
    setAuditItemDrawerOpen(false);
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
      if (statusFilter === 'in_progress' && t.inProgress <= 0) return false;
      if (statusFilter === 'completed' && t.inProgress > 0) return false;
      if (statusFilter === 'has_disputes' && t.disputes <= 0) return false;
      return true;
    });
  }, [tasks, keyword, statusFilter]);

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
      title: '通过 / 打回 / 进行中',
      width: 260,
      render: (_, row) => (
        <Space direction="vertical" size={6}>
          <div className="owner-review-result-row">
            <Tag className="owner-review-result-pill is-approved" icon={<CheckCircleFilled />}>
              通过 {row.approvedCount}
            </Tag>
            <Tag className="owner-review-result-pill is-returned" icon={<CloseCircleFilled />}>
              打回 {row.returnedCount}
            </Tag>
            <Tag className="owner-review-result-pill is-progress" icon={<ClockCircleOutlined />}>
              进行中 {row.inProgress}
            </Tag>
          </div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            共 {row.totalAnnotations} 条 · 人工已审 {row.totalReviewed}
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
    <Space direction="vertical" size="large" className="page-stack owner-review-page">
      {/* 标题 + 阶段标识 */}
      <div className="page-title-row">
        <Space direction="vertical" size={4}>
          <Title level={3}>人工审核</Title>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            只读跟踪人工审核进度、审核人员表现与审计日志。
          </Paragraph>
        </Space>
        <Space size={8}>
          <Tag color="processing" icon={<ThunderboltFilled />}>
            Phase 5 · AI 与人工审核
          </Tag>
        </Space>
      </div>

      {loadError && (
        <Alert
          type="error"
          showIcon
          message="人工审核数据加载失败"
          description={loadError}
          action={
            <Button size="small" icon={<ReloadOutlined />} onClick={() => void loadAll()}>
              重试
            </Button>
          }
        />
      )}

      {/* 顶部 KPI 概览 */}
      <OverviewKpi overview={overview} loading={loading} />

      {/* 主区:右侧审计日志通过 ResizeObserver 跟随左侧任务表卡片高度,不包含上方工具条。 */}
      <Row gutter={16} align="stretch">
        <Col xs={24} xl={18}>
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
            <div
              ref={taskTableCardMeasureRef}
              className="owner-review-task-table-measure"
            >
              <Card className="owner-table-card owner-review-task-table-card" loading={loading}>
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
            </div>
          </Space>
        </Col>

        <Col xs={24} xl={6} className="owner-review-side-col">
          <Space
            direction="vertical"
            size={16}
            className="owner-review-side-stack"
            style={{ width: '100%' }}
          >
            <div
              ref={reviewerWorkloadMeasureRef}
              className="owner-review-workload-measure"
            >
              <ReviewerWorkloadCard overview={overview} loading={loading} />
            </div>
            <div
              ref={auditLogMeasureRef}
              className={`owner-review-audit-measure${
                auditLogCardHeight ? ' owner-review-audit-measure--height-synced' : ''
              }`}
              style={
                auditLogCardHeight
                  ? ({ '--owner-review-audit-card-height': `${auditLogCardHeight}px` } as CSSProperties)
                  : undefined
              }
            >
              <AuditLogCard
                entries={auditLog}
                loading={loading}
                reviewers={reviewers}
                reviewerId={auditReviewerId}
                onReviewerChange={setAuditReviewerId}
                onOpenAll={openAuditDrawer}
                timelineCache={auditItemTimelineCache}
                timelineLoading={auditItemTimelineLoading}
                timelineErrors={auditItemTimelineErrors}
                interactionMode={auditEntryInteractionMode}
                onPreviewTimeline={previewAuditItemTimeline}
                onRetryTimeline={retryAuditItemTimeline}
                onOpenEntry={openAuditItemDrawerFromEntry}
                onOpenTimeline={openAuditItemDrawer}
              />
            </div>
          </Space>
        </Col>
      </Row>

      {/* 任务详情抽屉 */}
      <TaskDetailDrawer
        task={detailTask}
        annotations={detailAnnotations}
        loading={detailLoading}
        error={detailError}
        onRetry={detailTask ? () => void openTaskDetail(detailTask) : undefined}
        onClose={() => setDetailTask(null)}
      />

      <AuditLogDrawer
        open={auditDrawerOpen}
        reviewerName={auditReviewerName}
        entries={auditDrawerItems}
        total={auditDrawerTotal}
        page={auditDrawerPage}
        loading={auditDrawerLoading}
        error={auditDrawerError}
        onPageChange={handleAuditDrawerPageChange}
        onRetry={() => void loadAuditDrawer(auditDrawerPage)}
        onClose={closeAuditDrawer}
        timelineCache={auditItemTimelineCache}
        timelineLoading={auditItemTimelineLoading}
        timelineErrors={auditItemTimelineErrors}
        interactionMode={auditEntryInteractionMode}
        onPreviewTimeline={previewAuditItemTimeline}
        onRetryTimeline={retryAuditItemTimeline}
        onOpenEntry={openAuditItemDrawerFromEntry}
        onOpenTimeline={openAuditItemDrawer}
      />

      <AuditItemTimelineDrawer
        open={auditItemDrawerOpen}
        timeline={activeAuditItemTimeline}
        onClose={closeAuditItemDrawer}
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
              待终审处理
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
            <Tag color="processing">已抽检样本占比</Tag>
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
    <Card
      title="审核员当日负载"
      className="owner-review-workload-card"
      loading={loading}
      bordered={false}
    >
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
                    今日已审 <strong>{w.reviewedToday}</strong>
                  </span>
                  <span>平均 {Math.round(w.avgDurationSec)} 秒/条</span>
                </span>
              </Space>
              <Tooltip
                title={`平均处理 ${Math.round(w.avgDurationSec)} 秒 / 条`}
              >
                <Progress
                  className="owner-review-workload-progress"
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

type AuditEntryInteractionMode = 'popover' | 'drawer';

type AuditTimelineControls = {
  timelineCache: Record<string, ReviewAuditItemTimeline>;
  timelineLoading: Record<string, boolean>;
  timelineErrors: Record<string, string>;
  interactionMode: AuditEntryInteractionMode;
  onPreviewTimeline: (entry: ReviewAuditLogEntry) => void | Promise<void>;
  onRetryTimeline: (entry: ReviewAuditLogEntry) => void;
  onOpenEntry: (entry: ReviewAuditLogEntry) => void | Promise<void>;
  onOpenTimeline: (timeline: ReviewAuditItemTimeline) => void;
};

function AuditLogCard({
  entries,
  loading,
  reviewers,
  reviewerId,
  onReviewerChange,
  onOpenAll,
  timelineCache,
  timelineLoading,
  timelineErrors,
  interactionMode,
  onPreviewTimeline,
  onRetryTimeline,
  onOpenEntry,
  onOpenTimeline,
}: {
  entries: ReviewAuditLogEntry[];
  loading: boolean;
  reviewers: OwnerReviewReviewer[];
  reviewerId: string;
  onReviewerChange: (v: string) => void;
  onOpenAll: () => void;
} & AuditTimelineControls) {
  return (
    <Card
      className="owner-review-audit-card"
      title="审计日志"
      extra={
        <Space size={6} className="owner-review-audit-card-extra">
          <Select
            className="owner-review-audit-reviewer-select"
            size="small"
            value={reviewerId}
            onChange={onReviewerChange}
            style={{ width: 150 }}
            options={[
              { label: '全部审核员', value: 'all' },
              ...reviewers.map((reviewer) => ({
                label: reviewer.reviewerName,
                value: reviewer.reviewerId,
              })),
            ]}
          />
          <Tooltip title="查看全部日志">
            <Button
              className="owner-review-audit-open-all"
              size="small"
              icon={<FileSearchOutlined />}
              aria-label="查看全部日志"
              onClick={onOpenAll}
            />
          </Tooltip>
        </Space>
      }
      loading={loading}
      bordered={false}
    >
      {entries.length === 0 ? (
        <Empty
          description="近 7 天暂无人工审核日志"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      ) : (
        <Timeline
          mode="left"
          items={entries.slice(0, 12).map((entry) => ({
            color: timelineColorOf(entry),
            children: (
              <AuditEntryLineWithTimeline
                entry={entry}
                timeline={timelineCache[entry.logId]}
                loading={!!timelineLoading[entry.logId]}
                error={timelineErrors[entry.logId]}
                interactionMode={interactionMode}
                onPreview={() => void onPreviewTimeline(entry)}
                onRetry={() => onRetryTimeline(entry)}
                onOpenEntry={() => void onOpenEntry(entry)}
                onOpenTimeline={onOpenTimeline}
              />
            ),
          }))}
        />
      )}
    </Card>
  );
}

function AuditLogDrawer({
  open,
  reviewerName,
  entries,
  total,
  page,
  loading,
  error,
  onPageChange,
  onRetry,
  onClose,
  timelineCache,
  timelineLoading,
  timelineErrors,
  interactionMode,
  onPreviewTimeline,
  onRetryTimeline,
  onOpenEntry,
  onOpenTimeline,
}: {
  open: boolean;
  reviewerName: string;
  entries: ReviewAuditLogEntry[];
  total: number;
  page: number;
  loading: boolean;
  error?: string | null;
  onPageChange: PaginationProps['onChange'];
  onRetry: () => void;
  onClose: () => void;
} & AuditTimelineControls) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={Math.min(760, window.innerWidth * 0.9)}
      title={
        <Space direction="vertical" size={2}>
          <Text strong>全部审计日志</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {reviewerName} · 近 365 天
          </Text>
        </Space>
      }
      destroyOnClose
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {error && (
          <Alert
            type="error"
            showIcon
            message="全部审计日志加载失败"
            description={error}
            action={
              <Button size="small" icon={<ReloadOutlined />} onClick={onRetry}>
                重试
              </Button>
            }
          />
        )}
        <Card
          className="owner-review-audit-drawer-card"
          loading={loading}
          bordered={false}
        >
          {entries.length === 0 ? (
            <Empty
              description="近 365 天暂无人工审核日志"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          ) : (
            <Timeline
              mode="left"
              items={entries.map((entry) => ({
                color: timelineColorOf(entry),
                children: (
                  <AuditEntryLineWithTimeline
                    entry={entry}
                    timeline={timelineCache[entry.logId]}
                    loading={!!timelineLoading[entry.logId]}
                    error={timelineErrors[entry.logId]}
                    interactionMode={interactionMode}
                    rowClassName="owner-review-audit-row--drawer"
                    onPreview={() => void onPreviewTimeline(entry)}
                    onRetry={() => onRetryTimeline(entry)}
                    onOpenEntry={() => void onOpenEntry(entry)}
                    onOpenTimeline={onOpenTimeline}
                  />
                ),
              }))}
            />
          )}
        </Card>
        <div className="owner-review-audit-drawer-pagination">
          <Pagination
            current={page}
            pageSize={20}
            total={total}
            showSizeChanger={false}
            showTotal={(value) => `共 ${value} 条日志`}
            onChange={onPageChange}
          />
        </div>
      </Space>
    </Drawer>
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

function fallbackAuditItemTitle(entry: ReviewAuditLogEntry) {
  const taskTitle = entry.taskTitle || '标注任务';
  return entry.itemIndex && entry.itemIndex > 0
    ? `${taskTitle} · 第 ${entry.itemIndex} 题`
    : `${taskTitle} · 题号缺失`;
}

type AuditPreviewGroup = {
  key: string;
  collapseKey?: string;
  primary: ReviewAuditLogEntry;
  items: ReviewAuditLogEntry[];
};

function buildAuditPreviewGroups(items: ReviewAuditLogEntry[]): AuditPreviewGroup[] {
  const groups: AuditPreviewGroup[] = [];
  items.forEach((item) => {
    const collapseKey = auditPreviewCollapseKey(item);
    const latestGroup = groups[groups.length - 1];
    if (
      collapseKey
      && latestGroup?.collapseKey === collapseKey
      && canMergeAuditPreviewItem(latestGroup, item)
    ) {
      latestGroup.items.push(item);
      return;
    }
    groups.push({ key: item.logId, collapseKey: collapseKey ?? undefined, primary: item, items: [item] });
  });
  return groups;
}

function auditPreviewCollapseKey(item: ReviewAuditLogEntry) {
  const phase = auditPreviewBusinessPhase(item);
  if (!phase) {
    return null;
  }
  return [
    item.assignmentId || '',
    phase,
    auditPreviewOperatorKey(item, phase),
    item.occurredAt,
  ].join('|');
}

function auditPreviewBusinessPhase(item: ReviewAuditLogEntry) {
  const entityType = item.entityType.toLowerCase();
  if (['annotation', 'assignment'].includes(entityType)) {
    if (['human_review.approve', 'human_review.return', 'human_review.revise.accept'].includes(item.action)) {
      return item.action;
    }
  }
  if (['annotation', 'ai_review_job'].includes(entityType)) {
    if (item.action === 'ai_review.start') {
      return aiReviewStartPhase(item);
    }
    if ([
      'ai_review.complete',
      'ai_review.fail',
      'ai_review.retry',
      'ai_review.fallback_to_human',
    ].includes(item.action)) {
      return item.action;
    }
  }
  return null;
}

function aiReviewStartPhase(item: ReviewAuditLogEntry) {
  const entityType = item.entityType.toLowerCase();
  const fromState = item.fromState?.toLowerCase();
  const toState = item.toState?.toLowerCase();
  if (entityType === 'ai_review_job' && fromState === 'pending' && toState === 'running') {
    return 'ai_review.start.running';
  }
  return 'ai_review.start.queued';
}

function auditPreviewOperatorKey(item: ReviewAuditLogEntry, phase: string) {
  if (phase === 'ai_review.start.queued') {
    return item.operatorName;
  }
  return `${item.operatorRole}|${item.operatorName}`;
}

function canMergeAuditPreviewItem(group: AuditPreviewGroup, item: ReviewAuditLogEntry) {
  return !group.items.some((existing) => (
    existing.logId === item.logId
    || (existing.entityType === item.entityType && existing.entityId === item.entityId)
  ));
}

function auditPreviewEntitySummary(items: ReviewAuditLogEntry[]) {
  return `底层实体: ${items.map((item) => `${item.entityType} ${item.entityId}`).join('、')}`;
}

function prettifyAuditPreviewAction(group: AuditPreviewGroup) {
  const phase = group.collapseKey?.split('|')[1];
  if (phase === 'ai_review.start.queued') {
    return 'AI 预审排队';
  }
  if (phase === 'ai_review.start.running') {
    return 'AI 预审开始运行';
  }
  return prettifyAction(group.primary.action);
}

function AuditEntryLineWithTimeline({
  entry,
  timeline,
  loading,
  error,
  interactionMode,
  rowClassName,
  onPreview,
  onRetry,
  onOpenEntry,
  onOpenTimeline,
}: {
  entry: ReviewAuditLogEntry;
  timeline?: ReviewAuditItemTimeline;
  loading: boolean;
  error?: string;
  interactionMode: AuditEntryInteractionMode;
  rowClassName?: string;
  onPreview: () => void;
  onRetry: () => void;
  onOpenEntry: () => void;
  onOpenTimeline: (timeline: ReviewAuditItemTimeline) => void;
}) {
  const title = entry.itemTitle || fallbackAuditItemTitle(entry);
  const rowClassNames = [
    'owner-review-audit-row',
    interactionMode === 'drawer' ? 'owner-review-audit-row--clickable' : '',
    rowClassName ?? '',
  ].filter(Boolean).join(' ');
  const row = (
    <div
      className={rowClassNames}
      tabIndex={0}
      role={interactionMode === 'drawer' ? 'button' : undefined}
      aria-label={interactionMode === 'drawer' ? `查看${prettifyAction(entry.action)}同题日志` : undefined}
      onClick={interactionMode === 'drawer' ? onOpenEntry : undefined}
      onKeyDown={
        interactionMode === 'drawer'
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onOpenEntry();
              }
            }
          : undefined
      }
    >
      <span className="owner-review-audit-action">
        {prettifyAction(entry.action)}
      </span>
      <Text type="secondary" className="owner-review-audit-meta">
        {entry.operatorName}
        <Text type="secondary" style={{ margin: '0 4px' }}>
          ·
        </Text>
        {title}
      </Text>
      <Text type="secondary" style={{ fontSize: 12 }}>
        {entry.fromState && entry.toState && (
          <>
            {entry.fromState} → {entry.toState}
            <Text type="secondary" style={{ margin: '0 4px' }}>
              ·
            </Text>
          </>
        )}
        {entry.occurredAt}
      </Text>
      {entry.reason && (
        <div className="owner-review-audit-reason">原因:{entry.reason}</div>
      )}
    </div>
  );

  if (interactionMode === 'drawer') {
    return row;
  }

  return (
    <Popover
      trigger="hover"
      placement="rightTop"
      overlayClassName="owner-review-audit-popover"
      onOpenChange={(open) => {
        if (open) onPreview();
      }}
      content={
        <AuditItemTimelinePreview
          entry={entry}
          timeline={timeline}
          loading={loading}
          error={error}
          onRetry={onRetry}
          onOpenTimeline={onOpenTimeline}
        />
      }
    >
      {row}
    </Popover>
  );
}

function AuditItemTimelinePreview({
  entry,
  timeline,
  loading,
  error,
  onRetry,
  onOpenTimeline,
}: {
  entry: ReviewAuditLogEntry;
  timeline?: ReviewAuditItemTimeline;
  loading: boolean;
  error?: string;
  onRetry: () => void;
  onOpenTimeline: (timeline: ReviewAuditItemTimeline) => void;
}) {
  if (loading && !timeline) {
    return (
      <div className="owner-review-audit-preview">
        <Spin size="small" />
        <Text type="secondary">加载同题日志...</Text>
      </div>
    );
  }
  if (error && !timeline) {
    return (
      <div className="owner-review-audit-preview">
        <Alert
          type="error"
          showIcon
          message="同题日志加载失败"
          description={error}
          action={<Button size="small" onClick={onRetry}>重试</Button>}
        />
      </div>
    );
  }
  const previewGroups = buildAuditPreviewGroups(timeline?.items ?? []).slice(0, 5);
  return (
    <div className="owner-review-audit-preview">
      <Space direction="vertical" size={2}>
        <Text strong>{timeline?.itemTitle || entry.itemTitle || '同题日志'}</Text>
        <Text type="secondary" style={{ fontSize: 12 }}>
          标注员 {timeline?.labelerName || entry.labelerName || '-'}
        </Text>
      </Space>
      {previewGroups.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无同题日志" />
      ) : (
        <div className="owner-review-audit-preview-list">
          {previewGroups.map((group) => (
            <div key={group.key} className="owner-review-audit-preview-item">
              <Space size={4} wrap>
                <Text strong>{prettifyAuditPreviewAction(group)}</Text>
                {group.items.length > 1 && (
                  <Tag style={{ marginInlineEnd: 0 }}>底层 {group.items.length} 条</Tag>
                )}
              </Space>
              <Text type="secondary">
                {group.primary.operatorName} · {group.primary.occurredAt}
              </Text>
              {group.items.length > 1 && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {auditPreviewEntitySummary(group.items)}
                </Text>
              )}
            </div>
          ))}
        </div>
      )}
      {timeline && (
        <Button
          size="small"
          type="link"
          icon={<FileSearchOutlined />}
          onClick={() => onOpenTimeline(timeline)}
        >
          查看详情
        </Button>
      )}
    </div>
  );
}

function AuditItemTimelineDrawer({
  open,
  timeline,
  onClose,
}: {
  open: boolean;
  timeline: ReviewAuditItemTimeline | null;
  onClose: () => void;
}) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={Math.min(720, window.innerWidth * 0.9)}
      rootClassName="owner-review-audit-item-drawer"
      title={
        <Space direction="vertical" size={2}>
          <Text strong>{timeline?.itemTitle ?? '同题日志详情'}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            标注员 {timeline?.labelerName ?? '-'}
            {timeline?.assignmentId && (
              <>
                <Text type="secondary" style={{ margin: '0 4px' }}>
                  ·
                </Text>
                Assignment {timeline.assignmentId}
              </>
            )}
          </Text>
        </Space>
      }
      destroyOnClose
    >
      {!timeline || timeline.items.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无同题日志" />
      ) : (
        <Timeline
          mode="left"
          items={timeline.items.map((item) => ({
            color: timelineColorOf(item),
            children: <AuditTimelineDetailItem entry={item} />,
          }))}
        />
      )}
    </Drawer>
  );
}

function AuditTimelineDetailItem({ entry }: { entry: ReviewAuditLogEntry }) {
  return (
    <div className="owner-review-audit-detail-item">
      <Space direction="vertical" size={4} style={{ width: '100%' }}>
        <Space size={8} wrap>
          <Text strong>{prettifyAction(entry.action)}</Text>
          <Tag style={{ marginInlineEnd: 0 }}>{entry.operatorName}</Tag>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {entry.occurredAt}
          </Text>
        </Space>
        {entry.fromState && entry.toState && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {entry.fromState} → {entry.toState}
          </Text>
        )}
        <Text type="secondary" style={{ fontSize: 12 }}>
          {entry.entityType} · {entry.entityId}
          {entry.annotationId && <> · Annotation {entry.annotationId}</>}
          {entry.itemId && <> · Item {entry.itemId}</>}
        </Text>
        {entry.reason && (
          <div className="owner-review-audit-reason">原因:{entry.reason}</div>
        )}
      </Space>
    </div>
  );
}

function AuditEntryLine({ entry }: { entry: ReviewAuditLogEntry }) {
  return (
    <div className="owner-review-audit-row">
      <span className="owner-review-audit-action">
        {prettifyAction(entry.action)}
      </span>
      <Text type="secondary" className="owner-review-audit-meta">
        {entry.operatorName}
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
    'human_review.start': '开始人工审核',
    'human_review.approve': '审核通过',
    'human_review.return': '审核打回',
    'human_review.revise': '人工改写',
    'human_review.revise.accept': '改写后通过',
    'human_review.escalate': '升级到争议样本',
    'ai_review.start': 'AI 预审开始',
    'ai_review.complete': 'AI 预审完成',
    'ai_review.fail': 'AI 预审失败',
    'ai_review.retry': 'AI 预审重试',
    'ai_review.fallback_to_human': '转人工审核',
    'ai_review.delete': '删除 AI 预审任务',
    'ai_review.cancel': '取消 AI 预审任务',
    'ai_review.stale_writeback_rejected': '拒绝过期 AI 回写',
    'export.complete': '导出完成',
  };
  return map[action] ?? action;
}

/* =============== 任务详情抽屉 =============== */

function TaskDetailDrawer({
  task,
  annotations,
  loading,
  error,
  onRetry,
  onClose,
}: {
  task: OwnerReviewTaskRow | null;
  annotations: OwnerReviewAnnotation[];
  loading: boolean;
  error?: string | null;
  onRetry?: () => void;
  onClose: () => void;
}) {
  const [mobileVisibleAnnotationCount, setMobileVisibleAnnotationCount] = useState(
    MOBILE_REVIEW_DETAIL_PAGE_SIZE,
  );

  useEffect(() => {
    setMobileVisibleAnnotationCount(MOBILE_REVIEW_DETAIL_PAGE_SIZE);
  }, [task?.taskId]);

  const sortedAnnotations = useMemo(
    () => [...annotations].sort((a, b) => (a.itemIndex || 0) - (b.itemIndex || 0)),
    [annotations],
  );
  const mobileAnnotations = sortedAnnotations.slice(0, mobileVisibleAnnotationCount);
  const hasMoreMobileAnnotations = mobileVisibleAnnotationCount < sortedAnnotations.length;

  // 只读条目表
  const columns: ColumnsType<OwnerReviewAnnotation> = [
    {
      title: '题号',
      dataIndex: 'itemIndex',
      width: 130,
      defaultSortOrder: 'ascend',
      sorter: (a, b) => (a.itemIndex || 0) - (b.itemIndex || 0),
      render: (value: number | undefined, row) => {
        const text = row.annotationId;
        const itemIndex = Number(value);
        const label = Number.isFinite(itemIndex) && itemIndex > 0
          ? `第 ${itemIndex} 题`
          : '题号缺失';
        return (
          <Tooltip title={`Annotation ${text} · Item ${row.itemId}`}>
            <Text strong>{label}</Text>
          </Tooltip>
        );
      },
    },
    {
      title: '标注员',
      dataIndex: 'labelerName',
      width: 150,
      render: (text: string) => <Text>{text || '-'}</Text>,
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
      rootClassName="owner-review-task-detail-drawer"
      title={
        task ? (
          <Space direction="vertical" size={2} className="owner-review-task-detail-title">
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
          {error && (
            <Alert
              type="error"
              showIcon
              message="条目明细加载失败"
              description={error}
              style={{ marginBottom: 16 }}
              action={
                onRetry ? (
                  <Button size="small" icon={<ReloadOutlined />} onClick={onRetry}>
                    重试
                  </Button>
                ) : undefined
              }
            />
          )}

          {/* 条目明细表 */}
          <Card
            className="owner-review-annotation-card"
            size="small"
            title="条目明细"
            extra={
              <Text type="secondary" style={{ fontSize: 12 }}>
                共 {annotations.length} 条 · 按题号升序展示前 50 条
              </Text>
            }
            bordered={false}
          >
            <Table<OwnerReviewAnnotation>
              className="owner-review-annotation-table"
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
            <div className="owner-review-annotation-mobile-list">
              {loading ? (
                <div className="owner-review-annotation-mobile-state">
                  <Spin size="small" />
                  <Text type="secondary">条目加载中...</Text>
                </div>
              ) : sortedAnnotations.length === 0 ? (
                <Empty description="暂无条目" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                <>
                  {mobileAnnotations.map((annotation) => {
                    const itemIndex = Number(annotation.itemIndex);
                    const itemLabel = Number.isFinite(itemIndex) && itemIndex > 0
                      ? `第 ${itemIndex} 题`
                      : '题号缺失';
                    const statusMeta = annotationStatusMeta[annotation.status];
                    return (
                      <article
                        key={annotation.annotationId}
                        className="owner-review-annotation-mobile-card"
                      >
                        <div className="owner-review-annotation-mobile-head">
                          <Text strong>{itemLabel}</Text>
                          <Space size={4} wrap>
                            <Tag color={statusMeta.color} className="owner-review-annotation-mobile-tag">
                              {statusMeta.label}
                            </Tag>
                            {annotation.sampling && (
                              <Tag className="owner-review-meta-tag is-sampling">抽检</Tag>
                            )}
                          </Space>
                        </div>
                        <div className="owner-review-annotation-mobile-grid">
                          <div className="owner-review-annotation-mobile-field">
                            <span>标注员</span>
                            <strong>{annotation.labelerName || '-'}</strong>
                          </div>
                          <div className="owner-review-annotation-mobile-field">
                            <span>AI 预审</span>
                            {annotation.aiDecision ? (
                              <Tag
                                color={
                                  annotation.aiDecision === 'PASS'
                                    ? 'success'
                                    : annotation.aiDecision === 'REJECT'
                                      ? 'error'
                                      : 'warning'
                                }
                                className="owner-review-annotation-mobile-tag"
                              >
                                {annotation.aiDecision}
                              </Tag>
                            ) : (
                              <Text type="secondary">-</Text>
                            )}
                          </div>
                          <div className="owner-review-annotation-mobile-field">
                            <span>最近裁决</span>
                            <strong>{annotation.lastDecision ?? '-'}</strong>
                          </div>
                          <div className="owner-review-annotation-mobile-field">
                            <span>最近审核员</span>
                            <strong>{annotation.lastReviewer ?? '-'}</strong>
                          </div>
                          <div className="owner-review-annotation-mobile-field is-wide">
                            <span>更新时间</span>
                            <strong>{annotation.updatedAt || '-'}</strong>
                          </div>
                        </div>
                        <div className="owner-review-annotation-mobile-ids">
                          <Text type="secondary">Annotation {annotation.annotationId}</Text>
                          <Text type="secondary">Item {annotation.itemId}</Text>
                        </div>
                      </article>
                    );
                  })}
                  <div className="owner-review-annotation-mobile-more">
                    {hasMoreMobileAnnotations ? (
                      <Button
                        block
                        onClick={() =>
                          setMobileVisibleAnnotationCount((count) =>
                            Math.min(count + MOBILE_REVIEW_DETAIL_PAGE_SIZE, sortedAnnotations.length),
                          )
                        }
                      >
                        加载更多（已显示 {mobileAnnotations.length} / {sortedAnnotations.length}）
                      </Button>
                    ) : (
                      <Text type="secondary">已显示全部</Text>
                    )}
                  </div>
                </>
              )}
            </div>
          </Card>
        </>
      )}
    </Drawer>
  );
}
