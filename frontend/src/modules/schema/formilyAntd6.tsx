import { CheckOutlined, ReloadOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useMemo, useState } from 'react';
import {
  Alert,
  App as AntdApp,
  Button,
  Checkbox,
  Input,
  Radio,
  Space,
  Tag,
  Typography,
} from 'antd';
import { useField } from '@formily/react';

import { labelerApi, type LlmTriggerStreamResult } from '../../api/labeler';
import type { SchemaField } from '../../types/schema';
import { formatDisplayValue, getValueByPath, isSubmittableField } from './schemaCompiler';

type ChoiceOption = { value: string; label: string };

interface BaseControlProps {
  value?: unknown;
  onChange?: (value: unknown) => void;
  disabled?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  maxLength?: number;
  options?: ChoiceOption[];
}

interface LlmTriggerControlProps extends BaseControlProps {
  fieldName?: string;
  assignmentId?: string;
  targetField?: string;
  promptTemplate?: string;
  contextPaths?: string[];
  buttonText?: string;
  allFields?: SchemaField[];
  currentAnswerJson?: Record<string, unknown>;
  previewMode?: boolean;
  onApplyLlmResult?: (fieldName: string, value: unknown) => void;
}

export const formilyAntd6Components = {
  FormItem,
  TextInput,
  TextAreaInput,
  RichTextInput,
  SingleChoice,
  MultiChoice,
  TagsChoice,
  JsonEditor,
  ShowItem,
  FileUpload,
  LlmTrigger,
  GroupContainer,
  TabContainer,
};

function FormItem({ children, helpText }: { children?: React.ReactNode; helpText?: string }) {
  const field = useField() as unknown as {
    title?: string;
    required?: boolean;
    selfErrors?: string[];
    errors?: string[];
    decoratorProps?: { helpText?: string };
  };
  const errors = field.selfErrors?.length ? field.selfErrors : field.errors ?? [];
  const help = helpText ?? field.decoratorProps?.helpText;
  return (
    <div className={`lh-formily-item ${errors.length ? 'has-error' : ''}`}>
      <div className="lh-formily-label">
        {field.title}
        {field.required && <span className="field-required">*</span>}
      </div>
      <div className="lh-formily-control">{children}</div>
      {help && <div className="lh-formily-help">{help}</div>}
      {errors.map((error) => (
        <div key={error} className="lh-formily-error">
          {error}
        </div>
      ))}
    </div>
  );
}

function TextInput(props: BaseControlProps) {
  return (
    <Input
      placeholder={props.placeholder}
      maxLength={props.maxLength}
      value={(props.value as string) ?? ''}
      disabled={props.disabled || props.readOnly}
      onChange={(event) => props.onChange?.(event.target.value)}
    />
  );
}

function TextAreaInput(props: BaseControlProps) {
  return (
    <Input.TextArea
      rows={3}
      placeholder={props.placeholder}
      maxLength={props.maxLength}
      value={(props.value as string) ?? ''}
      disabled={props.disabled || props.readOnly}
      onChange={(event) => props.onChange?.(event.target.value)}
    />
  );
}

function RichTextInput(props: BaseControlProps) {
  return (
    <Input.TextArea
      rows={5}
      placeholder={props.placeholder ?? '请输入富文本内容(MVP 暂用纯文本承载)'}
      value={(props.value as string) ?? ''}
      disabled={props.disabled || props.readOnly}
      onChange={(event) => props.onChange?.(event.target.value)}
    />
  );
}

function SingleChoice(props: BaseControlProps) {
  return (
    <Radio.Group
      value={props.value as string}
      disabled={props.disabled || props.readOnly}
      onChange={(event) => props.onChange?.(event.target.value)}
    >
      <Space wrap>
        {(props.options ?? []).map((option) => (
          <Radio.Button key={option.value} value={option.value}>
            {option.label}
          </Radio.Button>
        ))}
      </Space>
    </Radio.Group>
  );
}

function MultiChoice(props: BaseControlProps) {
  return (
    <Checkbox.Group
      value={(props.value as string[]) ?? []}
      disabled={props.disabled || props.readOnly}
      onChange={(values) => props.onChange?.(values)}
    >
      <Space wrap size={[8, 8]}>
        {(props.options ?? []).map((option) => (
          <Checkbox key={option.value} value={option.value}>
            {option.label}
          </Checkbox>
        ))}
      </Space>
    </Checkbox.Group>
  );
}

function TagsChoice(props: BaseControlProps) {
  const value = (props.value as string[]) ?? [];
  const disabled = props.disabled || props.readOnly;
  return (
    <Space wrap size={[8, 8]}>
      {(props.options ?? []).map((option) => {
        const checked = value.includes(option.value);
        return (
          <Tag.CheckableTag
            key={option.value}
            checked={checked}
            className={disabled ? 'answer-tag-readonly' : undefined}
            onChange={(nextChecked) => {
              if (disabled) return;
              props.onChange?.(
                nextChecked
                  ? Array.from(new Set([...value, option.value]))
                  : value.filter((item) => item !== option.value),
              );
            }}
          >
            {option.label}
          </Tag.CheckableTag>
        );
      })}
    </Space>
  );
}

function JsonEditor(props: BaseControlProps) {
  return (
    <Input.TextArea
      rows={6}
      placeholder={props.placeholder ?? '{ "key": "value" }'}
      value={(props.value as string) ?? ''}
      disabled={props.disabled || props.readOnly}
      style={{ fontFamily: 'monospace' }}
      onChange={(event) => props.onChange?.(event.target.value)}
    />
  );
}

function ShowItem({
  sourcePath,
  showText,
  rawPayload,
}: {
  sourcePath?: string;
  showText?: string;
  rawPayload?: Record<string, unknown>;
}) {
  const sourceValue = sourcePath ? getValueByPath(rawPayload, sourcePath) : undefined;
  const text = formatDisplayValue(sourceValue ?? showText ?? '');
  return (
    <div className="answer-field-show">
      <div className="answer-show-text">
        {text || <Typography.Text type="secondary">(暂无展示内容)</Typography.Text>}
      </div>
      {sourcePath && <Tag className="answer-show-tag">raw.{sourcePath}</Tag>}
    </div>
  );
}

function FileUpload(props: BaseControlProps) {
  return (
    <Input
      value={(props.value as string) ?? ''}
      placeholder={props.placeholder ?? '文件上传组件占位,后续接入文件服务'}
      disabled={props.disabled || props.readOnly}
      onChange={(event) => props.onChange?.(event.target.value)}
    />
  );
}

function LlmTrigger(props: LlmTriggerControlProps) {
  const { message, modal } = AntdApp.useApp();
  const disabled = props.disabled || props.readOnly;
  const targetFieldName = typeof props.targetField === 'string' ? props.targetField.trim() : '';
  const targetField = useMemo(
    () =>
      (props.allFields ?? []).find(
        (field) => field.fieldName === targetFieldName && isSubmittableField(field),
      ),
    [props.allFields, targetFieldName],
  );
  const [generating, setGenerating] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [result, setResult] = useState<LlmTriggerStreamResult | null>(null);
  const [error, setError] = useState('');
  const buttonText = typeof props.buttonText === 'string' && props.buttonText.trim()
    ? props.buttonText.trim()
    : '生成建议';

  const handleGenerate = async () => {
    if (disabled) return;
    if (props.previewMode || !props.assignmentId) {
      message.info('预览环境不调用模型');
      return;
    }
    if (!props.fieldName || !targetFieldName || !targetField) {
      message.warning('请先配置 LLM 触发组件的目标字段');
      return;
    }
    setGenerating(true);
    setStreamText('');
    setResult(null);
    setError('');
    try {
      await labelerApi.streamLlmTrigger(
        props.assignmentId,
        {
          triggerFieldName: props.fieldName,
          targetFieldName,
          currentAnswerJson: props.currentAnswerJson ?? {},
        },
        {
          onDelta: (delta) => setStreamText((prev) => prev + delta),
          onResult: (nextResult) => {
            setResult(nextResult);
            setStreamText((prev) => nextResult.displayText || prev);
          },
          onError: (nextError) => setError(nextError.message || 'LLM 生成失败'),
        },
      );
    } catch (nextError) {
      const messageText = nextError instanceof Error ? nextError.message : 'LLM 生成失败';
      setError(messageText);
      message.error(messageText);
    } finally {
      setGenerating(false);
    }
  };

  const applyResult = () => {
    if (!result) return;
    const apply = () => {
      props.onApplyLlmResult?.(result.targetFieldName, result.normalizedValue);
      message.success('已应用到目标字段');
    };
    if (hasAnswerValue(props.currentAnswerJson?.[result.targetFieldName])) {
      modal.confirm({
        title: '覆盖当前字段值?',
        content: `目标字段「${targetField?.label ?? result.targetFieldName}」已有内容,应用后会覆盖当前值。`,
        okText: '覆盖并应用',
        cancelText: '取消',
        onOk: apply,
      });
      return;
    }
    apply();
  };

  return (
    <div className="lh-llm-trigger">
      <Space wrap className="lh-llm-trigger-actions">
        <Button
          type="primary"
          icon={<ThunderboltOutlined />}
          loading={generating}
          disabled={disabled}
          onClick={() => void handleGenerate()}
        >
          {buttonText}
        </Button>
        {result && (
          <Button icon={<CheckOutlined />} disabled={disabled} onClick={applyResult}>
            应用到字段
          </Button>
        )}
        {(streamText || result || error) && (
          <Button
            icon={<ReloadOutlined />}
            disabled={disabled || generating}
            onClick={() => void handleGenerate()}
          >
            重新生成
          </Button>
        )}
      </Space>
      <div className="lh-llm-trigger-meta">
        目标字段:{' '}
        {targetField ? `${targetField.label} (${targetField.fieldName})` : targetFieldName || '未配置'}
      </div>
      {props.previewMode && (
        <Alert
          className="lh-llm-trigger-alert"
          type="info"
          showIcon
          message="预览环境不调用模型"
        />
      )}
      {streamText && (
        <div className="lh-llm-trigger-output">
          <Typography.Text>{streamText}</Typography.Text>
        </div>
      )}
      {result && (
        <div className="lh-llm-trigger-normalized">
          <Typography.Text type="secondary">
            规范化值: {formatDisplayValue(result.normalizedValue)}
          </Typography.Text>
        </div>
      )}
      {error && (
        <Alert
          className="lh-llm-trigger-alert"
          type="error"
          showIcon
          message={error}
        />
      )}
    </div>
  );
}

function hasAnswerValue(value: unknown) {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function GroupContainer() {
  return <div className="lh-formily-layout-placeholder">分组容器</div>;
}

function TabContainer() {
  return <div className="lh-formily-layout-placeholder">多 Tab 布局容器</div>;
}
