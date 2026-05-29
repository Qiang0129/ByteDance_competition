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
  title: string;
  type: string;
  status: ItemStatus;
  progress: string;
  publishedAt?: string;
  deadline?: string;
  updatedAt: string;
  ownerName: string;
  assignedCount: number;
  pendingCount: number;
  submittedCount: number;
  actionText: string;
  actionDisabled: boolean;
}

const statusText: Partial<Record<ItemStatus, string>> = {
  available: '可领取',
  claimed: '进行中',
  submitted: '已提交',
  returned: '已打回',
  accepted: '已通过',
};

const statusColor: Partial<Record<ItemStatus, string>> = {
  available: 'default',
  claimed: 'processing',
  submitted: 'blue',
  returned: 'warning',
  accepted: 'success',
};

const sampleRows: MyTaskRow[] = [
  {
    key: 'sample-t-1',
    assignmentId: 'sample-a-1',
    taskId: 'sample-t-1',
    title: 'QA 质量评估 · 批次 Q12',
    type: 'QA Quality',
    status: 'claimed',
    progress: '已提交 24 / 50',
    updatedAt: '今天 14:32',
    ownerName: 'Demo Owner',
    assignedCount: 50,
    pendingCount: 26,
    submittedCount: 24,
    actionText: '继续答题',
    actionDisabled: false,
  },
  {
    key: 'sample-t-2',
    assignmentId: 'sample-a-2',
    taskId: 'sample-t-2',
    title: '偏好对比 A/B · 批次 P07',
    type: 'Preference Compare',
    status: 'submitted',
    progress: '已提交 12 / 12',
    updatedAt: '昨天 18:01',
    ownerName: 'Demo Owner',
    assignedCount: 12,
    pendingCount: 0,
    submittedCount: 12,
    actionText: '查看/修改答卷',
    actionDisabled: false,
  },
  {
    key: 'sample-t-3',
    assignmentId: 'sample-a-3',
    taskId: 'sample-t-3',
    title: '图像分类标注 · 交通标志 V4',
    type: 'Image Classification',
    status: 'claimed',
    progress: '已提交 0 / 18',
    updatedAt: '昨天 20:45',
    ownerName: 'Demo Owner',
    assignedCount: 18,
    pendingCount: 18,
    submittedCount: 0,
    actionText: '开始答题',
    actionDisabled: false,
  },
];

function assignmentsToRows(items: Assignment[]): MyTaskRow[] {
  const grouped = new Map<string, Assignment[]>();
  items.forEach((item) => {
    grouped.set(item.taskId, [...(grouped.get(item.taskId) ?? []), item]);
  });

  return Array.from(grouped.entries()).map(([taskId, assignments]) => {
    const latest = assignments[0];
    const entry = resolveEntryAssignment(assignments);
    const submittedCount = assignments.filter((item) =>
      item.status === 'submitted' || item.status === 'accepted'
    ).length;
    const pendingCount = assignments.filter((item) =>
      item.status === 'claimed' || item.status === 'returned'
    ).length;
    const assignedCount = assignments.length;
    const quotaTotal = latest.quotaTotal ?? assignedCount;

    return {
      key: taskId,
      assignmentId: entry.assignmentId,
      taskId,
      title: latest.taskTitle || `任务 #${taskId}`,
      type: latest.taskType || 'Annotation Task',
      status: resolveTaskStatus(assignments),
      progress: `已提交 ${submittedCount.toLocaleString()} / ${assignedCount.toLocaleString()} · 已领 ${assignedCount.toLocaleString()} / ${quotaTotal.toLocaleString()}`,
      publishedAt: latest.publishedAt || '-',
      deadline: latest.deadline || '-',
      updatedAt: latest.updatedAt || latest.submittedAt || latest.claimedAt || '-',
      ownerName: latest.ownerName || '-',
      assignedCount,
      pendingCount,
      submittedCount,
      actionText: resolveActionText(entry),
      actionDisabled: entry.status === 'voided',
    };
  });
}

function resolveEntryAssignment(assignments: Assignment[]) {
  const sorted = [...assignments].sort(compareAssignmentId);
  return (
    sorted.find((item) => item.status === 'returned') ??
    sorted.find((item) => item.status === 'claimed') ??
    sorted[0]
  );
}

function resolveTaskStatus(assignments: Assignment[]): ItemStatus {
  if (assignments.every((item) => item.status === 'voided')) return 'voided';
  if (assignments.some((item) => item.status === 'returned')) return 'returned';
  if (assignments.some((item) => item.status === 'claimed')) return 'claimed';
  if (assignments.every((item) => item.status === 'accepted')) return 'accepted';
  return 'submitted';
}

function compareAssignmentId(a: Assignment, b: Assignment) {
  const left = Number(a.assignmentId);
  const right = Number(b.assignmentId);
  if (Number.isFinite(left) && Number.isFinite(right)) {
    return left - right;
  }
  return a.assignmentId.localeCompare(b.assignmentId);
}

function resolveActionText(assignment: Assignment) {
  if (assignment.status === 'accepted') return '查看答卷';
  if (assignment.status === 'returned') return '继续修改';
  if (assignment.status === 'submitted' || assignment.hasSubmittedAnnotation) {
    return '查看/修改答卷';
  }
  if (assignment.status === 'claimed') {
    return assignment.hasDraft ? '继续答题' : '开始答题';
  }
  if (assignment.status === 'voided') return '已作废';
  return '查看';
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
        setRows(assignmentsToRows(response.items ?? []));
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
            Task {record.taskId} · Owner {record.ownerName} · 已领取 {record.assignedCount} 题 · 待答 {record.pendingCount} 题
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
    { title: '作答进度', dataIndex: 'progress' },
    { title: '发布时间', dataIndex: 'publishedAt', render: (value?: string) => value || '-' },
    { title: '截止时间', dataIndex: 'deadline', render: (value?: string) => value || '-' },
    { title: '更新时间', dataIndex: 'updatedAt' },
    {
      title: '操作',
      key: 'action',
      render: (_value, record) => (
        <Space size="small">
          <Button
            type="link"
            disabled={record.actionDisabled}
            onClick={() => navigate(`/labeler/answer/${record.assignmentId}`)}
          >
            {record.actionText}
          </Button>
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
