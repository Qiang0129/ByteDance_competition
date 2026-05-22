import { Button, Card, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';

interface MyTaskRow {
  key: string;
  title: string;
  type: string;
  status: 'in_progress' | 'submitted' | 'ai_reviewing' | 'reviewing';
  remaining: string;
  updatedAt: string;
}

/**
 * 我的任务。
 * 接口预留:GET /assignments/mine(见 api/labeler.ts)。
 */
const statusText: Record<MyTaskRow['status'], string> = {
  in_progress: '进行中',
  submitted: '已提交',
  ai_reviewing: 'AI 预审中',
  reviewing: '审核中',
};

const statusColor: Record<MyTaskRow['status'], string> = {
  in_progress: 'processing',
  submitted: 'blue',
  ai_reviewing: 'gold',
  reviewing: 'purple',
};

const rows: MyTaskRow[] = [
  {
    key: 'a-1',
    title: 'QA 质量评估 · 批次 Q12',
    type: 'QA Quality',
    status: 'in_progress',
    remaining: '24 / 50',
    updatedAt: '今天 14:32',
  },
  {
    key: 'a-2',
    title: '偏好对比 A/B · 批次 P07',
    type: 'Preference Compare',
    status: 'submitted',
    remaining: '0 / 12',
    updatedAt: '昨天 18:01',
  },
  {
    key: 'a-3',
    title: '图像分类标注 · 交通标志 V4',
    type: 'Image Classification',
    status: 'ai_reviewing',
    remaining: '0 / 18',
    updatedAt: '昨天 20:45',
  },
];

const columns: ColumnsType<MyTaskRow> = [
  { title: '任务名称', dataIndex: 'title' },
  {
    title: '类型',
    dataIndex: 'type',
    render: (type: string) => <Tag color="blue">{type}</Tag>,
  },
  {
    title: '状态',
    dataIndex: 'status',
    render: (status: MyTaskRow['status']) => (
      <Tag color={statusColor[status]}>{statusText[status]}</Tag>
    ),
  },
  { title: '剩余进度', dataIndex: 'remaining' },
  { title: '更新时间', dataIndex: 'updatedAt' },
  {
    title: '操作',
    key: 'action',
    render: (_value, record) => (
      <Space size="small">
        <Button type="link">继续答题</Button>
        {record.status === 'submitted' && <Button type="link">查看答卷</Button>}
      </Space>
    ),
  },
];

export default function MyTasks() {
  return (
    <Space direction="vertical" size="large" className="page-stack">
      <div className="page-title-row">
        <Space direction="vertical" size={4}>
          <Typography.Title level={3}>我的任务</Typography.Title>
          <Typography.Text type="secondary">
            管理已认领的标注作业,查看 AI 预审与人工审核进度。
          </Typography.Text>
        </Space>
      </div>

      <Card>
        <Table<MyTaskRow> columns={columns} dataSource={rows} pagination={false} />
      </Card>
    </Space>
  );
}
