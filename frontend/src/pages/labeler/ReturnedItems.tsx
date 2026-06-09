import {
  ExclamationCircleOutlined,
  ReloadOutlined,
  RobotOutlined,
  SearchOutlined,
  UserOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  List,
  Segmented,
  Skeleton,
  Space,
  Tag,
  Typography,
} from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ApiError, getApiErrorMessage } from '../../api/client';
import { labelerApi } from '../../api/labeler';
import type { LabelerItemHistory, LabelerReturnedItem, ReturnedItemSource } from '../../types/labeler';

const PAGE_SIZE = 20;

const sourceOptions: Array<{ label: string; value: ReturnedItemSource }> = [
  { label: '全部', value: 'all' },
  { label: '待修改', value: 'human_return' },
  { label: '已修改', value: 'reworked' },
  { label: '已审核', value: 'reviewed' },
  { label: 'AI预打回', value: 'ai_pre_reject' },
];

export default function ReturnedItems() {
  const navigate = useNavigate();
  const [items, setItems] = useState<LabelerReturnedItem[]>([]);
  const [source, setSource] = useState<ReturnedItemSource>('all');
  const [searchText, setSearchText] = useState('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await labelerApi.listReturnedItems({
        source,
        keyword: keyword || undefined,
        page,
        pageSize: PAGE_SIZE,
      });
      setItems(response.items ?? []);
      setTotal(response.total ?? 0);
    } catch (requestError) {
      setItems([]);
      setTotal(0);
      if (requestError instanceof ApiError && requestError.code === 'INVALID_RETURNED_ITEM_SOURCE') {
        setError('');
        return;
      }
      setError(getApiErrorMessage(requestError, '打回项接口暂不可用'));
    } finally {
      setLoading(false);
    }
  }, [keyword, page, source]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextKeyword = searchText.trim();
      if (keyword !== nextKeyword) {
        setKeyword(nextKeyword);
        setPage(1);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [keyword, searchText]);

  const handleSourceChange = (value: ReturnedItemSource) => {
    setSource(value);
    setPage(1);
  };

  const openReturnedItem = (item: LabelerReturnedItem) => {
    navigate(`/labeler/answer/${item.assignmentId}`, {
      state: {
        entry: item.reworkStatus === 'RETURNED' ? 'returned-rework' : 'returned-result',
        assignmentId: item.assignmentId,
      },
    });
  };

  return (
    <Space direction="vertical" size="large" className="page-stack">
      <div className="page-title-row">
        <Space direction="vertical" size={4}>
          <Typography.Title level={3}>打回项</Typography.Title>
          <Typography.Text type="secondary">
            跟踪人工审核打回、返修重提和最终审核结果；AI预打回仍需等待人工审核裁决。
          </Typography.Text>
        </Space>
        <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadItems()}>
          刷新
        </Button>
      </div>

      <Alert
        type="warning"
        showIcon
        icon={<ExclamationCircleOutlined />}
        message="人工审核打回才会开放修改并重提；已修改和已审核记录会继续保留，便于追踪返修闭环。"
      />

      <Card>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Space size={12} wrap className="returned-filter-row">
            <Segmented
              className="returned-source-segmented"
              options={sourceOptions}
              value={source}
              onChange={(value) => handleSourceChange(value as ReturnedItemSource)}
            />
            <Input
              allowClear
              className="returned-search-input"
              prefix={<SearchOutlined />}
              placeholder="搜索任务标题 / 任务ID / 题目ID / Assignment"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
            />
            <Typography.Text type="secondary">
              共 {total.toLocaleString()} 项
            </Typography.Text>
          </Space>

          {error ? (
            <Alert
              type="error"
              showIcon
              message={error}
              action={
                <Button size="small" onClick={() => void loadItems()}>
                  重试
                </Button>
              }
            />
          ) : null}

          {loading ? (
            <Skeleton active paragraph={{ rows: 6 }} />
          ) : (
            <List<LabelerReturnedItem>
              className="returned-item-list"
              dataSource={items}
              pagination={total > PAGE_SIZE ? {
                current: page,
                pageSize: PAGE_SIZE,
                total,
                showSizeChanger: false,
                onChange: setPage,
              } : false}
              locale={{
                emptyText: <Empty description={resolveEmptyDescription(source)} />,
              }}
              renderItem={(item) => (
                <List.Item className="returned-list-item">
                  <ReturnedItemCard item={item} onOpen={() => openReturnedItem(item)} />
                </List.Item>
              )}
            />
          )}
        </Space>
      </Card>
    </Space>
  );
}

function ReturnedItemCard({ item, onOpen }: { item: LabelerReturnedItem; onOpen: () => void }) {
  const isHumanReturn = item.source === 'HUMAN_REVIEW_RETURN';
  const stageLabel = resolveReviewStageLabel(item);
  const primaryStatus = resolvePrimaryStatus(item);
  return (
    <article className="returned-item-card">
      <div className="returned-item-main">
        <div className="returned-item-header">
          <div className="returned-item-heading">
            <Typography.Text strong className="returned-item-title">{item.title}</Typography.Text>
            <div className="returned-item-tags">
              <Tag color={isHumanReturn ? 'red' : 'orange'} icon={isHumanReturn ? <UserOutlined /> : <RobotOutlined />}>
                {item.sourceLabel}
              </Tag>
              <Tag color={primaryStatus.color}>{primaryStatus.label}</Tag>
              <Tag color="blue">{item.taskType || 'Annotation Task'}</Tag>
              <Tag color="default">第 {item.revisionNo} 轮</Tag>
            </div>
          </div>
        </div>

        <div className="returned-summary-grid">
          <ReturnedSummaryItem label="任务" value={item.taskId} />
          <ReturnedSummaryItem label="题目" value={item.itemId} />
          <ReturnedSummaryItem label="更新时间" value={item.updatedAt || '未知'} />
          <ReturnedSummaryItem label="审核角色" value={item.reviewerName || (isHumanReturn ? 'Reviewer' : '待人工审核')} />
          <ReturnedSummaryItem label="阶段" value={stageLabel || (isHumanReturn ? '人工审核' : 'AI预审')} strong />
          <ReturnedSummaryItem label={resolveTimeLabel(item)} value={resolveTimeValue(item)} />
        </div>

        {isHumanReturn ? (
          <HumanReturnDetail item={item} stageLabel={stageLabel} />
        ) : (
          <AiPreRejectDetail item={item} />
        )}

        <ReturnedTimeline entries={item.reviewTimeline ?? []} />
      </div>

      <div className="returned-item-action">
        <Button
          className="returned-item-action-btn"
          type={item.actionable ? 'primary' : 'default'}
          disabled={!item.actionable}
          onClick={onOpen}
        >
          {item.actionText}
        </Button>
      </div>
    </article>
  );
}

function ReturnedSummaryItem({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="returned-summary-item">
      <span className="returned-summary-label">{label}</span>
      <span className={strong ? 'returned-summary-value is-strong' : 'returned-summary-value'}>
        {value || '无'}
      </span>
    </div>
  );
}

function HumanReturnDetail({ item, stageLabel }: { item: LabelerReturnedItem; stageLabel: string }) {
  const returned = item.reworkStatus === 'RETURNED';
  const reworked = item.reworkStatus === 'REWORK_SUBMITTED';
  const reviewed = isReviewedStatus(item.reworkStatus);
  const reasonTitle = returned ? '打回原因' : '原打回原因';
  const reason = returned ? item.humanReason : item.reviewResultReason || item.humanReason;
  return (
    <div className="returned-detail-block">
      <div className="returned-detail-tags">
        {stageLabel ? <Tag color="red">{stageLabel}</Tag> : null}
        {item.reviewResultLabel ? (
          <Tag color={resolveReviewResultColor(item.reviewDecision)}>
            {item.reviewResultLabel}
          </Tag>
        ) : null}
        {item.aiDecision ? <Tag color="orange">AI {item.aiDecision}</Tag> : null}
      </div>
      <ReturnedReasonBox title={reasonTitle} content={reason || '未填写原因'} />
      {reworked ? (
        <Typography.Text type="secondary" className="returned-help-text">
          已修改并重新提交，等待 Reviewer 人工审核。
          {item.reworkSubmittedAt ? ` 重提时间:${item.reworkSubmittedAt}` : ''}
        </Typography.Text>
      ) : null}
      {reviewed ? (
        <ReturnedReasonBox
          title={`${stageLabel || '人工审核'}意见`}
          content={item.reviewResultReason || '未填写意见'}
          tone={resolveReviewResultTone(item.reviewDecision)}
        />
      ) : null}
      {returned && item.resubmitDeadline ? (
        <Typography.Text type={item.editable ? 'secondary' : 'danger'} className="returned-help-text">
          返修截止:{item.resubmitDeadline}
          {!item.editable && item.expiredReason === 'TASK_EXPIRED' ? '，任务已截止' : ''}
          {!item.editable && item.expiredReason === 'RETURN_REWORK_EXPIRED' ? '，已过期' : ''}
        </Typography.Text>
      ) : null}
      {returned && item.reworkSubmittedAt ? (
        <Typography.Text type="secondary" className="returned-help-text">
          上次重提时间:{item.reworkSubmittedAt}
        </Typography.Text>
      ) : null}
    </div>
  );
}

function AiPreRejectDetail({ item }: { item: LabelerReturnedItem }) {
  return (
    <div className="returned-detail-block">
      <div className="returned-detail-tags">
        <Tag color="orange">AI {item.aiDecision || 'REJECT'}</Tag>
        {typeof item.aiTotalScore === 'number' ? (
          <Tag color="gold">评分 {formatScore(item.aiTotalScore)}</Tag>
        ) : null}
        <Tag color="default">待人工审核</Tag>
      </div>
      <ReturnedReasonBox title="AI 评语" content={item.aiComment || '暂无评语'} tone="warning" />
      {item.aiRiskFlags.length > 0 ? (
        <div className="returned-evidence-row">
          <span>风险标记</span>
          {item.aiRiskFlags.map((flag, index) => (
            <Tag key={`${flag}-${index}`} color="orange">{flag}</Tag>
          ))}
        </div>
      ) : null}
      {item.aiEvidence.length > 0 ? (
        <ReturnedReasonBox title="证据" content={item.aiEvidence.join('；')} />
      ) : null}
    </div>
  );
}

function ReturnedReasonBox({
  title,
  content,
  tone = 'default',
}: {
  title: string;
  content: string;
  tone?: 'default' | 'success' | 'danger' | 'warning';
}) {
  return (
    <div className={`returned-reason-box is-${tone}`}>
      <span className="returned-reason-title">{title}</span>
      <p>{content}</p>
    </div>
  );
}

function ReturnedTimeline({ entries }: { entries: LabelerItemHistory[] }) {
  if (entries.length === 0) {
    return null;
  }
  return (
    <div className="returned-timeline-wrap">
      <div className="returned-section-title">审核链路</div>
      <ol className="returned-timeline">
        {entries.map((entry) => (
          <li key={entry.id} className={`returned-timeline-item is-${resolveTimelineTone(entry)}`}>
            <span className="returned-timeline-dot" />
            <div className="returned-timeline-content">
              <div className="returned-timeline-meta">
                <span className="returned-timeline-title">{formatLabelerHistoryTitle(entry.title)}</span>
                <span className="returned-timeline-time">{entry.occurredAt || (entry.status === 'current' ? '当前' : '')}</span>
              </div>
              <div className="returned-timeline-main">
                <span>{entry.actor}</span>
                {entry.decision ? <Tag>{historyDecisionLabel(entry.decision)}</Tag> : null}
                {typeof entry.score === 'number' ? <Tag color="gold">AI {formatScore(entry.score)}</Tag> : null}
              </div>
              {entry.reason || entry.comment ? (
                <div className="returned-timeline-note">{entry.reason || entry.comment}</div>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function formatScore(score: number) {
  return Number.isInteger(score) ? score.toString() : score.toFixed(2);
}

function resolveEmptyDescription(source: ReturnedItemSource) {
  if (source === 'reworked' || source === 'reviewed') {
    return '暂无记录；如果刚升级前端，请重启后端以启用该筛选。';
  }
  return '暂无打回项或 AI 预打回记录。';
}

function isReviewedStatus(status?: string) {
  return status === 'REVIEW_APPROVED' || status === 'REVIEW_REVISED' || status === 'REVIEW_ESCALATED';
}

function resolvePrimaryStatus(item: LabelerReturnedItem): { label: string; color: string } {
  if (item.source === 'AI_PRE_REJECT') {
    return { label: '等待人工审核', color: 'orange' };
  }
  if (item.reworkStatus === 'RETURNED') {
    return item.editable
      ? { label: item.reworkStatusLabel || '待修改', color: 'red' }
      : { label: '返修过期', color: 'default' };
  }
  if (item.reworkStatus === 'REWORK_SUBMITTED') {
    return { label: '已修改待复审', color: 'blue' };
  }
  if (item.reviewResultLabel) {
    return { label: item.reviewResultLabel, color: resolveReviewResultColor(item.reviewDecision) };
  }
  return { label: item.reworkStatusLabel || item.sourceLabel, color: resolveReworkStatusColor(item.reworkStatus) };
}

function resolveTimeLabel(item: LabelerReturnedItem) {
  if (item.reworkStatus === 'RETURNED') {
    return '返修截止';
  }
  if (item.reworkStatus === 'REWORK_SUBMITTED') {
    return '重提时间';
  }
  if (isReviewedStatus(item.reworkStatus)) {
    return '审核时间';
  }
  return '状态';
}

function resolveTimeValue(item: LabelerReturnedItem) {
  if (item.reworkStatus === 'RETURNED') {
    return item.resubmitDeadline || '未设置';
  }
  if (item.reworkStatus === 'REWORK_SUBMITTED') {
    return item.reworkSubmittedAt || '未记录';
  }
  if (isReviewedStatus(item.reworkStatus)) {
    return item.reviewedAt || '未记录';
  }
  return item.source === 'AI_PRE_REJECT' ? '等待人工审核' : '未记录';
}

function resolveReviewStageLabel(item: LabelerReturnedItem) {
  if (item.reviewStageLabel) {
    return item.reviewStageLabel;
  }
  const stageNo = item.reviewStageNo ?? item.revisionNo;
  if (!stageNo || stageNo < 1) {
    return '';
  }
  if (stageNo === 1) {
    return '初审';
  }
  if (stageNo === 2) {
    return '复审';
  }
  return '终审';
}

function resolveReviewResultTone(decision?: string): 'default' | 'success' | 'danger' | 'warning' {
  const normalized = decision?.trim().toLowerCase();
  if (normalized === 'approve' || normalized === 'approved' || normalized === 'revise' || normalized === 'revised') {
    return 'success';
  }
  if (normalized === 'return' || normalized === 'returned' || normalized === 'reject' || normalized === 'rejected') {
    return 'danger';
  }
  if (normalized === 'escalate') {
    return 'warning';
  }
  return 'default';
}

function resolveReworkStatusColor(status?: string) {
  switch (status) {
    case 'RETURNED':
      return 'red';
    case 'REWORK_SUBMITTED':
      return 'blue';
    case 'REVIEW_APPROVED':
    case 'REVIEW_REVISED':
      return 'green';
    case 'REVIEW_ESCALATED':
      return 'purple';
    case 'AI_PRE_REJECT':
      return 'orange';
    default:
      return 'default';
  }
}

function resolveReviewResultColor(decision?: string) {
  const normalized = decision?.trim().toLowerCase();
  if (normalized === 'approve' || normalized === 'approved' || normalized === 'revise' || normalized === 'revised') {
    return 'green';
  }
  if (normalized === 'escalate') {
    return 'purple';
  }
  if (normalized === 'return' || normalized === 'returned' || normalized === 'reject' || normalized === 'rejected') {
    return 'red';
  }
  return 'default';
}

function resolveTimelineTone(entry: LabelerItemHistory): 'blue' | 'green' | 'red' | 'orange' | 'gray' {
  const decision = entry.decision?.toUpperCase();
  if (entry.status === 'current') return 'blue';
  if (decision === 'APPROVE' || decision === 'APPROVED' || decision === 'REVISE' || decision === 'REVISED' || decision === 'PASS') {
    return 'green';
  }
  if (decision === 'RETURN' || decision === 'RETURNED' || decision === 'REJECT' || decision === 'REJECTED') {
    return 'red';
  }
  if (decision === 'ESCALATE' || decision === 'NEED_HUMAN_REVIEW' || decision === 'PENDING_HUMAN_REVIEW') {
    return 'orange';
  }
  if (entry.type === 'submit') return 'blue';
  return 'gray';
}

function formatLabelerHistoryTitle(title: string) {
  return title.replace(/AI\s*预审（Revision\s+(\d+)）/i, '第 $1 轮 AI预审');
}

function historyDecisionLabel(decision: string): string {
  const normalized = decision.toUpperCase();
  const labels: Record<string, string> = {
    SUBMIT: '提交',
    PASS: '通过',
    APPROVE: '通过',
    APPROVED: '通过',
    REVISE: '修订通过',
    REVISED: '修订通过',
    RETURN: '打回',
    RETURNED: '打回',
    REJECT: '打回',
    REJECTED: '打回',
    ESCALATE: '升级争议',
    NEED_HUMAN_REVIEW: '需人工',
    PENDING_HUMAN_REVIEW: '待人工',
    REWORKING: '修改中',
  };
  return labels[normalized] ?? decision;
}
