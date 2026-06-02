import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ApiOutlined,
  ArrowLeftOutlined,
  CheckCircleFilled,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  InfoCircleOutlined,
  PlayCircleFilled,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import {
  Alert,
  App as AntdApp,
  AutoComplete,
  Button,
  Card,
  Col,
  Drawer,
  Empty,
  Input,
  InputNumber,
  Popconfirm,
  Row,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';

import { aiReviewApi } from '../../api/aiReview';
import { getApiErrorMessage } from '../../api/client';
import type { AiModelConfig, AiModelConfigRequest } from '../../types/aiReview';
import { AiAssistantIcon } from '../../components/icons';

const { Paragraph, Text, Title } = Typography;
type ReasoningEffort = AiModelConfigRequest['reasoningEffort'];

interface ModelSettingsLocationState {
  from?: string;
}

/**
 * 模型配置页:支持多配置管理。
 *
 * - 页面主体是配置卡片列表,每张卡显示供应商名 + API 地址 + 模型名 + 状态;
 * - 同一时间只有一个配置是 active(Agent 运行时使用),其余为 inactive;
 * - 点「启用」切换激活配置;点「编辑」打开右侧 Drawer 修改;点「删除」移除(不能删激活的);
 * - 点「新建配置」打开空白 Drawer 创建新配置。
 *
 * 后端接口:
 *   - GET    /ai-review/model-configs              配置列表
 *   - POST   /ai-review/model-configs              新建配置
 *   - PUT    /ai-review/model-configs/{configId}   更新配置
 *   - DELETE /ai-review/model-configs/{configId}   删除配置
 *   - POST   /ai-review/model-configs/{configId}/activate  激活配置
 *
 * 后端未实现时回落到旧单配置接口 GET/PUT /ai-review/model-config。
 */

interface ConfigFormValues {
  providerName: string;
  notes: string;
  licenseUrl: string;
  apiKey: string;
  apiBaseUrl: string;
  useFullUrl: boolean;
  modelName: string;
  reasoningEffort: ReasoningEffort;
  workerConcurrency: number;
  apiKeyMask?: string;
}

const DEFAULT_FORM: ConfigFormValues = {
  providerName: '',
  notes: '',
  licenseUrl: '',
  apiKey: '',
  apiBaseUrl: '',
  useFullUrl: false,
  modelName: '',
  reasoningEffort: 'high',
  workerConcurrency: 3,
};

function normalizeReasoningEffort(value?: string): ReasoningEffort {
  if (value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh') {
    return value;
  }
  if (value === 'minimal') {
    return 'low';
  }
  return 'high';
}

function configToForm(config: AiModelConfig): ConfigFormValues {
  return {
    providerName: config.providerName ?? '',
    notes: config.notes ?? '',
    licenseUrl: config.licenseUrl ?? '',
    apiKey: '',
    apiBaseUrl: config.apiBaseUrl ?? '',
    useFullUrl: config.useFullUrl ?? false,
    modelName: config.modelName ?? '',
    reasoningEffort: normalizeReasoningEffort(config.reasoningEffort),
    workerConcurrency: config.workerConcurrency ?? 3,
    apiKeyMask: config.apiKeyMask,
  };
}

export default function ModelSettings() {
  const { message } = AntdApp.useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const [configs, setConfigs] = useState<AiModelConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [usingFallback, setUsingFallback] = useState(false);

  // Drawer 状态
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<AiModelConfig | null>(null);
  const [form, setForm] = useState<ConfigFormValues>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [modelIds, setModelIds] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);

  /** 加载配置列表 */
  const loadConfigs = useCallback(async () => {
    setLoading(true);
    try {
      const list = await aiReviewApi.listModelConfigs();
      setConfigs(Array.isArray(list) ? list : []);
      setUsingFallback(false);
    } catch {
      // 后端多配置接口未实现时,回落到旧单配置接口
      try {
        const single = await aiReviewApi.getModelConfig();
        if (single) {
          setConfigs([{ ...single, configId: single.configId || 'default', status: 'active' }]);
        } else {
          setConfigs([]);
        }
        setUsingFallback(true);
      } catch {
        setConfigs([]);
        setUsingFallback(true);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfigs();
  }, [loadConfigs]);

  /** 当前激活的配置 */
  const activeConfig = useMemo(
    () => configs.find((c) => c.status === 'active'),
    [configs],
  );

  function handleBack() {
    const state = location.state as ModelSettingsLocationState | null;
    const from = state?.from;
    if (from && from !== location.pathname) {
      navigate(from);
      return;
    }

    const historyState = window.history.state as { idx?: number } | null;
    const canReturnWithinApp =
      typeof historyState?.idx === 'number' ? historyState.idx > 0 : window.history.length > 1;
    if (canReturnWithinApp) {
      navigate(-1);
      return;
    }

    navigate(location.pathname.startsWith('/ai-reviewer') ? '/ai-reviewer' : '/owner/tasks');
  }

  /** 打开新建 Drawer */
  function openCreate() {
    setEditing(null);
    setForm(DEFAULT_FORM);
    setModelIds([]);
    setDrawerOpen(true);
  }

  /** 打开编辑 Drawer */
  function openEdit(config: AiModelConfig) {
    setEditing(config);
    setForm(configToForm(config));
    setModelIds([]);
    setDrawerOpen(true);
  }

  /** 复制配置:以现有配置为模板打开新建 Drawer,名称加「(副本)」后缀 */
  function openDuplicate(config: AiModelConfig) {
    setEditing(null); // null 表示新建模式
    setForm({
      ...configToForm(config),
      providerName: `${config.providerName} (副本)`,
      apiKey: '', // API Key 不复制,需要重新填写
      apiKeyMask: undefined,
    });
    setModelIds([]);
    setDrawerOpen(true);
  }

  /** 保存(新建或更新) */
  async function handleSave() {
    const payload: AiModelConfigRequest = {
      providerName: form.providerName.trim(),
      notes: form.notes.trim() || undefined,
      licenseUrl: form.licenseUrl.trim() || undefined,
      apiBaseUrl: form.apiBaseUrl.trim(),
      useFullUrl: form.useFullUrl,
      modelName: form.modelName.trim(),
      reasoningEffort: form.reasoningEffort,
      wireApi: 'responses',
      workerConcurrency: form.workerConcurrency || 3,
      apiKey: form.apiKey.trim() || undefined,
    };

    if (!payload.providerName || !payload.apiBaseUrl || !payload.modelName) {
      message.warning('请填写供应商名称、API 地址和模型名称');
      return;
    }
    if (!payload.apiKey && !form.apiKeyMask) {
      message.warning('首次保存必须填写 API Key');
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        await aiReviewApi.updateModelConfig(editing.configId, payload);
        message.success('配置已更新');
      } else {
        await aiReviewApi.createModelConfig(payload);
        message.success('配置已创建');
      }
      setDrawerOpen(false);
      await loadConfigs();
    } catch (error) {
      if (usingFallback) {
        // 回落到旧接口
        try {
          await aiReviewApi.saveModelConfig(payload);
          message.success('配置已保存(兼容模式)');
          setDrawerOpen(false);
          await loadConfigs();
        } catch (fallbackError) {
          message.error(getApiErrorMessage(fallbackError, '保存失败'));
        }
      } else {
        message.error(getApiErrorMessage(error, '保存失败'));
      }
    } finally {
      setSaving(false);
    }
  }

  /** 激活配置 */
  async function handleActivate(config: AiModelConfig) {
    try {
      await aiReviewApi.activateModelConfig(config.configId);
      message.success(`已启用「${config.providerName}」配置`);
      await loadConfigs();
    } catch (error) {
      if (usingFallback) {
        // 兼容模式:本地标记
        setConfigs((prev) =>
          prev.map((c) => ({
            ...c,
            status: c.configId === config.configId ? 'active' : 'inactive',
          })),
        );
        message.warning('已切换(兼容模式,后端未实现多配置激活接口)');
      } else {
        message.error(getApiErrorMessage(error, '启用失败'));
      }
    }
  }

  /** 删除配置 */
  async function handleDelete(config: AiModelConfig) {
    try {
      await aiReviewApi.deleteModelConfig(config.configId);
      message.success('配置已删除');
      await loadConfigs();
    } catch (error) {
      if (usingFallback) {
        setConfigs((prev) => prev.filter((c) => c.configId !== config.configId));
        message.warning('已删除(兼容模式)');
      } else {
        message.error(getApiErrorMessage(error, '删除失败'));
      }
    }
  }

  /** 获取模型列表 */
  async function handleFetchModels() {
    if (!form.apiBaseUrl.trim()) {
      message.warning('请先填写 API 请求地址');
      return;
    }
    if (!form.apiKey.trim() && !form.apiKeyMask) {
      message.warning('请先填写 API Key');
      return;
    }
    setFetchingModels(true);
    try {
      const result = await aiReviewApi.listProviderModels({
        apiBaseUrl: form.apiBaseUrl.trim(),
        useFullUrl: form.useFullUrl,
        apiKey: form.apiKey.trim() || undefined,
      });
      setModelIds(result.modelIds);
      if (result.modelIds.length === 0) {
        message.info('供应商返回了空模型列表，可手动填写');
      } else {
        message.success(`已获取 ${result.modelIds.length} 个模型`);
      }
    } catch (error) {
      message.error(getApiErrorMessage(error, '获取模型列表失败'));
    } finally {
      setFetchingModels(false);
    }
  }

  const update = useCallback((patch: Partial<ConfigFormValues>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  }, []);

  const apiKeyHint = useMemo(() => {
    if (form.apiKey) return '保存后将覆盖当前 API Key。';
    if (form.apiKeyMask) return `已保存密钥: ${form.apiKeyMask}。留空表示继续沿用。`;
    return '首次保存必须填写 API Key，后端会加密存储。';
  }, [form.apiKey, form.apiKeyMask]);

  return (
    <Space direction="vertical" size="large" className="page-stack">
      {/* 标题 */}
      <div className="page-title-row">
        <div className="model-settings-title">
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={handleBack}
            className="model-settings-back"
            aria-label="返回上一页"
          />
          <Space direction="vertical" size={4}>
            <Title level={3}>模型配置</Title>
            <Paragraph type="secondary" style={{ marginBottom: 0 }}>
              管理 AI 预审 Agent 使用的模型配置,支持多配置切换,点击「启用」激活目标配置。
            </Paragraph>
          </Space>
        </div>
        <Space>
          {usingFallback && <Tag color="gold">兼容模式 · 旧接口</Tag>}
          <Button icon={<ReloadOutlined />} onClick={() => void loadConfigs()} loading={loading}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建配置
          </Button>
        </Space>
      </div>

      {/* 配置卡片列表 */}
      {configs.length === 0 && !loading ? (
        <Card>
          <Empty description="暂无模型配置,请点击「新建配置」添加">
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新建配置
            </Button>
          </Empty>
        </Card>
      ) : (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {configs.map((config) => (
            <ModelConfigCard
              key={config.configId}
              config={config}
              isActive={config.status === 'active'}
              onActivate={() => void handleActivate(config)}
              onDuplicate={() => openDuplicate(config)}
              onEdit={() => openEdit(config)}
              onDelete={() => void handleDelete(config)}
            />
          ))}
        </Space>
      )}

      {/* 编辑 / 新建 Drawer */}
      <Drawer
        title={editing ? `编辑配置:${editing.providerName}` : '新建模型配置'}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={560}
        destroyOnClose
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => setDrawerOpen(false)}>取消</Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={saving}
              onClick={() => void handleSave()}
            >
              {editing ? '保存修改' : '创建配置'}
            </Button>
          </div>
        }
      >
        <Space direction="vertical" size={20} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            icon={<InfoCircleOutlined />}
            message="API Key 只会加密保存在后端，页面不会回显明文。留空保存表示沿用当前已保存密钥。"
          />

          <Row gutter={16}>
            <Col xs={24} md={12}>
              <div className="model-field">
                <label className="model-field-label">供应商名称 *</label>
                <Input
                  placeholder="例如: OpenAI / 豆包 / 自建网关"
                  value={form.providerName}
                  onChange={(e) => update({ providerName: e.target.value })}
                  prefix={<AiAssistantIcon style={{ color: '#94a3b8' }} />}
                />
              </div>
            </Col>
            <Col xs={24} md={12}>
              <div className="model-field">
                <label className="model-field-label">备注</label>
                <Input
                  placeholder="例如: 比赛测试额度"
                  value={form.notes}
                  onChange={(e) => update({ notes: e.target.value })}
                />
              </div>
            </Col>
          </Row>

          <div className="model-field">
            <label className="model-field-label">许可链接</label>
            <Input
              placeholder="https://example.com/license"
              value={form.licenseUrl}
              onChange={(e) => update({ licenseUrl: e.target.value })}
            />
          </div>

          <div className="model-field">
            <label className="model-field-label">
              <ApiOutlined /> API Key *
            </label>
            <Input.Password
              placeholder={form.apiKeyMask ? '留空表示沿用当前密钥' : '请输入 API Key'}
              value={form.apiKey}
              onChange={(e) => update({ apiKey: e.target.value })}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {apiKeyHint}
            </Text>
          </div>

          <div className="model-field">
            <div className="model-field-label-row">
              <label className="model-field-label">
                <ThunderboltOutlined /> API 请求地址 *
              </label>
              <Space size={8}>
                <Text type="secondary" style={{ fontSize: 12 }}>完整 URL</Text>
                <Switch
                  size="small"
                  checked={form.useFullUrl}
                  onChange={(checked) => update({ useFullUrl: checked })}
                />
              </Space>
            </div>
            <Input
              placeholder={form.useFullUrl ? 'https://your-api.com/v1/responses' : 'https://your-api.com/v1'}
              value={form.apiBaseUrl}
              onChange={(e) => update({ apiBaseUrl: e.target.value })}
            />
            <Alert
              type="warning"
              showIcon
              icon={<InfoCircleOutlined />}
              message={form.useFullUrl
                ? '完整 URL 模式:Agent 直接请求该地址;获取模型列表时推导 /models。'
                : '普通模式:Agent 请求 {API地址}/responses,模型列表请求 {API地址}/models。'}
              className="model-field-hint"
            />
          </div>

          <Row gutter={16}>
            <Col xs={24} md={12}>
              <div className="model-field">
                <div className="model-field-label-row">
                  <label className="model-field-label">模型名称 *</label>
                  <Button
                    type="link"
                    size="small"
                    icon={<ApiOutlined />}
                    loading={fetchingModels}
                    onClick={() => void handleFetchModels()}
                  >
                    获取模型列表
                  </Button>
                </div>
                <AutoComplete
                  showSearch
                  allowClear
                  placeholder="例如: gpt-5.5 / doubao-pro-32k"
                  value={form.modelName}
                  options={modelIds.map((id) => ({ label: id, value: id }))}
                  onSearch={(value) => update({ modelName: value })}
                  onChange={(value) => update({ modelName: value ?? '' })}
                  notFoundContent="可直接输入模型名"
                />
              </div>
            </Col>
            <Col xs={24} md={12}>
              <div className="model-field">
                <label className="model-field-label">推理强度</label>
                <Select
                  value={form.reasoningEffort}
                  options={[
                    { label: 'low', value: 'low' },
                    { label: 'medium', value: 'medium' },
                    { label: 'high', value: 'high' },
                    { label: 'xhigh', value: 'xhigh' },
                  ]}
                  onChange={(value) => update({ reasoningEffort: value })}
                />
              </div>
            </Col>
          </Row>

          <div className="model-field">
            <label className="model-field-label">Agent 并发数</label>
            <InputNumber
              min={1}
              max={10}
              precision={0}
              value={form.workerConcurrency}
              onChange={(value) => update({ workerConcurrency: value ?? 3 })}
              style={{ width: '100%' }}
              addonAfter="个 worker"
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              Agent 启动时读取该值并创建固定数量 worker；修改后需要重启 Agent 生效。
            </Text>
          </div>
        </Space>
      </Drawer>
    </Space>
  );
}

/* ============ 配置卡片 ============ */

function ModelConfigCard({
  config,
  isActive,
  onActivate,
  onDuplicate,
  onEdit,
  onDelete,
}: {
  config: AiModelConfig;
  isActive: boolean;
  onActivate: () => void;
  onDuplicate: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  // 取供应商名首字母做头像
  const avatar = (config.providerName || 'M').slice(0, 2).toUpperCase();

  return (
    <Card
      className={`model-config-card ${isActive ? 'is-active' : ''}`}
      hoverable={!isActive}
    >
      <div className="model-config-card-inner">
        {/* 左侧:头像 + 信息 */}
        <div className="model-config-card-left">
          <div className={`model-config-avatar ${isActive ? 'is-active' : ''}`}>
            {avatar}
          </div>
          <div className="model-config-info">
            <div className="model-config-name">
              <Text strong style={{ fontSize: 15 }}>{config.providerName}</Text>
              {isActive && (
                <Tag color="success" icon={<CheckCircleFilled />} style={{ marginLeft: 8, borderRadius: 999 }}>
                  当前启用
                </Tag>
              )}
              {config.notes && (
                <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                  {config.notes}
                </Text>
              )}
            </div>
            <div className="model-config-meta">
              <Text type="secondary" style={{ fontSize: 13 }}>
                {config.apiBaseUrl}
              </Text>
            </div>
            <div className="model-config-tags">
              <Tag color="blue" style={{ borderRadius: 999 }}>{config.modelName}</Tag>
              <Tag style={{ borderRadius: 999 }}>{config.reasoningEffort}</Tag>
              <Tag color="geekblue" style={{ borderRadius: 999 }}>
                并发 {config.workerConcurrency ?? 3}
              </Tag>
              {config.updatedAt && (
                <Text type="secondary" style={{ fontSize: 11 }}>
                  更新于 {config.updatedAt}
                </Text>
              )}
            </div>
          </div>
        </div>

        {/* 右侧:操作按钮 */}
        <div className="model-config-card-actions">
          {!isActive && (
            <Tooltip title="启用此配置">
              <Button
                type="primary"
                icon={<PlayCircleFilled />}
                onClick={onActivate}
              >
                启用
              </Button>
            </Tooltip>
          )}
          <Tooltip title="复制配置">
            <Button type="text" icon={<CopyOutlined />} onClick={onDuplicate} />
          </Tooltip>
          <Tooltip title="编辑">
            <Button type="text" icon={<EditOutlined />} onClick={onEdit} />
          </Tooltip>
          {!isActive && (
            <Popconfirm
              title="确认删除此配置?"
              description="删除后不可恢复,当前激活的配置不允许删除。"
              okText="删除"
              okButtonProps={{ danger: true }}
              cancelText="取消"
              onConfirm={onDelete}
            >
              <Tooltip title="删除">
                <Button type="text" danger icon={<DeleteOutlined />} />
              </Tooltip>
            </Popconfirm>
          )}
        </div>
      </div>
    </Card>
  );
}
