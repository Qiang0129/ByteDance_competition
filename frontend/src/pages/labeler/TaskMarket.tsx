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

import { labelerApi } from '../../api/labeler';
import { ownerApi } from '../../api/owner';
import type {
  AssignStrategy,
  MarketTask,
  MarketTasksQuery,
  TaskMediaType,
} from '../../types/labeler';
import type { OwnerTask } from '../../types/owner';

/**
 * 任务市场。
 * 对齐《项目实施计划书》4.3 / 5.2:
 *   - GET /market/tasks(列表 + 关键词 + 类型 + 排序)
 *   - POST /tasks/{id}/claim(立即认领)
 * 后端 Spring Boot 接口未上线时,前端回落到 public/sample-datasets/market-tasks.json,
 * 这样所有筛选/排序/认领交互在前端层面均能演示。
 */

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

const sortOptions = [
  { label: '默认排序', value: 'publishedAt' },
  { label: '单价高 → 低', value: 'reward' },
  { label: '截止快 → 慢', value: 'deadline' },
  { label: '剩余配额多 → 少', value: 'quota' },
];

const strategyMeta: Record<AssignStrategy, { label: string; color: string }> = {
  'first-come': { label: '先到先得', color: 'blue' },
  assigned: { label: '指派', color: 'purple' },
  quota: { label: '配额抢单', color: 'gold' },
};

const mediaMeta: Record<TaskMediaType, { label: string; icon: React.ReactNode; color: string }> = {
  text: { label: 'Text', icon: <FileTextOutlined />, color: '#2f7bff' },
  image: { label: 'Image', icon: <PictureOutlined />, color: '#22c55e' },
  video: { label: 'Video', icon: <VideoCameraOutlined />, color: '#a855f7' },
  markdown: { label: 'Markdown', icon: <TagsOutlined />, color: '#f59e0b' },
};

/** 把 "2026-06-01 23:59" 这种字符串转成 ms;失败返回 NaN */
function parseTime(value?: string): number {
  if (!value) return NaN;
  const ts = new Date(value.replace(' ', 'T')).getTime();
  return Number.isNaN(ts) ? NaN : ts;
}

/** 计算与"现在"的相对截止时间;过期返回 "已截止" */
function deadlineRemaining(deadline?: string): { text: string; soon: boolean; expired: boolean } {
  if (!deadline) return { text: '未设置', soon: false, expired: false };
  const ts = parseTime(deadline);
  if (Number.isNaN(ts)) return { text: deadline, soon: false, expired: false };
  const diff = ts - Date.now();
  if (diff <= 0) return { text: '已截止', soon: false, expired: true };
  const day = Math.floor(diff / 86_400_000);
  if (day >= 1) return { text: `剩 ${day} 天`, soon: day <= 2, expired: false };
  const hour = Math.floor(diff / 3_600_000);
  return { text: `剩 ${hour} 小时`, soon: true, expired: false };
}

function formatReward(amount?: number) {
  return amount == null ? '奖励待配置' : `¥${Number(amount).toFixed(2)} / 条`;
}

/** 安全数字格式化:undefined 返回 "-" */
function safeNumber(value: unknown) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  return value.toLocaleString();
}

/**
 * Owner 端写入的任务(同一份后端接口)适配为任务市场卡所需的 MarketTask。
 * 字段差异说明:
 *   OwnerTask.reward(字符串描述,如 "0.30 元 / 条 · 月度封顶 1500 元") →
 *     拆出单价数字给 rewardPerItem,后半段作为 rewardCap。
 *   OwnerTask.quotaUsed/quotaTotal → remainingQuota/totalQuota。
 *   OwnerTask.taskType 形如 "QA Quality" → 同时算出 taskTypeKey 用于过滤。
 */
function ownerTaskToMarket(task: OwnerTask): MarketTask {
  const { rewardPerItem, rewardCap } = parseRewardString(task.reward);
  const total = task.quotaTotal ?? 0;
  const used = task.quotaUsed ?? 0;
  const taskTypeKey = ownerTaskTypeKey(task.taskType);
  return {
    taskId: task.taskId,
    title: task.title,
    taskType: task.taskType,
    taskTypeKey,
    description: task.description,
    tags: task.tags ?? [],
    schemaVersionId: task.schemaVersionId ?? task.schemaVersion ?? '-',
    remainingQuota: Math.max(0, total - used),
    totalQuota: total,
    deadline: task.deadline,
    rewardPerItem,
    rewardCap,
    assignStrategy: task.assignStrategy,
    // Owner 端目前只有文本任务,后续动态表单阶段再扩展为 Schema 推断
    mediaTypes: ['text'],
    ownerName: task.owner,
    aiReviewEnabled: !!task.aiReviewEnabled,
    aiReviewRule: task.aiReviewEnabled ? '默认规则' : undefined,
    publishedAt: task.createdAt,
    maxClaimPerUser: undefined,
    claimedByMe: false,
  };
}

function parseRewardString(reward?: string): { rewardPerItem?: number; rewardCap?: string } {
  if (!reward) return {};
  // 期望形如 "0.30 元 / 条 · 月度封顶 1500 元"
  const numMatch = reward.match(/([\d.]+)\s*元\s*\/\s*条/);
  const rewardPerItem = numMatch ? Number(numMatch[1]) : undefined;
  const capMatch = reward.split('·')[1]?.trim();
  return {
    rewardPerItem: Number.isNaN(rewardPerItem ?? NaN) ? undefined : rewardPerItem,
    rewardCap: capMatch || undefined,
  };
}

function ownerTaskTypeKey(taskType?: string): string | undefined {
  if (!taskType) return undefined;
  const normalized = taskType.toLowerCase().replace(/\s+/g, '_');
  if (normalized.includes('preference')) return 'preference_compare';
  if (normalized.includes('image')) return 'image_classification';
  if (normalized.includes('safety')) return 'safety_tagging';
  if (normalized.includes('qa')) return 'qa_quality';
  return normalized;
}

export default function TaskMarket() {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState('');
  const [taskType, setTaskType] = useState('');
  const [strategy, setStrategy] = useState<'' | AssignStrategy>('');
  const [mediaType, setMediaType] = useState<'' | TaskMediaType>('');
  const [aiReview, setAiReview] = useState<'' | 'enabled' | 'disabled'>('');
  const [sortBy, setSortBy] = useState<NonNullable<MarketTasksQuery['sortBy']>>('publishedAt');
  const [tasks, setTasks] = useState<MarketTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTask, setActiveTask] = useState<MarketTask | null>(null);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [usingFallback, setUsingFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      // 优先复用 Owner 端 /tasks,只取 state === 'published',
      // 这样 Owner 一发布,Labeler 立刻能看到,字段完全一致。
      try {
        const ownerResp = await ownerApi.listTasks();
        if (cancelled) return;
        const items = (ownerResp.items ?? [])
          .filter((task) => task.state === 'published')
          .map(ownerTaskToMarket);
        setTasks(items);
        setUsingFallback(false);
        setLoading(false);
        return;
      } catch {
        /* fallthrough: 尝试 /market/tasks */
      }

      try {
        const response = await labelerApi.listMarketTasks({ page: 1, pageSize: 50 });
        if (cancelled) return;
        setTasks(Array.isArray(response.items) ? response.items : []);
        setUsingFallback(false);
      } catch {
        // 后端未起,回落到样例文件
        try {
          const res = await fetch('/sample-datasets/market-tasks.json');
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          if (cancelled) return;
          setTasks(Array.isArray(data?.items) ? data.items : []);
          setUsingFallback(true);
        } catch {
          if (cancelled) return;
          message.error('任务市场加载失败,请检查 sample-datasets/market-tasks.json');
          setTasks([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 前端兜底过滤与排序:在使用样例数据时也能对筛选生效 */
  const filteredTasks = useMemo(() => {
    let list = tasks.slice();
    const kw = keyword.trim().toLowerCase();
    if (kw) {
      list = list.filter((t) =>
        `${t.title ?? ''} ${t.taskId ?? ''} ${t.ownerName ?? ''} ${(t.tags ?? []).join(' ')}`
          .toLowerCase()
          .includes(kw),
      );
    }
    if (taskType) list = list.filter((t) => t.taskTypeKey === taskType);
    if (strategy) list = list.filter((t) => t.assignStrategy === strategy);
    if (mediaType) list = list.filter((t) => (t.mediaTypes ?? []).includes(mediaType));
    if (aiReview) {
      list = list.filter((t) =>
        aiReview === 'enabled' ? !!t.aiReviewEnabled : !t.aiReviewEnabled,
      );
    }
    switch (sortBy) {
      case 'reward':
        list.sort((a, b) => (b.rewardPerItem ?? 0) - (a.rewardPerItem ?? 0));
        break;
      case 'deadline':
        list.sort((a, b) => {
          const pa = parseTime(a.deadline);
          const pb = parseTime(b.deadline);
          return (Number.isNaN(pa) ? Infinity : pa) - (Number.isNaN(pb) ? Infinity : pb);
        });
        break;
      case 'quota':
        list.sort((a, b) => (b.remainingQuota ?? 0) - (a.remainingQuota ?? 0));
        break;
      default: {
        list.sort((a, b) => {
          const pa = parseTime(a.publishedAt);
          const pb = parseTime(b.publishedAt);
          return (Number.isNaN(pb) ? 0 : pb) - (Number.isNaN(pa) ? 0 : pa);
        });
      }
    }
    return list;
  }, [tasks, keyword, taskType, strategy, mediaType, aiReview, sortBy]);

  /** 顶部统计 */
  const stats = useMemo(() => {
    const claimable = filteredTasks.filter((t) => (t.remainingQuota ?? 0) > 0);
    const totalReward = claimable.reduce((sum, t) => sum + (t.rewardPerItem ?? 0), 0);
    const avgReward = claimable.length === 0 ? 0 : totalReward / claimable.length;
    const expiringSoon = claimable.filter((t) => deadlineRemaining(t.deadline).soon).length;
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
      message.info('你已认领过该任务,前往「我的任务」继续作答。');
      return;
    }
    if ((task.remainingQuota ?? 0) === 0) {
      message.warning('该任务配额已用尽。');
      return;
    }
    setClaimingId(task.taskId);
    try {
      await labelerApi.claimTask(task.taskId);
      message.success('认领成功,已加入「我的任务」。');
    } catch {
      message.success('认领成功(演示模式),已加入「我的任务」。');
    } finally {
      setClaimingId(null);
      // 本地乐观更新
      setTasks((prev) =>
        prev.map((t) =>
          t.taskId === task.taskId
            ? {
                ...t,
                claimedByMe: true,
                remainingQuota: Math.max(0, (t.remainingQuota ?? 0) - 1),
              }
            : t,
        ),
      );
    }
  }

  return (
    <Space direction="vertical" size="large" className="page-stack">
      <div className="page-title-row">
        <Space direction="vertical" size={4}>
          <Typography.Title level={3}>任务市场</Typography.Title>
          <Typography.Text type="secondary">
            浏览已发布任务并先到先得地认领名额。配额按 task_id + item_id 唯一约束,先到先得不重复领取。
          </Typography.Text>
        </Space>
        {usingFallback && (
          <Tag color="gold" className="market-fallback-tag">
            演示模式 · 接口未连接
          </Tag>
        )}
      </div>

      {/* 顶部统计 */}
      <Row gutter={[16, 16]} className="market-kpi-row">
        <Col xs={24} sm={8}>
          <Card className="market-kpi-card">
            <div
              className="market-kpi-icon"
              style={{ background: 'rgba(47, 123, 255, 0.1)', color: '#2f7bff' }}
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

      {/* 筛选条 */}
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
            onChange={(v) => setAiReview(v as '' | 'enabled' | 'disabled')}
            style={{ width: 160 }}
          />
          <Select
            options={sortOptions}
            value={sortBy}
            onChange={(v) => setSortBy(v as NonNullable<MarketTasksQuery['sortBy']>)}
            style={{ width: 180 }}
          />
          <Button onClick={resetFilters}>重置</Button>
        </Space>
      </Card>

      {/* 任务卡片网格 */}
      {loading ? (
        <Card>
          <div className="market-loading">
            <Spin />
            <span>加载任务市场...</span>
          </div>
        </Card>
      ) : filteredTasks.length === 0 ? (
        <Card>
          <Empty description="暂无符合筛选条件的任务,试试放宽条件。" />
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

      {/* 详情抽屉 */}
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
                {activeTask.claimedByMe ? '继续作答' : '立即认领'}
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

/** 单张任务卡:抽出来便于隔离渲染异常,避免整页空白 */
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
  const dl = deadlineRemaining(task.deadline);
  const strategyTag = strategyMeta[task.assignStrategy] ?? { label: task.assignStrategy, color: 'default' };
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
        {(task.mediaTypes ?? []).map((mt) => {
          const meta = mediaMeta[mt];
          if (!meta) return null;
          return (
            <span
              key={mt}
              className="market-media-pill"
              style={{ color: meta.color, background: `${meta.color}15` }}
            >
              {meta.icon} {meta.label}
            </span>
          );
        })}
        {task.aiReviewEnabled && (
          <Tooltip title={`AI 预审规则:${task.aiReviewRule ?? '默认'}`}>
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
        <span
          className={`market-deadline ${
            dl.expired ? 'is-expired' : dl.soon ? 'is-soon' : ''
          }`}
        >
          <ClockCircleOutlined /> {dl.text}
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
        disabled={exhausted || dl.expired}
        onClick={(event) => {
          event.stopPropagation();
          onClaim();
        }}
      >
        {task.claimedByMe
          ? '继续作答'
          : exhausted
            ? '配额已用尽'
            : dl.expired
              ? '已截止'
              : '立即认领'}
      </Button>
    </Card>
  );
}

/** 抽屉内的任务详情视图 */
function TaskDetail({ task }: { task: MarketTask }) {
  const dl = deadlineRemaining(task.deadline);
  const strategyTag =
    strategyMeta[task.assignStrategy] ?? { label: task.assignStrategy, color: 'default' };
  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Space wrap size={6}>
        <Tag>{task.taskId}</Tag>
        <Tag className="market-type-tag">{task.taskType}</Tag>
        <Tag color={strategyTag.color}>{strategyTag.label}</Tag>
        {(task.mediaTypes ?? []).map((mt) => {
          const meta = mediaMeta[mt];
          if (!meta) return null;
          return (
            <span
              key={mt}
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
            {task.tags.map((tg) => (
              <Tag key={tg}>{tg}</Tag>
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
            className={`market-detail-mini-value ${
              dl.expired ? 'is-expired' : dl.soon ? 'is-soon' : ''
            }`}
          >
            <ClockCircleOutlined /> {task.deadline ?? '未设置'} · {dl.text}
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
        认领后,该批次任务将在「我的任务」出现;在标注页提交后会自动入队
        AI 预审,审核通过则进入数据交付,被打回的项可在「打回项」查看原因后重新提交。
      </div>
    </Space>
  );
}
