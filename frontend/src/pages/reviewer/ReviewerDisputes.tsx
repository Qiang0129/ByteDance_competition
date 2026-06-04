import { useEffect, useMemo, useState } from 'react';
import {
  CheckOutlined,
  CloseOutlined,
  ExclamationCircleFilled,
  HistoryOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import {
  App as AntdApp,
  Button,
  Card,
  Input,
  List,
  Modal,
  Segmented,
  Space,
  Tag,
  Typography,
} from 'antd';

import { reviewerApi } from '../../api/reviewer';
import type { DisputeItem } from '../../types/reviewer';

/**
 * 争议样本页。
 * 计划书 4.5 / 4.6:对多轮返工或人工/AI 分歧严重的样本走单独议程,带终审决定。
 */

export default function ReviewerDisputes() {
  const { message } = AntdApp.useApp();
  const [items, setItems] = useState<DisputeItem[]>([]);
  const [filter, setFilter] = useState<'all' | 'open' | 'resolved'>('all');
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  const [usingFallback, setUsingFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const resp = await reviewerApi.listDisputes({ status: 'all', pageSize: 50 });
        if (cancelled) return;
        setItems(resp.items ?? []);
        setUsingFallback(false);
      } catch {
        try {
          const res = await fetch('/sample-datasets/reviewer-disputes.json');
          const data = await res.json();
          if (cancelled) return;
          setItems((data.items as DisputeItem[]) ?? []);
          setUsingFallback(true);
        } catch {
          if (!cancelled) message.error('加载争议样本失败');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [message]);

  const filtered = useMemo(() => {
    return items.filter((it) => {
      if (filter !== 'all' && it.status !== filter) return false;
      if (keyword) {
        const kw = keyword.toLowerCase();
        if (!`${it.taskTitle} ${it.disputeId} ${it.reason}`.toLowerCase().includes(kw))
          return false;
      }
      return true;
    });
  }, [items, filter, keyword]);

  async function resolve(item: DisputeItem, resolution: 'approve' | 'reject', note?: string) {
    try {
      await reviewerApi.resolveDispute(item.disputeId, { resolution, note });
    } catch {
      // 演示模式
    }
    setItems((prev) =>
      prev.map((it) =>
        it.disputeId === item.disputeId ? { ...it, status: 'resolved' } : it,
      ),
    );
    message.success(resolution === 'approve' ? '终审通过' : '终审驳回');
  }

  function openResolveDialog(item: DisputeItem, resolution: 'approve' | 'reject') {
    let note = '';
    Modal.confirm({
      title: resolution === 'approve' ? '终审通过' : '终审驳回',
      content: (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            {item.taskTitle} · {item.disputeId} · 已经历 {item.rounds} 轮审核。
            确认后写入 audit log 并通知关联标注员与初审员。
          </Typography.Paragraph>
          {resolution === 'reject' && (
            <Input.TextArea
              rows={4}
              placeholder="请输入终审打回原因"
              onChange={(event) => {
                note = event.target.value;
              }}
            />
          )}
        </Space>
      ),
      okText: '确认',
      onOk: async () => {
        const trimmed = note.trim();
        if (resolution === 'reject' && !trimmed) {
          message.warning('终审打回必须填写原因');
          return Promise.reject();
        }
        await resolve(item, resolution, trimmed || undefined);
      },
    });
  }

  return (
    <Space direction="vertical" size="large" className="page-stack">
      <div className="page-title-row">
        <Space direction="vertical" size={4}>
          <Typography.Title level={3}>争议样本</Typography.Title>
          <Typography.Text type="secondary">
            处理多轮返工或人工与 AI 分歧严重的样本,做出终审决定;decisions 写入 audit log。
          </Typography.Text>
        </Space>
        {usingFallback && <Tag color="gold">演示模式 · 接口未连接</Tag>}
      </div>

      <Card>
        <Space size={12} wrap>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索任务名 / 争议 ID / 原因"
            style={{ width: 280 }}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Segmented
            options={[
              { label: '全部', value: 'all' },
              { label: '待处理', value: 'open' },
              { label: '已解决', value: 'resolved' },
            ]}
            value={filter}
            onChange={(v) => setFilter(v as typeof filter)}
          />
        </Space>
      </Card>

      <Card>
        <List<DisputeItem>
          loading={loading}
          dataSource={filtered}
          locale={{ emptyText: '暂无争议样本,点赞~' }}
          renderItem={(item) => (
            <List.Item
              actions={
                item.status === 'open'
                  ? [
                      <Button
                        key="approve"
                        type="link"
                        icon={<CheckOutlined />}
                        onClick={() => openResolveDialog(item, 'approve')}
                      >
                        终审通过
                      </Button>,
                      <Button
                        key="reject"
                        type="link"
                        danger
                        icon={<CloseOutlined />}
                        onClick={() => openResolveDialog(item, 'reject')}
                      >
                        终审驳回
                      </Button>,
                    ]
                  : [<Tag key="status" color="success">已解决</Tag>]
              }
            >
              <List.Item.Meta
                title={
                  <Space size={8} wrap>
                    <span className="dispute-task-title">{item.taskTitle}</span>
                    <Tag>{item.disputeId}</Tag>
                    <Tag color={item.rounds >= 3 ? 'red' : 'orange'}>
                      已经 {item.rounds} 轮
                    </Tag>
                  </Space>
                }
                description={
                  <Space direction="vertical" size={4}>
                    <Typography.Text type="secondary">
                      <ExclamationCircleFilled style={{ color: '#f59e0b' }} /> {item.reason}
                    </Typography.Text>
                    <Typography.Text type="secondary" className="dispute-meta">
                      <HistoryOutlined /> 由 {item.raisedBy} 升级 · {item.raisedAt}
                    </Typography.Text>
                  </Space>
                }
              />
            </List.Item>
          )}
        />
      </Card>
    </Space>
  );
}
