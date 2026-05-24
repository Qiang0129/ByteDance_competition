import { useEffect, useRef, useState } from 'react';
import {
  ArrowRightOutlined,
  CheckCircleFilled,
  CloseOutlined,
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
  Drawer,
  Form,
  Input,
  InputNumber,
  Row,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';

import { ownerApi } from '../../api/owner';
import type { OwnerAssignStrategy, OwnerTask, OwnerTaskState } from '../../types/owner';

/**
 * 任务管理页(Owner 端默认入口)。
 * 信息架构对齐《项目实施计划书》4.1 与 5.2:
 *   任务全生命周期:草稿 → 发布中 → 已暂停 → 已结束
 *   POST /tasks  PUT /tasks/{id}/state  GET /tasks
 * 当前已接入 Spring Boot 任务创建、列表查询和状态切换接口。
 */

type TaskState = OwnerTaskState;
type OwnerTaskRow = OwnerTask;

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

interface PublishFormValues {
  title: string;
  tags: string[];
  reward: string;
  quota: number;
  deadline: string;
  strategy: OwnerAssignStrategy;
  schema: string;
}

export default function OwnerTasks() {
  const { message } = App.useApp();
  const [form] = Form.useForm<PublishFormValues>();
  const [stateFilter, setStateFilter] = useState<string>('all');
  const [strategyFilter, setStrategyFilter] = useState<string>('all');
  const [keyword, setKeyword] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeRow, setActiveRow] = useState<OwnerTaskRow | null>(null);
  const [rows, setRows] = useState<OwnerTaskRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submitStateRef = useRef<TaskState>('published');

  useEffect(() => {
    void loadTasks();
  }, []);

  const filteredRows = rows.filter((row) => {
    if (stateFilter !== 'all' && row.state !== stateFilter) return false;
    if (strategyFilter !== 'all' && row.assignStrategy !== strategyFilter) return false;
    if (keyword && !`${row.title} ${row.taskId} ${row.owner}`.includes(keyword)) return false;
    return true;
  });

  const publishedCount = rows.filter((row) => row.state === 'published').length;
  const draftCount = rows.filter((row) => row.state === 'draft').length;
  const submittedCount = rows.reduce((sum, row) => sum + row.quotaUsed, 0);

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
      width: 120,
      render: (strategy: OwnerAssignStrategy) => strategyLabel[strategy],
    },
    {
      title: '配额 / 进度',
      dataIndex: 'quotaUsed',
      width: 200,
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
      width: 200,
      render: (_value, record) => (
        <Space size="small">
          {record.state === 'draft' && (
            <Button type="link" onClick={() => openDrawer(record)}>
              发布
            </Button>
          )}
          {record.state === 'published' && (
            <Button type="link" icon={<PauseCircleFilled />} onClick={() => handleStateChange(record, 'paused')}>
              暂停
            </Button>
          )}
          {record.state === 'paused' && (
            <Button type="link" icon={<SyncOutlined />} onClick={() => handleStateChange(record, 'published')}>
              恢复
            </Button>
          )}
          {(record.state === 'published' || record.state === 'paused') && (
            <Button type="link" danger icon={<StopFilled />} onClick={() => handleStateChange(record, 'ended')}>
              结束
            </Button>
          )}
          <Button type="link" onClick={() => openDrawer(record)}>
            详情
          </Button>
        </Space>
      ),
    },
  ];

  function openDrawer(row?: OwnerTaskRow) {
    setActiveRow(row ?? null);
    submitStateRef.current = row ? row.state : 'published';
    form.setFieldsValue(toFormValues(row));
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setActiveRow(null);
  }

  async function loadTasks() {
    setLoading(true);
    try {
      const response = await ownerApi.listTasks();
      setRows(response.items);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '任务列表加载失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleStateChange(row: OwnerTaskRow, state: TaskState) {
    try {
      await ownerApi.updateTaskState(row.taskId, state);
      message.success('任务状态已更新');
      await loadTasks();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '任务状态更新失败');
    }
  }

  async function handlePublishFinish(values: PublishFormValues) {
    const targetState = submitStateRef.current;
    setSubmitting(true);
    try {
      if (activeRow) {
        if (targetState !== activeRow.state) {
          await ownerApi.updateTaskState(activeRow.taskId, targetState);
          message.success('任务状态已更新');
        }
      } else {
        await ownerApi.createTask({
          title: values.title,
          tags: values.tags,
          reward: values.reward,
          quota: values.quota,
          deadline: values.deadline,
          strategy: values.strategy,
          schema: values.schema,
          aiReviewEnabled: true,
          status: targetState,
        });
        message.success(targetState === 'published' ? '任务已发布' : '任务草稿已保存');
      }
      closeDrawer();
      await loadTasks();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '任务保存失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Space direction="vertical" size="large" className="page-stack">
      {/* ============ 标题 + 主 CTA ============ */}
      <div className="page-title-row">
        <Space direction="vertical" size={4}>
          <Typography.Title level={3}>任务管理</Typography.Title>
          <Typography.Text type="secondary">
            维护任务全生命周期:草稿 → 发布中 → 已暂停 → 已结束
          </Typography.Text>
        </Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openDrawer()}>
          新建任务
        </Button>
      </div>

      {/* ============ 三张概览卡 ============ */}
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
            <Tag className="owner-stat-trend owner-stat-mute">
              待完善后发布
            </Tag>
          </Card>
        </Col>
        <Col span={8}>
          <Card className="owner-stat-card">
            <div className="owner-stat-label">本周新增提交</div>
            <div className="owner-stat-value owner-stat-primary">{submittedCount.toLocaleString()}</div>
            <Tag color="processing" className="owner-stat-trend">
              <RobotOutlined /> AI 通过率 87%
            </Tag>
          </Card>
        </Col>
      </Row>

      {/* ============ 工具条 ============ */}
      <Card className="owner-toolbar">
        <Space size={12} wrap>
          <Input.Search
            placeholder="搜索任务名 / ID / 负责人"
            allowClear
            style={{ width: 280 }}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onSearch={(value) => setKeyword(value)}
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

      {/* ============ 任务表格 ============ */}
      <Card className="owner-table-card">
        <Table<OwnerTaskRow>
          columns={columns}
          dataSource={filteredRows}
          rowKey="taskId"
          loading={loading}
          pagination={{ pageSize: 10, showSizeChanger: false }}
          rowClassName="owner-task-row"
        />
      </Card>

      {/* ============ 新建/发布抽屉 ============ */}
      <Drawer
        title={activeRow ? `发布任务 · ${activeRow.title}` : '新建标注任务'}
        width={520}
        open={drawerOpen}
        onClose={closeDrawer}
        closeIcon={<CloseOutlined />}
        footer={
          <Space className="owner-drawer-footer">
            <Button
              loading={submitting}
              onClick={() => {
                submitStateRef.current = 'draft';
                form.submit();
              }}
            >
              存为草稿
            </Button>
            <Button
              type="primary"
              icon={<ArrowRightOutlined />}
              loading={submitting}
              onClick={() => {
                submitStateRef.current = 'published';
                form.submit();
              }}
            >
              立即发布
            </Button>
          </Space>
        }
      >
        <div className="owner-drawer-banner">
          发布后将进入「发布中」状态,标注员将在任务广场看到该任务并可领取。
        </div>

        <Form<PublishFormValues>
          form={form}
          layout="vertical"
          requiredMark={false}
          onFinish={handlePublishFinish}
        >
          <Form.Item label="任务标题" name="title" rules={[{ required: true }]}>
            <Input placeholder="例如:商品标题清洗 v3 · 抖音电商" />
          </Form.Item>

          <Form.Item label="标签" name="tags">
            <Select mode="tags" placeholder="按回车输入标签" />
          </Form.Item>

          <Form.Item label="奖励规则" name="reward">
            <Input placeholder="0.30 元 / 条" />
          </Form.Item>

          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="配额" name="quota">
                <InputNumber min={1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="截止时间" name="deadline">
                <Input placeholder="2026-06-01 23:59" />
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

          <Form.Item label="关联模板" name="schema">
            <Input
              addonAfter={<Button type="link" size="small">切换</Button>}
              readOnly
            />
          </Form.Item>

          <Form.Item label="启用 AI 预审">
            <Space>
              <Tag color="success">已开启</Tag>
              <Typography.Text type="secondary">规则:电商相关性 v2</Typography.Text>
            </Space>
          </Form.Item>
        </Form>
      </Drawer>
    </Space>
  );
}

function toFormValues(row?: OwnerTaskRow): PublishFormValues {
  return {
    title: row?.title ?? '',
    tags: row?.tags?.length ? row.tags : ['电商', '文本清洗', '中文'],
    reward: row?.reward ?? '0.30 元 / 条 · 月度封顶 1500 元',
    quota: row?.quotaTotal || 5000,
    deadline: row?.deadline || '2026-06-01 23:59',
    strategy: row?.assignStrategy ?? 'first-come',
    schema: row ? `${row.title} (Schema ${row.schemaVersion})` : '商品清洗 · v3 (Schema r12)',
  };
}
