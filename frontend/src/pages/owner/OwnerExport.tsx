import { useEffect, useState } from 'react';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  CloudDownloadOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import {
  App as AntdApp,
  Button,
  Card,
  Empty,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';

import { exportApi } from '../../api/export';
import { ownerApi } from '../../api/owner';
import type { ExportFormat, ExportJob } from '../../types/export';
import type { OwnerTask } from '../../types/owner';

const statusMeta: Record<ExportJob['status'], { color: string; label: string }> = {
  pending: { color: 'default', label: '待执行' },
  running: { color: 'processing', label: '导出中' },
  succeeded: { color: 'success', label: '已完成' },
  failed: { color: 'error', label: '失败' },
};

export default function OwnerExport() {
  const { message } = AntdApp.useApp();
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [tasks, setTasks] = useState<OwnerTask[]>([]);
  const [taskId, setTaskId] = useState<string>();
  const [format, setFormat] = useState<ExportFormat>('json');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [jobRes, taskRes] = await Promise.all([
        exportApi.listExports(),
        ownerApi.listTasks(),
      ]);
      setJobs(jobRes);
      setTasks(taskRes.items ?? []);
      setTaskId((current) => current ?? taskRes.items?.[0]?.taskId);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导出数据加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function createExport() {
    if (!taskId) {
      message.warning('请选择任务');
      return;
    }
    setSubmitting(true);
    try {
      await exportApi.createExport({ taskId, format });
      message.success('导出任务已创建');
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '创建导出任务失败');
    } finally {
      setSubmitting(false);
    }
  }

  async function runAction(action: () => Promise<ExportJob>, successText: string) {
    try {
      await action();
      message.success(successText);
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '操作失败');
    }
  }

  const columns: ColumnsType<ExportJob> = [
    {
      title: '导出 ID',
      dataIndex: 'exportId',
      width: 100,
      render: (value: string) => <code className="dataset-id">{value}</code>,
    },
    {
      title: '任务',
      dataIndex: 'taskId',
      render: (value: string) => tasks.find((task) => task.taskId === value)?.title ?? value,
    },
    {
      title: '格式',
      dataIndex: 'format',
      width: 90,
      render: (value: ExportFormat) => <Tag>{value.toUpperCase()}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 120,
      render: (value: ExportJob['status']) => (
        <Tag color={statusMeta[value].color}>{statusMeta[value].label}</Tag>
      ),
    },
    {
      title: '进度',
      dataIndex: 'progress',
      width: 90,
      render: (value: number) => `${value}%`,
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 150,
    },
    {
      title: '操作',
      key: 'action',
      width: 220,
      render: (_value, record) => (
        <Space size={4}>
          {record.status === 'pending' && (
            <Button
              type="link"
              size="small"
              icon={<PlayCircleOutlined />}
              onClick={() => runAction(() => exportApi.startExport(record.exportId), '导出已开始')}
            >
              开始
            </Button>
          )}
          {record.status === 'running' && (
            <Button
              type="link"
              size="small"
              icon={<CheckCircleOutlined />}
              onClick={() => runAction(() => exportApi.completeExport(record.exportId), '导出已完成')}
            >
              完成
            </Button>
          )}
          {record.status === 'running' && (
            <Button
              type="link"
              size="small"
              danger
              icon={<CloseCircleOutlined />}
              onClick={() => runAction(() => exportApi.failExport(record.exportId, 'manual failed'), '已标记失败')}
            >
              失败
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size="large" className="page-stack">
      <div className="page-title-row">
        <Space direction="vertical" size={4}>
          <Typography.Title level={3}>导出中心</Typography.Title>
          <Typography.Text type="secondary">
            只导出已通过审核的标注结果,导出状态变化会写入审计日志。
          </Typography.Text>
        </Space>
        <Button icon={<ReloadOutlined />} onClick={() => void load()}>
          刷新
        </Button>
      </div>

      <Card>
        <Space size={12} wrap>
          <Select
            placeholder="选择任务"
            style={{ width: 300 }}
            value={taskId}
            onChange={setTaskId}
            options={tasks.map((task) => ({ label: task.title, value: task.taskId }))}
          />
          <Select
            style={{ width: 120 }}
            value={format}
            onChange={setFormat}
            options={[
              { label: 'JSON', value: 'json' },
              { label: 'JSONL', value: 'jsonl' },
              { label: 'CSV', value: 'csv' },
              { label: 'Excel', value: 'xlsx' },
            ]}
          />
          <Button
            type="primary"
            icon={<CloudDownloadOutlined />}
            loading={submitting}
            onClick={() => void createExport()}
          >
            创建导出
          </Button>
        </Space>
      </Card>

      <Card>
        <Table<ExportJob>
          rowKey="exportId"
          columns={columns}
          dataSource={jobs}
          loading={loading}
          locale={{ emptyText: <Empty description="暂无导出任务" /> }}
          pagination={{ defaultPageSize: 10, showSizeChanger: true }}
        />
      </Card>
    </Space>
  );
}
