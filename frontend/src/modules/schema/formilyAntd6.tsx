import { ThunderboltOutlined } from '@ant-design/icons';
import {
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

import { formatDisplayValue, getValueByPath } from './schemaCompiler';

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

function LlmTrigger(props: BaseControlProps) {
  const { message } = AntdApp.useApp();
  return (
    <Space.Compact style={{ width: '100%' }}>
      <Input
        value={(props.value as string) ?? ''}
        placeholder={props.placeholder ?? 'AI 生成结果会写入此字段'}
        disabled={props.disabled || props.readOnly}
        onChange={(event) => props.onChange?.(event.target.value)}
      />
      <Button
        icon={<ThunderboltOutlined />}
        disabled={props.disabled || props.readOnly}
        onClick={() => {
          message.info('LLM 触发组件已预留,真实模型调用将在 AI Agent 阶段接入。');
        }}
      >
        生成
      </Button>
    </Space.Compact>
  );
}

function GroupContainer() {
  return <div className="lh-formily-layout-placeholder">分组容器</div>;
}

function TabContainer() {
  return <div className="lh-formily-layout-placeholder">多 Tab 布局容器</div>;
}
