import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownOutlined,
  ArrowLeftOutlined,
  ArrowUpOutlined,
  CheckOutlined,
  CloseOutlined,
  CodeOutlined,
  DeleteOutlined,
  DragOutlined,
  ExportOutlined,
  EyeOutlined,
  FieldStringOutlined,
  FileTextOutlined,
  FileZipOutlined,
  FontSizeOutlined,
  FormOutlined,
  GroupOutlined,
  PicCenterOutlined,
  PlusOutlined,
  SaveOutlined,
  SettingOutlined,
  TagsOutlined,
  ThunderboltOutlined,
  UnorderedListOutlined,
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
  DragOverEvent,
  DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Alert,
  App as AntdApp,
  Button,
  Drawer,
  Empty,
  Input,
  Modal,
  Segmented,
  Select,
  Space,
  Switch,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { createPortal } from 'react-dom';

import { getApiErrorMessage } from '../../api/client';
import { datasetApi } from '../../api/dataset';
import { schemaApi } from '../../api/schema';
import { LabelHubFormRenderer, validateSchemaFields } from '../../modules/schema';
import type { DatasetItem, DatasetMeta } from '../../types/dataset';
import type {
  MaterialCategory,
  MaterialKind,
  MaterialMeta,
  SchemaDiagnostic,
  SchemaField,
  SchemaReactionAction,
  SchemaReactionOperator,
  SchemaReactionRule,
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
  { kind: 'llm-trigger', label: 'LLM 触发组件', category: 'advanced', fieldPrefix: 'llm', submittable: true },
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

const CANVAS_DROPPABLE_ID = 'canvas-droppable';

const designerCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length === 0) {
    return args.pointerCoordinates ? [] : closestCenter(args);
  }

  const directFieldCollisions = pointerCollisions.filter(
    (collision) => String(collision.id) !== CANVAS_DROPPABLE_ID,
  );
  if (directFieldCollisions.length > 0) {
    return directFieldCollisions;
  }

  const fieldContainers = args.droppableContainers.filter(
    (container) => String(container.id) !== CANVAS_DROPPABLE_ID,
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
  return {
    id: uid(),
    kind: meta.kind,
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
    helpText: meta.kind === 'llm-trigger' ? 'LLM 调用入口已预留,真实模型调用将在 AI Agent 阶段接入。' : undefined,
  };
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

  const [schema, setSchema] = useState<SchemaVersion>({
    versionId: versionId ?? `draft-${Date.now()}`,
    versionNumber: versionId ? 'r12' : 'r-draft',
    taskId: undefined,
    taskTitle: undefined,
    name: isNew ? '新建模板' : '商品清洗 · v3',
    description: 'Schema 与渲染解耦:左物料 → 中画布 → 右属性,产物为可序列化 JSON Schema。',
    datasetId: undefined,
    datasetName: undefined,
    status: 'draft',
    fields: isNew ? [] : defaultDemoFields,
    updatedAt: new Date().toISOString(),
    createdBy: 'Owner Demo',
  });

  const [activeFieldId, setActiveFieldId] = useState<string | null>(
    schema.fields[0]?.id ?? null,
  );
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
          setSchema(real);
          setActiveFieldId(real.fields[0]?.id ?? null);
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
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const items = await datasetApi.listItems(previewDatasetId);
        if (cancelled) return;
        setPreviewItems(items);
        setPreviewItemIndex(0);
      } catch {
        if (!cancelled) {
          setPreviewItems([]);
          message.warning('数据集条目加载失败,预览将使用内置示例数据。');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [previewDatasetId, message]);

  const activeField = useMemo(
    () => schema.fields.find((f) => f.id === activeFieldId) ?? null,
    [schema.fields, activeFieldId],
  );
  const schemaCheck = useMemo(() => validateSchemaFields(schema.fields), [schema.fields]);
  const previewRawPayload = useMemo(
    () => normalizePreviewItem(previewItems[previewItemIndex]) ?? fallbackPreviewPayload,
    [previewItems, previewItemIndex],
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

  function updateField(fieldId: string, patch: Partial<SchemaField>) {
    if (isPublished) return;
    setSchema((prev) => ({
      ...prev,
      fields: prev.fields.map((f) => (f.id === fieldId ? { ...f, ...patch } : f)),
    }));
  }

  function updateSchemaMeta(
    patch: Partial<Pick<SchemaVersion, 'name' | 'description' | 'datasetId' | 'datasetName'>>,
  ) {
    setSchema((prev) => ({ ...prev, ...patch }));
  }

  function addMaterial(meta: MaterialMeta) {
    if (isPublished) return;
    setSchema((prev) => {
      const field = createField(meta, prev.fields);
      return { ...prev, fields: [...prev.fields, field] };
    });
  }

  function removeField(fieldId: string) {
    if (isPublished) return;
    setSchema((prev) => {
      const next = prev.fields.filter((f) => f.id !== fieldId);
      return { ...prev, fields: next };
    });
    if (activeFieldId === fieldId) {
      setActiveFieldId(null);
    }
  }

  function moveField(fieldId: string, direction: -1 | 1) {
    if (isPublished) return;
    setSchema((prev) => {
      const idx = prev.fields.findIndex((f) => f.id === fieldId);
      if (idx < 0) return prev;
      const target = idx + direction;
      if (target < 0 || target >= prev.fields.length) return prev;
      const next = prev.fields.slice();
      const [item] = next.splice(idx, 1);
      next.splice(target, 0, item);
      return { ...prev, fields: next };
    });
  }

  function readDragPayload(event: DragStartEvent | DragOverEvent | DragEndEvent | DragCancelEvent) {
    return event.active.data.current as DesignerDragPayload | undefined;
  }

  function getDraggedCenterY(event: DragOverEvent | DragEndEvent) {
    const activeRect = event.active.rect.current.translated ?? event.active.rect.current.initial;
    return activeRect ? activeRect.top + activeRect.height / 2 : null;
  }

  function clearDragState() {
    setDraggingMaterial(null);
    setDraggingFieldId(null);
    setDropIndicator(null);
  }

  function resolveDropIndicator(event: DragOverEvent | DragEndEvent): DropIndicator | null {
    const { active, over } = event;
    if (!over) return null;

    const activeData = readDragPayload(event);
    const overId = String(over.id);

    if (overId === CANVAS_DROPPABLE_ID) {
      const lastField = schema.fields[schema.fields.length - 1];
      if (!lastField) return null;
      if (activeData?.type === 'field' && activeData.fieldId === lastField.id) return null;
      return { fieldId: lastField.id, position: 'after' };
    }

    const overField = schema.fields.find((field) => field.id === overId);
    if (!overField) return null;
    if (activeData?.type === 'field' && activeData.fieldId === overField.id) return null;

    const draggedCenterY = getDraggedCenterY(event);
    const overCenterY = over.rect.top + over.rect.height / 2;

    return {
      fieldId: overField.id,
      position: draggedCenterY != null && draggedCenterY > overCenterY ? 'after' : 'before',
    };
  }

  function handleDragOver(event: DragOverEvent) {
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

    if (activeData?.type === 'material') {
      // 物料拖到画布
      setSchema((prev) => {
        const field = createField(activeData.meta, prev.fields);
        const next = prev.fields.slice();
        if (overId === CANVAS_DROPPABLE_ID) {
          next.push(field);
        } else {
          const targetId = placement?.fieldId ?? overId;
          const idx = next.findIndex((f) => f.id === targetId);
          if (idx === -1) next.push(field);
          else next.splice(idx + (placement?.position === 'after' ? 1 : 0), 0, field);
        }
        return { ...prev, fields: next };
      });
      return;
    }

    if (activeData?.type === 'field') {
      // 字段间排序
      setSchema((prev) => {
        const fromIdx = prev.fields.findIndex((f) => f.id === activeData.fieldId);
        if (fromIdx === -1) return prev;
        let insertIdx: number;
        if (overId === CANVAS_DROPPABLE_ID) {
          insertIdx = prev.fields.length;
        } else {
          if (!placement) return prev;
          const overIdx = prev.fields.findIndex((f) => f.id === placement.fieldId);
          if (overIdx === -1) return prev;
          insertIdx = overIdx + (placement.position === 'after' ? 1 : 0);
        }
        const next = prev.fields.slice();
        const [item] = next.splice(fromIdx, 1);
        const normalizedInsertIdx = fromIdx < insertIdx ? insertIdx - 1 : insertIdx;
        if (fromIdx === normalizedInsertIdx) return prev;
        next.splice(normalizedInsertIdx, 0, item);
        return { ...prev, fields: next };
      });
    }
  }

  async function validateTemplateBeforePersist() {
    if (!schema.name.trim()) {
      message.warning('请先填写模板名称');
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
        fields: schema.fields,
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
    if (schema.versionId.startsWith('draft-')) {
      const created = await schemaApi.createStandaloneDraft({
        name,
        taskId: schema.taskId,
        datasetId: schema.datasetId ?? '',
        datasetName: schema.datasetName ?? '',
        description,
        fields: schema.fields,
      });
      setSchema(created);
      setActiveFieldId(
        created.fields.some((field) => field.id === currentActiveFieldId)
          ? currentActiveFieldId
          : created.fields[0]?.id ?? null,
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
      fields: schema.fields,
    });
    setSchema(updated);
    setActiveFieldId(
      updated.fields.some((field) => field.id === currentActiveFieldId)
        ? currentActiveFieldId
        : updated.fields[0]?.id ?? null,
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
          setActiveFieldId(withdrawn.fields[0]?.id ?? null);
          setUsingFallback(false);
          message.success('模板已收回,现在可以继续编辑');
        } catch (error) {
          message.error(getApiErrorMessage(error, '收回发布失败,请确认模板状态。'));
        }
      },
    });
  }

  const submittableCount = schema.fields.filter((f) => f.kind !== 'show-item' && f.kind !== 'group' && f.kind !== 'multi-tab').length;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={designerCollisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="designer-shell">
      {/* 顶部工具栏 */}
      <div className="designer-topbar">
        <Space>
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate('/owner/templates')}
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
        <Space>
          <Tag className="designer-version-tag">当前版本 {schema.versionNumber}</Tag>
          {schema.taskId && (
            <Tag color="blue">绑定任务 {schema.taskId}</Tag>
          )}
          <Button icon={<EyeOutlined />} onClick={() => setPreviewOpen(true)}>
            预览
          </Button>
          <Button icon={<ExportOutlined />} onClick={() => setExportOpen(true)}>
            导出 Schema JSON
          </Button>
          <Button icon={<SaveOutlined />} disabled={isPublished} onClick={() => void handleSave()}>
            保存草稿
          </Button>
          <Button type="primary" icon={<CheckOutlined />} disabled={isPublished} onClick={handlePublish}>
            保存并发布
          </Button>
          {isPublished && (
            <Button danger onClick={() => void handleWithdraw()}>
              收回发布
            </Button>
          )}
        </Space>
      </div>

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
        <strong> {schema.fields.length} </strong>
        个字段({submittableCount} 个参与提交)。
      </div>

      <SchemaCheckPanel result={schemaCheck} />

      <div className="designer-grid">
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
          <Tabs
            defaultActiveKey="basic"
            className="designer-tabs"
            tabBarExtraContent={
              <Typography.Text type="secondary" className="designer-tab-tip">
                CMD+S 保存 · 点击物料追加字段
              </Typography.Text>
            }
            items={[
              {
                key: 'basic',
                label: '基础信息',
                children: (
                  <Canvas
                    fields={schema.fields}
                    activeFieldId={activeFieldId}
                    dropIndicator={dropIndicator}
                    onSelect={setActiveFieldId}
                    onMove={moveField}
                    onRemove={removeField}
                    onAdd={() => message.info('从左侧物料栏点击物料即可追加新字段')}
                  />
                ),
              },
              { key: 'review', label: '标注', children: <ReviewPlaceholder /> },
              {
                key: 'plus',
                label: (
                  <span>
                    <PlusOutlined /> 新 Tab
                  </span>
                ),
                children: <ReviewPlaceholder />,
              },
            ]}
          />
        </div>

        {/* 右:属性配置 */}
        <div className="designer-right">
          {activeField ? (
            <PropertyPanel
              field={activeField}
              fields={schema.fields}
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
              onChange={(value) => setPreviewDatasetId(value)}
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
              onChange={(value) => setPreviewItemIndex(value)}
            />
          </Space>
          <LabelHubFormRenderer
            schema={schema.fields}
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
              {schema.fields.find((f) => f.id === draggingFieldId)?.label ?? '字段'}
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
  fields,
  activeFieldId,
  dropIndicator,
  onSelect,
  onMove,
  onRemove,
  onAdd,
}: {
  fields: SchemaField[];
  activeFieldId: string | null;
  dropIndicator: DropIndicator | null;
  onSelect: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: CANVAS_DROPPABLE_ID });

  if (fields.length === 0) {
    return (
      <div
        ref={setNodeRef}
        className={`canvas-empty ${isOver ? 'is-drop-over' : ''}`}
      >
        <Empty description="从左侧物料拖入此处,或点击物料卡片直接追加字段" />
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
          />
        ))}
        <button type="button" className="canvas-add" onClick={onAdd}>
          <PlusOutlined /> 拖入此处新增字段
        </button>
      </div>
    </SortableContext>
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
}) {
  const submittable =
    field.kind !== 'show-item' && field.kind !== 'group' && field.kind !== 'multi-tab';
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
      className={`field-card ${active ? 'is-active' : ''} ${
        dropPosition ? `is-drop-${dropPosition}` : ''
      }`}
      onClick={onSelect}
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
          {!submittable && <Tag className="field-show-tag">ShowItem · 不参与提交</Tag>}
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
      <div className="field-card-preview">{renderFieldPreview(field)}</div>
      {dropPosition === 'after' && <span className="field-drop-indicator is-after" />}
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
      return <Input.TextArea placeholder="富文本内容(预览占位)" disabled rows={3} />;
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
      return <div className="field-show-text">📎 文件 / 图片上传(支持 jpg / png / mp4)</div>;
    case 'json-editor':
      return <pre className="field-show-text">{`{}`}</pre>;
    case 'llm-trigger':
      return (
        <Space>
          <Button size="small" type="primary">
            生成参考
          </Button>
          <Typography.Text type="secondary">{field.placeholder}</Typography.Text>
        </Space>
      );
    default:
      return <Typography.Text type="secondary">布局容器</Typography.Text>;
  }
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
  rules,
  fieldOptions,
  onChange,
}: {
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
        action: 'hidden',
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
    { label: '必填', value: 'required' },
    { label: '非必填', value: 'optional' },
  ];

  return (
    <div className="reaction-editor">
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
                    onChange={(value) => updateAt(idx, { sourceField: value })}
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
                    />
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

function ReviewPlaceholder() {
  return (
    <div className="canvas-empty">
      <Empty
        description="该 Tab 用于配置审核侧渲染或打回时的副表单,后续阶段接入。"
      />
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
