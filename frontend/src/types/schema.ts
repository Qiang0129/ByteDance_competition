/**
 * 模板搭建数据模型,字段命名与《项目实施计划书》4.2 / 5.1 / 5.2 对齐:
 *   - schema_versions(versionId, taskId, status, fields, updatedAt, ...)
 *   - 物料类型对齐核心物料清单:ShowItem / 文本 / 单选 / 多选 / 标签 / JSON / 富文本 / 文件 / LLM
 *   - 后端实现的接口:
 *       POST /tasks/{id}/schemas/draft
 *       POST /schemas/{id}/publish
 *       GET  /schemas/{versionId}
 *       GET  /schemas
 */

/** 物料类型 */
export type MaterialKind =
  | 'text-single' // 单行输入
  | 'text-multi' // 多行文本
  | 'single-choice' // 单选
  | 'multi-choice' // 多选
  | 'tags' // 标签选择
  | 'rich-text' // 富文本
  | 'file-upload' // 文件 / 图片
  | 'json-editor' // JSON 编辑器
  | 'llm-trigger' // LLM 触发组件
  | 'show-item' // 展示项 ShowItem(只读)
  | 'group' // 分组容器(布局)
  | 'multi-tab'; // 多 Tab 布局

/** 物料分类(左侧面板分组) */
export type MaterialCategory = 'input' | 'choice' | 'media' | 'advanced' | 'layout';
export type SchemaSemanticType =
  | 'text'
  | 'single_choice'
  | 'multi_choice'
  | 'tags'
  | 'json'
  | 'file'
  | 'llm'
  | 'display'
  | 'layout';

export interface MaterialMeta {
  kind: MaterialKind;
  label: string;
  category: MaterialCategory;
  /** 默认 fieldName 前缀 */
  fieldPrefix: string;
  /** 是否参与提交(ShowItem 不参与) */
  submittable: boolean;
}

export type SchemaValidatorType = 'regex' | 'noEmoji' | 'jsonObject' | 'lengthBetween';
export type SchemaReactionOperator = 'eq' | 'ne' | 'empty' | 'notEmpty' | 'includes';
export type SchemaReactionAction = 'visible' | 'hidden' | 'required' | 'optional' | 'visibleRequired';

/** 结构化校验规则。customFn 旧字段会在运行时兼容为这里的白名单规则。 */
export interface SchemaValidatorRule {
  type: SchemaValidatorType;
  pattern?: string;
  min?: number;
  max?: number;
  message?: string;
}

/** 字段联动规则:当 sourceField 满足条件时,对 targetField 执行动作。 */
export interface SchemaReactionRule {
  sourceField: string;
  operator: SchemaReactionOperator;
  value?: unknown;
  targetField: string;
  action: SchemaReactionAction;
}

export interface SchemaFieldLayout {
  span?: number;
  group?: string;
  tab?: string;
}

export interface SchemaTab {
  id: string;
  label: string;
}

export interface SchemaDiagnostic {
  level: 'error' | 'warning';
  code: string;
  message: string;
  fieldName?: string;
}

export interface SchemaValidationResult {
  valid: boolean;
  errors: SchemaDiagnostic[];
  warnings: SchemaDiagnostic[];
}

/** Schema 字段 */
export interface SchemaField {
  /** 内部稳定 ID,前端用,提交时不必传 */
  id: string;
  kind: MaterialKind;
  /** 答案语义类型,由后端根据 kind 权威补齐;前端渲染和校验优先读取该字段 */
  semanticType?: SchemaSemanticType;
  /** 后端最终落库的字段名(英文) */
  fieldName: string;
  /** 显示标签(中文) */
  label: string;
  /** 占位符 */
  placeholder?: string;
  /** 必填 */
  required?: boolean;
  /** 最大长度,文本类用 */
  maxLength?: number;
  /** 单选/多选的选项 */
  options?: Array<{ value: string; label: string }>;
  /** ShowItem 的展示内容 */
  showText?: string;
  /** ShowItem 从 raw_payload 读取的字段路径,例如 prompt / metadata.title */
  sourcePath?: string;
  /** 组件透传配置,运行时会映射到 antd6 适配组件 */
  componentProps?: Record<string, unknown>;
  /** 结构化校验规则 */
  validators?: SchemaValidatorRule[];
  /** 结构化联动规则 */
  reactions?: SchemaReactionRule[];
  /** 布局信息,用于分组和多 Tab 的后续扩展 */
  layout?: SchemaFieldLayout;
  /** 默认值 */
  defaultValue?: unknown;
  /** 字段帮助说明 */
  helpText?: string;
  /** 校验规则 */
  validations?: {
    regex?: string;
    /** 自定义函数名(后端校验白名单) */
    customFn?: string;
  };
  /** 字段联动规则:简单形式 */
  linkages?: Array<{
    /** 条件:形如 'category == "食品生鲜"' */
    when: string;
    /** 命中时隐藏的字段 fieldName 列表 */
    hide?: string[];
    /** 命中时显示的字段 fieldName 列表 */
    show?: string[];
  }>;
}

/** Schema 版本 */
export interface SchemaVersion {
  versionId: string;
  /** 版本号,例如 r12 */
  versionNumber: string;
  /** 关联任务 ID,可空(模板尚未绑定任务) */
  taskId?: string;
  /** 关联任务标题 */
  taskTitle?: string;
  /** 模板名称 */
  name: string;
  /** 模板描述 */
  description?: string;
  /** 模板默认关联的数据集 ID,任务发布页选择模板时会自动带入 */
  datasetId?: string;
  /** 模板默认关联的数据集名称,由后端根据 datasetId 派生 */
  datasetName?: string;
  status: 'draft' | 'published';
  tabs?: SchemaTab[];
  fields: SchemaField[];
  updatedAt: string;
  createdBy: string;
}

/** 列表项摘要 */
export interface SchemaSummary {
  versionId: string;
  versionNumber: string;
  name: string;
  taskId?: string;
  taskTitle?: string;
  datasetId?: string;
  datasetName?: string;
  status: 'draft' | 'published';
  fieldCount: number;
  updatedAt: string;
  createdBy: string;
}

/** 草稿创建请求 */
export interface CreateSchemaDraftRequest {
  name: string;
  taskId?: string;
  datasetId?: string;
  datasetName?: string;
  description?: string;
  tabs?: SchemaTab[];
  fields: SchemaField[];
}

/** 草稿保存请求(更新) */
export interface UpdateSchemaDraftRequest {
  name?: string;
  taskId?: string;
  datasetId?: string;
  datasetName?: string;
  description?: string;
  tabs?: SchemaTab[];
  fields: SchemaField[];
}
