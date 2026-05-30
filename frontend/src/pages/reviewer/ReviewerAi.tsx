import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRightOutlined,
  ExclamationCircleOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import {
  App as AntdApp,
  Button,
  Card,
  Empty,
  Input,
  Segmented,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import { useNavigate } from 'react-router-dom';

import { reviewerApi } from '../../api/reviewer';
import { AiAssistantIcon } from '../../components/icons';
import type {
  AiReviewResult,
  AiReviewTaskSummary,
  AnnotationToReview,
} from '../../types/reviewer';

/**
 * AI 预审页:按「任务」聚合展示 AI 已出结论的标注。
 *   - 顶层是优美的任务卡片,显示 PASS / NEED_HUMAN / REJECT 计数;
 *   - 每张卡片带「进入审核」按钮,点击跳到三栏审核工作台 /reviewer/ai/{taskId}。
 * 后端接口(待实现):
 *   GET  /reviewer/ai-review/tasks
 *   GET  /reviewer/ai-review/tasks/{taskId}/annotations
 *   POST /reviewer/annotations/{annotationId}/decision
 */

type DecisionFilter = 'all' | AiReviewResult['decision'];

export default function ReviewerAi() {
  const { message } = AntdApp.useApp();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<AiReviewTaskSummary[]>([]);
  const [filter, setFilter] = useState<DecisionFilter>('all');
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  const [usingFallback, setUsingFallback] = useState(false);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await reviewerApi.listAiReviewTasks({
        decision: filter,
        keyword: keyword || undefined,
      });
      setTasks(resp.items ?? []);
      setUsingFallback(false);
    } catch {
      try {
        const res = await fetch('/sample-datasets/reviewer-annotations.json');
        const data = await res.json();
        const items = (data.items as AnnotationToReview[]) ?? [];
        setTasks(groupTasksFromItems(items));
        setUsingFallback(true);
      } catch {
        message.error('加载 AI 预审任务失败');
        setTasks([]);
      }
    } finally {
      setLoading(false);
    }
  }, [filter, keyword, message]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const visibleTasks = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return tasks.filter((t) => {
      if (filter !== 'all') {
        const count =
          filter === 'PASS'
            ? t.passCount
            : filter === 'REJECT'
              ? t.rejectCount
              : t.needHumanCount;
        if (count <= 0) return false;
      }
      if (kw && !`${t.taskTitle} ${t.taskType ?? ''}`.toLowerCase().includes(kw)) {
        return false;
      }
      return true;
    });
  }, [tasks, filter, keyword]);

  const totalAnnotations = useMemo(
    () => visibleTasks.reduce((sum, t) => sum + t.total, 0),
    [visibleTasks],
  );

  return (
    <Space direction="vertical" size="large" className="page-stack">
      <div className="page-title-row">
        <Space direction="vertical" size={4}>
          <Typography.Title level={3}>待审队列</Typography.Title>
          <Typography.Text type="secondary">
            按任务集中查看 AI 预审结果,点击「进入审核」逐条裁决并入库。
          </Typography.Text>
        </Space>
        {usingFallback && <Tag color="gold">演示模式 · 接口未连接</Tag>}
      </div>

      <Card>
        <Space size={12} wrap>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索任务名称 / 类型"
            style={{ width: 280 }}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Segmented
            options={[
              { label: '全部', value: 'all' },
              { label: 'PASS', value: 'PASS' },
              { label: '人工复核', value: 'NEED_HUMAN_REVIEW' },
              { label: 'REJECT', value: 'REJECT' },
            ]}
            value={filter}
            onChange={(v) => setFilter(v as DecisionFilter)}
          />
          <Tag icon={<AiAssistantIcon />} color="processing">
            {visibleTasks.length} 个任务 · {totalAnnotations} 条 AI 结果
          </Tag>
        </Space>
      </Card>

      <Spin spinning={loading}>
        {visibleTasks.length === 0 && !loading ? (
          <Card>
            <Empty description="暂无 AI 预审结果" />
          </Card>
        ) : (
          <div className="ai-review-card-grid">
            {visibleTasks.map((task) => (
              <AiReviewTaskCard
                key={task.taskId}
                task={task}
                onEnter={() => navigate(`/reviewer/ai/${encodeURIComponent(task.taskId)}`)}
              />
            ))}
          </div>
        )}
      </Spin>

      <Card>
        <Space size={6} wrap>
          <ExclamationCircleOutlined style={{ color: '#f59e0b' }} />
          <Typography.Text type="secondary">
            当 AI 结果与人工裁决出现分歧并升级时,会进入「争议样本」页;计划书 4.4 要求保留 prompt 与 response 快照。
          </Typography.Text>
        </Space>
      </Card>
    </Space>
  );
}

/* ============ 任务卡片 ============ */
function AiReviewTaskCard({
  task,
  onEnter,
}: {
  task: AiReviewTaskSummary;
  onEnter: () => void;
}) {
  const donePct = task.total > 0 ? Math.round(((task.total - task.pendingHuman) / task.total) * 100) : 0;

  return (
    <Card className="ai-review-card" hoverable onClick={onEnter}>
      <div className="ai-review-card-head">
        <div className="ai-review-card-icon">
          <AiAssistantIcon />
        </div>
        <div className="ai-review-card-titles">
          <span className="ai-review-card-title">{task.taskTitle}</span>
          {task.taskType && <span className="ai-review-card-type">{task.taskType}</span>}
        </div>
      </div>

      <div className="ai-review-card-stats">
        <div className="ai-review-stat is-pass">
          <span className="ai-review-stat-num">{task.passCount}</span>
          <span className="ai-review-stat-label">建议通过</span>
        </div>
        <div className="ai-review-stat is-human">
          <span className="ai-review-stat-num">{task.needHumanCount}</span>
          <span className="ai-review-stat-label">人工复核</span>
        </div>
        <div className="ai-review-stat is-reject">
          <span className="ai-review-stat-num">{task.rejectCount}</span>
          <span className="ai-review-stat-label">建议打回</span>
        </div>
      </div>

      <div className="ai-review-card-progress">
        <div className="ai-review-card-progress-bar">
          <span style={{ width: `${donePct}%` }} />
        </div>
        <span className="ai-review-card-progress-text">
          待审 {task.pendingHuman} · 共 {task.total} 条
        </span>
      </div>

      <Button
        type="primary"
        block
        className="ai-review-card-enter"
        onClick={(e) => {
          e.stopPropagation();
          onEnter();
        }}
      >
        进入审核 <ArrowRightOutlined />
      </Button>
    </Card>
  );
}

/* ============ 工具函数 ============ */

/** 把扁平标注列表按任务聚合成任务摘要(演示模式 / 无后端聚合接口时使用) */
export function groupTasksFromItems(items: AnnotationToReview[]): AiReviewTaskSummary[] {
  const map = new Map<string, AiReviewTaskSummary>();
  for (const it of items) {
    if (!it.aiResult) continue;
    const taskId = it.taskId ?? `schema-${it.schemaVersionId}`;
    const taskTitle = it.taskTitle ?? `Schema ${it.schemaVersionId} 任务`;
    let summary = map.get(taskId);
    if (!summary) {
      summary = {
        taskId,
        taskTitle,
        taskType: it.taskType,
        total: 0,
        passCount: 0,
        needHumanCount: 0,
        rejectCount: 0,
        pendingHuman: 0,
      };
      map.set(taskId, summary);
    }
    summary.total += 1;
    summary.pendingHuman += 1;
    if (it.aiResult.decision === 'PASS') summary.passCount += 1;
    if (it.aiResult.decision === 'REJECT') summary.rejectCount += 1;
    if (it.aiResult.decision === 'NEED_HUMAN_REVIEW') summary.needHumanCount += 1;
  }
  return Array.from(map.values());
}
