import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  CloudDownloadOutlined,
  DownloadOutlined,
  ExportOutlined,
  EyeOutlined,
  FileTextOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Checkbox,
  Col,
  Descriptions,
  Drawer,
  Empty,
  Input,
  Progress,
  Row,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';

import { getApiErrorMessage } from '../../api/client';
import { exportApi } from '../../api/export';
import { ownerApi } from '../../api/owner';
import type {
  ExportColumnConfig,
  ExportFieldOption,
  ExportFormat,
  ExportJob,
  ExportJobStatus,
  ExportOverview,
  ExportTaskOptions,
} from '../../types/export';
import type { OwnerTask } from '../../types/owner';

const { Title, Text } = Typography;

const emptyOverview: ExportOverview = {
  totalJobs: 0,
  succeededJobs: 0,
  failedJobs: 0,
  monthlyExportedItems: 0,
  monthlyFileSizeBytes: 0,
};

const statusMeta: Record<ExportJobStatus, { color: string; label: string; icon?: ReactNode }> = {
  pending: { color: 'default', label: '待执行' },
  running: { color: 'processing', label: '导出中' },
  succeeded: { color: 'success', label: '已创建', icon: <CheckCircleOutlined /> },
  failed: { color: 'error', label: '失败', icon: <CloseCircleOutlined /> },
};

const formatLabel: Record<ExportFormat, string> = {
  json: 'JSON',
  jsonl: 'JSONL',
  csv: 'CSV',
  xlsx: 'Excel',
};

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function drawerWidth(max: number) {
  if (typeof window === 'undefined') return max;
  return Math.min(max, Math.max(280, window.innerWidth - 24));
}

function sanitizeFilename(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
}

function buildDownloadName(job: ExportJob, taskTitle: string) {
  return `${sanitizeFilename(taskTitle || 'export')}-${job.exportId}.${job.format}`;
}

function sourceLabel(source: string) {
  if (source === 'answer') return '答案字段';
  if (source === 'system') return '系统字段';
  if (source === 'item') return '题目字段';
  return source;
}

function extractMappingColumns(mappingJson?: ExportJob['mappingJson']): ExportColumnConfig[] {
  if (!mappingJson || typeof mappingJson !== 'object') return [];
  const columns = (mappingJson as { columns?: unknown }).columns;
  if (!Array.isArray(columns)) return [];
  return columns.filter((column): column is ExportColumnConfig => {
    if (!column || typeof column !== 'object') return false;
    const candidate = column as Partial<ExportColumnConfig>;
    return typeof candidate.key === 'string'
      && typeof candidate.label === 'string'
      && typeof candidate.source === 'string'
      && typeof candidate.path === 'string';
  });
}

function isExportDownloaded(job: Pick<ExportJob, 'status' | 'downloadedAt'>) {
  return job.status === 'succeeded' && !!job.downloadedAt;
}

function exportStatusLabel(job: ExportJob) {
  if (job.status === 'succeeded') {
    return isExportDownloaded(job) ? '已下载' : '已创建';
  }
  return statusMeta[job.status].label;
}

function exportStepOnePercent(job: ExportJob) {
  if (job.status === 'pending') return 0;
  if (job.status === 'running') return Math.min(Math.max(job.progress, 0), 99);
  if (job.status === 'failed') return Math.min(Math.max(job.progress, 0), 100);
  return 100;
}

function exportStepOneStatus(job: ExportJob) {
  if (job.status === 'failed') return 'exception' as const;
  if (job.status === 'running') return 'active' as const;
  if (job.status === 'succeeded') return 'success' as const;
  return 'normal' as const;
}

function exportStepTwoStatus(job: ExportJob) {
  return isExportDownloaded(job) ? ('success' as const) : ('normal' as const);
}

function ExportStepProgress({ job }: { job: ExportJob }) {
  return (
    <div className="owner-export-progress" aria-label="导出进度">
      <Progress
        percent={exportStepOnePercent(job)}
        size="small"
        showInfo={false}
        strokeWidth={4}
        status={exportStepOneStatus(job)}
        className="owner-export-progress-bar"
      />
      <Progress
        percent={isExportDownloaded(job) ? 100 : 0}
        size="small"
        showInfo={false}
        strokeWidth={4}
        status={exportStepTwoStatus(job)}
        className="owner-export-progress-bar"
      />
    </div>
  );
}

export default function OwnerExport() {
  const { message } = AntdApp.useApp();
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [overview, setOverview] = useState<ExportOverview>(emptyOverview);
  const [tasks, setTasks] = useState<OwnerTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [taskFilter, setTaskFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<ExportJobStatus | 'all'>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [detailJob, setDetailJob] = useState<ExportJob | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const taskTitleMap = useMemo(() => {
    return new Map(tasks.map((task) => [task.taskId, task.title]));
  }, [tasks]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [jobRes, overviewRes, taskRes] = await Promise.all([
        exportApi.listExports(),
        exportApi.getOverview(),
        ownerApi.listTasks(),
      ]);
      setJobs(Array.isArray(jobRes) ? jobRes : []);
      setOverview(overviewRes ?? emptyOverview);
      setTasks(taskRes.items ?? []);
    } catch (error) {
      message.error(getApiErrorMessage(error, '导出中心数据加载失败'));
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleJobs = useMemo(() => {
    return jobs.filter((job) => {
      if (taskFilter !== 'all' && job.taskId !== taskFilter) return false;
      if (statusFilter !== 'all' && job.status !== statusFilter) return false;
      return true;
    });
  }, [jobs, statusFilter, taskFilter]);

  const successRate =
    overview.totalJobs > 0 ? Math.round((overview.succeededJobs / overview.totalJobs) * 100) : null;

  function resolveTaskTitle(job: Pick<ExportJob, 'taskId' | 'taskTitle'>) {
    return job.taskTitle ?? taskTitleMap.get(job.taskId) ?? `任务 ${job.taskId}`;
  }

  function updateExportJob(updated: ExportJob) {
    setJobs((current) =>
      current.map((job) => (job.exportId === updated.exportId ? updated : job)),
    );
    setDetailJob((current) =>
      current && current.exportId === updated.exportId ? updated : current,
    );
  }

  async function handleDownload(job: ExportJob) {
    if (job.status !== 'succeeded') {
      message.warning('只有已创建或已下载的导出可以下载');
      return;
    }

    setDownloadingId(job.exportId);
    try {
      const currentStateLabel = isExportDownloaded(job) ? '已下载' : '已创建';
      const result = await exportApi.downloadExport(
        job.exportId,
        buildDownloadName(job, resolveTaskTitle(job)),
      );
      if (result.kind === 'confirmed') {
        updateExportJob(result.job);
        message.success('文件已保存，状态已更新为已下载');
      } else if (result.kind === 'cancelled') {
        message.info(`已取消保存，状态保持${currentStateLabel}`);
      } else {
        message.info(`下载已触发，当前浏览器无法确认保存完成，状态保持${currentStateLabel}`);
      }
    } catch (error) {
      message.error(getApiErrorMessage(error, '下载导出文件失败'));
    } finally {
      setDownloadingId(null);
    }
  }

  const columns: ColumnsType<ExportJob> = [
    {
      title: '导出 ID',
      dataIndex: 'exportId',
      width: 110,
      render: (value: string) => (
        <Text code style={{ fontSize: 12 }}>
          {value}
        </Text>
      ),
    },
    {
      title: '任务',
      dataIndex: 'taskId',
      width: 260,
      render: (_: string, record) => (
        <Space direction="vertical" size={2}>
          <Text strong>{resolveTaskTitle(record)}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {record.taskId}
          </Text>
        </Space>
      ),
    },
    {
      title: '格式',
      dataIndex: 'format',
      width: 90,
      render: (value: ExportFormat) => <Tag color="blue">{formatLabel[value]}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 120,
      render: (value: ExportJobStatus, record) => {
        const meta = statusMeta[value];
        return (
          <Tag color={meta.color} icon={meta.icon}>
            {exportStatusLabel(record)}
          </Tag>
        );
      },
    },
    {
      title: '进度',
      dataIndex: 'progress',
      width: 150,
      render: (_, record) => <ExportStepProgress job={record} />,
    },
    {
      title: '条目 / 大小',
      width: 140,
      render: (_, record) =>
        record.status === 'succeeded' ? (
          <Space direction="vertical" size={0}>
            <Text style={{ fontSize: 13 }}>{record.exportedCount ?? 0} 条</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {formatBytes(record.fileSizeBytes)}
            </Text>
          </Space>
        ) : (
          <Text type={record.status === 'failed' ? 'danger' : 'secondary'}>
            {record.status === 'failed' ? '生成失败' : '-'}
          </Text>
        ),
    },
    {
      title: '时间',
      width: 170,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Text style={{ fontSize: 12 }}>创建 {record.createdAt || '-'}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            更新 {record.updatedAt || '-'}
          </Text>
        </Space>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 112,
      align: 'center',
      render: (_, record) => (
        <Space size={4}>
          <Tooltip title="查看详情">
            <Button
              type="text"
              size="small"
              icon={<EyeOutlined />}
              onClick={() => setDetailJob(record)}
              aria-label="查看导出详情"
            />
          </Tooltip>
          {record.status === 'succeeded' && (
            <Tooltip title="下载文件">
              <Button
                type="text"
                size="small"
                icon={<DownloadOutlined style={{ color: 'var(--lh-primary)' }} />}
                loading={downloadingId === record.exportId}
                onClick={() => void handleDownload(record)}
                aria-label="下载导出文件"
              />
            </Tooltip>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size="large" className="page-stack owner-export-page">
      <div className="page-title-row">
        <Title level={3}>导出中心</Title>
      </div>

      <Row gutter={16} className="row-equal owner-export-kpi-row">
        <Col xs={24} sm={12} xl={6}>
          <Card className="owner-stat-card" loading={loading}>
            <div className="owner-stat-label">
              <ExportOutlined /> 导出总数
            </div>
            <div className="owner-stat-value owner-stat-primary">
              {overview.totalJobs.toLocaleString()}
            </div>
            <Tag className="owner-stat-trend">
              成功 {overview.succeededJobs} · 失败 {overview.failedJobs}
            </Tag>
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card className="owner-stat-card" loading={loading}>
            <div className="owner-stat-label">
              <CheckCircleOutlined style={{ color: '#16a34a' }} /> 成功率
            </div>
            <div className="owner-stat-value">{successRate == null ? '-' : `${successRate}%`}</div>
            <Tag color="success" className="owner-stat-trend">
              创建成功导出占比
            </Tag>
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card className="owner-stat-card" loading={loading}>
            <div className="owner-stat-label">
              <FileTextOutlined /> 本月导出条目
            </div>
            <div className="owner-stat-value">
              {overview.monthlyExportedItems
                ? overview.monthlyExportedItems.toLocaleString()
                : '-'}
            </div>
            <Tag className="owner-stat-trend owner-stat-mute">支持重复导出</Tag>
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card className="owner-stat-card" loading={loading}>
            <div className="owner-stat-label">
              <CloudDownloadOutlined /> 本月文件大小
            </div>
            <div className="owner-stat-value">{formatBytes(overview.monthlyFileSizeBytes)}</div>
            <Tag className="owner-stat-trend owner-stat-mute">本地导出文件累计</Tag>
          </Card>
        </Col>
      </Row>

      <Card className="owner-toolbar">
        <Space size={12} wrap>
          <Button
            type="primary"
            icon={<CloudDownloadOutlined />}
            onClick={() => setCreateOpen(true)}
          >
            创建导出
          </Button>
          <Select
            showSearch
            optionFilterProp="label"
            style={{ width: 260 }}
            value={taskFilter}
            onChange={setTaskFilter}
            options={[
              { label: '全部任务', value: 'all' },
              ...tasks.map((task) => ({ label: task.title, value: task.taskId })),
            ]}
          />
          <Segmented
            value={statusFilter}
            onChange={(value) => setStatusFilter(value as ExportJobStatus | 'all')}
            options={[
              { label: '全部', value: 'all' },
              { label: '待执行', value: 'pending' },
              { label: '导出中', value: 'running' },
              { label: '已创建/已下载', value: 'succeeded' },
              { label: '失败', value: 'failed' },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>
            刷新
          </Button>
        </Space>
      </Card>

      <Card className="owner-table-card" loading={loading}>
        <Table<ExportJob>
          rowKey="exportId"
          columns={columns}
          dataSource={visibleJobs}
          locale={{ emptyText: <Empty description="暂无导出记录" /> }}
          scroll={{ x: 1160 }}
          pagination={{
            defaultPageSize: 10,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条导出记录`,
            pageSizeOptions: ['10', '20', '50', '100'],
          }}
        />
      </Card>

      <CreateExportDrawer
        open={createOpen}
        tasks={tasks}
        defaultTaskId={taskFilter !== 'all' ? taskFilter : tasks[0]?.taskId}
        onClose={() => setCreateOpen(false)}
        onCreated={async () => {
          setCreateOpen(false);
          await load();
        }}
      />

      <ExportDetailDrawer
        job={detailJob}
        taskTitle={detailJob ? resolveTaskTitle(detailJob) : ''}
        downloading={detailJob ? downloadingId === detailJob.exportId : false}
        onClose={() => setDetailJob(null)}
        onDownload={(job) => void handleDownload(job)}
      />
    </Space>
  );
}

function CreateExportDrawer({
  open,
  tasks,
  defaultTaskId,
  onClose,
  onCreated,
}: {
  open: boolean;
  tasks: OwnerTask[];
  defaultTaskId?: string;
  onClose: () => void;
  onCreated: (job: ExportJob) => Promise<void> | void;
}) {
  const { message } = AntdApp.useApp();
  const [taskId, setTaskId] = useState<string>();
  const [format, setFormat] = useState<ExportFormat>('json');
  const [taskOptions, setTaskOptions] = useState<ExportTaskOptions | null>(null);
  const [fieldLoading, setFieldLoading] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [columnLabels, setColumnLabels] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setTaskId(defaultTaskId ?? tasks[0]?.taskId);
      setFormat('json');
    }
  }, [defaultTaskId, open, tasks]);

  const loadTaskOptions = useCallback(
    async (nextTaskId: string) => {
      setFieldLoading(true);
      try {
        const options = await exportApi.getTaskOptions(nextTaskId);
        setTaskOptions(options);
        const labels = options.fields.reduce<Record<string, string>>((acc, field) => {
          acc[field.key] = field.label;
          return acc;
        }, {});
        setColumnLabels(labels);
        setSelectedKeys(options.fields.filter((field) => field.defaultSelected).map((field) => field.key));
      } catch (error) {
        setTaskOptions(null);
        setSelectedKeys([]);
        setColumnLabels({});
        message.error(getApiErrorMessage(error, '导出字段配置加载失败'));
      } finally {
        setFieldLoading(false);
      }
    },
    [message],
  );

  useEffect(() => {
    if (open && taskId) {
      void loadTaskOptions(taskId);
    }
  }, [loadTaskOptions, open, taskId]);

  const fields = taskOptions?.fields ?? [];
  const selectedFieldSet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const taskExportableCount = taskOptions?.exportableCount ?? taskOptions?.acceptedCount ?? 0;

  function toggleField(key: string, checked: boolean) {
    setSelectedKeys((current) => {
      if (checked) {
        return current.includes(key) ? current : [...current, key];
      }
      return current.filter((item) => item !== key);
    });
  }

  function updateColumnLabel(key: string, value: string) {
    setColumnLabels((current) => ({ ...current, [key]: value }));
  }

  function selectedColumns(): ExportColumnConfig[] {
    const selected = new Set(selectedKeys);
    return fields
      .filter((field) => selected.has(field.key))
      .map((field) => ({
        key: field.key,
        label: columnLabels[field.key]?.trim() || field.label,
        source: field.source,
        path: field.path,
      }));
  }

  async function submit() {
    if (!taskId) {
      message.warning('请选择任务');
      return;
    }
    if (!taskOptions || taskExportableCount <= 0) {
      message.warning('当前任务没有已审核入库的可导出标注');
      return;
    }

    const columns = selectedColumns();
    if (columns.length === 0) {
      message.warning('请至少选择一个导出字段');
      return;
    }

    setSubmitting(true);
    try {
      const job = await exportApi.createExport({
        taskId,
        format,
        mappingJson: { columns },
      });
      if (job.status === 'failed') {
        message.error(job.errorSummary || '导出创建失败');
      } else {
        message.success('导出文件已生成');
      }
      await onCreated(job);
    } catch (error) {
      message.error(getApiErrorMessage(error, '创建导出失败'));
    } finally {
      setSubmitting(false);
    }
  }

  const fieldColumns: ColumnsType<ExportFieldOption> = [
    {
      title: '字段',
      dataIndex: 'label',
      width: 280,
      render: (_, record) => {
        const checked = selectedFieldSet.has(record.key);
        return (
          <Checkbox
            checked={checked}
            onChange={(event) => toggleField(record.key, event.target.checked)}
          >
            <Space direction="vertical" size={0}>
              <Text>{record.label}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {sourceLabel(record.source)} · {record.path}
              </Text>
            </Space>
          </Checkbox>
        );
      },
    },
    {
      title: '导出字段名',
      dataIndex: 'label',
      width: 240,
      render: (_, record) => (
        <Input
          size="small"
          value={columnLabels[record.key] ?? record.label}
          disabled={!selectedFieldSet.has(record.key)}
          onChange={(event) => updateColumnLabel(record.key, event.target.value)}
        />
      ),
    },
  ];

  return (
    <Drawer
      title={
        <Space>
          <CloudDownloadOutlined />
          <span>创建导出</span>
        </Space>
      }
      open={open}
      onClose={onClose}
      width={drawerWidth(720)}
      destroyOnClose
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={onClose}>取消</Button>
          <Button
            type="primary"
            icon={<CloudDownloadOutlined />}
            loading={submitting}
            disabled={fieldLoading || !taskId || !taskOptions || taskExportableCount <= 0}
            onClick={() => void submit()}
          >
            创建导出
          </Button>
        </div>
      }
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Select
          showSearch
          optionFilterProp="label"
          placeholder="选择任务"
          value={taskId}
          onChange={setTaskId}
          style={{ width: '100%' }}
          options={tasks.map((task) => ({ label: task.title, value: task.taskId }))}
        />
        <Select
          value={format}
          onChange={setFormat}
          style={{ width: '100%' }}
          options={[
            { label: 'JSON', value: 'json' },
            { label: 'JSONL', value: 'jsonl' },
            { label: 'CSV', value: 'csv' },
            { label: 'Excel', value: 'xlsx' },
          ]}
        />

        {taskOptions && (
          <Alert
            type={taskExportableCount > 0 ? 'info' : 'warning'}
            showIcon
            message={`当前可导出 ${taskExportableCount.toLocaleString()} 条已审核入库标注`}
          />
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <Text strong>导出字段</Text>
          <Space size={8}>
            <Button
              size="small"
              onClick={() => setSelectedKeys(fields.map((field) => field.key))}
              disabled={fields.length === 0}
            >
              全选
            </Button>
            <Button size="small" onClick={() => setSelectedKeys([])} disabled={fields.length === 0}>
              清空
            </Button>
          </Space>
        </div>

        <Table<ExportFieldOption>
          rowKey="key"
          size="small"
          columns={fieldColumns}
          dataSource={fields}
          loading={fieldLoading}
          pagination={false}
          scroll={{ x: 560, y: 380 }}
          locale={{ emptyText: <Empty description="暂无可导出字段" /> }}
        />
      </Space>
    </Drawer>
  );
}

function ExportDetailDrawer({
  job,
  taskTitle,
  downloading,
  onClose,
  onDownload,
}: {
  job: ExportJob | null;
  taskTitle: string;
  downloading: boolean;
  onClose: () => void;
  onDownload: (job: ExportJob) => void;
}) {
  if (!job) return null;

  const meta = statusMeta[job.status];
  const mappingColumns = extractMappingColumns(job.mappingJson);

  return (
    <Drawer
      title={
        <Space>
          <ExportOutlined />
          <span>导出详情</span>
          <Tag color={meta.color}>{exportStatusLabel(job)}</Tag>
        </Space>
      }
      open={!!job}
      onClose={onClose}
      width={drawerWidth(560)}
      destroyOnClose
      footer={
        job.status === 'succeeded' ? (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              loading={downloading}
              onClick={() => onDownload(job)}
            >
              下载文件
            </Button>
          </div>
        ) : null
      }
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label="导出 ID">
            <Text code>{job.exportId}</Text>
          </Descriptions.Item>
          <Descriptions.Item label="关联任务">
            {taskTitle}
            <Text type="secondary" style={{ marginLeft: 8 }}>
              ({job.taskId})
            </Text>
          </Descriptions.Item>
          <Descriptions.Item label="格式">
            <Tag color="blue">{formatLabel[job.format]}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag color={meta.color} icon={meta.icon}>
              {exportStatusLabel(job)}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="进度">
            <ExportStepProgress job={job} />
          </Descriptions.Item>
          {job.exportedCount != null && (
            <Descriptions.Item label="导出条目">{job.exportedCount} 条</Descriptions.Item>
          )}
          {job.fileSizeBytes != null && (
            <Descriptions.Item label="文件大小">{formatBytes(job.fileSizeBytes)}</Descriptions.Item>
          )}
          <Descriptions.Item label="创建时间">{job.createdAt || '-'}</Descriptions.Item>
          <Descriptions.Item label="更新时间">{job.updatedAt || '-'}</Descriptions.Item>
          {job.createdBy && <Descriptions.Item label="创建人">{job.createdBy}</Descriptions.Item>}
          {job.status === 'succeeded' && (
            <Descriptions.Item label="下载确认时间">{job.downloadedAt || '-'}</Descriptions.Item>
          )}
        </Descriptions>

        {job.errorSummary && (
          <Alert type="error" showIcon message="错误摘要" description={job.errorSummary} />
        )}

        {mappingColumns.length > 0 ? (
          <Card size="small" title="字段配置">
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              {mappingColumns.map((column) => (
                <div
                  key={column.key}
                  style={{ borderBottom: '1px solid var(--lh-border, rgba(5, 5, 5, 0.06))', paddingBottom: 8 }}
                >
                  <Space direction="vertical" size={0}>
                    <Text strong>{column.label}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {sourceLabel(column.source)} · {column.key} · {column.path || '-'}
                    </Text>
                  </Space>
                </div>
              ))}
            </Space>
          </Card>
        ) : job.mappingJson ? (
          <Card size="small" title="字段配置">
            <pre style={{ fontSize: 12, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {JSON.stringify(job.mappingJson, null, 2)}
            </pre>
          </Card>
        ) : null}
      </Space>
    </Drawer>
  );
}
