import { useEffect, useMemo, useRef, useState } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import {
  ArrowRightOutlined,
  CheckCircleFilled,
  CloseOutlined,
  DeleteOutlined,
  PauseCircleFilled,
  PlusOutlined,
  RobotOutlined,
  StopFilled,
  SyncOutlined,
} from '@ant-design/icons';
import {
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';

import { getApiErrorMessage } from '../../api/client';
import { datasetApi } from '../../api/dataset';
import { ownerApi } from '../../api/owner';
import { schemaApi } from '../../api/schema';
import type { DatasetMeta } from '../../types/dataset';
import type {
  AssignableLabeler,
  CreateOwnerTaskRequest,
  OwnerAssignStrategy,
  OwnerTask,
  OwnerTaskState,
} from '../../types/owner';
import type { SchemaSummary } from '../../types/schema';

type TaskState = OwnerTaskState;
type OwnerTaskRow = OwnerTask;

interface PublishFormValues {
  title: string;
  tags: string[];
  reward: string;
  quota: number | null;
  deadline: Dayjs | null;
  datasetId: string;
  strategy: OwnerAssignStrategy;
  maxClaimPerUser?: number | null;
  assignedLabelerIds?: string[];
  schema?: string;
  schemaVersionId?: string;
}

const DATE_TIME_FORMAT = 'YYYY-MM-DD HH:mm';

const stateMeta: Record<TaskState, { label: string; color: string; icon: React.ReactNode }> = {
  draft: { label: '草稿', color: 'default', icon: <span className="state-dot dot-draft" /> },
  published: { label: '发布中', color: 'success', icon: <span className="state-dot dot-published" /> },
  paused: { label: '已暂停', color: 'warning', icon: <span className="state-dot dot-paused" /> },
  ended: { label: '已结束', color: 'default', icon: <span className="state-dot dot-ended" /> },
};

const strategyLabel: Record<OwnerAssignStrategy, string> = {
  'first-come': '先到先得',
  assigned: '指派',
  quota: '配额抢单',
};

const stateFilterOptions = [
  { label: '全部状态', value: 'all' },
  { label: '草稿', value: 'draft' },
  { label: '发布中', value: 'published' },
  { label: '已暂停', value: 'paused' },
  { label: '已结束', value: 'ended' },
];

const strategyFilterOptions = [
  { label: '分发策略:全部', value: 'all' },
  { label: '先到先得', value: 'first-come' },
  { label: '指派', value: 'assigned' },
  { label: '配额抢单', value: 'quota' },
];

export default function OwnerTasks() {
  const { message } = App.useApp();
  const [form] = Form.useForm<PublishFormValues>();
  const [stateFilter, setStateFilter] = useState<string>('all');
  const [strategyFilter, setStrategyFilter] = useState<string>('all');
  const [keyword, setKeyword] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeRow, setActiveRow] = useState<OwnerTaskRow | null>(null);
  const [rows, setRows] = useState<OwnerTaskRow[]>([]);
  const [datasets, setDatasets] = useState<DatasetMeta[]>([]);
  const [schemas, setSchemas] = useState<SchemaSummary[]>([]);
  const [assignableLabelers, setAssignableLabelers] = useState<AssignableLabeler[]>([]);
  const [loading, setLoading] = useState(false);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submitStateRef = useRef<TaskState>('published');
  const lastSchemaSelectionRef = useRef<string | undefined>();

  const selectedStrategy = Form.useWatch('strategy', form);
  const selectedDatasetId = Form.useWatch('datasetId', form);
  const selectedSchemaVersionId = Form.useWatch('schemaVersionId', form);

  useEffect(() => {
    void Promise.all([loadTasks(), loadDatasets(), loadSchemas(), loadAssignableLabelers()]);
  }, []);

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        if (stateFilter !== 'all' && row.state !== stateFilter) return false;
        if (strategyFilter !== 'all' && row.assignStrategy !== strategyFilter) return false;
        if (keyword && !`${row.title} ${row.taskId} ${row.owner}`.includes(keyword)) return false;
        return true;
      }),
    [keyword, rows, stateFilter, strategyFilter],
  );

  const publishedCount = rows.filter((row) => row.state === 'published').length;
  const draftCount = rows.filter((row) => row.state === 'draft').length;
  const submittedCount = rows.reduce((sum, row) => sum + row.quotaUsed, 0);

  const datasetOptions = datasets.map((dataset) => ({
    label: `${dataset.name} · ${dataset.itemCount} 条 · 当前关联: ${dataset.taskTitle ?? '未命名任务'}`,
    value: dataset.id,
  }));

  const publishedSchemas = useMemo(
    () => schemas.filter((schema) => schema.status === 'published'),
    [schemas],
  );

  const schemaOptions = useMemo(
    () =>
      publishedSchemas.map((schema) => ({
        label: `${schema.name} (${schema.versionNumber}) · ${schema.fieldCount} 个字段`,
        value: schema.versionId,
      })),
    [publishedSchemas],
  );

  useEffect(() => {
    if (!drawerOpen || !activeRow?.schemaVersionId) {
      return;
    }
    const hasPublishedSchema = publishedSchemas.some(
      (schema) => schema.versionId === activeRow.schemaVersionId,
    );
    if (hasPublishedSchema) {
      form.setFieldValue('schemaVersionId', activeRow.schemaVersionId);
    }
  }, [activeRow, drawerOpen, form, publishedSchemas]);

  useEffect(() => {
    if (!drawerOpen) {
      lastSchemaSelectionRef.current = undefined;
      return;
    }
    if (!selectedSchemaVersionId) {
      lastSchemaSelectionRef.current = undefined;
      return;
    }
    if (lastSchemaSelectionRef.current === selectedSchemaVersionId) {
      return;
    }
    lastSchemaSelectionRef.current = selectedSchemaVersionId;
    const schema = publishedSchemas.find((item) => item.versionId === selectedSchemaVersionId);
    if (schema?.datasetId) {
      form.setFieldValue('datasetId', schema.datasetId);
    }
  }, [drawerOpen, form, publishedSchemas, selectedSchemaVersionId]);

  const labelerOptions = assignableLabelers.map((labeler) => ({
    label: `${labeler.displayName} (${labeler.username})`,
    value: labeler.userId,
  }));

  const selectedDataset = datasets.find((dataset) => dataset.id === selectedDatasetId);
  const selectedSchema = publishedSchemas.find(
    (schema) => schema.versionId === selectedSchemaVersionId,
  );

  const columns: ColumnsType<OwnerTaskRow> = [
    {
      title: '任务',
      dataIndex: 'title',
      render: (_value, record) => (
        <div className="owner-task-title">
          <div className="owner-task-name">{record.title}</div>
          <div className="owner-task-meta">
            {record.taskId} · Owner: {record.owner} · 创建于 {record.createdAt}
          </div>
        </div>
      ),
    },
    {
      title: '状态',
      dataIndex: 'state',
      width: 120,
      render: (state: TaskState) => (
        <span className="owner-task-state">
          {stateMeta[state].icon}
          {stateMeta[state].label}
        </span>
      ),
    },
    {
      title: '分发策略',
      dataIndex: 'assignStrategy',
      width: 140,
      render: (strategy: OwnerAssignStrategy, record) => (
        <Space direction="vertical" size={2}>
          <span>{strategyLabel[strategy]}</span>
          {strategy === 'quota' && record.maxClaimPerUser ? (
            <Typography.Text type="secondary">
              每人最多 {record.maxClaimPerUser} 条
            </Typography.Text>
          ) : null}
          {strategy === 'assigned' && record.assignedLabelerIds.length > 0 ? (
            <Typography.Text type="secondary">
              已指派 {record.assignedLabelerIds.length} 人
            </Typography.Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: '配额 / 进度',
      dataIndex: 'quotaUsed',
      width: 220,
      render: (_value, record) => {
        const ratio = record.quotaTotal > 0 ? (record.quotaUsed / record.quotaTotal) * 100 : 0;
        return (
          <div className="owner-task-quota">
            <div className="owner-task-quota-numbers">
              <strong>{record.quotaUsed.toLocaleString()}</strong>
              <span> / {record.quotaTotal.toLocaleString()}</span>
            </div>
            <div className="owner-task-quota-bar">
              <span style={{ width: `${ratio}%` }} />
            </div>
          </div>
        );
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 220,
      render: (_value, record) => (
        <Space size="small">
          {record.state === 'draft' && (
            <Button type="link" onClick={() => openDrawer(record)}>
              发布
            </Button>
          )}
          {record.state === 'published' && (
            <Button
              type="link"
              icon={<PauseCircleFilled />}
              onClick={() => void handleStateChange(record, 'paused')}
            >
              暂停
            </Button>
          )}
          {record.state === 'paused' && (
            <Button
              type="link"
              icon={<SyncOutlined />}
              onClick={() => void handleStateChange(record, 'published')}
            >
              恢复
            </Button>
          )}
          {(record.state === 'published' || record.state === 'paused') && (
            <Button
              type="link"
              danger
              icon={<StopFilled />}
              onClick={() => void handleStateChange(record, 'ended')}
            >
              结束
            </Button>
          )}
          <Button type="link" onClick={() => openDrawer(record)}>
            详情
          </Button>
          <Button
            type="link"
            danger
            icon={<DeleteOutlined />}
            onClick={() => void handleDelete(record)}
          >
            删除
          </Button>
        </Space>
      ),
    },
  ];

  async function loadTasks() {
    setLoading(true);
    try {
      const response = await ownerApi.listTasks();
      setRows(response.items);
    } catch (error) {
      message.error(getApiErrorMessage(error, '任务列表加载失败'));
    } finally {
      setLoading(false);
    }
  }

  async function loadDatasets() {
    try {
      const response = await datasetApi.listDatasets();
      setDatasets(response.items);
    } catch (error) {
      message.error(getApiErrorMessage(error, '数据集列表加载失败'));
    }
  }

  async function loadSchemas() {
    setSchemaLoading(true);
    try {
      const response = await schemaApi.listSchemas();
      setSchemas(response.items);
    } catch (error) {
      message.error(getApiErrorMessage(error, '模板列表加载失败'));
    } finally {
      setSchemaLoading(false);
    }
  }

  async function loadAssignableLabelers() {
    try {
      const response = await ownerApi.listAssignableLabelers();
      setAssignableLabelers(response);
    } catch (error) {
      message.error(getApiErrorMessage(error, '标注员列表加载失败'));
    }
  }

  function inferDatasetId(row?: OwnerTaskRow) {
    if (!row) {
      return datasets[0]?.id ?? '';
    }
    if (row.datasetId) {
      return row.datasetId;
    }
    return datasets.find((dataset) => dataset.taskId === row.taskId)?.id ?? '';
  }

  function toFormValues(row?: OwnerTaskRow): PublishFormValues {
    return {
      title: row?.title ?? '',
      tags: row?.tags?.length ? row.tags : ['电商', '中文'],
      reward: row?.reward ?? '0.30 元 / 条 · 月度封顶 1500 元',
      quota: row?.quotaTotal ?? 5000,
      deadline: row?.deadline ? dayjs(row.deadline, DATE_TIME_FORMAT) : null,
      datasetId: inferDatasetId(row),
      strategy: row?.assignStrategy ?? 'first-come',
      maxClaimPerUser: row?.maxClaimPerUser ?? null,
      assignedLabelerIds: row?.assignedLabelerIds ?? [],
      schema: row ? `${row.title} (Schema ${row.schemaVersion})` : '',
      schemaVersionId:
        row?.schemaVersionId && publishedSchemas.some((schema) => schema.versionId === row.schemaVersionId)
          ? row.schemaVersionId
          : undefined,
    };
  }

  function openDrawer(row?: OwnerTaskRow) {
    setActiveRow(row ?? null);
    submitStateRef.current = row?.state ?? 'published';
    lastSchemaSelectionRef.current = row?.schemaVersionId || undefined;
    form.setFieldsValue(toFormValues(row));
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setActiveRow(null);
    form.resetFields();
  }

  function buildTaskPayload(values: PublishFormValues, status: TaskState): CreateOwnerTaskRequest {
    const schema = publishedSchemas.find((item) => item.versionId === values.schemaVersionId);
    const schemaLabel = schema ? `${schema.name} (${schema.versionNumber})` : values.schema?.trim();
    return {
      title: values.title.trim(),
      tags: values.tags ?? [],
      reward: values.reward?.trim(),
      quota: values.quota ?? undefined,
      deadline: values.deadline ? values.deadline.format(DATE_TIME_FORMAT) : undefined,
      datasetId: values.datasetId,
      strategy: values.strategy,
      maxClaimPerUser:
        values.strategy === 'quota' ? values.maxClaimPerUser ?? undefined : undefined,
      assignedLabelerIds:
        values.strategy === 'assigned' ? values.assignedLabelerIds ?? [] : [],
      schema: schemaLabel || undefined,
      schemaVersionId: schema?.versionId,
      aiReviewEnabled: true,
      status,
    };
  }

  function secondarySubmitState() {
    if (!activeRow || activeRow.state === 'draft') {
      return 'draft' as TaskState;
    }
    return activeRow.state;
  }

  function primarySubmitState() {
    if (!activeRow || activeRow.state === 'draft') {
      return 'published' as TaskState;
    }
    return activeRow.state;
  }

  async function handleStateChange(row: OwnerTaskRow, state: TaskState) {
    try {
      await ownerApi.updateTaskState(row.taskId, state);
      message.success('任务状态已更新');
      await loadTasks();
    } catch (error) {
      message.error(getApiErrorMessage(error, '任务状态更新失败'));
    }
  }

  async function handleDelete(row: OwnerTaskRow) {
    Modal.confirm({
      title: '确认删除该任务?',
      content: `任务「${row.title}」将从任务列表和 Labeler 端隐藏; 已领取和已提交的标注会标记为作废, 原始答案仍保留在数据库中。`,
      okText: '确认删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await ownerApi.deleteTask(row.taskId);
          message.success('任务已删除');
          await loadTasks();
        } catch (error) {
          message.error(getApiErrorMessage(error, '删除失败'));
        }
      },
    });
  }

  async function handlePublishFinish(values: PublishFormValues) {
    const targetState = submitStateRef.current;
    setSubmitting(true);
    try {
      const payload = buildTaskPayload(values, targetState);
      if (activeRow) {
        await ownerApi.updateTask(activeRow.taskId, payload);
        message.success(targetState === 'published' ? '任务已更新并发布' : '任务内容已保存');
      } else {
        await ownerApi.createTask(payload);
        message.success(targetState === 'published' ? '任务已发布' : '任务草稿已保存');
      }
      closeDrawer();
      await Promise.all([loadTasks(), loadDatasets()]);
    } catch (error) {
      message.error(getApiErrorMessage(error, '任务保存失败'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Space direction="vertical" size="large" className="page-stack">
      <div className="page-title-row">
        <Space direction="vertical" size={4}>
          <Typography.Title level={3}>任务管理</Typography.Title>
          <Typography.Text type="secondary">
            维护任务全生命周期：草稿、发布中、已暂停、已结束。
          </Typography.Text>
        </Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openDrawer()}>
          新建任务
        </Button>
      </div>

      <Row gutter={16}>
        <Col span={8}>
          <Card className="owner-stat-card">
            <div className="owner-stat-label">发布中任务</div>
            <div className="owner-stat-value owner-stat-primary">{publishedCount}</div>
            <Tag color="success" className="owner-stat-trend">
              <CheckCircleFilled /> 当前在线
            </Tag>
          </Card>
        </Col>
        <Col span={8}>
          <Card className="owner-stat-card">
            <div className="owner-stat-label">草稿</div>
            <div className="owner-stat-value">{draftCount}</div>
            <Tag className="owner-stat-trend owner-stat-mute">待完善后发布</Tag>
          </Card>
        </Col>
        <Col span={8}>
          <Card className="owner-stat-card">
            <div className="owner-stat-label">累计已认领</div>
            <div className="owner-stat-value owner-stat-primary">
              {submittedCount.toLocaleString()}
            </div>
            <Tag color="processing" className="owner-stat-trend">
              <RobotOutlined /> AI 预审已开启
            </Tag>
          </Card>
        </Col>
      </Row>

      <Card className="owner-toolbar">
        <Space size={12} wrap>
          <Input.Search
            placeholder="搜索任务名 / ID / 负责人"
            allowClear
            style={{ width: 280 }}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onSearch={setKeyword}
          />
          <Select
            options={stateFilterOptions}
            value={stateFilter}
            onChange={setStateFilter}
            style={{ width: 140 }}
          />
          <Select
            options={strategyFilterOptions}
            value={strategyFilter}
            onChange={setStrategyFilter}
            style={{ width: 160 }}
          />
        </Space>
      </Card>

      <Card className="owner-table-card">
        <Table<OwnerTaskRow>
          columns={columns}
          dataSource={filteredRows}
          rowKey="taskId"
          loading={loading}
          pagination={{ defaultPageSize: 10, showSizeChanger: true, showTotal: (total: number) => `共 ${total} 条匹配记录`, pageSizeOptions: [10, 20, 50, 100, 200] }}
          rowClassName="owner-task-row"
        />
      </Card>

      <Drawer
        title={activeRow ? `发布任务 · ${activeRow.title}` : '新建标注任务'}
        width={560}
        open={drawerOpen}
        onClose={closeDrawer}
        closeIcon={<CloseOutlined />}
        footer={
          <Space className="owner-drawer-footer">
            <Button
              loading={submitting}
              onClick={() => {
                submitStateRef.current = secondarySubmitState();
                form.submit();
              }}
            >
              {!activeRow || activeRow.state === 'draft' ? '存为草稿' : '保存更改'}
            </Button>
            <Button
              type="primary"
              icon={<ArrowRightOutlined />}
              loading={submitting}
              onClick={() => {
                submitStateRef.current = primarySubmitState();
                form.submit();
              }}
            >
              {!activeRow || activeRow.state === 'draft' ? '立即发布' : '保存并关闭'}
            </Button>
          </Space>
        }
      >
        <div className="owner-drawer-banner">
          发布后任务会进入「发布中」状态。你可以在这里直接绑定现有数据集，并配置指派或配额抢单策略。
        </div>

        <Form<PublishFormValues>
          form={form}
          layout="vertical"
          requiredMark={false}
          onFinish={handlePublishFinish}
        >
          <Form.Item
            label="任务标题"
            name="title"
            rules={[{ required: true, message: '请输入任务标题' }]}
          >
            <Input placeholder="例如：商品标题清洗 v3" />
          </Form.Item>

          <Form.Item label="标签" name="tags">
            <Select mode="tags" placeholder="按回车输入标签" />
          </Form.Item>

          <Form.Item
            label="关联数据集"
            name="datasetId"
            rules={[{ required: true, message: '请选择一个现有数据集' }]}
          >
            <Select
              placeholder="选择本任务使用的数据集"
              options={datasetOptions}
              showSearch
              optionFilterProp="label"
            />
          </Form.Item>

          {selectedDataset ? (
            <Card size="small" className="owner-stat-card">
              <Space direction="vertical" size={2}>
                <Typography.Text strong>{selectedDataset.name}</Typography.Text>
                <Typography.Text type="secondary">
                  {selectedDataset.itemCount} 条 · 当前任务：{selectedDataset.taskTitle}
                </Typography.Text>
              </Space>
            </Card>
          ) : null}

          <Form.Item label="奖励规则" name="reward">
            <Input placeholder="0.30 元 / 条 · 月度封顶 1500 元" />
          </Form.Item>

          <Row gutter={12}>
            <Col span={12}>
              <Form.Item
                label="配额"
                name="quota"
                rules={[{ required: true, message: '请输入任务总配额' }]}
              >
                <InputNumber min={1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="截止时间"
                name="deadline"
                rules={[{ required: true, message: '请选择截止时间' }]}
              >
                <DatePicker
                  showTime={{ format: 'HH:mm' }}
                  format={DATE_TIME_FORMAT}
                  style={{ width: '100%' }}
                  placeholder="选择截止时间"
                />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label="分发策略" name="strategy">
            <Segmented
              block
              options={[
                { label: '先到先得', value: 'first-come' },
                { label: '指派', value: 'assigned' },
                { label: '配额抢单', value: 'quota' },
              ]}
            />
          </Form.Item>

          {selectedStrategy === 'assigned' ? (
            <Form.Item
              label="指派标注员"
              name="assignedLabelerIds"
              rules={[{ required: true, message: '请至少选择一位标注员' }]}
            >
              <Select
                mode="multiple"
                placeholder="选择需要预分配任务的标注员"
                options={labelerOptions}
                showSearch
                optionFilterProp="label"
              />
            </Form.Item>
          ) : null}

          {selectedStrategy === 'quota' ? (
            <Form.Item
              label="每人最多可认领"
              name="maxClaimPerUser"
              rules={[{ required: true, message: '请输入每人最多可认领数量' }]}
            >
              <InputNumber min={1} style={{ width: '100%' }} placeholder="例如：2" />
            </Form.Item>
          ) : null}

          <Form.Item
            label="关联模板"
            name="schemaVersionId"
            extra={
              publishedSchemas.length === 0
                ? '暂无已发布模板，请先到「模板搭建」页发布模板。'
                : '任务发布后，Labeler 将按该模板版本渲染标注表单。'
            }
            rules={[
              {
                validator: async (_rule, value) => {
                  if (
                    submitStateRef.current === 'published' &&
                    !publishedSchemas.some((schema) => schema.versionId === value)
                  ) {
                    throw new Error('发布任务前请选择一个已发布模板');
                  }
                },
              },
            ]}
          >
            <Select
              placeholder="选择已发布模板"
              options={schemaOptions}
              loading={schemaLoading}
              showSearch
              allowClear
              optionFilterProp="label"
            />
          </Form.Item>

          {selectedSchema ? (
            <Card size="small" className="owner-stat-card">
              <Space direction="vertical" size={2}>
                <Typography.Text strong>{selectedSchema.name}</Typography.Text>
                <Typography.Text type="secondary">
                  {selectedSchema.versionNumber} · {selectedSchema.fieldCount} 个字段 · 更新于{' '}
                  {selectedSchema.updatedAt}
                </Typography.Text>
                {selectedSchema.datasetName ? (
                  <Typography.Text type="secondary">
                    模板默认数据集：{selectedSchema.datasetName}
                  </Typography.Text>
                ) : null}
              </Space>
            </Card>
          ) : null}

          <Form.Item label="启用 AI 预审">
            <Space>
              <Tag color="success">已开启</Tag>
              <Typography.Text type="secondary">规则：电商相关性 v2</Typography.Text>
            </Space>
          </Form.Item>
        </Form>
      </Drawer>
    </Space>
  );
}
