import {
  ExclamationCircleOutlined,
  ReloadOutlined,
  RobotOutlined,
  UserOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Empty,
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
import type { LabelerReturnedItem, ReturnedItemSource } from '../../types/labeler';

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
  }, [page, source]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

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
                <List.Item
                  actions={[
                    <Button
                      key="action"
                      type={item.actionable ? 'link' : 'default'}
                      disabled={!item.actionable}
                      onClick={() => openReturnedItem(item)}
                    >
                      {item.actionText}
                    </Button>,
                  ]}
                >
                  <List.Item.Meta
                    title={<ReturnedItemTitle item={item} />}
                    description={<ReturnedItemDescription item={item} />}
                  />
                </List.Item>
              )}
            />
          )}
        </Space>
      </Card>
    </Space>
  );
}

function ReturnedItemTitle({ item }: { item: LabelerReturnedItem }) {
  const isHumanReturn = item.source === 'HUMAN_REVIEW_RETURN';
  return (
    <Space size={[8, 4]} wrap>
      <Typography.Text strong>{item.title}</Typography.Text>
      <Tag color={isHumanReturn ? 'red' : 'orange'} icon={isHumanReturn ? <UserOutlined /> : <RobotOutlined />}>
        {item.sourceLabel}
      </Tag>
      <Tag color={resolveReworkStatusColor(item.reworkStatus)}>
        {item.reworkStatusLabel || item.sourceLabel}
      </Tag>
      <Tag color="blue">{item.taskType || 'Annotation Task'}</Tag>
      <Tag color="default">Revision {item.revisionNo}</Tag>
    </Space>
  );
}

function ReturnedItemDescription({ item }: { item: LabelerReturnedItem }) {
  return (
    <Space direction="vertical" size={6}>
      <Space size={[8, 4]} wrap>
        <Typography.Text type="secondary">任务 {item.taskId}</Typography.Text>
        <Typography.Text type="secondary">题目 {item.itemId}</Typography.Text>
        <Typography.Text type="secondary">{item.updatedAt || '更新时间未知'}</Typography.Text>
      </Space>
      {item.source === 'HUMAN_REVIEW_RETURN'
        ? <HumanReturnDetail item={item} />
        : <AiPreRejectDetail item={item} />}
    </Space>
  );
}

function HumanReturnDetail({ item }: { item: LabelerReturnedItem }) {
  const returned = item.reworkStatus === 'RETURNED';
  const reworked = item.reworkStatus === 'REWORK_SUBMITTED';
  const reviewed = isReviewedStatus(item.reworkStatus);
  const showAgainReturned = returned && item.reviewResultLabel === '再次打回';
  const stageLabel = resolveReviewStageLabel(item);
  return (
    <Space direction="vertical" size={4}>
      <Space size={[8, 4]} wrap>
        <Typography.Text>
          Reviewer:{item.reviewerName || '未记录'}
        </Typography.Text>
        {stageLabel ? (
          <Tag color="red">{stageLabel}</Tag>
        ) : null}
        {reviewed && item.reviewResultLabel ? (
          <Tag color={resolveReviewResultColor(item.reviewDecision)}>
            {item.reviewResultLabel}
          </Tag>
        ) : null}
        {showAgainReturned ? (
          <Tag color="red">{stageLabel || '人工审核'}结果:{item.reviewResultLabel}</Tag>
        ) : null}
      </Space>
      <Typography.Text type="secondary">
        {returned ? '打回原因' : '原打回原因'}:{item.humanReason || '未填写原因'}
      </Typography.Text>
      {reworked ? (
        <Typography.Text type="secondary">
          已修改并重新提交，等待 Reviewer 人工审核。
          {item.reworkSubmittedAt ? ` 重提时间:${item.reworkSubmittedAt}` : ''}
        </Typography.Text>
      ) : null}
      {reviewed ? (
        <>
          <Typography.Text type="secondary">
            {stageLabel || '人工审核'}结果:{item.reviewResultLabel || '已审核'}
            {item.reviewedAt ? `，${stageLabel || '人工审核'}时间:${item.reviewedAt}` : ''}
          </Typography.Text>
          <Typography.Text type="secondary">
            {stageLabel || '人工审核'}意见:{item.reviewResultReason || '未填写意见'}
          </Typography.Text>
        </>
      ) : null}
      {returned && item.resubmitDeadline ? (
        <Typography.Text type={item.editable ? 'secondary' : 'danger'}>
          返修截止:{item.resubmitDeadline}
          {!item.editable && item.expiredReason === 'RETURN_REWORK_EXPIRED' ? '，已过期' : ''}
        </Typography.Text>
      ) : null}
      {returned && item.reworkSubmittedAt ? (
        <Typography.Text type="secondary">
          上次重提时间:{item.reworkSubmittedAt}
        </Typography.Text>
      ) : null}
      {item.aiDecision ? (
        <Typography.Text type="secondary">
          AI 预审结论:{item.aiDecision}
        </Typography.Text>
      ) : null}
    </Space>
  );
}

function AiPreRejectDetail({ item }: { item: LabelerReturnedItem }) {
  return (
    <Space direction="vertical" size={4}>
      <Space size={[8, 4]} wrap>
        <Tag color="orange">AI {item.aiDecision || 'REJECT'}</Tag>
        {typeof item.aiTotalScore === 'number' ? (
          <Tag color="gold">评分 {formatScore(item.aiTotalScore)}</Tag>
        ) : null}
        <Tag color="default">待人工审核</Tag>
      </Space>
      <Typography.Text type="secondary">
        AI 评语:{item.aiComment || '暂无评语'}
      </Typography.Text>
      {item.aiRiskFlags.length > 0 ? (
        <Space size={[6, 4]} wrap>
          <Typography.Text type="secondary">风险标记:</Typography.Text>
          {item.aiRiskFlags.map((flag, index) => (
            <Tag key={`${flag}-${index}`} color="orange">{flag}</Tag>
          ))}
        </Space>
      ) : null}
      {item.aiEvidence.length > 0 ? (
        <Typography.Text type="secondary">
          证据:{item.aiEvidence.join('；')}
        </Typography.Text>
      ) : null}
    </Space>
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
