import {
  CloudUploadOutlined,
  DatabaseOutlined,
  FileSearchOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { Button, Card, Col, Row, Space, Statistic, Steps, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';

interface ProjectRow {
  key: string;
  name: string;
  dataset: string;
  status: 'draft' | 'running' | 'reviewing';
  progress: string;
}

const projectRows: ProjectRow[] = [
  {
    key: 'traffic-sign',
    name: '交通标志图片分类',
    dataset: 'traffic-sign-v1',
    status: 'running',
    progress: '128 / 500',
  },
  {
    key: 'merchant-review',
    name: '商户评论情感标注',
    dataset: 'merchant-review-demo',
    status: 'reviewing',
    progress: '86 / 120',
  },
];

const statusText: Record<ProjectRow['status'], string> = {
  draft: '草稿',
  running: '标注中',
  reviewing: '审核中',
};

const statusColor: Record<ProjectRow['status'], string> = {
  draft: 'default',
  running: 'processing',
  reviewing: 'warning',
};

const columns: ColumnsType<ProjectRow> = [
  {
    title: '项目名称',
    dataIndex: 'name',
  },
  {
    title: '数据集',
    dataIndex: 'dataset',
  },
  {
    title: '状态',
    dataIndex: 'status',
    render: (status: ProjectRow['status']) => (
      <Tag color={statusColor[status]}>{statusText[status]}</Tag>
    ),
  },
  {
    title: '进度',
    dataIndex: 'progress',
  },
];

export default function OwnerHome() {
  return (
    <Space direction="vertical" size="large" className="page-stack">
      <div className="page-title-row">
        <Space direction="vertical" size={4}>
          <Typography.Title level={3}>项目方工作台</Typography.Title>
          <Typography.Text type="secondary">
            管理数据集、创建标注项目，并跟踪标注与审核进度。
          </Typography.Text>
        </Space>
        <Button type="primary" icon={<PlusOutlined />}>
          新建标注项目
        </Button>
      </div>

      <Row gutter={16}>
        <Col span={8}>
          <Card>
            <Statistic title="活跃项目" value={2} prefix={<DatabaseOutlined />} />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic title="待审核任务" value={34} prefix={<FileSearchOutlined />} />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic title="已上传数据集" value={5} prefix={<CloudUploadOutlined />} />
          </Card>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col span={15}>
          <Card title="项目概览">
            <Table<ProjectRow>
              columns={columns}
              dataSource={projectRows}
              pagination={false}
            />
          </Card>
        </Col>
        <Col span={9}>
          <Card title="第一阶段后端接口预留">
            <Steps
              direction="vertical"
              size="small"
              current={0}
              items={[
                { title: '认证登录', description: 'POST /api/auth/login' },
                { title: '当前用户', description: 'GET /api/auth/me' },
                { title: '项目列表', description: 'GET /api/owner/projects' },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </Space>
  );
}
