import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Avatar,
  Button,
  Card,
  Col,
  Drawer,
  Empty,
  Popover,
  Progress,
  Row,
  Skeleton,
  Space,
  Tag,
  Typography,
} from 'antd';
import {
  ArrowRightOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  EditOutlined,
  ExclamationCircleFilled,
  FileTextOutlined,
  ReloadOutlined,
  RightOutlined,
  RiseOutlined,
  ShopOutlined,
} from '@ant-design/icons';
import type { KeyboardEvent, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { labelerOverviewApi } from '../../api/labelerOverview';
import { getApiErrorMessage } from '../../api/client';
import { AiAssistantIcon } from '../../components/icons';
import { useThemeColors } from '../../theme/useThemeColors';
import type {
  LabelerOverview,
  LabelerOverviewPendingTypeDistribution,
  LabelerOverviewRecentBatch,
  LabelerOverviewRewardDetail,
} from '../../types/labelerOverview';

interface KpiItem {
  key: string;
  title: string;
  value: number | string;
  suffix?: string;
  trend?: string;
  trendUp?: boolean;
  icon: ReactNode;
  accent: string;
}

interface RewardTaskSummary {
  taskId: string;
  taskTitle: string;
  itemCount: number;
  rewardTotal: number;
  details: LabelerOverviewRewardDetail[];
}

const reviewLegendConfig = [
  { key: 'aiPass', label: 'AI 通过', color: '#2f7bff' },
  { key: 'aiNeedHuman', label: '需人工复核', color: '#a855f7' },
  { key: 'aiReject', label: 'AI 拒绝', color: '#ef4444' },
  { key: 'humanPass', label: '人工通过', color: '#22c55e' },
  { key: 'humanReturned', label: '打回修改', color: '#f59e0b' },
] as const;

const MOBILE_QUERY = '(max-width: 768px)';

const typeTone: Record<string, string> = {
  text: '#2f7bff',
  image: '#22c55e',
  video: '#a855f7',
  markdown: '#f59e0b',
};

function isMobileViewport() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(MOBILE_QUERY).matches;
}

export default function LabelerOverview() {
  const navigate = useNavigate();
  const themeColors = useThemeColors();
  const [data, setData] = useState<LabelerOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeRewardTask, setActiveRewardTask] = useState<RewardTaskSummary | null>(null);
  const [rewardPopoverOpen, setRewardPopoverOpen] = useState(false);
  const [rewardSummaryOpen, setRewardSummaryOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(isMobileViewport);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await labelerOverviewApi.getOverview();
      setData(response);
    } catch (requestError) {
      setData(null);
      setError(getApiErrorMessage(requestError, '工作概览接口暂不可用'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }

    const mediaQuery = window.matchMedia(MOBILE_QUERY);
    const syncMobileState = () => {
      setIsMobile(mediaQuery.matches);
      if (mediaQuery.matches) {
        setRewardPopoverOpen(false);
      } else {
        setRewardSummaryOpen(false);
      }
    };

    syncMobileState();
    mediaQuery.addEventListener('change', syncMobileState);
    return () => mediaQuery.removeEventListener('change', syncMobileState);
  }, []);

  const kpis = useMemo<KpiItem[]>(() => {
    if (!data) return [];
    return [
      {
        key: 'in-progress',
        title: '进行中任务',
        value: data.kpis.activeTasks,
        icon: <FileTextOutlined />,
        accent: '#2f7bff',
        trend: data.kpis.activeTasks > 0 ? '来自已领取任务' : '暂无进行中任务',
        trendUp: data.kpis.activeTasks > 0,
      },
      {
        key: 'submitted-today',
        title: '今日已提交',
        value: data.kpis.submittedToday,
        icon: <RiseOutlined />,
        accent: '#22c55e',
        trend: `完成率 ${data.todayProgress.percent}%`,
        trendUp: data.todayProgress.percent > 0,
      },
      {
        key: 'returned',
        title: '待修改打回',
        value: data.kpis.returnedItems,
        icon: <ExclamationCircleFilled />,
        accent: '#f59e0b',
        trend: data.kpis.returnedItems > 0 ? '请优先重提' : '暂无打回项',
        trendUp: data.kpis.returnedItems === 0,
      },
      {
        key: 'today-reward',
        title: '今日通过奖励',
        value: `¥${data.kpis.todayReward.toFixed(2)}`,
        icon: <CheckCircleFilled />,
        accent: '#16a34a',
        trend: data.kpis.todayReward > 0 ? '已通过入库题目' : '暂无今日通过',
        trendUp: data.kpis.todayReward > 0,
      },
    ];
  }, [data]);

  const reviewItems = useMemo(() => {
    if (!data) return [];
    return reviewLegendConfig.map((item) => ({
      ...item,
      value: data.reviewDistribution[item.key],
    }));
  }, [data]);
  const reviewTotal = reviewItems.reduce((sum, item) => sum + item.value, 0);
  const monthlyRewardDetails = data?.heroStats.monthlyRewardDetails ?? [];
  const monthlyRewardTaskSummaries = useMemo(
    () => buildRewardTaskSummaries(monthlyRewardDetails),
    [monthlyRewardDetails]
  );

  if (loading) {
    return (
      <Space direction="vertical" size="large" className="page-stack labeler-overview">
        <Card>
          <Skeleton active paragraph={{ rows: 8 }} />
        </Card>
        <Row gutter={[16, 16]}>
          {[0, 1, 2, 3].map((item) => (
            <Col xs={24} sm={12} xl={6} key={item}>
              <Card className="kpi-card">
                <Skeleton active paragraph={{ rows: 2 }} />
              </Card>
            </Col>
          ))}
        </Row>
      </Space>
    );
  }

  if (error || !data) {
    return (
      <Space direction="vertical" size="large" className="page-stack labeler-overview">
        <Alert
          type="error"
          showIcon
          message="工作概览加载失败"
          description={error ?? '未获取到工作概览数据'}
          action={
            <Button icon={<ReloadOutlined />} onClick={() => void loadOverview()}>
              重试
            </Button>
          }
        />
      </Space>
    );
  }

  const pendingTypeDistribution = data.pendingTypeDistribution ?? [];
  const openRewardTaskDetails = (taskSummary: RewardTaskSummary) => {
    setRewardSummaryOpen(false);
    setRewardPopoverOpen(false);
    setActiveRewardTask(taskSummary);
  };
  const openRewardSummary = () => {
    if (isMobile) {
      setRewardSummaryOpen(true);
    }
  };
  const handleRewardSummaryKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!isMobile) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setRewardSummaryOpen(true);
    }
  };
  const rewardStatNode = (
    <div
      className="overview-hero-stat-trigger"
      role="button"
      tabIndex={0}
      onClick={openRewardSummary}
      onKeyDown={handleRewardSummaryKeyDown}
      aria-label="查看本月通过奖励明细"
    >
      <HeroStat value={`¥${data.heroStats.monthlyRewardEstimate.toFixed(2)}`} label="本月通过奖励" />
    </div>
  );

  return (
    <>
    <Space direction="vertical" size="large" className="page-stack labeler-overview">
      <section className="overview-hero">
        <div className="overview-hero-content">
          <Tag className="overview-hero-tag">Phase 1 · MVP</Tag>
          <Typography.Title level={2} className="overview-hero-title">
            欢迎回来,继续你的标注工作
          </Typography.Title>
          <Typography.Paragraph className="overview-hero-desc">
            浏览任务市场认领新的批次,在线作答会自动保存草稿;提交后将进入 AI
            预审与人工审核闭环,打回项可在“打回项”页查看原因后重新提交。
          </Typography.Paragraph>
          <div className="overview-hero-actions">
            <div className="overview-hero-btn-wrap">
              <Button
                size="large"
                icon={<ShopOutlined />}
                onClick={() => navigate('/labeler/market')}
                className="overview-hero-cta"
              >
                进入任务市场
              </Button>
            </div>
            <div className="overview-hero-btn-wrap">
              <Button
                size="large"
                icon={<EditOutlined />}
                onClick={() => navigate('/labeler/drafts')}
                className="overview-hero-secondary"
              >
                查看草稿
              </Button>
            </div>
          </div>
        </div>

        <div className="overview-hero-stats">
          <HeroStat value={data.heroStats.weeklySubmitted} label="本周累计提交" />
          <div className="overview-hero-divider" />
          <HeroStat value={formatPercent(data.heroStats.reviewPassRate)} label="审核通过率" />
          <div className="overview-hero-divider" />
          {isMobile ? (
            rewardStatNode
          ) : (
            <Popover
              trigger={['hover', 'focus']}
              placement="bottomRight"
              overlayClassName="labeler-reward-popover"
              open={rewardPopoverOpen}
              onOpenChange={setRewardPopoverOpen}
              content={
                <MonthlyRewardPreview
                  taskSummaries={monthlyRewardTaskSummaries}
                  totalItemCount={monthlyRewardDetails.length}
                  totalReward={data.heroStats.monthlyRewardEstimate}
                  onOpenTask={openRewardTaskDetails}
                />
              }
            >
              {rewardStatNode}
            </Popover>
          )}
        </div>
      </section>

      <Row gutter={[16, 16]} className="labeler-overview-kpi-row">
        {kpis.map((kpi) => (
          <Col xs={24} sm={12} xl={6} key={kpi.key}>
            <Card className="kpi-card">
              <div className="kpi-head">
                <span className="kpi-icon" style={{ background: `${kpi.accent}15`, color: kpi.accent }}>
                  {kpi.icon}
                </span>
                <span className="kpi-title">{kpi.title}</span>
              </div>
              <div className="kpi-value">
                {kpi.value}
                {kpi.suffix && <span className="kpi-suffix">{kpi.suffix}</span>}
              </div>
              {kpi.trend && (
                <div className={`kpi-trend ${kpi.trendUp ? 'is-up' : 'is-down'}`}>{kpi.trend}</div>
              )}
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]} className="labeler-overview-main-row">
        <Col xs={24} xl={16}>
          <Card
            className="overview-progress-card"
            title="今日标注节奏"
            extra={
              <Typography.Text type="secondary">
                目标 {data.todayProgress.target} 条 · 当前 {data.todayProgress.submitted} 条
              </Typography.Text>
            }
          >
            <Progress percent={data.todayProgress.percent} strokeColor={themeColors.progress} />

            <Row gutter={16} className="overview-progress-meta">
              <Col span={8}>
                <div className="overview-meta-label">提交总数</div>
                <div className="overview-meta-value">{data.todayProgress.submitted}</div>
              </Col>
              <Col span={8}>
                <div className="overview-meta-label">AI 预审通过</div>
                <div className="overview-meta-value">{data.todayProgress.aiPassed}</div>
              </Col>
              <Col span={8}>
                <div className="overview-meta-label">人工已确认</div>
                <div className="overview-meta-value">{data.todayProgress.humanConfirmed}</div>
              </Col>
            </Row>

            <Typography.Paragraph type="secondary" className="overview-progress-tip">
              <ClockCircleOutlined />
              {progressTip(data.todayProgress.avgDurationSec, data.todayProgress.estimatedFinishTime)}
            </Typography.Paragraph>
          </Card>
        </Col>

        <Col xs={24} xl={8}>
          <Card
            className="overview-review-card"
            title={
              <Space size={8}>
                <AiAssistantIcon style={{ color: 'var(--lh-primary)' }} />
                AI 审核分布
              </Space>
            }
            extra={<Typography.Text type="secondary">最近 7 日</Typography.Text>}
          >
            {reviewTotal === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无审核结果" />
            ) : (
              <>
                <div className="review-bar">
                  {reviewItems.map((item) => (
                    <span
                      key={item.key}
                      className="review-bar-seg"
                      style={{
                        width: `${(item.value / reviewTotal) * 100}%`,
                        background: item.color,
                      }}
                    />
                  ))}
                </div>
                <ul className="review-legend">
                  {reviewItems.map((item) => (
                    <li key={item.key}>
                      <span className="review-legend-dot" style={{ background: item.color }} />
                      <span className="review-legend-label">{item.label}</span>
                      <span className="review-legend-value">{item.value}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} className="labeler-overview-lower-row">
        <Col xs={24} xl={16}>
          <Card
            className="overview-batch-card"
            title="最近的任务批次"
            extra={
              <Button type="link" onClick={() => navigate('/labeler/my-tasks')} className="overview-link">
                查看全部 <RightOutlined />
              </Button>
            }
          >
            {data.recentBatches.length === 0 ? (
              <Empty description="暂无已领取任务批次" />
            ) : (
              <div className="batch-list">
                {data.recentBatches.map((batch) => (
                  <RecentBatchItem
                    key={`${batch.taskId}-${batch.assignmentId ?? 'none'}`}
                    batch={batch}
                    strokeColor={themeColors.primary}
                    onEnter={() => {
                      if (batch.assignmentId) {
                        navigate(`/labeler/answer/${batch.assignmentId}`);
                      }
                    }}
                  />
                ))}
              </div>
            )}
          </Card>
        </Col>

        <Col xs={24} xl={8}>
          <Space direction="vertical" size={16} className="page-stack labeler-overview-side-stack">
            <Card className="overview-shortcut-card" title="快捷入口">
              <div className="shortcut-grid">
                <ShortcutTile icon={<ShopOutlined />} label="任务市场" onClick={() => navigate('/labeler/market')} />
                <ShortcutTile icon={<FileTextOutlined />} label="我的任务" onClick={() => navigate('/labeler/my-tasks')} />
                <ShortcutTile icon={<EditOutlined />} label="草稿箱" onClick={() => navigate('/labeler/drafts')} />
                <ShortcutTile icon={<ExclamationCircleFilled />} label="打回项" onClick={() => navigate('/labeler/returned')} />
              </div>
            </Card>

            <Card className="overview-types-card" title="待处理类型分布">
              <Typography.Paragraph type="secondary" className="types-desc">
                当前仍需作答或返修的题目,按媒体类型聚合。
              </Typography.Paragraph>
              {pendingTypeDistribution.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无待处理题目" />
              ) : (
                <PendingTypeDistribution items={pendingTypeDistribution} />
              )}
              <div className="types-hint">
                <Avatar
                  size={28}
                  icon={<AiAssistantIcon />}
                  style={{ background: 'var(--lh-primary-bg-12)', color: 'var(--lh-primary)' }}
                />
                <span>优先处理数量较多或临近截止的题目类型。</span>
              </div>
            </Card>
          </Space>
        </Col>
      </Row>
    </Space>
    <RewardSummaryDrawer
      open={rewardSummaryOpen}
      onClose={() => setRewardSummaryOpen(false)}
      taskSummaries={monthlyRewardTaskSummaries}
      totalItemCount={monthlyRewardDetails.length}
      totalReward={data.heroStats.monthlyRewardEstimate}
      onOpenTask={openRewardTaskDetails}
    />
    <RewardTaskDrawer
      task={activeRewardTask}
      open={!!activeRewardTask}
      onClose={() => setActiveRewardTask(null)}
    />
    </>
  );
}

function HeroStat({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="overview-hero-stat">
      <span className="overview-hero-stat-value">{value}</span>
      <span className="overview-hero-stat-label">{label}</span>
    </div>
  );
}

function buildRewardTaskSummaries(details: LabelerOverviewRewardDetail[]): RewardTaskSummary[] {
  const grouped = new Map<string, RewardTaskSummary>();

  details.forEach((detail) => {
    const taskId = detail.taskId || 'unknown';
    const taskTitle = detail.taskTitle || '未命名任务';
    const groupKey = `${taskId}::${taskTitle}`;
    const existed = grouped.get(groupKey);

    if (existed) {
      existed.itemCount += 1;
      existed.rewardTotal += detail.rewardPerItem;
      existed.details.push(detail);
      return;
    }

    grouped.set(groupKey, {
      taskId,
      taskTitle,
      itemCount: 1,
      rewardTotal: detail.rewardPerItem,
      details: [detail],
    });
  });

  return Array.from(grouped.values());
}

function MonthlyRewardPreview({
  taskSummaries,
  totalItemCount,
  totalReward,
  onOpenTask,
}: {
  taskSummaries: RewardTaskSummary[];
  totalItemCount: number;
  totalReward: number;
  onOpenTask: (taskSummary: RewardTaskSummary) => void;
}) {
  return (
    <div className="labeler-reward-preview">
      <Space direction="vertical" size={2}>
        <Typography.Text strong>本月通过奖励明细</Typography.Text>
        <div className="labeler-reward-summary-line">
          <Typography.Text type="secondary">共 {totalItemCount} 题 · 合计</Typography.Text>
          <RewardAmountBubble amount={totalReward} />
        </div>
      </Space>
      {taskSummaries.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无本月通过奖励明细" />
      ) : (
        <div className="labeler-reward-preview-list">
          {taskSummaries.map((taskSummary) => (
            <button
              key={`${taskSummary.taskId}-${taskSummary.taskTitle}`}
              type="button"
              className="labeler-reward-preview-item labeler-reward-task-item"
              onClick={() => onOpenTask(taskSummary)}
            >
              <span className="labeler-reward-task-copy">
                <Typography.Text strong className="labeler-reward-task-main">
                  {taskSummary.taskTitle}
                </Typography.Text>
                <span className="labeler-reward-task-meta">
                  <Typography.Text type="secondary">{taskSummary.itemCount} 题 · 小计</Typography.Text>
                  <RewardAmountBubble amount={taskSummary.rewardTotal} />
                </span>
              </span>
              <RightOutlined className="labeler-reward-task-arrow" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RewardSummaryDrawer({
  open,
  onClose,
  taskSummaries,
  totalItemCount,
  totalReward,
  onOpenTask,
}: {
  open: boolean;
  onClose: () => void;
  taskSummaries: RewardTaskSummary[];
  totalItemCount: number;
  totalReward: number;
  onOpenTask: (taskSummary: RewardTaskSummary) => void;
}) {
  return (
    <Drawer
      title="本月通过奖励明细"
      placement="right"
      width="min(520px, 92vw)"
      open={open}
      onClose={onClose}
      destroyOnHidden
      rootClassName="labeler-reward-summary-drawer"
    >
      <MonthlyRewardPreview
        taskSummaries={taskSummaries}
        totalItemCount={totalItemCount}
        totalReward={totalReward}
        onOpenTask={onOpenTask}
      />
    </Drawer>
  );
}

function RewardTaskDrawer({
  task,
  open,
  onClose,
}: {
  task: RewardTaskSummary | null;
  open: boolean;
  onClose: () => void;
}) {
  const details = task?.details ?? [];

  return (
    <Drawer
      title={
        <div className="labeler-reward-drawer-title">
          <Typography.Text strong>{task?.taskTitle ?? '本月通过奖励明细'}</Typography.Text>
          <div className="labeler-reward-summary-line">
            <Typography.Text type="secondary">共 {task?.itemCount ?? 0} 题 · 合计</Typography.Text>
            <RewardAmountBubble amount={task?.rewardTotal ?? 0} />
          </div>
        </div>
      }
      placement="right"
      width="min(520px, 92vw)"
      open={open}
      onClose={onClose}
      destroyOnHidden
      rootClassName="labeler-reward-drawer"
    >
      {details.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无本月通过奖励明细" />
      ) : (
        <div className="labeler-reward-drawer-list">
          {details.map((detail) => (
            <div key={detail.annotationId} className="labeler-reward-drawer-item">
              <Typography.Text strong>
                {detail.itemTitle || `${detail.taskTitle} · 第 ${detail.itemIndex} 题`}
              </Typography.Text>
              <div className="labeler-reward-detail-meta">
                <Typography.Text type="secondary">
                  题目 ID {detail.itemId} · {detail.acceptedAt || '通过时间缺失'}
                </Typography.Text>
                <RewardAmountBubble amount={detail.rewardPerItem} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Drawer>
  );
}

function RewardAmountBubble({ amount }: { amount: number }) {
  return (
    <Tag className="labeler-reward-amount-bubble">
      ¥{amount.toFixed(2)}
    </Tag>
  );
}

function RecentBatchItem({
  batch,
  strokeColor,
  onEnter,
}: {
  batch: LabelerOverviewRecentBatch;
  strokeColor: string;
  onEnter: () => void;
}) {
  const totalQuota = Math.max(batch.totalQuota, 0);
  const remainingQuota = Math.max(batch.remainingQuota, 0);
  const completedPercent = totalQuota > 0
    ? Math.round(((totalQuota - remainingQuota) / totalQuota) * 100)
    : 0;

  return (
    <div className="batch-item">
      <div className="batch-item-head">
        <Space size={8} wrap className="batch-item-title-row">
          <span className="batch-item-title">{batch.title}</span>
          <Tag color="blue" className="batch-item-tag">
            {batch.taskType}
          </Tag>
        </Space>
        <Tag className="batch-item-reward">
          {batch.rewardPerItem == null ? '未配置单价' : `¥${batch.rewardPerItem.toFixed(2)} / 条`}
        </Tag>
      </div>
      <div className="batch-item-desc">{batch.description}</div>
      <div className="batch-item-foot">
        <div className="batch-item-progress">
          <Progress
            percent={completedPercent}
            showInfo={false}
            size="small"
            strokeColor={strokeColor}
          />
          <span className="batch-item-quota">
            剩余 <strong>{remainingQuota}</strong> / {totalQuota}
          </span>
        </div>
        <Space size={12} className="batch-item-action-row">
          <span className="batch-item-deadline">
            <ClockCircleOutlined /> {batch.deadline ? `截止 ${batch.deadline}` : '未设置截止'}
          </span>
          <Button
            type="primary"
            size="small"
            disabled={!batch.assignmentId}
            onClick={onEnter}
            className="batch-item-enter-btn"
          >
            进入答题 <ArrowRightOutlined />
          </Button>
        </Space>
      </div>
    </div>
  );
}

function ShortcutTile({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="shortcut-tile" onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function PendingTypeDistribution({ items }: { items: LabelerOverviewPendingTypeDistribution[] }) {
  return (
    <div className="types-list">
      {items.map((type) => {
        const tone = typeTone[type.key] ?? '#64748b';
        return (
          <span
            key={type.key}
            className="types-pill"
            style={{ color: tone, background: `${tone}15` }}
          >
            <CheckCircleFilled />
            <span>{type.label}</span>
            <strong>{type.count}</strong>
          </span>
        );
      })}
    </div>
  );
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function progressTip(avgDurationSec: number, estimatedFinishTime: string) {
  if (avgDurationSec <= 0) {
    return '暂无今日耗时数据,完成提交后将生成节奏预估。';
  }
  if (!estimatedFinishTime) {
    return `平均耗时 ${avgDurationSec} 秒/条,今日目标已完成。`;
  }
  return `平均耗时 ${avgDurationSec} 秒/条,按当前速度可在 ${estimatedFinishTime} 前完成今日目标。`;
}
