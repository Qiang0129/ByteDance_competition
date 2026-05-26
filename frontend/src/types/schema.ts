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

export interface MaterialMeta {
  kind: MaterialKind;
  label: string;
  category: MaterialCategory;
  /** 默认 fieldName 前缀 */
  fieldPrefix: string;
  /** 是否参与提交(ShowItem 不参与) */
  submittable: boolean;
}

/** Schema 字段 */
export interface SchemaField {
  /** 内部稳定 ID,前端用,提交时不必传 */
  id: string;
  kind: MaterialKind;
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
  status: 'draft' | 'published';
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
  status: 'draft' | 'published';
  fieldCount: number;
  updatedAt: string;
  createdBy: string;
}

/** 草稿创建请求 */
export interface CreateSchemaDraftRequest {
  name: string;
  taskId?: string;
  description?: string;
  fields: SchemaField[];
}

/** 草稿保存请求(更新) */
export interface UpdateSchemaDraftRequest {
  name?: string;
  taskId?: string;
  description?: string;
  fields: SchemaField[];
}
