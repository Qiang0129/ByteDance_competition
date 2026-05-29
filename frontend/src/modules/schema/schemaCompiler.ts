import type { SchemaField, SchemaReactionRule } from '../../types/schema';
import { normalizeValidators, SUBMITTABLE_KINDS } from './schemaValidation';

export interface RuntimeRuleState {
  visible: Record<string, boolean>;
  required: Record<string, boolean>;
}

export interface CompileOptions {
  rawPayload?: Record<string, unknown>;
  values?: Record<string, unknown>;
  readonly?: boolean;
}

export function getValueByPath(source: unknown, path?: string): unknown {
  if (!path || source == null) return undefined;
  const segments = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .map((item) => item.trim())
    .filter(Boolean);
  let current: unknown = source;
  for (const segment of segments) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function formatDisplayValue(value: unknown): string {
  if (value == null || value === '') return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value, null, 2);
}

export function resolveRuntimeRules(
  fields: SchemaField[],
  values: Record<string, unknown>,
): RuntimeRuleState {
  const visible = Object.fromEntries(fields.map((field) => [field.fieldName, true]));
  const required = Object.fromEntries(fields.map((field) => [field.fieldName, !!field.required]));
  const fieldRequired = Object.fromEntries(fields.map((field) => [field.fieldName, !!field.required]));

  fields.forEach((field) => {
    (field.reactions ?? []).forEach((rule) => {
      if (!rule.targetField) return;
      if (isDisplayRequiredAction(rule.action)) {
        visible[rule.targetField] = false;
        required[rule.targetField] = fieldRequired[rule.targetField] ?? false;
      }
    });
  });

  fields.forEach((field) => {
    (field.reactions ?? []).forEach((rule) => {
      if (!rule.targetField) return;
      const sourceField = findField(fields, rule.sourceField);
      if (!matchesRule(rule, values[rule.sourceField], sourceField)) return;
      switch (rule.action) {
        case 'visible':
          visible[rule.targetField] = true;
          break;
        case 'hidden':
          visible[rule.targetField] = false;
          required[rule.targetField] = fieldRequired[rule.targetField] ?? false;
          break;
        case 'visibleRequired':
        case 'required':
          visible[rule.targetField] = true;
          required[rule.targetField] = true;
          break;
        case 'optional':
          required[rule.targetField] = false;
          break;
      }
    });
  });

  return { visible, required };
}

export function filterVisibleAnswer(
  fields: SchemaField[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const ruleState = resolveRuntimeRules(fields, values);
  const next: Record<string, unknown> = {};
  fields.forEach((field) => {
    if (!field.fieldName || !SUBMITTABLE_KINDS.has(field.kind)) return;
    if (ruleState.visible[field.fieldName] === false) return;
    if (Object.prototype.hasOwnProperty.call(values, field.fieldName)) {
      next[field.fieldName] = values[field.fieldName];
    }
  });
  return next;
}

export function compileToFormilySchema(fields: SchemaField[], options: CompileOptions = {}) {
  const rawPayload = options.rawPayload ?? {};
  const values = options.values ?? {};
  const ruleState = resolveRuntimeRules(fields, values);
  const properties: Record<string, unknown> = {};

  fields.forEach((field, index) => {
    if (!field.fieldName) return;
    if (ruleState.visible[field.fieldName] === false) return;
    properties[field.fieldName] = toFormilyFieldSchema(field, index, rawPayload, ruleState, options);
  });

  return {
    type: 'object',
    properties,
  };
}

export function normalizeSchemaFields(fields: SchemaField[]): SchemaField[] {
  return fields.map((field) => ({
    ...field,
    reactions: (field.reactions ?? []).map((rule) => {
      const sourceField = findField(fields, rule.sourceField);
      return {
        ...rule,
        action: isDisplayRequiredAction(rule.action) ? 'visibleRequired' : rule.action,
        value: normalizeReactionValue(rule.value, sourceField),
      };
    }),
  }));
}

function toFormilyFieldSchema(
  field: SchemaField,
  index: number,
  rawPayload: Record<string, unknown>,
  ruleState: RuntimeRuleState,
  options: CompileOptions,
) {
  const visible = ruleState.visible[field.fieldName] !== false;
  const required = ruleState.required[field.fieldName] ?? !!field.required;
  const baseProps = {
    ...(field.componentProps ?? {}),
    placeholder: field.placeholder,
    maxLength: field.maxLength,
    options: field.options,
    disabled: options.readonly,
    readOnly: options.readonly,
    sourcePath: field.sourcePath,
    showText: field.showText,
    rawPayload,
  };

  return {
    type: inferValueType(field),
    title: field.label || field.fieldName || `字段 ${index + 1}`,
    required,
    default: field.defaultValue,
    'x-index': index,
    'x-visible': visible,
    'x-decorator': 'FormItem',
    'x-decorator-props': {
      helpText: field.helpText,
      kind: field.kind,
    },
    'x-component': componentName(field),
    'x-component-props': baseProps,
    'x-validator': toFormilyValidators(field),
  };
}

function inferValueType(field: SchemaField) {
  if (field.kind === 'multi-choice' || field.kind === 'tags') return 'array';
  if (field.kind === 'json-editor') return 'string';
  if (!SUBMITTABLE_KINDS.has(field.kind)) return 'void';
  return 'string';
}

function componentName(field: SchemaField) {
  switch (field.kind) {
    case 'text-single':
      return 'TextInput';
    case 'text-multi':
      return 'TextAreaInput';
    case 'rich-text':
      return 'RichTextInput';
    case 'single-choice':
      return 'SingleChoice';
    case 'multi-choice':
      return 'MultiChoice';
    case 'tags':
      return 'TagsChoice';
    case 'json-editor':
      return 'JsonEditor';
    case 'file-upload':
      return 'FileUpload';
    case 'llm-trigger':
      return 'LlmTrigger';
    case 'show-item':
      return 'ShowItem';
    case 'group':
      return 'GroupContainer';
    case 'multi-tab':
      return 'TabContainer';
    default:
      return 'TextInput';
  }
}

function toFormilyValidators(field: SchemaField) {
  const validators: Array<Record<string, unknown>> = [];
  if (field.maxLength) {
    validators.push({
      max: field.maxLength,
      message: `不能超过 ${field.maxLength} 字符`,
    });
  }
  normalizeValidators(field).forEach((rule) => {
    if (rule.type === 'regex' && rule.pattern) {
      validators.push({
        pattern: rule.pattern,
        message: rule.message || '格式不符合要求',
      });
    }
    if (rule.type === 'noEmoji') {
      validators.push({
        validator: (value: unknown) => {
          if (typeof value !== 'string') return '';
          return /[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(value)
            ? rule.message || '不能包含 Emoji'
            : '';
        },
      });
    }
    if (rule.type === 'jsonObject') {
      validators.push({
        validator: (value: unknown) => {
          if (typeof value !== 'string' || !value.trim()) return '';
          try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
              ? ''
              : rule.message || '必须是 JSON 对象';
          } catch {
            return rule.message || 'JSON 格式不合法';
          }
        },
      });
    }
    if (rule.type === 'lengthBetween') {
      validators.push({
        validator: (value: unknown) => {
          if (typeof value !== 'string') return '';
          if (rule.min !== undefined && value.length < rule.min) {
            return rule.message || `长度不能小于 ${rule.min}`;
          }
          if (rule.max !== undefined && value.length > rule.max) {
            return rule.message || `长度不能大于 ${rule.max}`;
          }
          return '';
        },
      });
    }
  });
  return validators;
}

function findField(fields: SchemaField[], fieldName: string) {
  return fields.find((field) => field.fieldName === fieldName);
}

function matchesRule(rule: SchemaReactionRule, value: unknown, sourceField?: SchemaField) {
  const expectedValues = resolveExpectedValues(rule, sourceField);
  switch (rule.operator) {
    case 'eq':
      return valueMatchesExpected(value, expectedValues);
    case 'ne':
      return !valueMatchesExpected(value, expectedValues);
    case 'empty':
      return value == null || value === '' || (Array.isArray(value) && value.length === 0);
    case 'notEmpty':
      return !(value == null || value === '' || (Array.isArray(value) && value.length === 0));
    case 'includes':
      return Array.isArray(value)
        ? value.some((item) => valueMatchesExpected(item, expectedValues))
        : expectedValues.some((expected) => String(value ?? '').includes(expected));
    default:
      return false;
  }
}

function isDisplayRequiredAction(action: SchemaReactionRule['action']) {
  return action === 'visibleRequired' || action === 'required';
}

function resolveExpectedValues(rule: SchemaReactionRule, sourceField?: SchemaField) {
  const values = new Set<string>();
  const raw = String(rule.value ?? '');
  values.add(raw);
  sourceField?.options?.forEach((option) => {
    if (option.value === raw || option.label === raw) {
      values.add(option.value);
      values.add(option.label);
    }
  });
  return Array.from(values);
}

function normalizeReactionValue(value: unknown, sourceField?: SchemaField) {
  const raw = String(value ?? '');
  const option = sourceField?.options?.find((item) => item.label === raw || item.value === raw);
  return option?.value ?? value;
}

function valueMatchesExpected(value: unknown, expectedValues: string[]) {
  const current = String(value ?? '');
  return expectedValues.includes(current);
}
