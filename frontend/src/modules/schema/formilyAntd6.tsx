import { CheckOutlined, ReloadOutlined, ThunderboltOutlined, UploadOutlined } from '@ant-design/icons';
import { useContext, useMemo, useState } from 'react';
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
  Upload,
} from 'antd';
import type { UploadFile, UploadProps } from 'antd';
import { useField } from '@formily/react';

import { attachmentApi } from '../../api/attachments';
import { labelerApi, type LlmTriggerFieldResult, type LlmTriggerStreamResult } from '../../api/labeler';
import type { SchemaField } from '../../types/schema';
import { AttachmentDisplayList, normalizeAttachmentValue } from './AttachmentDisplay';
import { formatDisplayValue, getValueByPath, isSubmittableField } from './schemaCompiler';
import {
  EMPTY_LLM_TRIGGER_STATE,
  LlmTriggerStateContext,
  type LlmTriggerStateUpdater,
  type LlmTriggerUiState,
} from './llmTriggerState';
import { RichTextEditor } from './RichTextEditor';

type ChoiceOption = { value: string; label: string };

interface BaseControlProps {
  value?: unknown;
  onChange?: (value: unknown) => void;
  disabled?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  maxLength?: number;
  options?: ChoiceOption[];
  fieldName?: string;
  assignmentId?: string;
  previewMode?: boolean;
}

interface LlmTriggerControlProps extends BaseControlProps {
  fieldName?: string;
  assignmentId?: string;
  targetField?: string;
  targetFields?: string[];
  promptTemplate?: string;
  contextPaths?: string[];
  buttonText?: string;
  allFields?: SchemaField[];
  currentAnswerJson?: Record<string, unknown>;
  previewMode?: boolean;
  llmTriggerState?: LlmTriggerUiState;
  onUpdateLlmTriggerState?: (updater: LlmTriggerStateUpdater) => void;
  onApplyLlmResult?: (fieldName: string, value: unknown) => void;
  onApplyLlmResults?: (values: Record<string, unknown>) => void;
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
    <RichTextEditor
      rows={6}
      placeholder={props.placeholder}
      maxLength={props.maxLength}
      value={(props.value as string) ?? ''}
      disabled={props.disabled}
      readOnly={props.readOnly}
      onChange={(next) => props.onChange?.(next)}
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
  const { message } = AntdApp.useApp();
  const [transientFiles, setTransientFiles] = useState<UploadFile[]>([]);
  const { attachments, legacyText } = normalizeAttachmentValue(props.value);
  const readonly = props.disabled || props.readOnly;
  const uploadDisabled = readonly || props.previewMode || !props.assignmentId || !props.fieldName;

  const updateTransient = (uid: string, patch: Partial<UploadFile>) => {
    setTransientFiles((items) =>
      items.map((item) => (item.uid === uid ? { ...item, ...patch } : item)),
    );
  };

  const removeTransient = (uid: string) => {
    setTransientFiles((items) => items.filter((item) => item.uid !== uid));
  };

  const appendAttachment = (attachment: unknown) => {
    const current = normalizeAttachmentValue(props.value).attachments;
    props.onChange?.([...current, attachment]);
  };

  const uploadOne = async (file: File & { uid?: string }) => {
    const uid = file.uid ?? `${Date.now()}-${file.name}`;
    setTransientFiles((items) => [
      ...items.filter((item) => item.uid !== uid),
      { uid, name: file.name, status: 'uploading' },
    ]);
    try {
      const attachment = await attachmentApi.uploadAssignmentAttachment(
        props.assignmentId!,
        props.fieldName!,
        file,
      );
      appendAttachment(attachment);
      removeTransient(uid);
      message.success('附件上传成功');
    } catch (error) {
      updateTransient(uid, {
        status: 'error',
        response: error instanceof Error ? error.message : '附件上传失败',
        originFileObj: file,
      } as Partial<UploadFile>);
      message.error(error instanceof Error ? error.message : '附件上传失败');
    }
  };

  const customRequest: UploadProps['customRequest'] = ({ file }) => {
    void uploadOne(file as File & { uid?: string });
  };

  const beforeUpload: UploadProps['beforeUpload'] = (file) => {
    const pendingCount = transientFiles.filter((item) => item.status === 'uploading').length;
    if (attachments.length + pendingCount >= 5) {
      message.warning('每个字段最多上传 5 个附件');
      return Upload.LIST_IGNORE;
    }
    if (file.size > 20 * 1024 * 1024) {
      message.warning('单个附件不能超过 20MB');
      return Upload.LIST_IGNORE;
    }
    return true;
  };

  const handleRemove = (fileId: string) => {
    props.onChange?.(attachments.filter((attachment) => attachment.fileId !== fileId));
  };

  return (
    <div className="lh-file-upload">
      <Upload
        multiple
        disabled={uploadDisabled}
        showUploadList={false}
        customRequest={customRequest}
        beforeUpload={beforeUpload}
      >
        <Button icon={<UploadOutlined />} disabled={uploadDisabled}>
          上传文件 / 图片
        </Button>
      </Upload>
      {props.previewMode && (
        <Typography.Text type="secondary" className="lh-file-upload-hint">
          模板预览模式不执行真实上传
        </Typography.Text>
      )}
      {!props.previewMode && !props.assignmentId && (
        <Typography.Text type="secondary" className="lh-file-upload-hint">
          缺少作业上下文，暂不能上传
        </Typography.Text>
      )}
      <AttachmentDisplayList
        value={legacyText ? props.value : attachments}
        assignmentId={props.assignmentId}
        onRemove={readonly ? undefined : handleRemove}
      />
      {transientFiles.length > 0 && (
        <div className="lh-attachment-list">
          {transientFiles.map((file) => (
            <div key={file.uid} className={`lh-attachment-item is-${file.status}`}>
              <div className="lh-attachment-thumb">
                <UploadOutlined />
              </div>
              <div className="lh-attachment-main">
                <div className="lh-attachment-name" title={file.name}>
                  {file.name}
                </div>
                <div className="lh-attachment-meta">
                  {file.status === 'error' ? String(file.response ?? '上传失败') : '上传中...'}
                </div>
              </div>
              {file.status === 'error' && file.originFileObj && (
                <Button
                  size="small"
                  onClick={() => void uploadOne(file.originFileObj as File & { uid?: string })}
                >
                  重试
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LlmTrigger(props: LlmTriggerControlProps) {
  const { message, modal } = AntdApp.useApp();
  const disabled = props.disabled || props.readOnly;
  const sharedState = useContext(LlmTriggerStateContext);
  const targetFieldNames = useMemo(
    () => resolveLlmTargetFieldNames(props.targetFields, props.targetField),
    [props.targetFields, props.targetField],
  );
  const targetFields = useMemo(
    () =>
      targetFieldNames
        .map((fieldName) =>
          (props.allFields ?? []).find(
            (field) => field.fieldName === fieldName && isSubmittableField(field),
          ),
        )
        .filter((field): field is SchemaField => Boolean(field)),
    [props.allFields, targetFieldNames],
  );
  const contextState = props.fieldName ? sharedState?.states[props.fieldName] : undefined;
  const triggerState = contextState ?? props.llmTriggerState ?? EMPTY_LLM_TRIGGER_STATE;
  const generating = triggerState.generating;
  const streamText = triggerState.streamText;
  const result = triggerState.result;
  const error = triggerState.error;
  const updateTriggerState = (updater: LlmTriggerStateUpdater) => {
    if (props.fieldName && sharedState) {
      sharedState.updateState(props.fieldName, updater);
      return;
    }
    props.onUpdateLlmTriggerState?.(updater);
  };
  const buttonText = typeof props.buttonText === 'string' && props.buttonText.trim()
    ? props.buttonText.trim()
    : '生成建议';

  const handleGenerate = async () => {
    if (disabled) return;
    if (props.previewMode || !props.assignmentId) {
      message.info('预览环境不调用模型');
      return;
    }
    if (!props.fieldName || targetFieldNames.length === 0 || targetFields.length !== targetFieldNames.length) {
      message.warning('请先配置 LLM 触发组件的目标字段');
      return;
    }
    updateTriggerState({
      generating: true,
      streamText: '',
      result: null,
      error: '',
    });
    try {
      await labelerApi.streamLlmTrigger(
        props.assignmentId,
        {
          triggerFieldName: props.fieldName,
          targetFieldName: targetFieldNames.length === 1 ? targetFieldNames[0] : undefined,
          targetFieldNames,
          currentAnswerJson: props.currentAnswerJson ?? {},
        },
        {
          onDelta: (delta) =>
            updateTriggerState((prev) => ({ ...prev, streamText: prev.streamText + delta })),
          onResult: (nextResult) => {
            updateTriggerState((prev) => ({
              ...prev,
              result: nextResult,
              streamText: nextResult.displayText || prev.streamText,
            }));
          },
          onError: (nextError) =>
            updateTriggerState((prev) => ({
              ...prev,
              error: nextError.message || 'LLM 生成失败',
            })),
        },
      );
    } catch (nextError) {
      const messageText = nextError instanceof Error ? nextError.message : 'LLM 生成失败';
      updateTriggerState((prev) => ({ ...prev, error: messageText }));
      message.error(messageText);
    } finally {
      updateTriggerState((prev) => ({ ...prev, generating: false }));
    }
  };

  const resultFields = normalizeLlmResultFields(result);
  const targetFieldLabel = (fieldName: string) => {
    const field = targetFields.find((item) => item.fieldName === fieldName);
    return field ? `${field.label} (${field.fieldName})` : fieldName;
  };
  const targetFieldByName = (fieldName: string) =>
    targetFields.find((item) => item.fieldName === fieldName);
  const applyResults = (items: LlmTriggerFieldResult[]) => {
    if (items.length === 0) return;
    const patch = Object.fromEntries(
      items.map((item) => [item.targetFieldName, item.normalizedValue]),
    );
    const overwritten = items.filter((item) =>
      hasAnswerValue(props.currentAnswerJson?.[item.targetFieldName]),
    );
    const apply = () => {
      props.onApplyLlmResults?.(patch);
      if (!props.onApplyLlmResults) {
        items.forEach((item) => props.onApplyLlmResult?.(item.targetFieldName, item.normalizedValue));
      }
      message.success(items.length > 1 ? '已应用到多个目标字段' : '已应用到目标字段');
    };
    if (overwritten.length > 0) {
      modal.confirm({
        title: '覆盖当前字段值?',
        content: `以下字段已有内容,应用后会覆盖当前值: ${overwritten
          .map((item) => targetFieldLabel(item.targetFieldName))
          .join('、')}`,
        okText: '覆盖并应用',
        cancelText: '取消',
        onOk: apply,
      });
      return;
    }
    apply();
  };

  const applyAllResults = () => {
    if (!result) return;
    applyResults(resultFields);
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
        {result && resultFields.length > 0 && (
          <Button icon={<CheckOutlined />} disabled={disabled} onClick={applyAllResults}>
            {resultFields.length > 1 ? '应用全部' : '应用到字段'}
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
        {targetFields.length > 0
          ? targetFields.map((field) => `${field.label} (${field.fieldName})`).join('、')
          : targetFieldNames.join('、') || '未配置'}
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
        <div className="lh-llm-trigger-results">
          {resultFields.map((item) => (
            <div key={item.targetFieldName} className="lh-llm-trigger-result-item">
              <div className="lh-llm-trigger-result-head">
                <Typography.Text strong>{targetFieldLabel(item.targetFieldName)}</Typography.Text>
                <Button
                  size="small"
                  icon={<CheckOutlined />}
                  disabled={disabled}
                  onClick={() => applyResults([item])}
                >
                  应用此字段
                </Button>
              </div>
              {item.displayText && (
                <Typography.Text className="lh-llm-trigger-result-text">
                  {item.displayText}
                </Typography.Text>
              )}
              <div className="lh-llm-trigger-normalized">
                <Typography.Text type="secondary">
                  建议值: {displayLlmResultValue(item, targetFieldByName(item.targetFieldName))}
                </Typography.Text>
              </div>
            </div>
          ))}
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

function resolveLlmTargetFieldNames(targetFields?: string[], legacyTargetField?: string) {
  const result: string[] = [];
  const add = (value?: string) => {
    const next = typeof value === 'string' ? value.trim() : '';
    if (next && !result.includes(next)) {
      result.push(next);
    }
  };
  (targetFields ?? []).forEach(add);
  add(legacyTargetField);
  return result;
}

function normalizeLlmResultFields(result: LlmTriggerStreamResult | null): LlmTriggerFieldResult[] {
  if (!result) return [];
  if (Array.isArray(result.results) && result.results.length > 0) {
    return result.results;
  }
  if (result.targetFieldName) {
    return [
      {
        targetFieldName: result.targetFieldName,
        targetSemanticType: result.targetSemanticType ?? 'text',
        displayText: result.displayText,
        normalizedValue: result.normalizedValue,
        normalizedDisplayValue: result.normalizedDisplayValue,
      },
    ];
  }
  return [];
}

function displayLlmResultValue(item: LlmTriggerFieldResult, targetField?: SchemaField) {
  if (item.normalizedDisplayValue && item.normalizedDisplayValue.trim()) {
    return item.normalizedDisplayValue;
  }
  if (!targetField?.options?.length) {
    return formatDisplayValue(item.normalizedValue);
  }
  if (item.targetSemanticType === 'single_choice') {
    const raw = String(item.normalizedValue ?? '');
    return targetField.options.find((option) => option.value === raw)?.label ?? raw;
  }
  if (item.targetSemanticType === 'multi_choice' || item.targetSemanticType === 'tags') {
    const values = Array.isArray(item.normalizedValue) ? item.normalizedValue : [item.normalizedValue];
    return values
      .map((value) => {
        const raw = String(value ?? '');
        return targetField.options?.find((option) => option.value === raw)?.label ?? raw;
      })
      .filter(Boolean)
      .join('、');
  }
  return formatDisplayValue(item.normalizedValue);
}

function GroupContainer() {
  return <div className="lh-formily-layout-placeholder">分组容器</div>;
}

function TabContainer() {
  return <div className="lh-formily-layout-placeholder">多 Tab 布局容器</div>;
}
