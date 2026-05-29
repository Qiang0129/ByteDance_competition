import { useEffect, useMemo, useState } from 'react';
import {
  AppstoreOutlined,
  ClockCircleOutlined,
  CloseOutlined,
  DollarCircleOutlined,
  FileTextOutlined,
  FireOutlined,
  PictureOutlined,
  RobotOutlined,
  SearchOutlined,
  TagsOutlined,
  TeamOutlined,
  ThunderboltFilled,
  UserOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import {
  App,
  Button,
  Card,
  Col,
  Drawer,
  Empty,
  Input,
  Row,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { useNavigate } from 'react-router-dom';

import { labelerApi } from '../../api/labeler';
import type {
  AssignStrategy,
  MarketTask,
  MarketTasksQuery,
  TaskMediaType,
} from '../../types/labeler';

const taskTypeOptions = [
  { label: '全部类型', value: '' },
  { label: 'QA Quality', value: 'qa_quality' },
  { label: 'Preference Compare', value: 'preference_compare' },
  { label: 'Image Classification', value: 'image_classification' },
  { label: 'Safety Tagging', value: 'safety_tagging' },
];

const strategyOptions: Array<{ label: string; value: '' | AssignStrategy }> = [
  { label: '全部策略', value: '' },
  { label: '先到先得', value: 'first-come' },
  { label: '指派', value: 'assigned' },
  { label: '配额抢单', value: 'quota' },
];

const mediaOptions: Array<{ label: string; value: '' | TaskMediaType }> = [
  { label: '全部媒体', value: '' },
  { label: 'Text', value: 'text' },
  { label: 'Image', value: 'image' },
  { label: 'Video', value: 'video' },
  { label: 'Markdown', value: 'markdown' },
];

const aiReviewOptions = [
  { label: '不限 AI 预审', value: '' },
  { label: '已启用 AI', value: 'enabled' },
  { label: '未启用 AI', value: 'disabled' },
];

const sortOptions: Array<{
  label: string;
  value: NonNullable<MarketTasksQuery['sortBy']>;
}> = [
  { label: '默认排序', value: 'publishedAt' },
  { label: '单价高 -> 低', value: 'reward' },
  { label: '截止快 -> 慢', value: 'deadline' },
  { label: '剩余额度多 -> 少', value: 'quota' },
];

const strategyMeta: Record<AssignStrategy, { label: string; color: string }> = {
  'first-come': { label: '先到先得', color: 'blue' },
  assigned: { label: '指派', color: 'purple' },
  quota: { label: '配额抢单', color: 'gold' },
};

const mediaMeta: Record<
  TaskMediaType,
  { label: string; icon: React.ReactNode; color: string }
> = {
  text: { label: 'Text', icon: <FileTextOutlined />, color: '#2f7bff' },
  image: { label: 'Image', icon: <PictureOutlined />, color: '#22c55e' },
  video: { label: 'Video', icon: <VideoCameraOutlined />, color: '#a855f7' },
  markdown: { label: 'Markdown', icon: <TagsOutlined />, color: '#f59e0b' },
};

function parseTime(value?: string): number {
  if (!value) return Number.NaN;
  const timestamp = new Date(value.replace(' ', 'T')).getTime();
  return Number.isNaN(timestamp) ? Number.NaN : timestamp;
}

function deadlineRemaining(
  deadline?: string,
): { text: string; soon: boolean; expired: boolean } {
  if (!deadline) {
    return { text: '未设置', soon: false, expired: false };
  }

  const timestamp = parseTime(deadline);
  if (Number.isNaN(timestamp)) {
    return { text: deadline, soon: false, expired: false };
  }

  const diff = timestamp - Date.now();
  if (diff <= 0) {
    return { text: '已截止', soon: false, expired: true };
  }

  const day = Math.floor(diff / 86_400_000);
  if (day >= 1) {
    return { text: `剩 ${day} 天`, soon: day <= 2, expired: false };
  }

  const hour = Math.max(1, Math.floor(diff / 3_600_000));
  return { text: `剩 ${hour} 小时`, soon: true, expired: false };
}

function formatReward(amount?: number) {
  return amount == null ? '奖励待配置' : `¥${Number(amount).toFixed(2)} / 条`;
}

function safeNumber(value: unknown) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  return value.toLocaleString();
}

function getClaimErrorMessage(error: unknown) {
  if (typeof error === 'object' && error !== null && 'payload' in error) {
    const payload = (error as { payload?: unknown }).payload;
    if (typeof payload === 'object' && payload !== null && 'code' in payload) {
      const code = (payload as { code?: unknown }).code;
      if (typeof code === 'string') {
        switch (code) {
          case 'NO_AVAILABLE_ITEM':
            return '该任务还没有可认领的数据项，请先让 Owner 在数据集页导入或追加数据。';
          case 'TASK_QUOTA_EXHAUSTED':
            return '该任务的可认领配额已用尽。';
          case 'TASK_CLAIM_LIMIT_REACHED':
            return '你已达到该任务的个人认领上限。';
          case 'TASK_NOT_PUBLISHED':
            return '该任务还未发布，暂时不能认领。';
          case 'TASK_DELETED':
            return '该任务已被 Owner 删除，无法继续认领。';
          case 'ASSIGNMENT_VOIDED':
            return '该任务下的认领已作废，无法继续操作。';
          case 'TASK_EXPIRED':
            return '该任务已过截止时间，无法认领。';
          case 'ASSIGNED_TASK_NOT_CLAIMABLE':
            return '该任务属于指派任务，当前账号没有可认领项。';
          default:
            break;
        }
      }
    }
    if (typeof payload === 'object' && payload !== null && 'message' in payload) {
      const message = (payload as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) {
        return message;
      }
    }
    if (typeof payload === 'string' && payload.trim()) {
      return payload;
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return '认领失败，请稍后重试。';
}

export default function TaskMarket() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState('');
  const [taskType, setTaskType] = useState('');
  const [strategy, setStrategy] = useState<'' | AssignStrategy>('');
  const [mediaType, setMediaType] = useState<'' | TaskMediaType>('');
  const [aiReview, setAiReview] = useState<'' | 'enabled' | 'disabled'>('');
  const [sortBy, setSortBy] =
    useState<NonNullable<MarketTasksQuery['sortBy']>>('publishedAt');
  const [tasks, setTasks] = useState<MarketTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTask, setActiveTask] = useState<MarketTask | null>(null);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [usingFallback, setUsingFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setLoading(true);

      try {
        const response = await labelerApi.listMarketTasks({ page: 1, pageSize: 50 });
        if (cancelled) return;
        setTasks(Array.isArray(response.items) ? response.items : []);
        setUsingFallback(false);
      } catch {
        try {
          const response = await fetch('/sample-datasets/market-tasks.json');
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const data = await response.json();
          if (cancelled) return;
          setTasks(Array.isArray(data?.items) ? data.items : []);
          setUsingFallback(true);
        } catch {
          if (cancelled) return;
          message.error(
            '任务市场加载失败，请检查后端接口或 sample-datasets/market-tasks.json。',
          );
          setTasks([]);
          setUsingFallback(false);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [message]);

  const filteredTasks = useMemo(() => {
    let list = tasks.slice();
    const normalizedKeyword = keyword.trim().toLowerCase();

    if (normalizedKeyword) {
      list = list.filter((task) =>
        `${task.title ?? ''} ${task.taskId ?? ''} ${task.ownerName ?? ''} ${(task.tags ?? []).join(' ')}`
          .toLowerCase()
          .includes(normalizedKeyword),
      );
    }

    if (taskType) {
      list = list.filter((task) => task.taskTypeKey === taskType);
    }

    if (strategy) {
      list = list.filter((task) => task.assignStrategy === strategy);
    }

    if (mediaType) {
      list = list.filter((task) => (task.mediaTypes ?? []).includes(mediaType));
    }

    if (aiReview) {
      list = list.filter((task) =>
        aiReview === 'enabled' ? !!task.aiReviewEnabled : !task.aiReviewEnabled,
      );
    }

    switch (sortBy) {
      case 'reward':
        list.sort((left, right) => (right.rewardPerItem ?? 0) - (left.rewardPerItem ?? 0));
        break;
      case 'deadline':
        list.sort((left, right) => {
          const leftTime = parseTime(left.deadline);
          const rightTime = parseTime(right.deadline);
          return (
            (Number.isNaN(leftTime) ? Number.POSITIVE_INFINITY : leftTime) -
            (Number.isNaN(rightTime) ? Number.POSITIVE_INFINITY : rightTime)
          );
        });
        break;
      case 'quota':
        list.sort((left, right) => (right.remainingQuota ?? 0) - (left.remainingQuota ?? 0));
        break;
      default:
        list.sort((left, right) => {
          const leftTime = parseTime(left.publishedAt);
          const rightTime = parseTime(right.publishedAt);
          return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime);
        });
        break;
    }

    return list;
  }, [aiReview, keyword, mediaType, sortBy, strategy, taskType, tasks]);

  const stats = useMemo(() => {
    const claimable = filteredTasks.filter((task) => (task.remainingQuota ?? 0) > 0);
    const totalReward = claimable.reduce((sum, task) => sum + (task.rewardPerItem ?? 0), 0);
    const avgReward = claimable.length === 0 ? 0 : totalReward / claimable.length;
    const expiringSoon = claimable.filter((task) => deadlineRemaining(task.deadline).soon).length;
    return { available: claimable.length, avgReward, expiringSoon };
  }, [filteredTasks]);

  function resetFilters() {
    setKeyword('');
    setTaskType('');
    setStrategy('');
    setMediaType('');
    setAiReview('');
    setSortBy('publishedAt');
  }

  async function handleClaim(task: MarketTask) {
    if (task.claimedByMe) {
      message.info('你已经认领过该任务，正在前往「我的任务」。');
      navigate('/labeler/my-tasks');
      return;
    }

    if (usingFallback) {
      message.warning('当前为演示模式，后端未连接，无法真实认领任务。');
      return;
    }

    if ((task.remainingQuota ?? 0) === 0) {
      message.warning('该任务配额已用尽。');
      return;
    }

    setClaimingId(task.taskId);
    try {
      await labelerApi.claimTask(task.taskId);
      message.success('认领成功，已加入「我的任务」。');
      setTasks((previous) =>
        previous.map((current) =>
          current.taskId === task.taskId
            ? {
                ...current,
                claimedByMe: true,
                remainingQuota: Math.max(0, (current.remainingQuota ?? 0) - 1),
              }
            : current,
        ),
      );
    } catch (error) {
      message.error(getClaimErrorMessage(error));
    } finally {
      setClaimingId(null);
    }
  }

  return (
    <Space direction="vertical" size="large" className="page-stack">
      <div className="page-title-row">
        <Space direction="vertical" size={4}>
          <Typography.Title level={3}>任务市场</Typography.Title>
          <Typography.Text type="secondary">
            浏览已发布任务并先到先得地认领名额。配额按 task_id + item_id 唯一约束，先到先得不重复领取。
          </Typography.Text>
        </Space>
        {usingFallback && (
          <Tag color="gold" className="market-fallback-tag">
            演示模式 · 接口未连接
          </Tag>
        )}
      </div>

      <Row gutter={[16, 16]} className="market-kpi-row">
        <Col xs={24} sm={8}>
          <Card className="market-kpi-card">
            <div
              className="market-kpi-icon"
              style={{ background: 'var(--lh-primary-bg-10)', color: 'var(--lh-primary)' }}
            >
              <AppstoreOutlined />
            </div>
            <div>
              <div className="market-kpi-label">可领任务</div>
              <div className="market-kpi-value">{stats.available}</div>
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card className="market-kpi-card">
            <div
              className="market-kpi-icon"
              style={{ background: 'rgba(34, 197, 94, 0.12)', color: '#22c55e' }}
            >
              <DollarCircleOutlined />
            </div>
            <div>
              <div className="market-kpi-label">平均单价</div>
              <div className="market-kpi-value">¥{stats.avgReward.toFixed(2)}</div>
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card className="market-kpi-card">
            <div
              className="market-kpi-icon"
              style={{ background: 'rgba(245, 158, 11, 0.14)', color: '#f59e0b' }}
            >
              <ThunderboltFilled />
            </div>
            <div>
              <div className="market-kpi-label">即将截止(48h)</div>
              <div className="market-kpi-value">{stats.expiringSoon}</div>
            </div>
          </Card>
        </Col>
      </Row>

      <Card className="market-filter-card">
        <Space size={12} wrap>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索任务名 / ID / Owner / 标签"
            style={{ width: 280 }}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          <Select
            options={taskTypeOptions}
            value={taskType}
            onChange={setTaskType}
            style={{ width: 180 }}
            placeholder="任务类型"
          />
          <Select
            options={strategyOptions}
            value={strategy}
            onChange={setStrategy}
            style={{ width: 140 }}
          />
          <Select
            options={mediaOptions}
            value={mediaType}
            onChange={setMediaType}
            style={{ width: 140 }}
          />
          <Select
            options={aiReviewOptions}
            value={aiReview}
            onChange={(value) => setAiReview(value as '' | 'enabled' | 'disabled')}
            style={{ width: 160 }}
          />
          <Select
            options={sortOptions}
            value={sortBy}
            onChange={(value) => setSortBy(value as NonNullable<MarketTasksQuery['sortBy']>)}
            style={{ width: 180 }}
          />
          <Button onClick={resetFilters}>重置</Button>
        </Space>
      </Card>

      {loading ? (
        <Card>
          <div className="market-loading">
            <Spin />
            <span>加载任务市场...</span>
          </div>
        </Card>
      ) : filteredTasks.length === 0 ? (
        <Card>
          <Empty description="暂无符合筛选条件的任务，试试放宽条件。" />
        </Card>
      ) : (
        <Row gutter={[16, 16]}>
          {filteredTasks.map((task) => (
            <Col key={task.taskId} xs={24} md={12} xl={8}>
              <TaskCard
                task={task}
                claiming={claimingId === task.taskId}
                onOpen={() => setActiveTask(task)}
                onClaim={() => void handleClaim(task)}
              />
            </Col>
          ))}
        </Row>
      )}

      <Drawer
        title={activeTask?.title ?? '任务详情'}
        width={520}
        open={!!activeTask}
        onClose={() => setActiveTask(null)}
        closeIcon={<CloseOutlined />}
        footer={
          activeTask ? (
            <div className="market-drawer-footer">
              <Button onClick={() => setActiveTask(null)}>关闭</Button>
              <Button
                type="primary"
                loading={claimingId === activeTask.taskId}
                disabled={
                  (activeTask.remainingQuota ?? 0) === 0 ||
                  deadlineRemaining(activeTask.deadline).expired
                }
                onClick={() => void handleClaim(activeTask)}
              >
                {activeTask.claimedByMe ? '去作答' : '立即认领'}
              </Button>
            </div>
          ) : null
        }
      >
        {activeTask ? <TaskDetail task={activeTask} /> : null}
      </Drawer>
    </Space>
  );
}

function TaskCard({
  task,
  claiming,
  onOpen,
  onClaim,
}: {
  task: MarketTask;
  claiming: boolean;
  onOpen: () => void;
  onClaim: () => void;
}) {
  const remaining = task.remainingQuota ?? 0;
  const total = task.totalQuota ?? 0;
  const ratio = total === 0 ? 0 : Math.round(((total - remaining) / total) * 100);
  const deadline = deadlineRemaining(task.deadline);
  const strategyTag = strategyMeta[task.assignStrategy] ?? {
    label: task.assignStrategy,
    color: 'default',
  };
  const exhausted = remaining === 0;

  return (
    <Card
      className={`market-card ${exhausted ? 'is-exhausted' : ''} ${task.claimedByMe ? 'is-claimed' : ''}`}
      onClick={onOpen}
    >
      <div className="market-card-head">
        <Space size={6} wrap>
          <span className="market-card-title">{task.title}</span>
          <Tag className="market-type-tag">{task.taskType}</Tag>
        </Space>
        <Tooltip title={task.rewardCap ?? ''}>
          <Tag className="market-reward-tag">
            <FireOutlined /> {formatReward(task.rewardPerItem)}
          </Tag>
        </Tooltip>
      </div>

      <Typography.Paragraph
        type="secondary"
        className="market-card-desc"
        ellipsis={{ rows: 2 }}
      >
        {task.description ?? '暂无描述'}
      </Typography.Paragraph>

      <div className="market-card-tags">
        <Tag color={strategyTag.color}>{strategyTag.label}</Tag>
        {(task.mediaTypes ?? []).map((mediaType) => {
          const meta = mediaMeta[mediaType];
          if (!meta) return null;
          return (
            <span
              key={mediaType}
              className="market-media-pill"
              style={{ color: meta.color, background: `${meta.color}15` }}
            >
              {meta.icon} {meta.label}
            </span>
          );
        })}
        {task.aiReviewEnabled && (
          <Tooltip title={`AI 预审规则: ${task.aiReviewRule ?? '默认'}`}>
            <Tag className="market-ai-tag">
              <RobotOutlined /> AI 预审
            </Tag>
          </Tooltip>
        )}
      </div>

      <div className="market-card-quota">
        <div className="market-quota-numbers">
          <span>剩余配额</span>
          <strong>{safeNumber(remaining)}</strong>
          <span> / {safeNumber(total)}</span>
        </div>
        <div className="market-quota-bar">
          <span style={{ width: `${ratio}%` }} />
        </div>
      </div>

      <div className="market-card-foot">
        <span className="market-card-time">
          <ClockCircleOutlined /> 发布时间: {task.publishedAt ?? '-'}
        </span>
        <span
          className={`market-deadline ${deadline.expired ? 'is-expired' : deadline.soon ? 'is-soon' : ''}`}
        >
          <ClockCircleOutlined /> 截止时间: {task.deadline ?? '未设置'} · {deadline.text}
        </span>
        <span className="market-owner">
          <UserOutlined /> {task.ownerName ?? '-'}
        </span>
      </div>

      <Button
        type="primary"
        block
        className="market-claim-btn"
        loading={claiming}
        disabled={exhausted || deadline.expired}
        onClick={(event) => {
          event.stopPropagation();
          onClaim();
        }}
      >
        {task.claimedByMe
          ? '去作答'
          : exhausted
            ? '配额已用尽'
            : deadline.expired
              ? '已截止'
              : '立即认领'}
      </Button>
    </Card>
  );
}

function TaskDetail({ task }: { task: MarketTask }) {
  const deadline = deadlineRemaining(task.deadline);
  const strategyTag = strategyMeta[task.assignStrategy] ?? {
    label: task.assignStrategy,
    color: 'default',
  };

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Space wrap size={6}>
        <Tag>{task.taskId}</Tag>
        <Tag className="market-type-tag">{task.taskType}</Tag>
        <Tag color={strategyTag.color}>{strategyTag.label}</Tag>
        {(task.mediaTypes ?? []).map((mediaType) => {
          const meta = mediaMeta[mediaType];
          if (!meta) return null;
          return (
            <span
              key={mediaType}
              className="market-media-pill"
              style={{ color: meta.color, background: `${meta.color}15` }}
            >
              {meta.icon} {meta.label}
            </span>
          );
        })}
        {task.aiReviewEnabled && (
          <Tag className="market-ai-tag">
            <RobotOutlined /> AI 预审 · {task.aiReviewRule ?? '默认规则'}
          </Tag>
        )}
      </Space>

      <div>
        <div className="market-detail-label">任务描述</div>
        <Typography.Paragraph className="market-detail-value">
          {task.description ?? '暂无描述'}
        </Typography.Paragraph>
      </div>

      {task.tags && task.tags.length > 0 && (
        <div>
          <div className="market-detail-label">标签</div>
          <Space size={6} wrap>
            {task.tags.map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </Space>
        </div>
      )}

      <Row gutter={[12, 12]}>
        <Col span={12}>
          <div className="market-detail-mini-label">剩余 / 总配额</div>
          <div className="market-detail-mini-value">
            <strong>{safeNumber(task.remainingQuota)}</strong>
            <span> / {safeNumber(task.totalQuota)}</span>
          </div>
        </Col>
        <Col span={12}>
          <div className="market-detail-mini-label">截止时间</div>
          <div
            className={`market-detail-mini-value ${deadline.expired ? 'is-expired' : deadline.soon ? 'is-soon' : ''}`}
          >
            <ClockCircleOutlined /> {task.deadline ?? '未设置'} · {deadline.text}
          </div>
        </Col>
        <Col span={12}>
          <div className="market-detail-mini-label">单价</div>
          <div className="market-detail-mini-value">{formatReward(task.rewardPerItem)}</div>
          {task.rewardCap && <div className="market-detail-mini-cap">{task.rewardCap}</div>}
        </Col>
        <Col span={12}>
          <div className="market-detail-mini-label">每人最多领取</div>
          <div className="market-detail-mini-value">
            {task.maxClaimPerUser ? `${task.maxClaimPerUser} 条` : '不限'}
          </div>
        </Col>
        <Col span={12}>
          <div className="market-detail-mini-label">Schema 版本</div>
          <div className="market-detail-mini-value">
            <code>{task.schemaVersionId ?? '-'}</code>
          </div>
        </Col>
        <Col span={12}>
          <div className="market-detail-mini-label">发布时间</div>
          <div className="market-detail-mini-value">{task.publishedAt ?? '-'}</div>
        </Col>
      </Row>

      <div>
        <div className="market-detail-label">
          <TeamOutlined /> 项目方
        </div>
        <div className="market-detail-value">{task.ownerName ?? '-'}</div>
      </div>

      <div className="market-detail-tip">
        认领后，该批次任务会出现在「我的任务」。提交后会进入后端审核流程；如果被打回，可在「打回项」查看原因并重新处理。
      </div>
    </Space>
  );
}
