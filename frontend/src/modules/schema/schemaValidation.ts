import type {
  MaterialKind,
  SchemaDiagnostic,
  SchemaField,
  SchemaReactionAction,
  SchemaReactionOperator,
  SchemaValidationResult,
  SchemaValidatorRule,
  SchemaValidatorType,
} from '../../types/schema';

export const SUBMITTABLE_KINDS = new Set<MaterialKind>([
  'text-single',
  'text-multi',
  'single-choice',
  'multi-choice',
  'tags',
  'rich-text',
  'file-upload',
  'json-editor',
  'llm-trigger',
]);

const ALLOWED_KINDS = new Set<MaterialKind>([
  'text-single',
  'text-multi',
  'single-choice',
  'multi-choice',
  'tags',
  'rich-text',
  'file-upload',
  'json-editor',
  'llm-trigger',
  'show-item',
  'group',
  'multi-tab',
]);

export const ALLOWED_VALIDATORS = new Set<SchemaValidatorType>([
  'regex',
  'noEmoji',
  'jsonObject',
  'lengthBetween',
]);

export const ALLOWED_REACTION_OPERATORS = new Set<SchemaReactionOperator>([
  'eq',
  'ne',
  'empty',
  'notEmpty',
  'includes',
]);

export const ALLOWED_REACTION_ACTIONS = new Set<SchemaReactionAction>([
  'visible',
  'hidden',
  'required',
  'optional',
]);

const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CHOICE_KINDS = new Set<MaterialKind>(['single-choice', 'multi-choice', 'tags']);

export function normalizeValidators(field: SchemaField): SchemaValidatorRule[] {
  const rules: SchemaValidatorRule[] = [...(field.validators ?? [])];
  if (field.validations?.regex && !rules.some((rule) => rule.type === 'regex')) {
    rules.push({ type: 'regex', pattern: field.validations.regex });
  }
  const customFn = field.validations?.customFn;
  if (customFn === 'noEmoji(value)' && !rules.some((rule) => rule.type === 'noEmoji')) {
    rules.push({ type: 'noEmoji' });
  }
  if (
    customFn === 'isJsonObject(value)' &&
    !rules.some((rule) => rule.type === 'jsonObject')
  ) {
    rules.push({ type: 'jsonObject' });
  }
  return rules;
}

export function validateSchemaFields(fields: SchemaField[]): SchemaValidationResult {
  const errors: SchemaDiagnostic[] = [];
  const warnings: SchemaDiagnostic[] = [];
  const names = new Map<string, number>();

  if (!Array.isArray(fields) || fields.length === 0) {
    errors.push({
      level: 'error',
      code: 'SCHEMA_FIELDS_REQUIRED',
      message: '至少需要配置一个字段。',
    });
    return { valid: false, errors, warnings };
  }

  fields.forEach((field, index) => {
    const label = field.label || `字段 ${index + 1}`;
    if (!ALLOWED_KINDS.has(field.kind)) {
      errors.push({
        level: 'error',
        code: 'INVALID_FIELD_KIND',
        fieldName: field.fieldName,
        message: `${label} 的物料类型不受支持。`,
      });
    }

    if (!field.fieldName || !FIELD_NAME.test(field.fieldName)) {
      errors.push({
        level: 'error',
        code: 'INVALID_FIELD_NAME',
        fieldName: field.fieldName,
        message: `${label} 的字段名必须是英文字母或下划线开头,且只能包含字母、数字、下划线。`,
      });
    } else {
      names.set(field.fieldName, (names.get(field.fieldName) ?? 0) + 1);
    }

    if (!field.label?.trim()) {
      errors.push({
        level: 'error',
        code: 'FIELD_LABEL_REQUIRED',
        fieldName: field.fieldName,
        message: `${field.fieldName || label} 缺少显示标签。`,
      });
    }

    if (CHOICE_KINDS.has(field.kind)) {
      validateOptions(field, errors);
    }

    if (field.kind === 'show-item' && !field.sourcePath?.trim() && !field.showText?.trim()) {
      errors.push({
        level: 'error',
        code: 'SHOW_ITEM_SOURCE_REQUIRED',
        fieldName: field.fieldName,
        message: `${label} 必须绑定 raw_payload 字段路径或填写静态展示内容。`,
      });
    }

    if (field.maxLength !== undefined && field.maxLength <= 0) {
      errors.push({
        level: 'error',
        code: 'INVALID_MAX_LENGTH',
        fieldName: field.fieldName,
        message: `${label} 的最大长度必须大于 0。`,
      });
    }

    validateValidators(field, errors);
  });

  names.forEach((count, fieldName) => {
    if (count > 1) {
      errors.push({
        level: 'error',
        code: 'DUPLICATE_FIELD_NAME',
        fieldName,
        message: `字段名 ${fieldName} 重复,会导致答案覆盖。`,
      });
    }
  });

  const nameSet = new Set([...names.keys()]);
  fields.forEach((field) => validateReactions(field, nameSet, errors, warnings));

  if (!fields.some((field) => SUBMITTABLE_KINDS.has(field.kind))) {
    warnings.push({
      level: 'warning',
      code: 'NO_SUBMITTABLE_FIELD',
      message: '当前模板没有可提交字段,Labeler 只能查看题目数据。',
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}

function validateOptions(field: SchemaField, errors: SchemaDiagnostic[]) {
  const options = field.options ?? [];
  if (options.length === 0) {
    errors.push({
      level: 'error',
      code: 'CHOICE_OPTIONS_REQUIRED',
      fieldName: field.fieldName,
      message: `${field.label} 至少需要配置一个选项。`,
    });
    return;
  }
  const values = new Set<string>();
  options.forEach((option, index) => {
    if (!option.value?.trim() || !option.label?.trim()) {
      errors.push({
        level: 'error',
        code: 'INVALID_CHOICE_OPTION',
        fieldName: field.fieldName,
        message: `${field.label} 的第 ${index + 1} 个选项缺少 value 或 label。`,
      });
    }
    if (option.value && values.has(option.value)) {
      errors.push({
        level: 'error',
        code: 'DUPLICATE_CHOICE_VALUE',
        fieldName: field.fieldName,
        message: `${field.label} 的选项值 ${option.value} 重复。`,
      });
    }
    if (option.value) values.add(option.value);
  });
}

function validateValidators(field: SchemaField, errors: SchemaDiagnostic[]) {
  normalizeValidators(field).forEach((rule) => {
    if (!ALLOWED_VALIDATORS.has(rule.type)) {
      errors.push({
        level: 'error',
        code: 'INVALID_VALIDATOR',
        fieldName: field.fieldName,
        message: `${field.label} 使用了不在白名单内的校验规则。`,
      });
      return;
    }
    if (rule.type === 'regex') {
      try {
        // 只验证 pattern 是否能被 JS/后端正则引擎解析。
        new RegExp(rule.pattern ?? '');
      } catch {
        errors.push({
          level: 'error',
          code: 'INVALID_REGEX',
          fieldName: field.fieldName,
          message: `${field.label} 的正则表达式不合法。`,
        });
      }
    }
    if (rule.type === 'lengthBetween' && (rule.min ?? 0) > (rule.max ?? 0)) {
      errors.push({
        level: 'error',
        code: 'INVALID_LENGTH_RANGE',
        fieldName: field.fieldName,
        message: `${field.label} 的长度区间配置不合法。`,
      });
    }
  });
}

function validateReactions(
  field: SchemaField,
  fieldNames: Set<string>,
  errors: SchemaDiagnostic[],
  warnings: SchemaDiagnostic[],
) {
  (field.reactions ?? []).forEach((rule, index) => {
    const prefix = `${field.label} 的第 ${index + 1} 条联动规则`;
    if (!ALLOWED_REACTION_OPERATORS.has(rule.operator)) {
      errors.push({
        level: 'error',
        code: 'INVALID_REACTION_OPERATOR',
        fieldName: field.fieldName,
        message: `${prefix} 使用了不支持的条件操作符。`,
      });
    }
    if (!ALLOWED_REACTION_ACTIONS.has(rule.action)) {
      errors.push({
        level: 'error',
        code: 'INVALID_REACTION_ACTION',
        fieldName: field.fieldName,
        message: `${prefix} 使用了不支持的联动动作。`,
      });
    }
    if (!fieldNames.has(rule.sourceField)) {
      errors.push({
        level: 'error',
        code: 'REACTION_SOURCE_NOT_FOUND',
        fieldName: field.fieldName,
        message: `${prefix} 引用的来源字段 ${rule.sourceField} 不存在。`,
      });
    }
    if (!fieldNames.has(rule.targetField)) {
      errors.push({
        level: 'error',
        code: 'REACTION_TARGET_NOT_FOUND',
        fieldName: field.fieldName,
        message: `${prefix} 引用的目标字段 ${rule.targetField} 不存在。`,
      });
    }
    if (rule.sourceField === rule.targetField) {
      warnings.push({
        level: 'warning',
        code: 'REACTION_SELF_REFERENCE',
        fieldName: field.fieldName,
        message: `${prefix} 自引用,请确认这是否符合预期。`,
      });
    }
  });
}
