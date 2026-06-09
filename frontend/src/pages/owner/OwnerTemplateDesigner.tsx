import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownOutlined,
  ArrowLeftOutlined,
  ArrowUpOutlined,
  CheckOutlined,
  CloseOutlined,
  CodeOutlined,
  DeleteOutlined,
  DragOutlined,
  EditOutlined,
  ExportOutlined,
  EyeOutlined,
  FieldStringOutlined,
  FileTextOutlined,
  FileZipOutlined,
  FontSizeOutlined,
  FormOutlined,
  GroupOutlined,
  MoreOutlined,
  PicCenterOutlined,
  PlusOutlined,
  SaveOutlined,
  SettingOutlined,
  TagsOutlined,
  ThunderboltOutlined,
  UnorderedListOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type {
  CollisionDetection,
  DragCancelEvent,
  DragEndEvent,
  DragMoveEvent,
  DragOverEvent,
  DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS, getEventCoordinates } from '@dnd-kit/utilities';
import {
  Alert,
  App as AntdApp,
  Button,
  Drawer,
  Dropdown,
  Empty,
  Input,
  Modal,
  Segmented,
  Select,
  Space,
  Switch,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { MenuProps } from 'antd';
import type { InputRef } from 'antd';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { createPortal } from 'react-dom';

import { getApiErrorMessage } from '../../api/client';
import { datasetApi } from '../../api/dataset';
import { schemaApi } from '../../api/schema';
import {
  DEFAULT_SCHEMA_TAB_ID,
  DEFAULT_SCHEMA_TABS,
  LabelHubFormRenderer,
  RichTextMarkdown,
  findSchemaField,
  flattenSchemaFields,
  isLayoutField,
  normalizeLayoutTabs,
  normalizeSchemaFields,
  normalizeSchemaTabs,
  resolveFieldTabId,
  resolveSemanticType,
  isSubmittableField,
  validateSchemaFields,
  withLayoutTabs,
} from '../../modules/schema';
import type { DatasetItem, DatasetMeta } from '../../types/dataset';
import type {
  MaterialCategory,
  MaterialKind,
  MaterialMeta,
  SchemaDiagnostic,
  SchemaField,
  SchemaLayoutTab,
  SchemaReactionAction,
  SchemaReactionOperator,
  SchemaReactionRule,
  SchemaTab,
  SchemaVersion,
  SchemaValidatorRule,
  SchemaValidatorType,
} from '../../types/schema';

/**
 * 模板搭建器 Designer。
 * 计划书 4.2 / 1.4:
 *   - 左物料 → 中画布 → 右属性配置
 *   - Schema 序列化为 JSON,Designer/Renderer 共用同一份
 *   - 核心物料:ShowItem / 文本 / 单选 / 多选 / 标签 / JSON / LLM / 文件&图片
 *   - 物料拖拽:为不引入 dnd-kit,前端用"点击物料 → 追加到画布末尾"+
 *     字段卡片上下排序按钮的轻量实现,后续阶段可平滑替换为真正拖拽。
 */

const materialCategoryLabel: Record<MaterialCategory, string> = {
  input: '输入物料',
  choice: '选择物料',
  media: '媒体与文件',
  advanced: '高级物料',
  layout: '布局物料',
};

const materials: MaterialMeta[] = [
  { kind: 'text-single', label: '单行输入', category: 'input', fieldPrefix: 'text', submittable: true },
  { kind: 'text-multi', label: '多行文本', category: 'input', fieldPrefix: 'note', submittable: true },
  { kind: 'rich-text', label: '富文本', category: 'input', fieldPrefix: 'content', submittable: true },
  { kind: 'single-choice', label: '单选', category: 'choice', fieldPrefix: 'choice', submittable: true },
  { kind: 'multi-choice', label: '多选', category: 'choice', fieldPrefix: 'multi', submittable: true },
  { kind: 'tags', label: '标签选择', category: 'choice', fieldPrefix: 'tags', submittable: true },
  { kind: 'file-upload', label: '文件 / 图片', category: 'media', fieldPrefix: 'file', submittable: true },
  { kind: 'show-item', label: '展示项 ShowItem', category: 'media', fieldPrefix: 'show', submittable: false },
  { kind: 'json-editor', label: 'JSON 编辑器', category: 'advanced', fieldPrefix: 'json', submittable: true },
  { kind: 'llm-trigger', label: 'LLM 触发组件', category: 'advanced', fieldPrefix: 'llm', submittable: false },
  { kind: 'group', label: '分组容器', category: 'layout', fieldPrefix: 'group', submittable: false },
  { kind: 'multi-tab', label: '多 Tab 布局', category: 'layout', fieldPrefix: 'tabs', submittable: false },
];

const materialIconMap: Record<MaterialKind, React.ReactNode> = {
  'text-single': <FontSizeOutlined />,
  'text-multi': <FileTextOutlined />,
  'rich-text': <FormOutlined />,
  'single-choice': <UnorderedListOutlined />,
  'multi-choice': <UnorderedListOutlined />,
  tags: <TagsOutlined />,
  'file-upload': <FileZipOutlined />,
  'show-item': <PicCenterOutlined />,
  'json-editor': <CodeOutlined />,
  'llm-trigger': <ThunderboltOutlined />,
  group: <GroupOutlined />,
  'multi-tab': <FieldStringOutlined />,
};

const groupedMaterials: Array<{ category: MaterialCategory; items: MaterialMeta[] }> = (
  ['input', 'choice', 'media', 'advanced', 'layout'] as MaterialCategory[]
).map((category) => ({
  category,
  items: materials.filter((m) => m.category === category),
}));

type DropPosition = 'before' | 'after';

type DropIndicator = {
  fieldId: string;
  position: DropPosition;
};

type DesignerDragPayload =
  | { type: 'material'; meta: MaterialMeta }
  | { type: 'field'; fieldId: string };

type MobileDesignerSection = 'materials' | 'canvas' | 'properties';

type DropIndicatorEvent = DragMoveEvent | DragOverEvent | DragEndEvent;

const CANVAS_DROPPABLE_PREFIX = 'canvas-droppable';

type CanvasScope =
  | { type: 'root' }
  | { type: 'group'; fieldId: string }
  | { type: 'tab'; fieldId: string; tabId: string };

function canvasDroppableId(scope: CanvasScope) {
  if (scope.type === 'root') return `${CANVAS_DROPPABLE_PREFIX}:root`;
  if (scope.type === 'group') return `${CANVAS_DROPPABLE_PREFIX}:group:${scope.fieldId}`;
  return `${CANVAS_DROPPABLE_PREFIX}:tab:${scope.fieldId}:${scope.tabId}`;
}

function isCanvasDroppableId(id: string) {
  return id === CANVAS_DROPPABLE_PREFIX || id.startsWith(`${CANVAS_DROPPABLE_PREFIX}:`);
}

function parseCanvasScope(id: string): CanvasScope | null {
  if (id === CANVAS_DROPPABLE_PREFIX || id === `${CANVAS_DROPPABLE_PREFIX}:root`) {
    return { type: 'root' };
  }
  if (!id.startsWith(`${CANVAS_DROPPABLE_PREFIX}:`)) return null;
  const parts = id.slice(CANVAS_DROPPABLE_PREFIX.length + 1).split(':');
  if (parts[0] === 'group' && parts[1]) {
    return { type: 'group', fieldId: parts[1] };
  }
  if (parts[0] === 'tab' && parts[1] && parts[2]) {
    return { type: 'tab', fieldId: parts[1], tabId: parts[2] };
  }
  return null;
}

function getNestedCanvasOwnerFieldId(id: string) {
  const scope = parseCanvasScope(id);
  return scope?.type === 'group' || scope?.type === 'tab' ? scope.fieldId : null;
}

const designerCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length === 0) {
    return args.pointerCoordinates ? [] : closestCenter(args);
  }

  const activeId = String(args.active.id);
  const directFieldCollisions = pointerCollisions.filter(
    (collision) => {
      const collisionId = String(collision.id);
      return collisionId !== activeId && !isCanvasDroppableId(collisionId);
    },
  );
  const directFieldCollisionIds = new Set(
    directFieldCollisions.map((collision) => String(collision.id)),
  );
  const nestedCanvasCollision = pointerCollisions.find((collision) => {
    const ownerFieldId = getNestedCanvasOwnerFieldId(String(collision.id));
    return (
      ownerFieldId != null &&
      directFieldCollisionIds.has(ownerFieldId) &&
      directFieldCollisions.every((directCollision) => String(directCollision.id) === ownerFieldId)
    );
  });
  if (nestedCanvasCollision) {
    return [nestedCanvasCollision];
  }

  if (directFieldCollisions.length > 0) {
    return directFieldCollisions;
  }

  const fieldContainers = args.droppableContainers.filter(
    (container) => {
      const rect = container.rect.current;
      return !isCanvasDroppableId(String(container.id)) && Boolean(rect?.width && rect?.height);
    },
  );
  const closestFieldCollisions = closestCenter({
    ...args,
    droppableContainers: fieldContainers,
  });

  return closestFieldCollisions.length > 0 ? closestFieldCollisions : pointerCollisions;
};

/** 默认样例字段(对齐图里那套商品清洗模板) */
const defaultDemoFields: SchemaField[] = [
  {
    id: 'f-show',
    kind: 'show-item',
    fieldName: 'origin_title',
    label: '原始商品标题(展示项)',
    sourcePath: 'origin_title',
    showText: '超柔软纯棉男女款居家服套装 春秋季睡衣大码情侣家居服',
  },
  {
    id: 'f-cleaned',
    kind: 'text-single',
    fieldName: 'cleaned_title',
    label: '商品标题清洗结果',
    placeholder: '请填写清洗后的标题(最多 35 字符)',
    required: true,
    maxLength: 35,
    validators: [
      { type: 'regex', pattern: '^[^@#$]+$', message: '不能包含 @ # $ 等符号' },
      { type: 'noEmoji', message: '不能包含 Emoji' },
    ],
    validations: { regex: '^[^@#$]+$', customFn: 'noEmoji(value)' },
  },
  {
    id: 'f-category',
    kind: 'single-choice',
    fieldName: 'category',
    label: '主类目',
    required: true,
    options: [
      { value: 'apparel', label: '服饰内衣' },
      { value: 'home', label: '家居用品' },
      { value: 'fresh', label: '食品生鲜' },
      { value: 'digital', label: '3C 数码' },
      { value: 'beauty', label: '美妆个护' },
    ],
    reactions: [
      {
        sourceField: 'category',
        operator: 'eq',
        value: 'fresh',
        targetField: 'keywords',
        action: 'required',
      },
    ],
  },
  {
    id: 'f-keywords',
    kind: 'tags',
    fieldName: 'keywords',
    label: '商品卖点关键词',
    options: [
      { value: 'cotton', label: '纯棉' },
      { value: 'plus_size', label: '大码' },
      { value: 'couple', label: '情侣款' },
      { value: 'home', label: '家居服' },
    ],
  },
  {
    id: 'f-llm',
    kind: 'llm-trigger',
    fieldName: 'llm_suggestion',
    label: 'AI 建议清洗(LLM 触发组件)',
    placeholder: '调用模型生成参考标题,可一键填入 cleaned_title',
    componentProps: {
      taskInstruction: '这是商品标题清洗任务，请根据原始标题生成更规范、更简洁的商品标题。',
      promptTemplate: '请根据原始商品标题生成一个简洁、规范、适合电商展示的清洗后标题。',
      outputInstruction: '只生成可直接填入目标字段的建议，不要输出额外解释。',
      contextPaths: ['origin_title', 'model_answer', 'reference'],
      targetField: 'cleaned_title',
      targetFields: ['cleaned_title'],
      buttonText: '生成参考',
      outputMode: 'structured',
    },
  },
];

function uid() {
  return `f-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36).slice(-3)}`;
}

function nextFieldName(prefix: string, existing: SchemaField[]): string {
  let idx = 1;
  while (existing.some((f) => f.fieldName === `${prefix}_${idx}`)) idx += 1;
  return `${prefix}_${idx}`;
}

function createField(meta: MaterialMeta, existing: SchemaField[]): SchemaField {
  const baseComponentProps =
    meta.kind === 'llm-trigger'
      ? {
          taskInstruction: '',
          promptTemplate: '请根据当前题目和已填写答案,为配置的目标字段生成合法候选值。',
          outputInstruction: '',
          contextPaths: [],
          targetFields: [],
          buttonText: '生成建议',
          outputMode: 'structured',
        }
      : meta.kind === 'multi-tab'
        ? {
            tabs: [
              { id: 'tab_1', label: 'Tab 1', children: [] },
              { id: 'tab_2', label: 'Tab 2', children: [] },
            ],
          }
        : undefined;
  return {
    id: uid(),
    kind: meta.kind,
    semanticType: resolveSemanticType({ kind: meta.kind }),
    fieldName: nextFieldName(meta.fieldPrefix, existing),
    label: `${meta.label}字段`,
    required: false,
    options:
      meta.kind === 'single-choice' || meta.kind === 'multi-choice' || meta.kind === 'tags'
        ? [
            { value: 'option_a', label: '选项 A' },
            { value: 'option_b', label: '选项 B' },
          ]
        : undefined,
    showText: meta.kind === 'show-item' ? '展示项内容,标注员只能查看' : undefined,
    sourcePath: meta.kind === 'show-item' ? 'prompt' : undefined,
    validators: meta.kind === 'json-editor' ? [{ type: 'jsonObject' }] : undefined,
    helpText: meta.kind === 'llm-trigger' ? 'Labeler 点击后生成建议,确认后手动应用到目标字段。' : undefined,
    componentProps: baseComponentProps,
    children: meta.kind === 'group' ? [] : undefined,
  };
}

function normalizeDesignerSchema(schema: SchemaVersion): SchemaVersion {
  const tabs = normalizeSchemaTabs(schema.tabs);
  const flatFields = flattenSchemaFields(schema.fields);
  if (tabs.length <= 1 || flatFields.some((field) => field.kind === 'multi-tab')) {
    return { ...schema, tabs };
  }
  return {
    ...schema,
    tabs: DEFAULT_SCHEMA_TABS,
    fields: [
      {
        id: `legacy-tabs-${uid()}`,
        kind: 'multi-tab',
        semanticType: 'layout',
        fieldName: nextFieldName('tabs', flatFields),
        label: '多 Tab 布局',
        required: false,
        componentProps: {
          tabs: tabs.map((tab) => ({
            id: tab.id,
            label: tab.label,
            children: schema.fields
              .filter((field) => resolveFieldTabId(field, tabs) === tab.id)
              .map((field) => ({
                ...field,
                layout: field.layout ? { ...field.layout, tab: undefined } : undefined,
              })),
          })),
        },
      },
    ],
  };
}

function createInitialDesignerSchema(versionId: string | null, isNew: boolean): SchemaVersion {
  return normalizeDesignerSchema({
    versionId: versionId ?? `draft-${Date.now()}`,
    versionNumber: versionId ? 'r12' : 'r-draft',
    taskId: undefined,
    taskTitle: undefined,
    name: isNew ? '新建模板' : '商品清洗 · v3',
    description: 'Schema 与渲染解耦:左物料 → 中画布 → 右属性,产物为可序列化 JSON Schema。',
    datasetId: undefined,
    datasetName: undefined,
    status: 'draft',
    tabs: DEFAULT_SCHEMA_TABS,
    fields: isNew ? [] : defaultDemoFields,
    updatedAt: new Date().toISOString(),
    createdBy: 'Owner Demo',
  });
}

function buildDesignerDraftFingerprint(schema: SchemaVersion) {
  return JSON.stringify({
    name: schema.name.trim(),
    description: schema.description?.trim() ?? '',
    taskId: schema.taskId ?? '',
    datasetId: schema.datasetId ?? '',
    datasetName: schema.datasetName ?? '',
    tabs: normalizeSchemaTabs(schema.tabs),
    fields: normalizeSchemaFields(schema.fields),
  });
}

function sameCanvasScope(a: CanvasScope | null, b: CanvasScope | null) {
  if (!a || !b || a.type !== b.type) return false;
  if (a.type === 'root' && b.type === 'root') return true;
  if (a.type === 'group' && b.type === 'group') return a.fieldId === b.fieldId;
  if (a.type === 'tab' && b.type === 'tab') return a.fieldId === b.fieldId && a.tabId === b.tabId;
  return false;
}

function getFieldsInScope(fields: SchemaField[], scope: CanvasScope): SchemaField[] {
  if (scope.type === 'root') return fields;
  const container = findSchemaField(fields, scope.fieldId);
  if (!container) return [];
  if (scope.type === 'group') return container.children ?? [];
  return normalizeLayoutTabs(container).find((tab) => tab.id === scope.tabId)?.children ?? [];
}

function updateFieldsInScope(
  fields: SchemaField[],
  scope: CanvasScope,
  updater: (items: SchemaField[]) => SchemaField[],
): SchemaField[] {
  if (scope.type === 'root') return updater(fields);
  return fields.map((field) => {
    if (scope.type === 'group' && field.id === scope.fieldId) {
      return { ...field, children: updater(field.children ?? []) };
    }
    if (field.kind === 'multi-tab') {
      return withLayoutTabs(
        field,
        normalizeLayoutTabs(field).map((tab) => ({
          ...tab,
          children:
            scope.type === 'tab' && field.id === scope.fieldId && tab.id === scope.tabId
              ? updater(tab.children ?? [])
              : updateFieldsInScope(tab.children ?? [], scope, updater),
        })),
      );
    }
    return field.children
      ? { ...field, children: updateFieldsInScope(field.children, scope, updater) }
      : field;
  });
}

function updateFieldInTree(
  fields: SchemaField[],
  fieldId: string,
  updater: (field: SchemaField) => SchemaField,
): SchemaField[] {
  return fields.map((field) => {
    const nextField = field.id === fieldId ? updater(field) : field;
    if (nextField.kind === 'multi-tab') {
      return withLayoutTabs(
        nextField,
        normalizeLayoutTabs(nextField).map((tab) => ({
          ...tab,
          children: updateFieldInTree(tab.children ?? [], fieldId, updater),
        })),
      );
    }
    return nextField.children
      ? { ...nextField, children: updateFieldInTree(nextField.children, fieldId, updater) }
      : nextField;
  });
}

function removeFieldFromTree(
  fields: SchemaField[],
  fieldId: string,
): { fields: SchemaField[]; removed: SchemaField | null } {
  let removed: SchemaField | null = null;
  const next: SchemaField[] = [];
  for (const field of fields) {
    if (field.id === fieldId) {
      removed = field;
      continue;
    }
    if (field.kind === 'multi-tab') {
      const nextTabs = normalizeLayoutTabs(field).map((tab) => {
        const result = removeFieldFromTree(tab.children ?? [], fieldId);
        if (result.removed) removed = result.removed;
        return { ...tab, children: result.fields };
      });
      next.push(withLayoutTabs(field, nextTabs));
    } else if (field.children) {
      const result = removeFieldFromTree(field.children, fieldId);
      if (result.removed) removed = result.removed;
      next.push({ ...field, children: result.fields });
    } else {
      next.push(field);
    }
  }
  return { fields: next, removed };
}

function findScopeOfField(
  fields: SchemaField[],
  fieldId: string,
  scope: CanvasScope = { type: 'root' },
): CanvasScope | null {
  for (const field of fields) {
    if (field.id === fieldId) return scope;
    if (field.kind === 'multi-tab') {
      for (const tab of normalizeLayoutTabs(field)) {
        const result = findScopeOfField(tab.children ?? [], fieldId, {
          type: 'tab',
          fieldId: field.id,
          tabId: tab.id,
        });
        if (result) return result;
      }
    } else if (field.children) {
      const result = findScopeOfField(field.children, fieldId, { type: 'group', fieldId: field.id });
      if (result) return result;
    }
  }
  return null;
}

function isFieldDescendant(fields: SchemaField[], ancestorId: string, candidateId: string) {
  const ancestor = findSchemaField(fields, ancestorId);
  if (!ancestor) return false;
  return flattenSchemaFields(
    ancestor.kind === 'multi-tab'
      ? normalizeLayoutTabs(ancestor).flatMap((tab) => tab.children ?? [])
      : ancestor.children ?? [],
  ).some((field) => field.id === candidateId);
}

function scopeTargetsOwnDescendant(fields: SchemaField[], draggedFieldId: string, targetScope: CanvasScope) {
  if (targetScope.type === 'root') return false;
  return targetScope.fieldId === draggedFieldId || isFieldDescendant(fields, draggedFieldId, targetScope.fieldId);
}

function insertFieldInScope(
  fields: SchemaField[],
  scope: CanvasScope,
  field: SchemaField,
  placement?: DropIndicator | null,
) {
  return updateFieldsInScope(fields, scope, (items) => {
    const next = items.filter((item) => item.id !== field.id);
    if (!placement) return [...next, field];
    const index = next.findIndex((item) => item.id === placement.fieldId);
    if (index < 0) return [...next, field];
    next.splice(index + (placement.position === 'after' ? 1 : 0), 0, field);
    return next;
  });
}

function moveFieldWithinScope(fields: SchemaField[], scope: CanvasScope, fieldId: string, direction: -1 | 1) {
  return updateFieldsInScope(fields, scope, (items) => {
    const index = items.findIndex((item) => item.id === fieldId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= items.length) return items;
    const next = items.slice();
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    return next;
  });
}

const fallbackPreviewPayload: Record<string, unknown> = {
  media_type: 'text',
  prompt: '请判断下面回答是否准确、完整、格式合规。',
  origin_title: '超柔软纯棉男女款居家服套装 春秋季睡衣大码情侣家居服',
  model_answer: '这是一条用于 Designer 预览的样例回答。',
  reference: '参考答案会在真实数据集中由 raw_payload 提供。',
  tags: ['demo', 'preview'],
};

export default function OwnerTemplateDesigner() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const versionId = searchParams.get('versionId');
  const isNew = searchParams.get('new') === '1';

  const { message } = AntdApp.useApp();

  const initialSchemaRef = useRef<SchemaVersion | null>(null);
  if (!initialSchemaRef.current) {
    initialSchemaRef.current = createInitialDesignerSchema(versionId, isNew);
  }

  const [schema, setSchema] = useState<SchemaVersion>(() => initialSchemaRef.current!);
  const [savedDraftFingerprint, setSavedDraftFingerprint] = useState(() =>
    buildDesignerDraftFingerprint(initialSchemaRef.current!),
  );

  const [activeSchemaTabId, setActiveSchemaTabId] = useState(DEFAULT_SCHEMA_TAB_ID);
  const [editingSchemaTabId, setEditingSchemaTabId] = useState<string | null>(null);
  const [editingSchemaTabDraft, setEditingSchemaTabDraft] = useState('');
  const [activeFieldId, setActiveFieldId] = useState<string | null>(
    schema.fields[0]?.id ?? null,
  );
  const [activeLayoutTabs, setActiveLayoutTabs] = useState<Record<string, string>>({});
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewDatasets, setPreviewDatasets] = useState<DatasetMeta[]>([]);
  const [previewDatasetId, setPreviewDatasetId] = useState<string>();
  const [previewItems, setPreviewItems] = useState<DatasetItem[]>([]);
  const [previewItemIndex, setPreviewItemIndex] = useState(0);
  const [previewAnswer, setPreviewAnswer] = useState<Record<string, unknown>>({});
  const [exportOpen, setExportOpen] = useState(false);
  const [usingFallback, setUsingFallback] = useState(false);
  /** 拖拽中的物料/字段,用于 DragOverlay 渲染半透明跟随物 */
  const [draggingMaterial, setDraggingMaterial] = useState<MaterialMeta | null>(null);
  const [draggingFieldId, setDraggingFieldId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);
  const [mobileSection, setMobileSection] = useState<MobileDesignerSection>('canvas');
  const [returnConfirmOpen, setReturnConfirmOpen] = useState(false);
  const [returnSaving, setReturnSaving] = useState(false);

  /** dnd-kit 传感器:按下 8px 才激活,避免与点击事件冲突 */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  /** 拉取真实 Schema(后端未实现时保持样例) */
  useEffect(() => {
    if (!versionId || isNew) return;
    let cancelled = false;
    (async () => {
      try {
        const real = await schemaApi.getSchema(versionId);
        if (!cancelled) {
          const nextSchema = normalizeDesignerSchema({ ...real, tabs: normalizeSchemaTabs(real.tabs) });
          setSchema(nextSchema);
          setSavedDraftFingerprint(buildDesignerDraftFingerprint(nextSchema));
          setActiveFieldId(flattenSchemaFields(nextSchema.fields)[0]?.id ?? null);
          setUsingFallback(false);
        }
      } catch {
        if (!cancelled) {
          setUsingFallback(true);
          message.error('模板不存在或已删除。');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [versionId, isNew, message]);

  useEffect(() => {
    if (previewDatasets.length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const resp = await datasetApi.listDatasets();
        if (cancelled) return;
        setPreviewDatasets(resp.items ?? []);
      } catch {
        if (!cancelled) {
          message.warning('数据集列表加载失败,预览将使用内置示例数据。');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [previewDatasets.length, message]);

  useEffect(() => {
    if (schema.datasetId && !previewDatasetId) {
      setPreviewDatasetId(schema.datasetId);
    }
  }, [schema.datasetId, previewDatasetId]);

  useEffect(() => {
    if (!previewDatasetId) {
      setPreviewItems([]);
      setPreviewItemIndex(0);
      setPreviewAnswer({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const items = await datasetApi.listItems(previewDatasetId);
        if (cancelled) return;
        setPreviewItems(items);
        setPreviewItemIndex(0);
        setPreviewAnswer({});
      } catch {
        if (!cancelled) {
          setPreviewItems([]);
          setPreviewItemIndex(0);
          setPreviewAnswer({});
          message.warning('数据集条目加载失败,预览将使用内置示例数据。');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [previewDatasetId, message]);

  const allFields = useMemo(() => flattenSchemaFields(schema.fields), [schema.fields]);
  const activeField = useMemo(
    () => (activeFieldId ? findSchemaField(schema.fields, activeFieldId) : null),
    [schema.fields, activeFieldId],
  );
  const schemaTabs = useMemo(() => normalizeSchemaTabs(schema.tabs), [schema.tabs]);
  const activeFieldScope = useMemo(
    () => (activeFieldId ? findScopeOfField(schema.fields, activeFieldId) : null),
    [schema.fields, activeFieldId],
  );
  const schemaCheck = useMemo(() => validateSchemaFields(schema.fields), [schema.fields]);
  const currentDraftFingerprint = useMemo(
    () => buildDesignerDraftFingerprint(schema),
    [schema],
  );
  const hasUnsavedDraft = currentDraftFingerprint !== savedDraftFingerprint;
  const previewRawPayload = useMemo(
    () => normalizePreviewItem(previewItems[previewItemIndex]) ?? fallbackPreviewPayload,
    [previewItems, previewItemIndex],
  );
  const previewRendererKey = useMemo(
    () => `${previewDatasetId ?? 'fallback'}:${previewItemIndex}:${JSON.stringify(previewRawPayload)}`,
    [previewDatasetId, previewItemIndex, previewRawPayload],
  );
  const rawPathOptions = useMemo(
    () => extractRawPaths(previewRawPayload).map((path) => ({ label: path, value: path })),
    [previewRawPayload],
  );
  const datasetOptions = useMemo(
    () =>
      previewDatasets.map((dataset) => ({
        label: `${dataset.name} · ${dataset.itemCount} 条`,
        value: dataset.id,
      })),
    [previewDatasets],
  );
  const isPublished = schema.status === 'published';

  useEffect(() => {
    setSchema((prev) => normalizeDesignerSchema(prev));
    // 只在首次挂载时兜底迁移旧顶层 Tab 模板,避免编辑过程中重复包裹。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeFieldId && allFields.some((field) => field.id === activeFieldId)) return;
    setActiveFieldId(allFields[0]?.id ?? null);
  }, [activeFieldId, allFields]);

  function updateField(fieldId: string, patch: Partial<SchemaField>) {
    if (isPublished) return;
    setSchema((prev) => ({
      ...prev,
      fields: updateFieldInTree(prev.fields, fieldId, (field) => ({ ...field, ...patch })),
    }));
  }

  function updateSchemaMeta(
    patch: Partial<Pick<SchemaVersion, 'name' | 'description' | 'datasetId' | 'datasetName'>>,
  ) {
    setSchema((prev) => ({ ...prev, ...patch }));
  }

  function addMaterial(meta: MaterialMeta) {
    if (isPublished) return;
    const scope = resolveClickAddScope();
    let addedFieldId = '';
    setSchema((prev) => {
      const field = createField(meta, flattenSchemaFields(prev.fields));
      addedFieldId = field.id;
      return {
        ...prev,
        fields: insertFieldInScope(prev.fields, scope, field),
      };
    });
    setActiveFieldId(addedFieldId);
    setMobileSection('canvas');
  }

  function selectCanvasField(fieldId: string) {
    setActiveFieldId(fieldId);
    setMobileSection('properties');
  }

  function resolveClickAddScope(): CanvasScope {
    if (!activeField) return { type: 'root' };
    if (activeField.kind === 'group') return { type: 'group', fieldId: activeField.id };
    if (activeField.kind === 'multi-tab') {
      const tabs = normalizeLayoutTabs(activeField);
      return {
        type: 'tab',
        fieldId: activeField.id,
        tabId: activeLayoutTabs[activeField.id] ?? tabs[0]?.id ?? 'tab_1',
      };
    }
    return { type: 'root' };
  }

  function removeField(fieldId: string) {
    if (isPublished) return;
    setSchema((prev) => {
      const result = removeFieldFromTree(prev.fields, fieldId);
      return { ...prev, fields: result.fields };
    });
    if (activeFieldId === fieldId) {
      setActiveFieldId(null);
    }
  }

  function moveField(fieldId: string, direction: -1 | 1) {
    if (isPublished) return;
    setSchema((prev) => {
      const scope = findScopeOfField(prev.fields, fieldId);
      return scope ? { ...prev, fields: moveFieldWithinScope(prev.fields, scope, fieldId, direction) } : prev;
    });
  }

  function readDragPayload(
    event: DragStartEvent | DragMoveEvent | DragOverEvent | DragEndEvent | DragCancelEvent,
  ) {
    return event.active.data.current as DesignerDragPayload | undefined;
  }

  function getDraggedCenterY(event: DropIndicatorEvent) {
    const activeRect = event.active.rect.current.translated ?? event.active.rect.current.initial;
    return activeRect ? activeRect.top + activeRect.height / 2 : null;
  }

  function getDragPointerY(event: DropIndicatorEvent) {
    const startCoordinates = getEventCoordinates(event.activatorEvent);
    return startCoordinates ? startCoordinates.y + event.delta.y : null;
  }

  function clearDragState() {
    setDraggingMaterial(null);
    setDraggingFieldId(null);
    setDropIndicator(null);
  }

  function resolveDropIndicator(event: DropIndicatorEvent): DropIndicator | null {
    const { active, over } = event;
    if (!over) return null;

    const activeData = readDragPayload(event);
    const overId = String(over.id);
    const overScope = parseCanvasScope(overId) ?? findScopeOfField(schema.fields, overId);
    const scopedFields = overScope ? getFieldsInScope(schema.fields, overScope) : [];

    if (isCanvasDroppableId(overId)) {
      const lastField = scopedFields[scopedFields.length - 1];
      if (!lastField) return null;
      if (activeData?.type === 'field' && activeData.fieldId === lastField.id) return null;
      return { fieldId: lastField.id, position: 'after' };
    }

    const overField = scopedFields.find((field) => field.id === overId);
    if (!overField) return null;
    if (activeData?.type === 'field' && activeData.fieldId === overField.id) return null;

    const pointerY = getDragPointerY(event);
    const draggedCenterY = getDraggedCenterY(event);
    const overCenterY = over.rect.top + over.rect.height / 2;
    const compareY = pointerY ?? draggedCenterY;

    return {
      fieldId: overField.id,
      position: compareY != null && compareY > overCenterY ? 'after' : 'before',
    };
  }

  function updateDropIndicator(event: DropIndicatorEvent) {
    const nextIndicator = resolveDropIndicator(event);
    setDropIndicator((prev) => {
      if (
        prev?.fieldId === nextIndicator?.fieldId &&
        prev?.position === nextIndicator?.position
      ) {
        return prev;
      }
      return nextIndicator;
    });
  }

  function handleDragMove(event: DragMoveEvent) {
    updateDropIndicator(event);
  }

  function handleDragOver(event: DragOverEvent) {
    updateDropIndicator(event);
  }

  /** dnd-kit drag start */
  function handleDragStart(event: DragStartEvent) {
    const data = readDragPayload(event);
    setDropIndicator(null);
    if (data?.type === 'material') {
      setDraggingMaterial(data.meta);
    } else if (data?.type === 'field') {
      setDraggingFieldId(data.fieldId);
    }
  }

  function handleDragCancel(_: DragCancelEvent) {
    clearDragState();
  }

  /** dnd-kit drag end:三种情况
   *  1. 物料 → 画布字段卡 / 画布空白:按目标位置插入
   *  2. 字段 → 字段:按插入提示线调整顺序
   *  3. 拖到 canvas 外:取消
   */
  function handleDragEnd(event: DragEndEvent) {
    const placement = resolveDropIndicator(event);
    clearDragState();
    if (isPublished) return;
    const { over } = event;
    if (!over) return;

    const activeData = readDragPayload(event);
    const overId = String(over.id);
    const targetScope = parseCanvasScope(overId) ?? findScopeOfField(schema.fields, overId);
    if (!targetScope) return;

    if (activeData?.type === 'material') {
      // 物料拖到目标画布范围。
      let addedFieldId = '';
      setSchema((prev) => {
        const field = createField(activeData.meta, flattenSchemaFields(prev.fields));
        addedFieldId = field.id;
        return { ...prev, fields: insertFieldInScope(prev.fields, targetScope, field, placement) };
      });
      setActiveFieldId(addedFieldId);
      return;
    }

    if (activeData?.type === 'field') {
      if (scopeTargetsOwnDescendant(schema.fields, activeData.fieldId, targetScope)) return;
      // 字段可在同级排序,也可移动到其他容器。
      setSchema((prev) => {
        const result = removeFieldFromTree(prev.fields, activeData.fieldId);
        if (!result.removed) return prev;
        return {
          ...prev,
          fields: insertFieldInScope(result.fields, targetScope, result.removed, placement),
        };
      });
    }
  }

  async function validateTemplateBeforePersist() {
    if (!schema.name.trim()) {
      message.warning('请先填写模板名称');
      return false;
    }
    if (schemaTabs.some((tab) => !tab.label.trim())) {
      message.warning('Tab 名称不能为空');
      return false;
    }
    if (!schemaCheck.valid) {
      message.error(`Schema 检查未通过: ${schemaCheck.errors[0]?.message ?? '请修正错误后再保存'}`);
      return false;
    }
    try {
      const backendCheck = await schemaApi.validate({
        name: schema.name.trim(),
        description: schema.description?.trim(),
        datasetId: schema.datasetId ?? '',
        datasetName: schema.datasetName ?? '',
        tabs: schemaTabs,
        fields: normalizeSchemaFields(schema.fields),
      });
      if (!backendCheck.valid) {
        message.error(`后端 Schema 检查未通过: ${backendCheck.errors[0]?.message ?? '请修正错误后再保存'}`);
        return false;
      }
    } catch (error) {
      message.error(getApiErrorMessage(error, '后端 Schema 检查失败,请确认后端已启动。'));
      return false;
    }
    return true;
  }

  async function saveDraft(): Promise<SchemaVersion> {
    const name = schema.name.trim();
    const description = schema.description?.trim();
    const currentActiveFieldId = activeFieldId;
    const normalizedTabs = schemaTabs;
    const normalizedFields = normalizeSchemaFields(schema.fields);
    if (schema.versionId.startsWith('draft-')) {
      const created = await schemaApi.createStandaloneDraft({
        name,
        taskId: schema.taskId,
        datasetId: schema.datasetId ?? '',
        datasetName: schema.datasetName ?? '',
        description,
        tabs: normalizedTabs,
        fields: normalizedFields,
      });
      setSchema(created);
      setSavedDraftFingerprint(buildDesignerDraftFingerprint(created));
      const createdFields = flattenSchemaFields(created.fields);
      setActiveFieldId(
        createdFields.some((field) => field.id === currentActiveFieldId)
          ? currentActiveFieldId
          : createdFields[0]?.id ?? null,
      );
      setUsingFallback(false);
      navigate(`/owner/templates/designer?versionId=${encodeURIComponent(created.versionId)}`, {
        replace: true,
      });
      return created;
    }

    const updated = await schemaApi.updateDraft(schema.versionId, {
      name,
      taskId: schema.taskId,
      datasetId: schema.datasetId ?? '',
      datasetName: schema.datasetName ?? '',
      description,
      tabs: normalizedTabs,
      fields: normalizedFields,
    });
    setSchema(updated);
    setSavedDraftFingerprint(buildDesignerDraftFingerprint(updated));
    const updatedFields = flattenSchemaFields(updated.fields);
    setActiveFieldId(
      updatedFields.some((field) => field.id === currentActiveFieldId)
        ? currentActiveFieldId
        : updatedFields[0]?.id ?? null,
    );
    setUsingFallback(false);
    return updated;
  }

  async function handleSave() {
    if (!(await validateTemplateBeforePersist())) return;
    try {
      await saveDraft();
      message.success('草稿已保存');
    } catch (error) {
      message.error(getApiErrorMessage(error, '草稿保存失败,请确认后端接口和模板状态。'));
    }
  }

  async function handleSaveDraftAndReturn() {
    setReturnSaving(true);
    try {
      if (!(await validateTemplateBeforePersist())) return;
      await saveDraft();
      message.success('草稿已保存');
      setReturnConfirmOpen(false);
      navigate('/owner/templates');
    } catch (error) {
      message.error(getApiErrorMessage(error, '草稿保存失败,请确认后端接口和模板状态。'));
    } finally {
      setReturnSaving(false);
    }
  }

  function handleReturnToTemplateList() {
    if (!hasUnsavedDraft) {
      navigate('/owner/templates');
      return;
    }
    setReturnConfirmOpen(true);
  }

  async function handlePublish() {
    if (!(await validateTemplateBeforePersist())) return;
    Modal.confirm({
      title: '确认发布该 Schema 版本?',
      content:
        '发布时会先保存当前画布配置,然后此版本进入只读状态;绑定的任务将按此版本渲染答题界面。',
      okText: '立即发布',
      onOk: async () => {
        try {
          const draft = await saveDraft();
          const published = await schemaApi.publish(draft.versionId);
          setSchema(published);
          setSavedDraftFingerprint(buildDesignerDraftFingerprint(published));
          setUsingFallback(false);
          message.success(`已发布版本 ${published.versionNumber}`);
        } catch (error) {
          message.error(getApiErrorMessage(error, '模板发布失败,请确认后端接口和模板状态。'));
        }
      },
    });
  }

  async function handleWithdraw() {
    Modal.confirm({
      title: '确认收回发布?',
      content:
        '收回后该模板回到草稿状态,绑定该模板的任务会暂停新认领和提交;已提交标注数据不会删除。',
      okText: '收回发布',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const withdrawn = await schemaApi.withdraw(schema.versionId);
          setSchema(withdrawn);
          const withdrawnFields = flattenSchemaFields(withdrawn.fields);
          setActiveFieldId(
            withdrawnFields.some((field) => field.id === activeFieldId)
              ? activeFieldId
              : withdrawnFields[0]?.id ?? null,
          );
          setUsingFallback(false);
          message.success('模板已收回,现在可以继续编辑');
        } catch (error) {
          message.error(getApiErrorMessage(error, '收回发布失败,请确认模板状态。'));
        }
      },
    });
  }

  const submittableCount = allFields.filter(isSubmittableField).length;
  const designerMoreItems = [
    {
      key: 'version',
      label: `当前版本 ${schema.versionNumber}`,
      disabled: true,
    },
    ...(schema.taskId
      ? [
          {
            key: 'task',
            label: `绑定任务 ${schema.taskId}`,
            disabled: true,
          },
        ]
      : []),
    {
      key: 'export',
      icon: <ExportOutlined />,
      label: '导出 Schema JSON',
    },
    ...(isPublished
      ? [
          {
            key: 'withdraw',
            label: '收回发布',
            danger: true,
          },
        ]
      : []),
  ];
  const designerMoreMenu: MenuProps = {
    items: designerMoreItems,
    onClick: ({ key, domEvent }) => {
      domEvent.stopPropagation();
      if (key === 'export') {
        setExportOpen(true);
        return;
      }
      if (key === 'withdraw') {
        void handleWithdraw();
      }
    },
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={designerCollisionDetection}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="designer-shell">
      {/* 顶部工具栏 */}
      <div className="designer-topbar">
        <Space className="designer-topbar-main">
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={handleReturnToTemplateList}
          >
            返回模板列表
          </Button>
          <Typography.Title level={4} className="designer-title">
            模板搭建器(Designer)
          </Typography.Title>
          <Tag color={isPublished ? 'success' : 'processing'}>
            {isPublished ? '已发布' : '草稿'}
          </Tag>
          {usingFallback && <Tag color="gold">详情加载失败</Tag>}
        </Space>
        <Space className="designer-topbar-actions">
          <Tag className="designer-version-tag designer-secondary-action">当前版本 {schema.versionNumber}</Tag>
          {schema.taskId && (
            <Tag color="blue" className="designer-secondary-action">绑定任务 {schema.taskId}</Tag>
          )}
          <Button icon={<EyeOutlined />} onClick={() => setPreviewOpen(true)}>
            预览
          </Button>
          <Button className="designer-secondary-action" icon={<ExportOutlined />} onClick={() => setExportOpen(true)}>
            导出 Schema JSON
          </Button>
          <Button
            className={`designer-save-draft-action${isPublished ? ' is-mobile-hidden-when-published' : ''}`}
            icon={<SaveOutlined />}
            disabled={isPublished}
            onClick={() => void handleSave()}
          >
            保存草稿
          </Button>
          <Button
            type="primary"
            className={`designer-publish-action${isPublished ? ' is-mobile-hidden-when-published' : ''}`}
            icon={<CheckOutlined />}
            disabled={isPublished}
            onClick={handlePublish}
          >
            保存并发布
          </Button>
          {isPublished && (
            <Button className="designer-secondary-action" danger onClick={() => void handleWithdraw()}>
              收回发布
            </Button>
          )}
          <Dropdown
            trigger={['click']}
            menu={designerMoreMenu}
          >
            <Button className="designer-mobile-more" icon={<MoreOutlined />}>
              更多
            </Button>
          </Dropdown>
        </Space>
        <div className={`designer-mobile-actions${isPublished ? ' is-published' : ' is-draft'}`}>
          <Button icon={<EyeOutlined />} onClick={() => setPreviewOpen(true)}>
            预览
          </Button>
          {!isPublished && (
            <Button
              className="designer-save-draft-action"
              icon={<SaveOutlined />}
              onClick={() => void handleSave()}
            >
              保存草稿
            </Button>
          )}
          {!isPublished && (
            <Button
              type="primary"
              className="designer-publish-action"
              icon={<CheckOutlined />}
              onClick={handlePublish}
            >
              保存并发布
            </Button>
          )}
          <Dropdown trigger={['click']} menu={designerMoreMenu}>
            <Button icon={<MoreOutlined />}>
              更多
            </Button>
          </Dropdown>
        </div>
      </div>

      <Modal
        title="是否保存当前草稿?"
        open={returnConfirmOpen}
        onCancel={() => setReturnConfirmOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setReturnConfirmOpen(false)} disabled={returnSaving}>
            取消
          </Button>,
          <Button
            key="discard"
            danger
            disabled={returnSaving}
            onClick={() => {
              setReturnConfirmOpen(false);
              navigate('/owner/templates');
            }}
          >
            不保存返回
          </Button>,
          <Button
            key="save"
            type="primary"
            loading={returnSaving}
            onClick={() => void handleSaveDraftAndReturn()}
          >
            保存草稿并返回
          </Button>,
        ]}
      >
        <Typography.Paragraph>
          当前模板有未保存的修改。保存草稿后返回可以保留本次编辑；不保存返回会放弃这些修改。
        </Typography.Paragraph>
      </Modal>

      <div className="designer-meta-panel">
        <div className="designer-meta-field">
          <span className="designer-meta-label">模板名称</span>
          <Input
            value={schema.name}
            maxLength={80}
            disabled={isPublished}
            placeholder="例如: 问答质量评分模板"
            onChange={(event) => updateSchemaMeta({ name: event.target.value })}
          />
        </div>
        <div className="designer-meta-field">
          <span className="designer-meta-label">模板描述</span>
          <Input
            value={schema.description ?? ''}
            maxLength={160}
            disabled={isPublished}
            placeholder="说明该模板适用的数据集、标注目标或注意事项"
            onChange={(event) => updateSchemaMeta({ description: event.target.value })}
          />
        </div>
        <div className="designer-meta-field">
          <span className="designer-meta-label">关联数据集</span>
          <Select
            allowClear
            showSearch
            disabled={isPublished}
            placeholder="选择模板默认数据集"
            options={datasetOptions}
            value={schema.datasetId || undefined}
            optionFilterProp="label"
            onChange={(value) => {
              const selected = previewDatasets.find((dataset) => dataset.id === value);
              updateSchemaMeta({
                datasetId: value ?? '',
                datasetName: selected?.name ?? '',
              });
              setPreviewDatasetId(value ?? undefined);
            }}
          />
        </div>
      </div>

      <div className="designer-subtitle">
        Schema 与渲染解耦:左物料 → 中画布 → 右属性,产物为可序列化 JSON Schema。当前模板包含
        <strong> {allFields.length} </strong>
        个字段({submittableCount} 个参与提交)。
      </div>

      <SchemaCheckPanel result={schemaCheck} />

      <Segmented
        block
        className="designer-mobile-section-switch"
        options={[
          { label: '物料', value: 'materials' },
          { label: '画布', value: 'canvas' },
          { label: '属性', value: 'properties' },
        ]}
        value={mobileSection}
        onChange={(value) => setMobileSection(value as MobileDesignerSection)}
      />

      <div className={`designer-grid designer-mobile-section-${mobileSection}`}>
        {/* 左:物料区 */}
        <div className="designer-left">
          {groupedMaterials.map((group) => (
            <div key={group.category} className="material-group">
              <div className="material-group-title">{materialCategoryLabel[group.category]}</div>
              <div className="material-list">
                {group.items.map((m) => (
                  <DraggableMaterial
                    key={m.kind}
                    meta={m}
                    onClick={() => addMaterial(m)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* 中:画布 */}
        <div className="designer-center">
          <div className="designer-canvas-head">
            <Typography.Text type="secondary" className="designer-tab-tip">
              CMD+S 保存 · 点击物料追加到当前选中的容器
            </Typography.Text>
          </div>
          <Canvas
            scope={{ type: 'root' }}
            fields={schema.fields}
            activeFieldId={activeFieldId}
            dropIndicator={dropIndicator}
            activeLayoutTabs={activeLayoutTabs}
            onActiveLayoutTabChange={(fieldId: string, tabId: string) =>
              setActiveLayoutTabs((prev) => ({ ...prev, [fieldId]: tabId }))
            }
            onSelect={selectCanvasField}
            onMove={moveField}
            onRemove={removeField}
            onAdd={() => {
              setMobileSection('materials');
              message.info('从左侧物料栏点击物料即可追加新字段');
            }}
          />
        </div>

        {/* 右:属性配置 */}
        <div className="designer-right">
          {activeField ? (
            <PropertyPanel
              field={activeField}
              fields={allFields}
              rawPathOptions={rawPathOptions}
              onChange={(patch) => updateField(activeField.id, patch)}
            />
          ) : (
            <div className="property-empty">
              <SettingOutlined />
              <span>从中间画布选中字段后,可在此编辑属性、校验与联动规则。</span>
            </div>
          )}
        </div>
      </div>

      {/* 预览抽屉 */}
      <Drawer
        title="表单预览(Renderer)"
        width={520}
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        closeIcon={<CloseOutlined />}
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="预览使用与 Labeler 答题页相同的 Formily Renderer。"
            description="选择数据集样本后,ShowItem 会从 raw_payload 的绑定路径读取真实题目数据。"
          />
          <Space wrap style={{ width: '100%' }}>
            <Select
              allowClear
              showSearch
              style={{ minWidth: 260 }}
              placeholder="选择数据集样本"
              value={previewDatasetId}
              options={datasetOptions}
              onChange={(value) => {
                setPreviewDatasetId(value);
                setPreviewItemIndex(0);
                setPreviewAnswer({});
              }}
            />
            <Select
              style={{ minWidth: 160 }}
              placeholder="选择样本条目"
              value={previewItemIndex}
              disabled={previewItems.length === 0}
              options={previewItems.slice(0, 50).map((_, index) => ({
                label: `第 ${index + 1} 条`,
                value: index,
              }))}
              onChange={(value) => {
                setPreviewItemIndex(value);
                setPreviewAnswer({});
              }}
            />
          </Space>
          <LabelHubFormRenderer
            key={previewRendererKey}
            schema={schema.fields}
            tabs={schemaTabs}
            rawPayload={previewRawPayload}
            value={previewAnswer}
            onChange={setPreviewAnswer}
          />
        </Space>
      </Drawer>

      {/* 导出 Modal */}
      <Modal
        title="Schema JSON"
        open={exportOpen}
        onCancel={() => setExportOpen(false)}
        footer={[
          <Button key="copy" onClick={() => {
            void navigator.clipboard.writeText(JSON.stringify(schema, null, 2));
            message.success('已复制到剪贴板');
          }}>
            复制 JSON
          </Button>,
          <Button key="close" type="primary" onClick={() => setExportOpen(false)}>
            关闭
          </Button>,
        ]}
        width={720}
      >
        <pre className="schema-json-preview">{JSON.stringify(schema, null, 2)}</pre>
      </Modal>
      </div>

      {createPortal(
        /* DragOverlay 使用 fixed 定位,挂到 body 可避开外层入场动画 transform 导致的坐标偏移。 */
        <DragOverlay dropAnimation={null}>
          {draggingMaterial ? (
            <div className="material-item is-overlay">
              <span className="material-icon">{materialIconMap[draggingMaterial.kind]}</span>
              <span className="material-label">{draggingMaterial.label}</span>
            </div>
          ) : draggingFieldId ? (
            <div className="field-card is-overlay">
              {findSchemaField(schema.fields, draggingFieldId)?.label ?? '字段'}
            </div>
          ) : null}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  );
}

/** 中间画布 */
function Canvas({
  scope,
  fields,
  activeFieldId,
  dropIndicator,
  activeLayoutTabs,
  onActiveLayoutTabChange,
  onSelect,
  onMove,
  onRemove,
  onAdd,
}: {
  scope: CanvasScope;
  fields: SchemaField[];
  activeFieldId: string | null;
  dropIndicator: DropIndicator | null;
  activeLayoutTabs: Record<string, string>;
  onActiveLayoutTabChange: (fieldId: string, tabId: string) => void;
  onSelect: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
}) {
  const droppableId = canvasDroppableId(scope);
  const { setNodeRef, isOver } = useDroppable({ id: droppableId });

  if (fields.length === 0) {
    return (
      <div ref={setNodeRef} className={`canvas-empty ${isOver ? 'is-drop-over' : ''}`}>
        <Empty description="从左侧物料拖入此处,或点击物料卡片直接追加字段" />
        <button type="button" className="canvas-add" onClick={onAdd}>
          <PlusOutlined /> 添加字段
        </button>
      </div>
    );
  }
  return (
    <SortableContext items={fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
      <div
        ref={setNodeRef}
        className={`canvas-list ${isOver ? 'is-drop-over' : ''}`}
      >
        {fields.map((field, idx) => (
          <FieldCard
            key={field.id}
            field={field}
            active={field.id === activeFieldId}
            dropPosition={dropIndicator?.fieldId === field.id ? dropIndicator.position : null}
            isFirst={idx === 0}
            isLast={idx === fields.length - 1}
            onSelect={() => onSelect(field.id)}
            onMoveUp={() => onMove(field.id, -1)}
            onMoveDown={() => onMove(field.id, 1)}
            onRemove={() => onRemove(field.id)}
            activeFieldId={activeFieldId}
            dropIndicator={dropIndicator}
            activeLayoutTabs={activeLayoutTabs}
            onActiveLayoutTabChange={onActiveLayoutTabChange}
            onNestedSelect={onSelect}
            onNestedMove={onMove}
            onNestedRemove={onRemove}
            onNestedAdd={onAdd}
          />
        ))}
        <button type="button" className="canvas-add" onClick={onAdd}>
          <PlusOutlined /> 拖入此处新增字段
        </button>
      </div>
    </SortableContext>
  );
}

function DesignerSchemaTabLabel({
  tab,
  isDefault,
  disabled,
  editing,
  draftLabel,
  onDraftChange,
  onStartEditing,
  onCommitEditing,
  onCancelEditing,
  onRemove,
}: {
  tab: SchemaTab;
  isDefault: boolean;
  disabled: boolean;
  editing: boolean;
  draftLabel: string;
  onDraftChange: (label: string) => void;
  onStartEditing: (tabId: string) => void;
  onCommitEditing: (tabId: string) => void;
  onCancelEditing: (tabId: string) => void;
  onRemove: (tabId: string) => void;
}) {
  const inputRef = useRef<InputRef | null>(null);

  useEffect(() => {
    if (!editing) return;
    let frame = 0;
    const timer = window.setTimeout(() => {
      frame = window.requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [editing]);

  const stopTabPointerEvent = (event: React.SyntheticEvent) => {
    event.stopPropagation();
  };

  const stopTabClickEvent = (event: React.SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const startEditing = (event: React.SyntheticEvent) => {
    stopTabClickEvent(event);
    onStartEditing(tab.id);
  };

  if (editing) {
    return (
      <span
        className="designer-tab-label is-editing"
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <Input
          ref={inputRef}
          size="small"
          value={draftLabel}
          autoFocus
          onChange={(event) => onDraftChange(event.target.value)}
          onBlur={() => onCommitEditing(tab.id)}
          onPressEnter={() => onCommitEditing(tab.id)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              onCancelEditing(tab.id);
              return;
            }
            event.stopPropagation();
          }}
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        />
      </span>
    );
  }

  return (
    <span className="designer-tab-label">
      <span className="designer-tab-name">{tab.label}</span>
      {!disabled && (
        <Tooltip title="重命名">
          <Button
            size="small"
            type="text"
            icon={<EditOutlined />}
            className="designer-tab-action"
            aria-label={`重命名 ${tab.label}`}
            onPointerDown={stopTabPointerEvent}
            onMouseDown={stopTabPointerEvent}
            onClickCapture={startEditing}
            onClick={stopTabClickEvent}
            onKeyDown={(event) => event.stopPropagation()}
          />
        </Tooltip>
      )}
      {!disabled && !isDefault && (
        <Button
          size="small"
          type="text"
          icon={<CloseOutlined />}
          className="designer-tab-action"
          aria-label={`删除 ${tab.label}`}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
            onRemove(tab.id);
          }}
        />
      )}
    </span>
  );
}

function FieldCard({
  field,
  active,
  dropPosition,
  isFirst,
  isLast,
  onSelect,
  onMoveUp,
  onMoveDown,
  onRemove,
  activeFieldId,
  dropIndicator,
  activeLayoutTabs,
  onActiveLayoutTabChange,
  onNestedSelect,
  onNestedMove,
  onNestedRemove,
  onNestedAdd,
}: {
  field: SchemaField;
  active: boolean;
  dropPosition: DropPosition | null;
  isFirst: boolean;
  isLast: boolean;
  onSelect: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  activeFieldId: string | null;
  dropIndicator: DropIndicator | null;
  activeLayoutTabs: Record<string, string>;
  onActiveLayoutTabChange: (fieldId: string, tabId: string) => void;
  onNestedSelect: (id: string) => void;
  onNestedMove: (id: string, dir: -1 | 1) => void;
  onNestedRemove: (id: string) => void;
  onNestedAdd: () => void;
}) {
  const submittable = isSubmittableField(field);
  const layoutField = isLayoutField(field);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: field.id,
    data: { type: 'field', fieldId: field.id },
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`field-card ${layoutField ? 'is-layout' : ''} ${active ? 'is-active' : ''} ${
        dropPosition ? `is-drop-${dropPosition}` : ''
      }`}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      {dropPosition === 'before' && <span className="field-drop-indicator is-before" />}
      <div className="field-card-head">
        <div className="field-card-title-row">
          <span
            className="field-drag-handle"
            {...attributes}
            {...listeners}
            onClick={(event) => event.stopPropagation()}
            title="拖动调整顺序"
          >
            <DragOutlined />
          </span>
          <span className="field-card-title">
            {field.label}
            {field.required && <span className="field-required">*</span>}
          </span>
          {!submittable && (
            <Tag className="field-show-tag">
              {field.kind === 'llm-trigger'
                ? '操作控件 · 不参与提交'
                : layoutField
                  ? '布局容器 · 不参与提交'
                  : '不参与提交'}
            </Tag>
          )}
        </div>
        <div className="field-card-actions" onClick={(event) => event.stopPropagation()}>
          <Button
            size="small"
            type="text"
            icon={<ArrowUpOutlined />}
            disabled={isFirst}
            onClick={onMoveUp}
          />
          <Button
            size="small"
            type="text"
            icon={<ArrowDownOutlined />}
            disabled={isLast}
            onClick={onMoveDown}
          />
          <Button size="small" type="text" icon={<EyeOutlined />} onClick={onSelect} />
          <Button
            size="small"
            type="text"
            danger
            icon={<DeleteOutlined />}
            onClick={onRemove}
          />
        </div>
      </div>
      <div className="field-card-meta">
        字段名:<code>{field.fieldName}</code> · {fieldKindLabel(field.kind)}
      </div>
      {layoutField ? (
        <FieldCardLayoutBody
          field={field}
          activeFieldId={activeFieldId}
          dropIndicator={dropIndicator}
          activeLayoutTabs={activeLayoutTabs}
          onActiveLayoutTabChange={onActiveLayoutTabChange}
          onSelect={onNestedSelect}
          onMove={onNestedMove}
          onRemove={onNestedRemove}
          onAdd={onNestedAdd}
        />
      ) : (
        <div className="field-card-preview">{renderFieldPreview(field)}</div>
      )}
      {dropPosition === 'after' && <span className="field-drop-indicator is-after" />}
    </div>
  );
}

function FieldCardLayoutBody({
  field,
  activeFieldId,
  dropIndicator,
  activeLayoutTabs,
  onActiveLayoutTabChange,
  onSelect,
  onMove,
  onRemove,
  onAdd,
}: {
  field: SchemaField;
  activeFieldId: string | null;
  dropIndicator: DropIndicator | null;
  activeLayoutTabs: Record<string, string>;
  onActiveLayoutTabChange: (fieldId: string, tabId: string) => void;
  onSelect: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
}) {
  if (field.kind === 'multi-tab') {
    const tabs = normalizeLayoutTabs(field);
    const fallbackTabId = tabs[0]?.id ?? 'tab_1';
    const activeTabId = tabs.some((tab) => tab.id === activeLayoutTabs[field.id])
      ? activeLayoutTabs[field.id]
      : fallbackTabId;
    return (
      <div className="field-card-layout-body" onClick={(event) => event.stopPropagation()}>
        <Tabs
          className="field-card-inner-tabs"
          size="small"
          activeKey={activeTabId}
          onChange={(tabId) => {
            onActiveLayoutTabChange(field.id, tabId);
            onSelect(field.id);
          }}
          items={tabs.map((tab) => ({
            key: tab.id,
            label: (
              <span className="field-card-inner-tab-label">
                {tab.label}
                <span>{(tab.children ?? []).length}</span>
              </span>
            ),
            children: (
              <div className="field-card-tab-canvas">
                <Canvas
                  scope={{ type: 'tab', fieldId: field.id, tabId: tab.id }}
                  fields={tab.children ?? []}
                  activeFieldId={activeFieldId}
                  dropIndicator={dropIndicator}
                  activeLayoutTabs={activeLayoutTabs}
                  onActiveLayoutTabChange={onActiveLayoutTabChange}
                  onSelect={onSelect}
                  onMove={onMove}
                  onRemove={onRemove}
                  onAdd={() => {
                    onActiveLayoutTabChange(field.id, tab.id);
                    onSelect(field.id);
                    onAdd();
                  }}
                />
              </div>
            ),
          }))}
        />
      </div>
    );
  }

  return (
    <div className="field-card-layout-body" onClick={(event) => event.stopPropagation()}>
      <div className="field-card-layout-summary">
        <Tag className="field-option-tag">{(field.children ?? []).length} 个子字段</Tag>
        <Typography.Text type="secondary">拖入字段后按分组渲染,容器本身不提交答案。</Typography.Text>
      </div>
      <div className="field-card-nested-canvas">
        <Canvas
          scope={{ type: 'group', fieldId: field.id }}
          fields={field.children ?? []}
          activeFieldId={activeFieldId}
          dropIndicator={dropIndicator}
          activeLayoutTabs={activeLayoutTabs}
          onActiveLayoutTabChange={onActiveLayoutTabChange}
          onSelect={onSelect}
          onMove={onMove}
          onRemove={onRemove}
          onAdd={() => {
            onSelect(field.id);
            onAdd();
          }}
        />
      </div>
    </div>
  );
}

/** 左侧物料项:同时支持拖动到画布、点击追加 */
function DraggableMaterial({ meta, onClick }: { meta: MaterialMeta; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `material-${meta.kind}`,
    data: { type: 'material', meta },
  });
  return (
    <button
      ref={setNodeRef}
      type="button"
      className={`material-item ${isDragging ? 'is-dragging' : ''}`}
      onClick={onClick}
      {...attributes}
      {...listeners}
    >
      <span className="material-icon">{materialIconMap[meta.kind]}</span>
      <span className="material-label">{meta.label}</span>
      <PlusOutlined className="material-plus" />
    </button>
  );
}

function fieldKindLabel(kind: MaterialKind) {
  return materials.find((m) => m.kind === kind)?.label ?? kind;
}

function renderFieldPreview(field: SchemaField) {
  switch (field.kind) {
    case 'text-single':
      return <Input placeholder={field.placeholder ?? '请输入'} disabled />;
    case 'text-multi':
      return <Input.TextArea placeholder={field.placeholder ?? '请输入'} disabled rows={2} />;
    case 'rich-text':
      return (
        <RichTextMarkdown
          className="designer-rich-text-preview"
          source={`### 富文本标题
支持 **加粗**、列表、引用、代码和 [链接](https://example.com)。`}
        />
      );
    case 'single-choice':
      return (
        <Space wrap size={6}>
          {(field.options ?? []).map((opt) => (
            <Tag key={opt.value} className="field-option-tag">
              {opt.label}
            </Tag>
          ))}
          <Tag className="field-option-tag is-add">+ 新增</Tag>
        </Space>
      );
    case 'multi-choice':
    case 'tags':
      return (
        <Space wrap size={6}>
          {(field.options ?? []).map((opt) => (
            <Tag key={opt.value} className="field-option-tag">
              {opt.label}
            </Tag>
          ))}
        </Space>
      );
    case 'show-item':
      return <div className="field-show-text">{field.showText ?? '(展示内容)'}</div>;
    case 'file-upload':
      return (
        <div className="lh-file-upload is-preview">
          <Button icon={<UploadOutlined />} disabled>
            上传文件 / 图片
          </Button>
          <Typography.Text type="secondary" className="lh-file-upload-hint">
            每字段最多 5 个附件，单文件最大 20MB
          </Typography.Text>
          <div className="lh-attachment-list">
            <div className="lh-attachment-item">
              <div className="lh-attachment-thumb">
                <FileZipOutlined />
              </div>
              <div className="lh-attachment-main">
                <div className="lh-attachment-name">附件预览</div>
                <div className="lh-attachment-meta">图片 / PDF / Office / 压缩包</div>
              </div>
            </div>
          </div>
        </div>
      );
    case 'json-editor':
      return <pre className="field-show-text">{`{}`}</pre>;
    case 'llm-trigger':
      {
        const buttonText =
          typeof field.componentProps?.buttonText === 'string' && field.componentProps.buttonText.trim()
            ? field.componentProps.buttonText.trim()
            : '生成建议';
        const targetFields = resolveLlmTargetFields(field.componentProps);
        const targetText =
          targetFields.length > 0
            ? `应用到 ${targetFields.length} 个字段`
            : '未配置目标字段';
        return (
          <Space wrap>
            <Button size="small" type="primary" icon={<ThunderboltOutlined />}>
              {buttonText}
            </Button>
            <Typography.Text type="secondary">{targetText}</Typography.Text>
          </Space>
        );
      }
    default:
      return <Typography.Text type="secondary">布局容器</Typography.Text>;
  }
}

function resolveLlmTargetFields(componentProps?: Record<string, unknown>) {
  const result: string[] = [];
  const add = (value: unknown) => {
    const next = typeof value === 'string' ? value.trim() : '';
    if (next && !result.includes(next)) {
      result.push(next);
    }
  };
  if (Array.isArray(componentProps?.targetFields)) {
    componentProps.targetFields.forEach(add);
  }
  add(componentProps?.targetField);
  return result;
}

/** 右侧属性配置 */
function PropertyPanel({
  field,
  fields,
  rawPathOptions,
  onChange,
}: {
  field: SchemaField;
  fields: SchemaField[];
  rawPathOptions: Array<{ label: string; value: string }>;
  onChange: (patch: Partial<SchemaField>) => void;
}) {
  const fieldOptions = fields
    .filter((item) => item.fieldName)
    .map((item) => ({ label: `${item.label} (${item.fieldName})`, value: item.fieldName }));
  const targetFieldOptions = fields
    .filter((item) => item.id !== field.id && item.fieldName && isSubmittableField(item))
    .map((item) => ({ label: `${item.label} (${item.fieldName})`, value: item.fieldName }));
  const componentProps = field.componentProps ?? {};
  const llmTargetFields = resolveLlmTargetFields(componentProps);
  const llmTargetFieldDetails = llmTargetFields
    .map((fieldName) => fields.find((item) => item.fieldName === fieldName))
    .filter((item): item is SchemaField => Boolean(item));
  const llmContextPaths = Array.isArray(componentProps.contextPaths)
    ? componentProps.contextPaths.filter((item): item is string => typeof item === 'string')
    : [];
  const llmTaskInstruction =
    typeof componentProps.taskInstruction === 'string' ? componentProps.taskInstruction : '';
  const llmPromptTemplate =
    typeof componentProps.promptTemplate === 'string' ? componentProps.promptTemplate : '';
  const llmOutputInstruction =
    typeof componentProps.outputInstruction === 'string' ? componentProps.outputInstruction : '';
  const llmButtonText =
    typeof componentProps.buttonText === 'string' ? componentProps.buttonText : '';
  const updateComponentProps = (patch: Record<string, unknown>) => {
    onChange({
      componentProps: {
        ...componentProps,
        ...patch,
      },
    });
  };
  const validators = field.validators ?? [];
  const regexRule = validators.find((rule) => rule.type === 'regex');
  const customRule = validators.find((rule) => rule.type !== 'regex');
  const upsertValidator = (rule: SchemaValidatorRule) => {
    const next = validators.filter((item) => item.type !== rule.type);
    if (rule.type !== 'regex') {
      onChange({ validators: [...next.filter((item) => item.type === 'regex'), rule] });
      return;
    }
    onChange({
      validators: [...next, rule],
      validations: { ...field.validations, regex: rule.pattern },
    });
  };
  const removeValidator = (type: SchemaValidatorType) => {
    const next = validators.filter((rule) => rule.type !== type);
    onChange({
      validators: next,
      validations:
        type === 'regex'
          ? { ...field.validations, regex: undefined }
          : { ...field.validations, customFn: undefined },
    });
  };
  return (
    <div className="property-panel">
      <Typography.Text className="property-panel-title">属性配置 · {field.fieldName}</Typography.Text>
      <Tabs
        defaultActiveKey="basic"
        items={[
          {
            key: 'basic',
            label: '基础',
            children: (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Field label="字段名">
                  <Input
                    value={field.fieldName}
                    onChange={(event) => onChange({ fieldName: event.target.value })}
                  />
                </Field>
                <Field label="标签">
                  <Input
                    value={field.label}
                    onChange={(event) => onChange({ label: event.target.value })}
                  />
                </Field>
                <Field label="必填">
                  <Switch
                    checked={!!field.required}
                    onChange={(checked) => onChange({ required: checked })}
                  />
                </Field>
                <Field label="占位符">
                  <Input
                    value={field.placeholder ?? ''}
                    onChange={(event) => onChange({ placeholder: event.target.value })}
                  />
                </Field>
                <Field label="帮助说明">
                  <Input
                    value={field.helpText ?? ''}
                    onChange={(event) => onChange({ helpText: event.target.value })}
                  />
                </Field>
                {field.kind === 'multi-tab' && (
                  <Field label="Tab 配置">
                    <LayoutTabsEditor
                      tabs={normalizeLayoutTabs(field)}
                      onChange={(nextTabs) => {
                        const nextField = withLayoutTabs(field, nextTabs);
                        onChange({
                          componentProps: nextField.componentProps,
                          children: undefined,
                        });
                      }}
                    />
                  </Field>
                )}
                {(field.kind === 'text-single' || field.kind === 'text-multi') && (
                  <Field label="最大长度">
                    <Input
                      type="number"
                      value={field.maxLength ?? ''}
                      onChange={(event) =>
                        onChange({ maxLength: Number(event.target.value) || undefined })
                      }
                    />
                  </Field>
                )}
                {(field.kind === 'single-choice' ||
                  field.kind === 'multi-choice' ||
                  field.kind === 'tags') && (
                  <Field label="选项">
                    <OptionsEditor
                      options={field.options ?? []}
                      onChange={(next) => onChange({ options: next })}
                    />
                  </Field>
                )}
                {field.kind === 'show-item' && (
                  <>
                    <Field label="绑定 raw 字段">
                      <Select
                        allowClear
                        showSearch
                        placeholder="选择 raw_payload 字段路径"
                        options={rawPathOptions}
                        value={field.sourcePath}
                        onChange={(value) => onChange({ sourcePath: value })}
                      />
                    </Field>
                    <Field label="兜底展示文本">
                      <Input.TextArea
                        rows={3}
                        value={field.showText ?? ''}
                        onChange={(event) => onChange({ showText: event.target.value })}
                      />
                    </Field>
                  </>
                )}
                {field.kind === 'llm-trigger' && (
                  <div className="llm-trigger-config">
                    <Alert
                      type="info"
                      showIcon
                      message="LLM 触发组件是操作控件,不写入答案 JSON。"
                    />
                    <Field label="目标字段">
                      <Select
                        allowClear
                        showSearch
                        mode="multiple"
                        maxTagCount="responsive"
                        placeholder="选择 AI 建议要应用到的字段"
                        options={targetFieldOptions}
                        value={llmTargetFields}
                        onChange={(value) =>
                          updateComponentProps({ targetFields: value, targetField: '' })
                        }
                      />
                    </Field>
                    {llmTargetFieldDetails.some((item) => item.options?.length) && (
                      <div className="llm-option-mapping-preview">
                        <Typography.Text type="secondary">选项映射预览</Typography.Text>
                        {llmTargetFieldDetails
                          .filter((item) => item.options?.length)
                          .map((target) => (
                            <div key={target.fieldName} className="llm-option-mapping-group">
                              <Typography.Text strong>
                                {target.label} ({target.fieldName})
                              </Typography.Text>
                              <Space wrap size={[6, 6]}>
                                {(target.options ?? []).map((option) => (
                                  <Tag key={option.value} className="llm-option-mapping-tag">
                                    {option.value} = {option.label}
                                  </Tag>
                                ))}
                              </Space>
                            </div>
                          ))}
                      </div>
                    )}
                    <Field label="上下文 raw 字段">
                      <Select
                        allowClear
                        showSearch
                        mode="multiple"
                        placeholder="不选择时使用整题 raw_payload"
                        options={rawPathOptions}
                        value={llmContextPaths}
                        onChange={(value) => updateComponentProps({ contextPaths: value })}
                      />
                    </Field>
                    <Field label="任务语义说明">
                      <Input.TextArea
                        rows={4}
                        maxLength={2000}
                        showCount
                        placeholder="说明当前数据集和标注任务的业务含义，例如 PREFERRED=A 表示 A 优于 B，但目标字段要判断是否通过。"
                        value={llmTaskInstruction}
                        onChange={(event) =>
                          updateComponentProps({ taskInstruction: event.target.value })
                        }
                      />
                    </Field>
                    <Field label="按钮文案">
                      <Input
                        value={llmButtonText}
                        placeholder="生成建议"
                        onChange={(event) =>
                          updateComponentProps({ buttonText: event.target.value })
                        }
                      />
                    </Field>
                    <Field label="生成规则 / 判断规则">
                      <Input.TextArea
                        rows={5}
                        maxLength={3000}
                        showCount
                        placeholder="告诉模型如何根据任务语义、上下文和已填写答案生成目标字段候选值"
                        value={llmPromptTemplate}
                        onChange={(event) =>
                          updateComponentProps({
                            promptTemplate: event.target.value,
                            outputMode: 'structured',
                          })
                        }
                      />
                    </Field>
                    <Field label="输出要求">
                      <Input.TextArea
                        rows={3}
                        maxLength={1200}
                        showCount
                        placeholder="补充输出要求，例如建议文案使用“通过/不通过”，不要直接展示 option_a/option_b。"
                        value={llmOutputInstruction}
                        onChange={(event) =>
                          updateComponentProps({ outputInstruction: event.target.value })
                        }
                      />
                    </Field>
                  </div>
                )}
              </Space>
            ),
          },
          {
            key: 'validate',
            label: '校验',
            children: (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Field label="正则">
                  <Input
                    value={regexRule?.pattern ?? field.validations?.regex ?? ''}
                    onChange={(event) => {
                      const pattern = event.target.value;
                      if (!pattern) {
                        removeValidator('regex');
                        return;
                      }
                      upsertValidator({ type: 'regex', pattern, message: '格式不符合要求' });
                    }}
                  />
                </Field>
                <Field label="白名单校验">
                  <Select
                    allowClear
                    placeholder="选择后端白名单校验"
                    options={[
                      { label: '禁止 Emoji', value: 'noEmoji' },
                      { label: '必须是 JSON 对象', value: 'jsonObject' },
                      { label: '长度区间', value: 'lengthBetween' },
                    ]}
                    value={customRule?.type}
                    onChange={(value?: SchemaValidatorType) => {
                      if (!value) {
                        if (customRule) removeValidator(customRule.type);
                        return;
                      }
                      upsertValidator(
                        value === 'lengthBetween'
                          ? { type: value, min: 1, max: field.maxLength ?? 100 }
                          : { type: value },
                      );
                    }}
                  />
                </Field>
                {customRule?.type === 'lengthBetween' && (
                  <Space size={8}>
                    <Input
                      type="number"
                      addonBefore="最小"
                      value={customRule.min ?? ''}
                      onChange={(event) =>
                        upsertValidator({
                          ...customRule,
                          min: Number(event.target.value) || 0,
                        })
                      }
                    />
                    <Input
                      type="number"
                      addonBefore="最大"
                      value={customRule.max ?? ''}
                      onChange={(event) =>
                        upsertValidator({
                          ...customRule,
                          max: Number(event.target.value) || undefined,
                        })
                      }
                    />
                  </Space>
                )}
              </Space>
            ),
          },
          {
            key: 'linkage',
            label: '联动',
            children: (
              <ReactionRulesEditor
                currentField={field}
                fields={fields}
                rules={field.reactions ?? []}
                fieldOptions={fieldOptions}
                onChange={(reactions) => onChange({ reactions })}
              />
            ),
          },
        ]}
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="property-field">
      <div className="property-field-label">{label}</div>
      <div className="property-field-control">{children}</div>
    </div>
  );
}

function LayoutTabsEditor({
  tabs,
  onChange,
}: {
  tabs: SchemaLayoutTab[];
  onChange: (next: SchemaLayoutTab[]) => void;
}) {
  const normalizedTabs = tabs.length > 0 ? tabs : [{ id: 'tab_1', label: 'Tab 1', children: [] }];

  const updateAt = (index: number, patch: Partial<SchemaLayoutTab>) => {
    onChange(normalizedTabs.map((tab, currentIndex) => (
      currentIndex === index ? { ...tab, ...patch } : tab
    )));
  };

  const removeAt = (index: number) => {
    if (normalizedTabs.length <= 1) return;
    onChange(normalizedTabs.filter((_, currentIndex) => currentIndex !== index));
  };

  const moveAt = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= normalizedTabs.length) return;
    const next = normalizedTabs.slice();
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    onChange(next);
  };

  const addTab = () => {
    let index = normalizedTabs.length + 1;
    const existingIds = new Set(normalizedTabs.map((tab) => tab.id));
    while (existingIds.has(`tab_${index}`)) index += 1;
    onChange([
      ...normalizedTabs,
      { id: `tab_${index}`, label: `Tab ${index}`, children: [] },
    ]);
  };

  return (
    <div className="layout-tabs-editor">
      {normalizedTabs.map((tab, index) => (
        <div key={tab.id} className="layout-tabs-editor-row">
          <span className="layout-tabs-editor-index">{index + 1}</span>
          <Input
            value={tab.label}
            placeholder={`Tab ${index + 1}`}
            onChange={(event) => updateAt(index, { label: event.target.value })}
          />
          <Tag className="layout-tabs-editor-count">{(tab.children ?? []).length}</Tag>
          <Button
            type="text"
            size="small"
            icon={<ArrowUpOutlined />}
            disabled={index === 0}
            onClick={() => moveAt(index, -1)}
            aria-label={`上移 ${tab.label}`}
          />
          <Button
            type="text"
            size="small"
            icon={<ArrowDownOutlined />}
            disabled={index === normalizedTabs.length - 1}
            onClick={() => moveAt(index, 1)}
            aria-label={`下移 ${tab.label}`}
          />
          <Button
            type="text"
            size="small"
            danger
            icon={<CloseOutlined />}
            disabled={normalizedTabs.length <= 1}
            onClick={() => removeAt(index)}
            aria-label={`删除 ${tab.label}`}
          />
        </div>
      ))}
      <Button
        type="dashed"
        block
        icon={<PlusOutlined />}
        onClick={addTab}
        className="layout-tabs-editor-add"
      >
        添加 Tab
      </Button>
    </div>
  );
}

function getSourceField(fields: SchemaField[], fieldName?: string) {
  return fields.find((field) => field.fieldName === fieldName);
}

function ReactionValueInput({
  fields,
  rule,
  onChange,
}: {
  fields: SchemaField[];
  rule: SchemaReactionRule;
  onChange: (value: unknown) => void;
}) {
  const sourceField = getSourceField(fields, rule.sourceField);
  const options = (sourceField?.options ?? []).map((option) => ({
    label: `${option.label} (${option.value})`,
    value: option.value,
  }));
  if (options.length === 0) {
    return (
      <Input
        placeholder="例如: option_b"
        value={String(rule.value ?? '')}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  return (
    <Select
      allowClear
      showSearch
      placeholder="选择匹配选项"
      options={options}
      value={rule.value == null || rule.value === '' ? undefined : String(rule.value)}
      onChange={(value) => onChange(value)}
    />
  );
}

/**
 * 选项编辑器:一项一个独立 Input,右侧有删除按钮,底部"添加选项"。
 * - value 自动保留原 value(便于已有数据持续映射),不存在时按 `opt_${idx+1}` 兜底
 * - 空 label 仍允许输入中状态保留,在序列化保存时由上层做 trim/过滤
 */
function OptionsEditor({
  options,
  onChange,
}: {
  options: Array<{ value: string; label: string }>;
  onChange: (next: Array<{ value: string; label: string }>) => void;
}) {
  const updateAt = (idx: number, patch: Partial<{ value: string; label: string }>) => {
    const next = options.map((opt, i) => (i === idx ? { ...opt, ...patch } : opt));
    onChange(next);
  };

  const removeAt = (idx: number) => {
    onChange(options.filter((_, i) => i !== idx));
  };

  const addOne = () => {
    const idx = options.length;
    onChange([...options, { value: `opt_${idx + 1}`, label: '' }]);
  };

  return (
    <div className="options-editor">
      {options.length === 0 && (
        <Typography.Text type="secondary" className="options-editor-empty">
          暂无选项,点击下方"添加选项"开始编辑。
        </Typography.Text>
      )}
      {options.map((opt, idx) => (
        <div key={idx} className="options-editor-row">
          <span className="options-editor-index">{idx + 1}</span>
          <Input
            placeholder={`选项 ${idx + 1}`}
            value={opt.label}
            onChange={(event) => updateAt(idx, { label: event.target.value })}
          />
          <Button
            type="text"
            size="small"
            icon={<CloseOutlined />}
            onClick={() => removeAt(idx)}
            aria-label={`删除选项 ${idx + 1}`}
            className="options-editor-remove"
          />
        </div>
      ))}
      <Button
        type="dashed"
        block
        icon={<PlusOutlined />}
        onClick={addOne}
        className="options-editor-add"
      >
        添加选项
      </Button>
    </div>
  );
}

function SchemaCheckPanel({ result }: { result: { valid: boolean; errors: SchemaDiagnostic[]; warnings: SchemaDiagnostic[] } }) {
  const diagnostics = [...result.errors, ...result.warnings];
  return (
    <div className={`schema-check-panel ${result.valid ? 'is-valid' : 'has-error'}`}>
      <Space direction="vertical" size={6} style={{ width: '100%' }}>
        <Space wrap>
          <Tag color={result.valid ? 'success' : 'error'}>
            {result.valid ? 'Schema 检查通过' : `Schema 有 ${result.errors.length} 个错误`}
          </Tag>
          {result.warnings.length > 0 && <Tag color="gold">{result.warnings.length} 个警告</Tag>}
          <Typography.Text type="secondary">
            发布前会强制执行同一套检查,保证 Designer 与 Renderer 使用的 Schema 可运行。
          </Typography.Text>
        </Space>
        {diagnostics.length > 0 && (
          <div className="schema-check-list">
            {diagnostics.slice(0, 4).map((item, index) => (
              <div key={`${item.code}-${item.fieldName ?? index}`} className="schema-check-item">
                <Tag color={item.level === 'error' ? 'error' : 'gold'}>{item.code}</Tag>
                <span>{item.message}</span>
              </div>
            ))}
            {diagnostics.length > 4 && (
              <Typography.Text type="secondary">还有 {diagnostics.length - 4} 条检查结果...</Typography.Text>
            )}
          </div>
        )}
      </Space>
    </div>
  );
}

function ReactionRulesEditor({
  currentField,
  fields,
  rules,
  fieldOptions,
  onChange,
}: {
  currentField: SchemaField;
  fields: SchemaField[];
  rules: SchemaReactionRule[];
  fieldOptions: Array<{ label: string; value: string }>;
  onChange: (next: SchemaReactionRule[]) => void;
}) {
  const updateAt = (idx: number, patch: Partial<SchemaReactionRule>) => {
    onChange(rules.map((rule, i) => (i === idx ? { ...rule, ...patch } : rule)));
  };
  const removeAt = (idx: number) => {
    onChange(rules.filter((_, i) => i !== idx));
  };
  const addRule = () => {
    onChange([
      ...rules,
      {
        sourceField: fieldOptions[0]?.value ?? '',
        operator: 'eq',
        value: '',
        targetField: fieldOptions[1]?.value ?? fieldOptions[0]?.value ?? '',
        action: 'visibleRequired',
      },
    ]);
  };

  // 操作符 / 动作选项,集中维护避免重复
  const operatorOptions = [
    { label: '等于', value: 'eq' },
    { label: '不等于', value: 'ne' },
    { label: '为空', value: 'empty' },
    { label: '不为空', value: 'notEmpty' },
    { label: '包含', value: 'includes' },
  ];
  const actionOptions = [
    { label: '显示', value: 'visible' },
    { label: '隐藏', value: 'hidden' },
    { label: '显示并必填', value: 'visibleRequired' },
    { label: '必填', value: 'required' },
    { label: '非必填', value: 'optional' },
  ];

  return (
    <div className="reaction-editor">
      <Alert
        type="info"
        showIcon
        message={`当前配置字段: ${currentField.label || currentField.fieldName} (${currentField.fieldName})`}
      />
      {rules.length === 0 && (
        <div className="reaction-editor-empty">
          <Typography.Text type="secondary">
            暂无联动规则。点击下方"新增联动规则"开始配置。
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            规则会在 Designer 预览和 Labeler Renderer 中同时生效。
          </Typography.Text>
        </div>
      )}
      {rules.map((rule, idx) => {
        const needValue = !['empty', 'notEmpty'].includes(rule.operator);
        return (
          <div key={idx} className="linkage-rule">
            <div className="linkage-rule-head">
              <span className="linkage-rule-index">规则 {idx + 1}</span>
              <Button
                size="small"
                type="text"
                icon={<CloseOutlined />}
                onClick={() => removeAt(idx)}
                className="linkage-rule-remove"
                aria-label={`删除规则 ${idx + 1}`}
              />
            </div>

            {/* IF 条件块 */}
            <div className="linkage-rule-section">
              <span className="linkage-rule-tag is-when">IF</span>
              <div className="linkage-rule-row">
                <Field label="来源字段">
                  <Select
                    placeholder="选择字段"
                    options={fieldOptions}
                    value={rule.sourceField}
                    onChange={(value) => updateAt(idx, { sourceField: value, value: undefined })}
                  />
                </Field>
                <Field label="比较">
                  <Select
                    options={operatorOptions}
                    value={rule.operator}
                    onChange={(value: SchemaReactionOperator) =>
                      updateAt(idx, { operator: value })
                    }
                  />
                </Field>
                {needValue && (
                  <Field label="匹配值">
                    <Input
                      placeholder="例如:是"
                      value={String(rule.value ?? '')}
                      onChange={(event) => updateAt(idx, { value: event.target.value })}
                      style={{ display: getSourceField(fields, rule.sourceField)?.options?.length ? 'none' : undefined }}
                    />
                    {getSourceField(fields, rule.sourceField)?.options?.length ? (
                      <ReactionValueInput
                        fields={fields}
                        rule={rule}
                        onChange={(value) => updateAt(idx, { value })}
                      />
                    ) : null}
                  </Field>
                )}
              </div>
            </div>

            {/* THEN 动作块 */}
            <div className="linkage-rule-section">
              <span className="linkage-rule-tag is-then">THEN</span>
              <div className="linkage-rule-row">
                <Field label="目标字段">
                  <Select
                    placeholder="选择字段"
                    options={fieldOptions}
                    value={rule.targetField}
                    onChange={(value) => updateAt(idx, { targetField: value })}
                  />
                </Field>
                <Field label="动作">
                  <Select
                    options={actionOptions}
                    value={rule.action}
                    onChange={(value: SchemaReactionAction) =>
                      updateAt(idx, { action: value })
                    }
                  />
                </Field>
              </div>
            </div>
          </div>
        );
      })}
      <Button
        type="dashed"
        icon={<PlusOutlined />}
        block
        onClick={addRule}
        className="reaction-editor-add"
      >
        新增联动规则
      </Button>
    </div>
  );
}

/** 表单预览 */
function PreviewRenderer({ fields }: { fields: SchemaField[] }) {
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {fields.map((field) => (
        <div key={field.id} className="preview-field">
          <div className="preview-field-label">
            {field.label}
            {field.required && <span className="field-required">*</span>}
          </div>
          {renderFieldPreview(field)}
        </div>
      ))}
    </Space>
  );
}

function normalizePreviewItem(item?: DatasetItem): Record<string, unknown> | null {
  if (!item || typeof item !== 'object') return null;
  const rawPayload = (item as Record<string, unknown>).rawPayload;
  if (rawPayload && typeof rawPayload === 'object') {
    return rawPayload as Record<string, unknown>;
  }
  return item as Record<string, unknown>;
}

function extractRawPaths(payload: Record<string, unknown>) {
  const paths = new Set<string>(['prompt', 'origin_title', 'model_answer', 'reference', 'content_markdown']);
  const walk = (value: unknown, prefix: string) => {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) {
      if (prefix) paths.add(prefix);
      return;
    }
    Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
      const next = prefix ? `${prefix}.${key}` : key;
      if (child != null && typeof child === 'object' && !Array.isArray(child)) {
        walk(child, next);
      } else {
        paths.add(next);
      }
    });
  };
  walk(payload, '');
  return Array.from(paths).sort();
}
