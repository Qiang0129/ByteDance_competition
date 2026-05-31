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

import { getApiErrorMessage } from '../../api/client';
import { labelerApi } from '../../api/labeler';
import type { LabelerReturnedItem, ReturnedItemSource } from '../../types/labeler';

const PAGE_SIZE = 20;

const sourceOptions: Array<{ label: string; value: ReturnedItemSource }> = [
  { label: '全部', value: 'all' },
  { label: '人工复审打回', value: 'human_return' },
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

  return (
    <Space direction="vertical" size="large" className="page-stack">
      <div className="page-title-row">
        <Space direction="vertical" size={4}>
          <Typography.Title level={3}>打回项</Typography.Title>
          <Typography.Text type="secondary">
            人工复审打回是正式返修,可修改并重提;AI预打回只是预审建议,需等待人工复审裁决。
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
        message="人工复审打回才会开放修改并重提;AI预打回不代表已正式退回,请等待 Reviewer 人工复审。"
      />

      <Card>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Space size={12} wrap>
            <Segmented
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
                emptyText: <Empty description="暂无打回项或 AI 预打回记录。" />,
              }}
              renderItem={(item) => (
                <List.Item
                  actions={[
                    <Button
                      key="action"
                      type={item.actionable ? 'link' : 'default'}
                      disabled={!item.actionable}
                      onClick={() => navigate(`/labeler/answer/${item.assignmentId}`, {
                        state: {
                          entry: 'returned-rework',
                          assignmentId: item.assignmentId,
                        },
                      })}
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
  return (
    <Space direction="vertical" size={4}>
      <Space size={[8, 4]} wrap>
        <Typography.Text>
          Reviewer:{item.reviewerName || '未记录'}
        </Typography.Text>
        {item.reviewRoundNo ? (
          <Tag color="red">第 {item.reviewRoundNo} 轮人工复审</Tag>
        ) : null}
      </Space>
      <Typography.Text type="secondary">
        人工复审打回原因:{item.humanReason || '未填写原因'}
      </Typography.Text>
      {item.resubmitDeadline ? (
        <Typography.Text type={item.editable ? 'secondary' : 'danger'}>
          返修截止:{item.resubmitDeadline}
          {!item.editable && item.expiredReason === 'RETURN_REWORK_EXPIRED' ? '，已过期' : ''}
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
        <Tag color="default">待人工复审</Tag>
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
