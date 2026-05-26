import { useEffect, useState } from 'react';
import { App, Button, Card, Empty, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useNavigate } from 'react-router-dom';

import { labelerApi } from '../../api/labeler';
import type { Assignment, ItemStatus } from '../../types/labeler';

interface MyTaskRow {
  key: string;
  assignmentId: string;
  taskId: string;
  itemId: string;
  title: string;
  type: string;
  status: ItemStatus;
  progress: string;
  updatedAt: string;
  ownerName: string;
}

const statusText: Record<ItemStatus, string> = {
  available: '可领取',
  claimed: '进行中',
  submitted: '已提交',
  returned: '已打回',
  accepted: '已通过',
};

const statusColor: Record<ItemStatus, string> = {
  available: 'default',
  claimed: 'processing',
  submitted: 'blue',
  returned: 'warning',
  accepted: 'success',
};

const sampleRows: MyTaskRow[] = [
  {
    key: 'sample-a-1',
    assignmentId: 'sample-a-1',
    taskId: 'sample-t-1',
    itemId: 'sample-i-1',
    title: 'QA 质量评估 · 批次 Q12',
    type: 'QA Quality',
    status: 'claimed',
    progress: '24 / 50',
    updatedAt: '今天 14:32',
    ownerName: 'Demo Owner',
  },
  {
    key: 'sample-a-2',
    assignmentId: 'sample-a-2',
    taskId: 'sample-t-2',
    itemId: 'sample-i-2',
    title: '偏好对比 A/B · 批次 P07',
    type: 'Preference Compare',
    status: 'submitted',
    progress: '0 / 12',
    updatedAt: '昨天 18:01',
    ownerName: 'Demo Owner',
  },
  {
    key: 'sample-a-3',
    assignmentId: 'sample-a-3',
    taskId: 'sample-t-3',
    itemId: 'sample-i-3',
    title: '图像分类标注 · 交通标志 V4',
    type: 'Image Classification',
    status: 'claimed',
    progress: '0 / 18',
    updatedAt: '昨天 20:45',
    ownerName: 'Demo Owner',
  },
];

function assignmentToRow(item: Assignment): MyTaskRow {
  const quotaUsed = item.quotaUsed ?? 0;
  const quotaTotal = item.quotaTotal ?? 0;
  return {
    key: item.assignmentId,
    assignmentId: item.assignmentId,
    taskId: item.taskId,
    itemId: item.itemId,
    title: item.taskTitle || `任务 #${item.taskId}`,
    type: item.taskType || 'Annotation Task',
    status: item.status,
    progress: `${quotaUsed.toLocaleString()} / ${quotaTotal.toLocaleString()}`,
    updatedAt: item.updatedAt || item.submittedAt || item.claimedAt || '-',
    ownerName: item.ownerName || '-',
  };
}

export default function MyTasks() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [rows, setRows] = useState<MyTaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [usingFallback, setUsingFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadAssignments = async () => {
      setLoading(true);
      try {
        const response = await labelerApi.listMyAssignments();
        if (cancelled) return;
        setRows((response.items ?? []).map(assignmentToRow));
        setUsingFallback(false);
      } catch (error) {
        if (cancelled) return;
        setRows(sampleRows);
        setUsingFallback(true);
        message.warning(error instanceof Error ? error.message : '我的任务接口暂不可用,已显示演示数据');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadAssignments();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const columns: ColumnsType<MyTaskRow> = [
    {
      title: '任务名称',
      dataIndex: 'title',
      render: (_value, record) => (
        <Space direction="vertical" size={2}>
          <span>{record.title}</span>
          <Typography.Text type="secondary">
            Assignment {record.assignmentId} · Item {record.itemId} · Owner {record.ownerName}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      render: (type: string) => <Tag color="blue">{type}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      render: (status: ItemStatus) => (
        <Tag color={statusColor[status] ?? 'default'}>{statusText[status] ?? status}</Tag>
      ),
    },
    { title: '已领 / 配额', dataIndex: 'progress' },
    { title: '更新时间', dataIndex: 'updatedAt' },
    {
      title: '操作',
      key: 'action',
      render: (_value, record) => (
        <Space size="small">
          <Button
            type="link"
            onClick={() => navigate(`/labeler/answer/${record.assignmentId}`)}
          >
            继续答题
          </Button>
          {(record.status === 'submitted' || record.status === 'accepted') && (
            <Button type="link">查看答卷</Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size="large" className="page-stack">
      <div className="page-title-row">
        <Space direction="vertical" size={4}>
          <Typography.Title level={3}>我的任务</Typography.Title>
          <Typography.Text type="secondary">
            管理已认领的标注作业,查看 AI 预审与人工审核进度。
          </Typography.Text>
        </Space>
        {usingFallback && <Tag color="gold">演示模式 · 接口未连接</Tag>}
      </div>

      <Card>
        <Table<MyTaskRow>
          columns={columns}
          dataSource={rows}
          loading={loading}
          pagination={false}
          locale={{ emptyText: <Empty description="暂无已认领任务,请先到任务市场领取。" /> }}
        />
      </Card>
    </Space>
  );
}
