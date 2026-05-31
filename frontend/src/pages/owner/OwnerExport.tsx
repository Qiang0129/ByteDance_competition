import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  CloudDownloadOutlined,
  DeleteOutlined,
  DownloadOutlined,
  ExportOutlined,
  EyeOutlined,
  FileTextOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SearchOutlined,
  ThunderboltFilled,
} from '@ant-design/icons';
import {
  App as AntdApp,
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Empty,
  Input,
  Popconfirm,
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

import { exportApi } from '../../api/export';
import { ownerApi } from '../../api/owner';
import type { ExportFormat, ExportJob, ExportJobStatus, ExportOverview } from '../../types/export';
import type { OwnerTask } from '../../types/owner';

/**
 * Owner 端「导出中心」页面。
 *
 * 对齐《项目实施计划书》4.6 / 5.2:
 *   - 只导出已通过审核(accepted)的标注结果;
 *   - 支持 JSON / JSONL / CSV / Excel 四种格式;
 *   - 导出状态变化写入 audit_logs;
 *   - 导出完成后 annotation 状态迁移到 exported;
 *   - 支持字段映射(mappingJson)自定义输出字段名。
 *
 * 页面结构:
 *   - 顶部 KPI 概览(导出总数 / 成功率 / 本月导出条目 / 本月文件大小)
 *   - 工具条(任务选择 + 格式选择 + 创建导出 + 关键词搜索 + 状态筛选 + 刷新)
 *   - 导出任务表(含进度条、操作按钮、详情入口)
 *   - 详情抽屉(字段映射预览 + 错误详情 + 下载链接)
 *
 * 后端接口已实现(接口文档 7.4):
 *   POST /exports、GET /exports、POST /exports/{id}/start|complete|fail
 * 新增预留:
 *   GET /exports/overview(KPI 聚合,后端待实现,前端先本地计算回落)
 *   GET /exports/{id}/download(文件下载,后端待实现)
 */

const { Title, Paragraph, Text } = Typography;

const statusMeta: Record<ExportJobStatus, { color: string; label: string; icon?: React.ReactNode }> = {
  pending: { color: 'default', label: '待执行' },
  running: { color: 'processing', label: '导出中' },
  succeeded: { color: 'success', label: '已完成', icon: <CheckCircleOutlined /> },
  failed: { color: 'error', label: '失败', icon: <CloseCircleOutlined /> },
};

const formatLabel: Record<ExportFormat, string> = {
  json: 'JSON',
  jsonl: 'JSONL',
  csv: 'CSV',
  xlsx: 'Excel',
};

/** 文件大小格式化 */
function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function OwnerExport() {
  const { message } = AntdApp.useApp();
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [tasks, setTasks] = useState<OwnerTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [usingFallback, setUsingFallback] = useState(false);

  // 创建导出表单
  const [taskId, setTaskId] = useState<string>();
  const [format, setFormat] = useState<ExportFormat>('json');
  const [submitting, setSubmitting] = useState(false);

  // 筛选
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<ExportJobStatus | 'all'>('all');

  // 详情抽屉
  const [detailJob, setDetailJob] = useState<ExportJob | null>(null);

  /** 加载导出列表 + 任务列表 */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [jobRes, taskRes] = await Promise.all([
        exportApi.listExports(),
        ownerApi.listTasks(),
      ]);
      setJobs(Array.isArray(jobRes) ? jobRes : []);
      setTasks(taskRes.items ?? []);
      setTaskId((current) => current ?? taskRes.items?.[0]?.taskId);
      setUsingFallback(false);
    } catch {
      // 后端不可达时回落到空列表,演示模式 Tag 提示
      setUsingFallback(true);
      try {
        const taskRes = await ownerApi.listTasks();
        setTasks(taskRes.items ?? []);
        setTaskId((current) => current ?? taskRes.items?.[0]?.taskId);
      } catch {
        // 任务列表也拿不到,保持空
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** 本地计算 KPI(后端 /exports/overview 未实现前的回落) */
  const overview: ExportOverview = useMemo(() => {
    const total = jobs.length;
    const succeeded = jobs.filter((j) => j.status === 'succeeded').length;
    const failed = jobs.filter((j) => j.status === 'failed').length;
    const monthlyItems = jobs
      .filter((j) => j.status === 'succeeded')
      .reduce((sum, j) => sum + (j.exportedCount ?? 0), 0);
    const monthlySize = jobs
      .filter((j) => j.status === 'succeeded')
      .reduce((sum, j) => sum + (j.fileSizeBytes ?? 0), 0);
    return {
      totalJobs: total,
      succeededJobs: succeeded,
      failedJobs: failed,
      monthlyExportedItems: monthlyItems,
      monthlyFileSizeBytes: monthlySize,
    };
  }, [jobs]);

  /** 筛选(本地) */
  const visibleJobs = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return jobs.filter((j) => {
      if (statusFilter !== 'all' && j.status !== statusFilter) return false;
      if (kw) {
        const taskTitle = j.taskTitle ?? tasks.find((t) => t.taskId === j.taskId)?.title ?? '';
        const blob = `${j.exportId} ${j.taskId} ${taskTitle} ${j.format}`.toLowerCase();
        if (!blob.includes(kw)) return false;
      }
      return true;
    });
  }, [jobs, tasks, keyword, statusFilter]);

  /** 创建导出 */
  async function createExport() {
    if (!taskId) {
      message.warning('请选择任务');
      return;
    }
    setSubmitting(true);
    try {
      await exportApi.createExport({ taskId, format });
      message.success('导出任务已创建,等待执行');
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '创建导出任务失败');
    } finally {
      setSubmitting(false);
    }
  }

  /** 状态流转操作 */
  async function runAction(action: () => Promise<ExportJob>, successText: string) {
    try {
      await action();
      message.success(successText);
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '操作失败');
    }
  }

  /** 下载导出文件 */
  function handleDownload(job: ExportJob) {
    if (job.downloadUrl) {
      window.open(job.downloadUrl, '_blank');
    } else {
      window.open(exportApi.getDownloadUrl(job.exportId), '_blank');
    }
  }

  /** 获取任务标题 */
  function resolveTaskTitle(taskId: string): string {
    return tasks.find((t) => t.taskId === taskId)?.title ?? taskId;
  }

  /* ============ 表格列定义 ============ */
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
      width: 220,
      render: (value: string, record) => (
        <Space direction="vertical" size={2}>
          <Text strong>{record.taskTitle ?? resolveTaskTitle(value)}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {value}
          </Text>
        </Space>
      ),
    },
    {
      title: '格式',
      dataIndex: 'format',
      width: 90,
      render: (value: ExportFormat) => (
        <Tag color="blue" style={{ borderRadius: 999 }}>
          {formatLabel[value]}
        </Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 120,
      render: (value: ExportJobStatus) => (
        <Tag color={statusMeta[value].color} icon={statusMeta[value].icon}>
          {statusMeta[value].label}
        </Tag>
      ),
    },
    {
      title: '进度',
      dataIndex: 'progress',
      width: 120,
      render: (value: number, record) =>
        record.status === 'succeeded' ? (
          <Progress percent={100} size="small" status="success" />
        ) : record.status === 'failed' ? (
          <Progress percent={value} size="small" status="exception" />
        ) : (
          <Progress percent={value} size="small" status="active" />
        ),
    },
    {
      title: '条目 / 大小',
      width: 140,
      render: (_, record) =>
        record.status === 'succeeded' ? (
          <Space direction="vertical" size={0}>
            <Text style={{ fontSize: 13 }}>
              {record.exportedCount ?? '-'} 条
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {formatBytes(record.fileSizeBytes)}
            </Text>
          </Space>
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
    {
      title: '时间',
      width: 160,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Text style={{ fontSize: 12 }}>创建 {record.createdAt}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            更新 {record.updatedAt}
          </Text>
        </Space>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 180,
      align: 'center',
      render: (_, record) => (
        <Space size={2}>
          {/* 查看详情 */}
          <Tooltip title="查看详情">
            <Button
              type="text"
              size="small"
              icon={<EyeOutlined />}
              onClick={() => setDetailJob(record)}
            />
          </Tooltip>
          {/* 状态流转 */}
          {record.status === 'pending' && (
            <Tooltip title="开始执行">
              <Button
                type="text"
                size="small"
                icon={<PlayCircleOutlined />}
                onClick={() =>
                  runAction(() => exportApi.startExport(record.exportId), '导出已开始')
                }
              />
            </Tooltip>
          )}
          {record.status === 'running' && (
            <Tooltip title="标记完成">
              <Button
                type="text"
                size="small"
                icon={<CheckCircleOutlined style={{ color: '#16a34a' }} />}
                onClick={() =>
                  runAction(
                    () => exportApi.completeExport(record.exportId),
                    '导出已完成',
                  )
                }
              />
            </Tooltip>
          )}
          {record.status === 'running' && (
            <Popconfirm
              title="确认标记失败?"
              okText="确认"
              cancelText="取消"
              onConfirm={() =>
                runAction(
                  () => exportApi.failExport(record.exportId, '手动标记失败'),
                  '已标记失败',
                )
              }
            >
              <Tooltip title="标记失败">
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<CloseCircleOutlined />}
                />
              </Tooltip>
            </Popconfirm>
          )}
          {/* 下载 */}
          {record.status === 'succeeded' && (
            <Tooltip title="下载导出文件">
              <Button
                type="text"
                size="small"
                icon={<DownloadOutlined style={{ color: 'var(--lh-primary)' }} />}
                onClick={() => handleDownload(record)}
              />
            </Tooltip>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size="large" className="page-stack">
      {/* 标题 + 阶段标识 */}
      <div className="page-title-row">
        <Space direction="vertical" size={4}>
          <Title level={3}>导出中心</Title>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            只导出已通过审核的标注结果,支持 JSON / JSONL / CSV / Excel 四种格式,导出状态变化写入审计日志。
          </Paragraph>
        </Space>
        <Space size={8}>
          {usingFallback && <Tag color="gold">演示模式 · 后端未就绪</Tag>}
          <Tag color="processing" icon={<ThunderboltFilled />}>
            Phase 5 · 数据交付
          </Tag>
        </Space>
      </div>

      {/* KPI 概览 */}
      <Row gutter={16} className="row-equal">
        <Col xs={24} sm={12} xl={6}>
          <Card className="owner-stat-card" loading={loading}>
            <div className="owner-stat-label">
              <ExportOutlined /> 导出总数
            </div>
            <div className="owner-stat-value owner-stat-primary">
              {overview.totalJobs}
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
            <div className="owner-stat-value">
              {overview.totalJobs > 0
                ? `${Math.round((overview.succeededJobs / overview.totalJobs) * 100)}%`
                : '-'}
            </div>
            <Tag color="success" className="owner-stat-trend">
              已完成导出占比
            </Tag>
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card className="owner-stat-card" loading={loading}>
            <div className="owner-stat-label">
              <FileTextOutlined /> 本月导出条目
            </div>
            <div className="owner-stat-value">
              {overview.monthlyExportedItems || '-'}
            </div>
            <Tag className="owner-stat-trend owner-stat-mute">
              accepted → exported
            </Tag>
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card className="owner-stat-card" loading={loading}>
            <div className="owner-stat-label">
              <CloudDownloadOutlined /> 本月文件大小
            </div>
            <div className="owner-stat-value">
              {formatBytes(overview.monthlyFileSizeBytes)}
            </div>
            <Tag className="owner-stat-trend owner-stat-mute">
              累计导出文件体积
            </Tag>
          </Card>
        </Col>
      </Row>

      {/* 工具条:创建导出 + 筛选 */}
      <Card className="owner-toolbar">
        <Space size={12} wrap>
          <Select
            placeholder="选择任务"
            showSearch
            optionFilterProp="label"
            style={{ width: 280 }}
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
          <span style={{ width: 1, height: 24, background: '#e2e6ec', display: 'inline-block' }} />
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索任务名 / 导出 ID"
            style={{ width: 220 }}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Segmented
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as ExportJobStatus | 'all')}
            options={[
              { label: '全部', value: 'all' },
              { label: '待执行', value: 'pending' },
              { label: '导出中', value: 'running' },
              { label: '已完成', value: 'succeeded' },
              { label: '失败', value: 'failed' },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>
            刷新
          </Button>
        </Space>
      </Card>

      {/* 导出任务表 */}
      <Card className="owner-table-card" loading={loading}>
        <Table<ExportJob>
          rowKey="exportId"
          columns={columns}
          dataSource={visibleJobs}
          locale={{ emptyText: <Empty description="暂无导出任务" /> }}
          pagination={{
            defaultPageSize: 10,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条导出记录`,
            pageSizeOptions: ['10', '20', '50', '100'],
          }}
        />
      </Card>

      {/* 详情抽屉 */}
      <ExportDetailDrawer
        job={detailJob}
        taskTitle={detailJob ? resolveTaskTitle(detailJob.taskId) : ''}
        onClose={() => setDetailJob(null)}
        onDownload={handleDownload}
      />
    </Space>
  );
}

/* ============ 详情抽屉 ============ */

function ExportDetailDrawer({
  job,
  taskTitle,
  onClose,
  onDownload,
}: {
  job: ExportJob | null;
  taskTitle: string;
  onClose: () => void;
  onDownload: (job: ExportJob) => void;
}) {
  if (!job) return null;

  const meta = statusMeta[job.status];

  return (
    <Drawer
      title={
        <Space>
          <ExportOutlined />
          <span>导出详情</span>
          <Tag color={meta.color}>{meta.label}</Tag>
        </Space>
      }
      open={!!job}
      onClose={onClose}
      width={520}
      destroyOnClose
      footer={
        job.status === 'succeeded' ? (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              onClick={() => onDownload(job)}
            >
              下载文件
            </Button>
          </div>
        ) : null
      }
    >
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
        <Descriptions.Item label="导出格式">
          <Tag color="blue">{formatLabel[job.format]}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="状态">
          <Tag color={meta.color} icon={meta.icon}>
            {meta.label}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label="进度">
          <Progress
            percent={job.status === 'succeeded' ? 100 : job.progress}
            size="small"
            status={
              job.status === 'succeeded'
                ? 'success'
                : job.status === 'failed'
                  ? 'exception'
                  : 'active'
            }
          />
        </Descriptions.Item>
        {job.exportedCount != null && (
          <Descriptions.Item label="导出条目数">
            {job.exportedCount} 条
          </Descriptions.Item>
        )}
        {job.fileSizeBytes != null && (
          <Descriptions.Item label="文件大小">
            {formatBytes(job.fileSizeBytes)}
          </Descriptions.Item>
        )}
        <Descriptions.Item label="创建时间">{job.createdAt}</Descriptions.Item>
        <Descriptions.Item label="更新时间">{job.updatedAt}</Descriptions.Item>
        {job.createdBy && (
          <Descriptions.Item label="创建人">{job.createdBy}</Descriptions.Item>
        )}
      </Descriptions>

      {/* 错误详情 */}
      {job.errorSummary && (
        <Card
          size="small"
          title="错误详情"
          style={{ marginTop: 16 }}
          styles={{ body: { background: '#fef2f2' } }}
        >
          <Text type="danger" style={{ fontSize: 13 }}>
            {job.errorSummary}
          </Text>
        </Card>
      )}

      {/* 字段映射预览 */}
      {job.mappingJson && Object.keys(job.mappingJson).length > 0 && (
        <Card size="small" title="字段映射配置" style={{ marginTop: 16 }}>
          <pre style={{ fontSize: 12, margin: 0, whiteSpace: 'pre-wrap' }}>
            {JSON.stringify(job.mappingJson, null, 2)}
          </pre>
        </Card>
      )}
    </Drawer>
  );
}
