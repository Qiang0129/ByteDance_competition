import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ApiOutlined,
  InfoCircleOutlined,
  RobotOutlined,
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
  Input,
  Row,
  Select,
  Space,
  Switch,
  Typography,
} from 'antd';

import { aiReviewApi } from '../../api/aiReview';
import { getApiErrorMessage } from '../../api/client';
import type { AiModelConfig, AiModelConfigRequest } from '../../types/aiReview';

const { Paragraph, Text, Title } = Typography;

interface ModelConfigForm {
  providerName: string;
  notes: string;
  licenseUrl: string;
  apiKey: string;
  apiBaseUrl: string;
  useFullUrl: boolean;
  modelName: string;
  reasoningEffort: AiModelConfigRequest['reasoningEffort'];
  wireApi: AiModelConfigRequest['wireApi'];
  apiKeyMask?: string;
}

const DEFAULT_CONFIG: ModelConfigForm = {
  providerName: '',
  notes: '',
  licenseUrl: '',
  apiKey: '',
  apiBaseUrl: '',
  useFullUrl: false,
  modelName: '',
  reasoningEffort: 'high',
  wireApi: 'responses',
};

function toFormConfig(config: AiModelConfig | null): ModelConfigForm {
  if (!config) return DEFAULT_CONFIG;
  return {
    providerName: config.providerName ?? '',
    notes: config.notes ?? '',
    licenseUrl: config.licenseUrl ?? '',
    apiKey: '',
    apiBaseUrl: config.apiBaseUrl ?? '',
    useFullUrl: config.useFullUrl ?? false,
    modelName: config.modelName ?? '',
    reasoningEffort: config.reasoningEffort ?? 'high',
    wireApi: config.wireApi ?? 'responses',
    apiKeyMask: config.apiKeyMask,
  };
}

export default function ModelSettings() {
  const { message } = AntdApp.useApp();
  const [config, setConfig] = useState<ModelConfigForm>(DEFAULT_CONFIG);
  const [savedConfig, setSavedConfig] = useState<AiModelConfig | null>(null);
  const [modelIds, setModelIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [dirty, setDirty] = useState(false);

  const apiKeyHint = useMemo(() => {
    if (config.apiKey) return '保存后将覆盖当前 API Key。';
    if (config.apiKeyMask) return `已保存密钥: ${config.apiKeyMask}。留空表示继续沿用。`;
    return '首次保存必须填写 API Key，后端会加密存储，不回显明文。';
  }, [config.apiKey, config.apiKeyMask]);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const result = await aiReviewApi.getModelConfig();
      setSavedConfig(result);
      setConfig(toFormConfig(result));
      setDirty(false);
    } catch (error) {
      message.error(getApiErrorMessage(error, '模型配置加载失败'));
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const update = useCallback((patch: Partial<ModelConfigForm>) => {
    setConfig((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  }, []);

  async function handleSave() {
    const payload: AiModelConfigRequest = {
      providerName: config.providerName.trim(),
      notes: config.notes.trim() || undefined,
      licenseUrl: config.licenseUrl.trim() || undefined,
      apiBaseUrl: config.apiBaseUrl.trim(),
      useFullUrl: config.useFullUrl,
      modelName: config.modelName.trim(),
      reasoningEffort: config.reasoningEffort,
      wireApi: 'responses',
      apiKey: config.apiKey.trim() || undefined,
    };

    if (!payload.providerName || !payload.apiBaseUrl || !payload.modelName) {
      message.warning('请填写供应商名称、API 地址和模型名称');
      return;
    }
    if (!payload.apiKey && !config.apiKeyMask) {
      message.warning('首次保存必须填写 API Key');
      return;
    }

    setSaving(true);
    try {
      const saved = await aiReviewApi.saveModelConfig(payload);
      setSavedConfig(saved);
      setConfig(toFormConfig(saved));
      setDirty(false);
      message.success('配置已保存，Agent 下一次领取 Job 时生效');
    } catch (error) {
      message.error(getApiErrorMessage(error, '模型配置保存失败'));
    } finally {
      setSaving(false);
    }
  }

  async function handleFetchModels() {
    if (!config.apiBaseUrl.trim()) {
      message.warning('请先填写 API 请求地址');
      return;
    }
    if (!config.apiKey.trim() && !config.apiKeyMask) {
      message.warning('请先填写 API Key，或先保存一份带密钥的配置');
      return;
    }

    setFetchingModels(true);
    try {
      const result = await aiReviewApi.listProviderModels({
        apiBaseUrl: config.apiBaseUrl.trim(),
        useFullUrl: config.useFullUrl,
        apiKey: config.apiKey.trim() || undefined,
      });
      setModelIds(result.modelIds);
      if (result.modelIds.length === 0) {
        message.info('供应商返回了空模型列表，可手动填写模型名');
      } else {
        message.success(`已获取 ${result.modelIds.length} 个模型`);
      }
    } catch (error) {
      message.error(getApiErrorMessage(error, '获取模型列表失败'));
    } finally {
      setFetchingModels(false);
    }
  }

  return (
    <Space direction="vertical" size="large" className="page-stack">
      <div className="page-title-row">
        <Space direction="vertical" size={4}>
          <Title level={3}>模型配置</Title>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            配置 AI 预审 Agent 使用的 OpenAI-compatible Responses API。只有 Owner 和 AI Reviewer 可修改。
          </Paragraph>
        </Space>
        <Space>
          {savedConfig?.updatedAt ? (
            <Text type="secondary">最近更新: {savedConfig.updatedAt}</Text>
          ) : null}
          <Button onClick={() => void loadConfig()} loading={loading}>
            重新加载
          </Button>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            disabled={!dirty}
            loading={saving}
            onClick={() => void handleSave()}
          >
            保存配置
          </Button>
        </Space>
      </div>

      <Card className="model-settings-card" loading={loading}>
        <Space direction="vertical" size={24} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            icon={<InfoCircleOutlined />}
            message="API Key 只会加密保存在后端，页面不会回显明文。留空保存表示沿用当前已保存密钥。"
          />

          <Row gutter={16}>
            <Col xs={24} md={12}>
              <div className="model-field">
                <label className="model-field-label">供应商名称</label>
                <Input
                  placeholder="例如: OpenAI-compatible 网关"
                  value={config.providerName}
                  onChange={(event) => update({ providerName: event.target.value })}
                  prefix={<RobotOutlined style={{ color: '#94a3b8' }} />}
                />
              </div>
            </Col>
            <Col xs={24} md={12}>
              <div className="model-field">
                <label className="model-field-label">备注</label>
                <Input
                  placeholder="例如: 比赛测试额度"
                  value={config.notes}
                  onChange={(event) => update({ notes: event.target.value })}
                />
              </div>
            </Col>
          </Row>

          <div className="model-field">
            <label className="model-field-label">许可链接</label>
            <Input
              placeholder="https://example.com/license"
              value={config.licenseUrl}
              onChange={(event) => update({ licenseUrl: event.target.value })}
            />
          </div>

          <div className="model-field">
            <label className="model-field-label">
              <ApiOutlined /> API Key
            </label>
            <Input.Password
              placeholder={config.apiKeyMask ? '留空表示沿用当前密钥' : '请输入 API Key'}
              value={config.apiKey}
              onChange={(event) => update({ apiKey: event.target.value })}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {apiKeyHint}
            </Text>
          </div>

          <div className="model-field">
            <div className="model-field-label-row">
              <label className="model-field-label">
                <ThunderboltOutlined /> API 请求地址
              </label>
              <Space size={8}>
                <Text type="secondary" style={{ fontSize: 12 }}>完整 URL</Text>
                <Switch
                  size="small"
                  checked={config.useFullUrl}
                  onChange={(checked) => update({ useFullUrl: checked })}
                />
              </Space>
            </div>
            <Input
              placeholder={config.useFullUrl ? 'https://your-api.com/v1/responses' : 'https://your-api.com/v1'}
              value={config.apiBaseUrl}
              onChange={(event) => update({ apiBaseUrl: event.target.value })}
            />
            <Alert
              type="warning"
              showIcon
              icon={<InfoCircleOutlined />}
              message={config.useFullUrl
                ? '完整 URL 模式下，Agent 会直接请求该地址；获取模型列表时会尝试推导 /models。'
                : '普通模式下，Agent 会请求 {API地址}/responses，模型列表请求 {API地址}/models。'}
              className="model-field-hint"
            />
          </div>

          <Row gutter={16}>
            <Col xs={24} md={12}>
              <div className="model-field">
                <div className="model-field-label-row">
                  <label className="model-field-label">模型名称</label>
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
                  placeholder="例如: gpt-5.5"
                  value={config.modelName}
                  options={modelIds.map((modelId) => ({ label: modelId, value: modelId }))}
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
                  value={config.reasoningEffort}
                  options={[
                    { label: 'minimal', value: 'minimal' },
                    { label: 'low', value: 'low' },
                    { label: 'medium', value: 'medium' },
                    { label: 'high', value: 'high' },
                  ]}
                  onChange={(value) => update({ reasoningEffort: value })}
                />
              </div>
            </Col>
          </Row>
        </Space>
      </Card>
    </Space>
  );
}
