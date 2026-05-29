import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircleFilled,
  CloseCircleFilled,
  DeleteOutlined,
  EditOutlined,
  ExclamationCircleFilled,
  EyeOutlined,
  PlusOutlined,
  RedoOutlined,
  ReloadOutlined,
  RobotOutlined,
  ThunderboltFilled,
} from '@ant-design/icons';
import {
  App as AntdApp,
  Button,
  Card,
  Col,
  Drawer,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Row,
  Segmented,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';

import { aiReviewApi } from '../../api/aiReview';
import type {
  AiReviewDimension,
  AiReviewJob,
  AiReviewJobStatus,
  AiReviewResult,
  AiReviewRule,
  AiReviewRuleRequest,
  AiReviewRuleStatus,
  AiDecision,
} from '../../types/aiReview';

/**
 * Owner 端 AI 预审规则管理页。
 * 对齐《项目实施计划书》4.4:
 *   - Owner 维护 Prompt 模板、评分维度、判定阈值、失败重试策略
 *   - 查看每条 annotation 的 AI 预审执行记录与 AIReviewResult
 * 本期前端 + 后端接口预留,Phase 5 实际实现 LLM Worker.
 */

const { Title, Paragraph, Text } = Typography;

const decisionMeta: Record<AiDecision, { label: string; color: string }> = {
  PASS: { label: 'PASS', color: 'success' },
  NEED_HUMAN_REVIEW: { label: 'NEED_HUMAN_REVIEW', color: 'warning' },
  REJECT: { label: 'REJECT', color: 'error' },
};

const jobStatusMeta: Record<AiReviewJobStatus, { label: string; color: string }> = {
  pending: { label: '排队中', color: 'default' },
  running: { label: '执行中', color: 'processing' },
  success: { label: '成功', color: 'success' },
  failed: { label: '失败', color: 'error' },
};

/** 规则编辑表单的字段类型 */
interface RuleFormValues extends Omit<AiReviewRuleRequest, 'dimensions' | 'status'> {
  dimensions: AiReviewDimension[];
  enabled: boolean;
}

export default function OwnerAiReview() {
  const [activeTab, setActiveTab] = useState<'rules' | 'jobs'>('rules');

  return (
    <Space direction="vertical" size="large" className="page-stack ai-review-page">
      {/* 标题 + 阶段标识 */}
      <div className="page-title-row">
        <Space direction="vertical" size={4}>
          <Title level={3}>AI 预审规则</Title>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            维护 Prompt 模板、评分维度,定义 PASS / NEED_HUMAN_REVIEW / REJECT 判定阈值与失败重试策略。
          </Paragraph>
        </Space>
        <Tag color="processing" icon={<ThunderboltFilled />}>
          Phase 5 · AI 与人工审核
        </Tag>
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as 'rules' | 'jobs')}
        items={[
          {
            key: 'rules',
            label: '规则管理',
            children: <RulesPanel />,
          },
          {
            key: 'jobs',
            label: '执行记录',
            children: <JobsPanel />,
          },
        ]}
      />
    </Space>
  );
}

/* ================ 规则管理面板 ================ */

function RulesPanel() {
  const { message } = AntdApp.useApp();
  const [rules, setRules] = useState<AiReviewRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [usingFallback, setUsingFallback] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<AiReviewRule | null>(null);
  const [form] = Form.useForm<RuleFormValues>();

  const loadRules = useCallback(async () => {
    setLoading(true);
    try {
      const result = await aiReviewApi.listRules({ page: 1, pageSize: 50 });
      setRules(result.items);
      setUsingFallback(false);
    } catch {
      // 后端未实现时回落样例 JSON,前端继续可用,保留只读 UI 能力
      try {
        const res = await fetch('/sample-datasets/ai-review-rules.json');
        const sample = (await res.json()) as { items: AiReviewRule[] };
        setRules(sample.items);
        setUsingFallback(true);
      } catch {
        message.error('AI 预审规则加载失败,且无法读取样例数据。');
      }
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void loadRules();
  }, [loadRules]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      name: '',
      promptTemplate: '',
      dimensions: [
        { key: 'relevance', label: '相关性', weight: 0.3, maxScore: 5 },
        { key: 'accuracy', label: '准确性', weight: 0.4, maxScore: 5 },
        { key: 'format_compliance', label: '格式合规', weight: 0.2, maxScore: 5 },
        { key: 'safety', label: '安全性', weight: 0.1, maxScore: 5 },
      ],
      passThreshold: 4.0,
      needHumanThreshold: 3.0,
      maxRetry: 2,
      retryBackoffSec: 30,
      enabled: true,
    });
    setDrawerOpen(true);
  };

  const openEdit = (rule: AiReviewRule) => {
    setEditing(rule);
    form.setFieldsValue({
      name: rule.name,
      scopeTaskId: rule.scopeTaskId,
      promptTemplate: rule.promptTemplate,
      dimensions: rule.dimensions,
      passThreshold: rule.passThreshold,
      needHumanThreshold: rule.needHumanThreshold,
      maxRetry: rule.maxRetry,
      retryBackoffSec: rule.retryBackoffSec,
      enabled: rule.status === 'enabled',
    });
    setDrawerOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    // dimensions 权重之和需要 ≈ 1
    const weightSum = values.dimensions.reduce((sum, d) => sum + (d.weight ?? 0), 0);
    if (Math.abs(weightSum - 1) > 0.001) {
      message.error(`评分维度权重之和需要等于 1,当前为 ${weightSum.toFixed(2)}`);
      return;
    }
    if (values.passThreshold <= values.needHumanThreshold) {
      message.error('PASS 阈值必须大于 NEED_HUMAN_REVIEW 阈值');
      return;
    }

    const payload: AiReviewRuleRequest = {
      name: values.name,
      scopeTaskId: values.scopeTaskId,
      promptTemplate: values.promptTemplate,
      dimensions: values.dimensions,
      passThreshold: values.passThreshold,
      needHumanThreshold: values.needHumanThreshold,
      maxRetry: values.maxRetry,
      retryBackoffSec: values.retryBackoffSec,
      status: values.enabled ? 'enabled' : 'disabled',
    };

    try {
      if (editing) {
        await aiReviewApi.updateRule(editing.ruleId, payload);
        message.success(`规则「${payload.name}」已更新`);
      } else {
        await aiReviewApi.createRule(payload);
        message.success(`规则「${payload.name}」已创建`);
      }
      setDrawerOpen(false);
      await loadRules();
    } catch {
      // 后端未就绪:本地 mock 更新,提示演示模式
      if (usingFallback) {
        if (editing) {
          setRules((prev) =>
            prev.map((r) =>
              r.ruleId === editing.ruleId
                ? {
                    ...r,
                    ...payload,
                    version: r.version + 1,
                    updatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
                  }
                : r,
            ),
          );
        } else {
          const newRule: AiReviewRule = {
            ruleId: `rule_local_${Date.now()}`,
            ...payload,
            version: 1,
            updatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
            createdBy: 'Owner Demo',
          };
          setRules((prev) => [newRule, ...prev]);
        }
        message.warning('后端未就绪,改动仅保存在演示模式中');
        setDrawerOpen(false);
      } else {
        message.error('保存规则失败,请检查后端是否就绪');
      }
    }
  };

  const handleToggle = async (rule: AiReviewRule, checked: boolean) => {
    const next: AiReviewRuleStatus = checked ? 'enabled' : 'disabled';
    try {
      await aiReviewApi.toggleRule(rule.ruleId, next);
      await loadRules();
      message.success(`规则已${checked ? '启用' : '停用'}`);
    } catch {
      if (usingFallback) {
        setRules((prev) =>
          prev.map((r) => (r.ruleId === rule.ruleId ? { ...r, status: next } : r)),
        );
        message.warning('后端未就绪,改动仅保存在演示模式中');
      } else {
        message.error('切换状态失败');
      }
    }
  };

  const handleDelete = async (rule: AiReviewRule) => {
    try {
      await aiReviewApi.deleteRule(rule.ruleId);
      message.success(`规则「${rule.name}」已删除`);
      await loadRules();
    } catch {
      if (usingFallback) {
        setRules((prev) => prev.filter((r) => r.ruleId !== rule.ruleId));
        message.warning('后端未就绪,改动仅保存在演示模式中');
      } else {
        message.error('删除规则失败');
      }
    }
  };

  const columns: ColumnsType<AiReviewRule> = [
    {
      title: '规则名称',
      dataIndex: 'name',
      width: 200,
      render: (_, rule) => (
        <Space direction="vertical" size={2}>
          <Text strong>{rule.name}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            v{rule.version} · {rule.createdBy}
          </Text>
        </Space>
      ),
    },
    {
      title: '作用范围',
      dataIndex: 'scopeTaskTitle',
      width: 180,
      render: (_, rule) =>
        rule.scopeTaskId ? (
          <Tag color="blue">{rule.scopeTaskTitle ?? rule.scopeTaskId}</Tag>
        ) : (
          <Tag>全局默认</Tag>
        ),
    },
    {
      title: 'Prompt 摘要',
      dataIndex: 'promptTemplate',
      ellipsis: true,
      render: (text: string) => (
        <Text type="secondary" ellipsis>
          {text.slice(0, 60)}
          {text.length > 60 ? '...' : ''}
        </Text>
      ),
    },
    {
      title: '阈值',
      width: 160,
      render: (_, rule) => (
        <Space direction="vertical" size={2}>
          <Text style={{ fontSize: 12 }}>
            PASS ≥ <Text strong>{rule.passThreshold}</Text>
          </Text>
          <Text style={{ fontSize: 12 }}>
            人工 ≥ <Text strong>{rule.needHumanThreshold}</Text>
          </Text>
        </Space>
      ),
    },
    {
      title: '重试',
      width: 90,
      render: (_, rule) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {rule.maxRetry} 次 / {rule.retryBackoffSec}s
        </Text>
      ),
    },
    {
      title: '状态',
      width: 90,
      render: (_, rule) => (
        <Switch
          checked={rule.status === 'enabled'}
          onChange={(checked) => void handleToggle(rule, checked)}
        />
      ),
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 150,
      render: (text: string) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {text}
        </Text>
      ),
    },
    {
      title: '操作',
      width: 96,
      align: 'center',
      render: (_, rule) => (
        <Space size={2}>
          <Tooltip title="编辑">
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => openEdit(rule)}
              aria-label="编辑规则"
            />
          </Tooltip>
          <Popconfirm
            title="确认删除该规则?"
            description="删除后该规则不再参与新提交的 AI 预审。"
            okText="删除"
            okButtonProps={{ danger: true }}
            cancelText="取消"
            onConfirm={() => void handleDelete(rule)}
          >
            <Tooltip title="删除">
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
                aria-label="删除规则"
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {/* KPI */}
      <RulesKpi rules={rules} />

      {/* 工具条 */}
      <Card className="owner-toolbar">
        <Space size={8} wrap>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建规则
          </Button>
          <Button icon={<ReloadOutlined />} onClick={() => void loadRules()}>
            刷新
          </Button>
          {usingFallback && <Tag color="gold">演示模式 · 后端未就绪</Tag>}
        </Space>
      </Card>

      <Card className="owner-table-card" loading={loading}>
        <Table<AiReviewRule>
          rowKey="ruleId"
          columns={columns}
          dataSource={rules}
          pagination={{
            defaultPageSize: 10,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条规则`,
            pageSizeOptions: ['10', '20', '50', '100'],
          }}
        />
      </Card>

      <RuleEditDrawer
        open={drawerOpen}
        editing={editing}
        form={form}
        onSubmit={submit}
        onClose={() => setDrawerOpen(false)}
      />
    </Space>
  );
}

function RulesKpi({ rules }: { rules: AiReviewRule[] }) {
  const total = rules.length;
  const enabled = rules.filter((r) => r.status === 'enabled').length;
  const globalRules = rules.filter((r) => !r.scopeTaskId).length;

  return (
    <Row gutter={16} className="row-equal">
      <Col xs={24} md={8}>
        <Card className="owner-stat-card">
          <div className="owner-stat-label">规则总数</div>
          <div className="owner-stat-value owner-stat-primary">{total}</div>
          <Tag className="owner-stat-trend">含启用与停用</Tag>
        </Card>
      </Col>
      <Col xs={24} md={8}>
        <Card className="owner-stat-card">
          <div className="owner-stat-label">已启用</div>
          <div className="owner-stat-value">{enabled}</div>
          <Tag color="success">实际参与 AI 预审</Tag>
        </Card>
      </Col>
      <Col xs={24} md={8}>
        <Card className="owner-stat-card">
          <div className="owner-stat-label">全局默认规则</div>
          <div className="owner-stat-value">{globalRules}</div>
          <Tag color="processing">未绑定任务时使用</Tag>
        </Card>
      </Col>
    </Row>
  );
}

/* ================ 规则编辑 Drawer ================ */

function RuleEditDrawer({
  open,
  editing,
  form,
  onSubmit,
  onClose,
}: {
  open: boolean;
  editing: AiReviewRule | null;
  form: ReturnType<typeof Form.useForm<RuleFormValues>>[0];
  onSubmit: () => void;
  onClose: () => void;
}) {
  return (
    <Drawer
      title={editing ? `编辑规则:${editing.name}` : '新建 AI 预审规则'}
      open={open}
      onClose={onClose}
      width={680}
      destroyOnClose
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" onClick={onSubmit}>
            {editing ? '保存修改' : '创建规则'}
          </Button>
        </div>
      }
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="name"
          label="规则名称"
          rules={[{ required: true, message: '请输入规则名称' }]}
        >
          <Input placeholder="例如:QA 质量评估默认规则" maxLength={64} />
        </Form.Item>

        <Form.Item name="scopeTaskId" label="作用任务 (可选,留空表示全局默认)">
          <Input placeholder="任务 ID,例如 T-2041" />
        </Form.Item>

        <Form.Item
          name="promptTemplate"
          label="Prompt 模板"
          extra="支持占位符 {{rawPayload}}、{{answer}}、{{schema}},会在调用 LLM 前被填充"
          rules={[{ required: true, message: '请输入 Prompt 模板' }]}
        >
          <Input.TextArea rows={6} placeholder="你是严格的标注质检员……" />
        </Form.Item>

        {/* 评分维度动态列表 */}
        <Form.Item label="评分维度 (权重之和必须等于 1)">
          <Form.List name="dimensions">
            {(fields, { add, remove }) => (
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                {fields.map((field) => (
                  <Row gutter={8} key={field.key} align="middle">
                    <Col span={6}>
                      <Form.Item
                        name={[field.name, 'key']}
                        rules={[{ required: true, message: 'key' }]}
                        style={{ marginBottom: 0 }}
                      >
                        <Input placeholder="key" />
                      </Form.Item>
                    </Col>
                    <Col span={7}>
                      <Form.Item
                        name={[field.name, 'label']}
                        rules={[{ required: true, message: 'label' }]}
                        style={{ marginBottom: 0 }}
                      >
                        <Input placeholder="展示名" />
                      </Form.Item>
                    </Col>
                    <Col span={5}>
                      <Form.Item
                        name={[field.name, 'weight']}
                        rules={[{ required: true, message: '权重' }]}
                        style={{ marginBottom: 0 }}
                      >
                        <InputNumber
                          step={0.1}
                          min={0}
                          max={1}
                          placeholder="权重"
                          style={{ width: '100%' }}
                        />
                      </Form.Item>
                    </Col>
                    <Col span={4}>
                      <Form.Item
                        name={[field.name, 'maxScore']}
                        rules={[{ required: true, message: '满分' }]}
                        style={{ marginBottom: 0 }}
                      >
                        <InputNumber
                          step={1}
                          min={1}
                          placeholder="满分"
                          style={{ width: '100%' }}
                        />
                      </Form.Item>
                    </Col>
                    <Col span={2} style={{ textAlign: 'right' }}>
                      <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => remove(field.name)}
                      />
                    </Col>
                  </Row>
                ))}
                <Button
                  type="dashed"
                  block
                  icon={<PlusOutlined />}
                  onClick={() =>
                    add({ key: '', label: '', weight: 0, maxScore: 5 })
                  }
                >
                  添加维度
                </Button>
              </Space>
            )}
          </Form.List>
        </Form.Item>

        <Row gutter={12}>
          <Col span={12}>
            <Form.Item
              name="passThreshold"
              label="PASS 阈值"
              rules={[{ required: true }]}
            >
              <InputNumber step={0.1} min={0} max={5} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="needHumanThreshold"
              label="NEED_HUMAN 阈值"
              rules={[{ required: true }]}
            >
              <InputNumber step={0.1} min={0} max={5} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="maxRetry" label="最大重试次数" rules={[{ required: true }]}>
              <InputNumber min={0} max={5} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="retryBackoffSec"
              label="重试退避秒数"
              rules={[{ required: true }]}
            >
              <InputNumber min={5} max={600} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item name="enabled" label="启用状态" valuePropName="checked">
          <Switch checkedChildren="启用" unCheckedChildren="停用" />
        </Form.Item>
      </Form>
    </Drawer>
  );
}

/* ================ 执行记录面板 ================ */

function JobsPanel() {
  const { message } = AntdApp.useApp();
  const [jobs, setJobs] = useState<AiReviewJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [usingFallback, setUsingFallback] = useState(false);
  const [statusFilter, setStatusFilter] = useState<AiReviewJobStatus | 'all'>('all');
  const [resultDrawer, setResultDrawer] = useState<{
    open: boolean;
    job?: AiReviewJob;
    result?: AiReviewResult;
    loading?: boolean;
  }>({ open: false });

  const loadJobs = useCallback(async () => {
    setLoading(true);
    try {
      const result = await aiReviewApi.listJobs({
        status: statusFilter === 'all' ? undefined : statusFilter,
        page: 1,
        pageSize: 100,
      });
      setJobs(result.items);
      setUsingFallback(false);
    } catch {
      try {
        const res = await fetch('/sample-datasets/ai-review-jobs.json');
        const sample = (await res.json()) as { items: AiReviewJob[] };
        const items = statusFilter === 'all'
          ? sample.items
          : sample.items.filter((j) => j.status === statusFilter);
        setJobs(items);
        setUsingFallback(true);
      } catch {
        message.error('AI 预审作业加载失败');
      }
    } finally {
      setLoading(false);
    }
  }, [statusFilter, message]);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  const handleRetry = async (job: AiReviewJob) => {
    try {
      await aiReviewApi.retryJob(job.jobId);
      message.success(`已重新入队作业 ${job.jobId}`);
      await loadJobs();
    } catch {
      if (usingFallback) {
        setJobs((prev) =>
          prev.map((j) =>
            j.jobId === job.jobId
              ? { ...j, status: 'pending', attempts: j.attempts + 1, lastError: undefined }
              : j,
          ),
        );
        message.warning('后端未就绪,改动仅保存在演示模式中');
      } else {
        message.error('重试失败');
      }
    }
  };

  const openResult = async (job: AiReviewJob) => {
    setResultDrawer({ open: true, job, loading: true });
    try {
      const result = await aiReviewApi.getJobResult(job.annotationId);
      setResultDrawer({ open: true, job, result, loading: false });
    } catch {
      // 失败时构造演示 result(基于 job 已有数据)
      const fallback: AiReviewResult = {
        scores: {
          relevance: 4,
          accuracy: 4,
          format_compliance: 5,
          safety: 5,
        },
        total_score: job.totalScore ?? 0,
        decision: job.decision ?? 'NEED_HUMAN_REVIEW',
        comment: '后端未就绪,以下为演示评估理由。整体表达清晰,但部分字段格式略有偏差。',
        risk_flags: ['demo'],
        evidence: ['rawPayload.prompt', 'answer.preferred'],
      };
      setResultDrawer({ open: true, job, result: fallback, loading: false });
    }
  };

  const columns: ColumnsType<AiReviewJob> = [
    {
      title: 'Job ID',
      dataIndex: 'jobId',
      width: 200,
      render: (text: string) => <Text code>{text}</Text>,
    },
    {
      title: '关联任务',
      dataIndex: 'taskTitle',
      width: 180,
      render: (_, j) => (
        <Space direction="vertical" size={2}>
          <Text>{j.taskTitle}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            ann:{j.annotationId}
          </Text>
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (status: AiReviewJobStatus) => {
        const meta = jobStatusMeta[status];
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: '决策',
      dataIndex: 'decision',
      width: 160,
      render: (decision?: AiDecision) => {
        if (!decision) return <Text type="secondary">-</Text>;
        const meta = decisionMeta[decision];
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: '总分',
      dataIndex: 'totalScore',
      width: 80,
      render: (score?: number) =>
        score === undefined ? <Text type="secondary">-</Text> : <Text strong>{score.toFixed(2)}</Text>,
    },
    {
      title: '尝试',
      dataIndex: 'attempts',
      width: 70,
    },
    {
      title: '最后错误',
      dataIndex: 'lastError',
      ellipsis: true,
      render: (err?: string) =>
        err ? (
          <Text type="danger" ellipsis style={{ fontSize: 12 }}>
            {err}
          </Text>
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
    {
      title: '时间',
      width: 170,
      render: (_, j) => (
        <Space direction="vertical" size={0}>
          <Text style={{ fontSize: 12 }}>{j.createdAt}</Text>
          {j.finishedAt && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              结束 {j.finishedAt}
            </Text>
          )}
        </Space>
      ),
    },
    {
      title: '操作',
      width: 120,
      align: 'center',
      render: (_, j) => (
        <Space size={2}>
          <Tooltip title="查看 AI 预审结果">
            <Button
              type="text"
              size="small"
              icon={<EyeOutlined />}
              aria-label="查看结果"
              onClick={() => void openResult(j)}
            />
          </Tooltip>
          {j.status === 'failed' && (
            <Tooltip title="重新入队">
              <Button
                type="text"
                size="small"
                icon={<RedoOutlined />}
                aria-label="重试作业"
                onClick={() => void handleRetry(j)}
              />
            </Tooltip>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <JobsKpi jobs={jobs} />

      <Card className="owner-toolbar">
        <Space size={12} wrap>
          <Segmented
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as typeof statusFilter)}
            options={[
              { label: '全部', value: 'all' },
              { label: '排队中', value: 'pending' },
              { label: '执行中', value: 'running' },
              { label: '成功', value: 'success' },
              { label: '失败', value: 'failed' },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void loadJobs()}>
            刷新
          </Button>
          {usingFallback && <Tag color="gold">演示模式 · 后端未就绪</Tag>}
        </Space>
      </Card>

      <Card className="owner-table-card" loading={loading}>
        <Table<AiReviewJob>
          rowKey="jobId"
          columns={columns}
          dataSource={jobs}
          pagination={{
            defaultPageSize: 10,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条作业`,
            pageSizeOptions: ['10', '20', '50', '100'],
          }}
        />
      </Card>

      <JobResultDrawer
        open={resultDrawer.open}
        job={resultDrawer.job}
        result={resultDrawer.result}
        loading={resultDrawer.loading}
        onClose={() => setResultDrawer({ open: false })}
      />
    </Space>
  );
}

function JobsKpi({ jobs }: { jobs: AiReviewJob[] }) {
  const stats = useMemo(() => {
    const today = jobs.length;
    const success = jobs.filter((j) => j.status === 'success').length;
    const failed = jobs.filter((j) => j.status === 'failed').length;
    const needHuman = jobs.filter((j) => j.decision === 'NEED_HUMAN_REVIEW').length;
    return { today, success, failed, needHuman };
  }, [jobs]);

  return (
    <Row gutter={16} className="row-equal">
      <Col xs={12} md={6}>
        <Card className="owner-stat-card">
          <div className="owner-stat-label">作业总数</div>
          <div className="owner-stat-value owner-stat-primary">{stats.today}</div>
          <Tag>当前筛选范围</Tag>
        </Card>
      </Col>
      <Col xs={12} md={6}>
        <Card className="owner-stat-card">
          <div className="owner-stat-label">成功</div>
          <div className="owner-stat-value">{stats.success}</div>
          <Tag color="success" icon={<CheckCircleFilled />}>
            PASS / NEED_HUMAN / REJECT 已得出
          </Tag>
        </Card>
      </Col>
      <Col xs={12} md={6}>
        <Card className="owner-stat-card">
          <div className="owner-stat-label">需人工复核</div>
          <div className="owner-stat-value">{stats.needHuman}</div>
          <Tag color="warning" icon={<ExclamationCircleFilled />}>
            进入审核员队列
          </Tag>
        </Card>
      </Col>
      <Col xs={12} md={6}>
        <Card className="owner-stat-card">
          <div className="owner-stat-label">失败</div>
          <div className="owner-stat-value">{stats.failed}</div>
          <Tag color="error" icon={<CloseCircleFilled />}>
            可重试
          </Tag>
        </Card>
      </Col>
    </Row>
  );
}

/* ================ 执行结果详情 Drawer ================ */

function JobResultDrawer({
  open,
  job,
  result,
  loading,
  onClose,
}: {
  open: boolean;
  job?: AiReviewJob;
  result?: AiReviewResult;
  loading?: boolean;
  onClose: () => void;
}) {
  return (
    <Drawer
      title={
        <Space>
          <RobotOutlined />
          <span>AI 预审结果</span>
          {job && <Text type="secondary">{job.jobId}</Text>}
        </Space>
      }
      open={open}
      onClose={onClose}
      width={520}
    >
      {!result || loading ? (
        <Text type="secondary">{loading ? '加载中...' : '暂无结果'}</Text>
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {/* 决策 + 总分 */}
          <Card>
            <Row gutter={12} align="middle">
              <Col span={12}>
                <Text type="secondary">决策</Text>
                <div style={{ marginTop: 4 }}>
                  <Tag color={decisionMeta[result.decision].color} style={{ fontSize: 14, padding: '2px 12px' }}>
                    {decisionMeta[result.decision].label}
                  </Tag>
                </div>
              </Col>
              <Col span={12}>
                <Text type="secondary">总分</Text>
                <div style={{ marginTop: 4 }}>
                  <Text strong style={{ fontSize: 22 }}>
                    {result.total_score.toFixed(2)}
                  </Text>
                </div>
              </Col>
            </Row>
          </Card>

          {/* 各维度评分 */}
          <Card title="评分明细">
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              {Object.entries(result.scores).map(([key, value]) => (
                <ScoreRow key={key} label={key} value={value ?? 0} />
              ))}
            </Space>
          </Card>

          {/* 评估理由 */}
          <Card title="评估理由">
            <Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>
              {result.comment || '未提供。'}
            </Paragraph>
          </Card>

          {/* Risk flags */}
          {result.risk_flags.length > 0 && (
            <Card title="风险标记">
              <Space wrap>
                {result.risk_flags.map((flag) => (
                  <Tag key={flag} color="error">
                    {flag}
                  </Tag>
                ))}
              </Space>
            </Card>
          )}

          {/* Evidence */}
          {result.evidence.length > 0 && (
            <Card title="证据 / 引用字段">
              <Space wrap>
                {result.evidence.map((ev) => (
                  <Tag key={ev} color="processing">
                    {ev}
                  </Tag>
                ))}
              </Space>
            </Card>
          )}
        </Space>
      )}
    </Drawer>
  );
}

function ScoreRow({ label, value }: { label: string; value: number }) {
  // 假设满分 5,按比例渲染条
  const ratio = Math.min(1, value / 5);
  return (
    <div className="ai-review-score-row">
      <Text style={{ minWidth: 120 }}>{label}</Text>
      <div className="ai-review-score-bar">
        <span style={{ width: `${ratio * 100}%` }} />
      </div>
      <Text strong style={{ minWidth: 36, textAlign: 'right' }}>
        {value.toFixed(1)}
      </Text>
    </div>
  );
}
