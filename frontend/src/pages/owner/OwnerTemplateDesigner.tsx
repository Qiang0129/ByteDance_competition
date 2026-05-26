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
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
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

import { ApiError } from '../../api/client';
import { schemaApi } from '../../api/schema';
import type {
  MaterialCategory,
  MaterialKind,
  MaterialMeta,
  SchemaField,
  SchemaVersion,
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

/** 默认样例字段(对齐图里那套商品清洗模板) */
const defaultDemoFields: SchemaField[] = [
  {
    id: 'f-show',
    kind: 'show-item',
    fieldName: 'origin_title',
    label: '原始商品标题(展示项)',
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
    linkages: [
      { when: 'category == "fresh"', hide: ['size_table'], show: ['shelf_life'] },
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
  };
}

function getApiErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError && error.payload && typeof error.payload === 'object') {
    const payload = error.payload as { message?: unknown };
    if (typeof payload.message === 'string' && payload.message) {
      return payload.message;
    }
  }
  return fallback;
}

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
    status: 'draft',
    fields: isNew ? [] : defaultDemoFields,
    updatedAt: new Date().toISOString(),
    createdBy: 'Owner Demo',
  });

  const [activeFieldId, setActiveFieldId] = useState<string | null>(
    schema.fields[0]?.id ?? null,
  );
  const [previewOpen, setPreviewOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [usingFallback, setUsingFallback] = useState(false);
  /** 拖拽中的物料/字段,用于 DragOverlay 渲染半透明跟随物 */
  const [draggingMaterial, setDraggingMaterial] = useState<MaterialMeta | null>(null);
  const [draggingFieldId, setDraggingFieldId] = useState<string | null>(null);

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
          message.error('模板详情加载失败,请确认后端已启动并已执行 V4 数据库迁移。');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [versionId, isNew, message]);

  const activeField = useMemo(
    () => schema.fields.find((f) => f.id === activeFieldId) ?? null,
    [schema.fields, activeFieldId],
  );

  function updateField(fieldId: string, patch: Partial<SchemaField>) {
    setSchema((prev) => ({
      ...prev,
      fields: prev.fields.map((f) => (f.id === fieldId ? { ...f, ...patch } : f)),
    }));
  }

  function addMaterial(meta: MaterialMeta) {
    setSchema((prev) => {
      const field = createField(meta, prev.fields);
      return { ...prev, fields: [...prev.fields, field] };
    });
  }

  function removeField(fieldId: string) {
    setSchema((prev) => {
      const next = prev.fields.filter((f) => f.id !== fieldId);
      return { ...prev, fields: next };
    });
    if (activeFieldId === fieldId) {
      setActiveFieldId(null);
    }
  }

  function moveField(fieldId: string, direction: -1 | 1) {
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

  /** dnd-kit drag start */
  function handleDragStart(event: DragStartEvent) {
    const { active } = event;
    const data = active.data.current as
      | { type: 'material'; meta: MaterialMeta }
      | { type: 'field'; fieldId: string }
      | undefined;
    if (data?.type === 'material') {
      setDraggingMaterial(data.meta);
    } else if (data?.type === 'field') {
      setDraggingFieldId(data.fieldId);
    }
  }

  /** dnd-kit drag end:三种情况
   *  1. 物料 → 画布字段卡 / 画布空白:按目标位置插入
   *  2. 字段 → 字段:arrayMove 调整顺序
   *  3. 拖到 canvas 外:取消
   */
  function handleDragEnd(event: DragEndEvent) {
    setDraggingMaterial(null);
    setDraggingFieldId(null);
    const { active, over } = event;
    if (!over) return;

    const activeData = active.data.current as
      | { type: 'material'; meta: MaterialMeta }
      | { type: 'field'; fieldId: string }
      | undefined;
    const overId = String(over.id);

    if (activeData?.type === 'material') {
      // 物料拖到画布
      setSchema((prev) => {
        const field = createField(activeData.meta, prev.fields);
        const next = prev.fields.slice();
        if (overId === 'canvas-droppable') {
          next.push(field);
        } else {
          // overId 是某个字段的 id,插到它前面
          const idx = next.findIndex((f) => f.id === overId);
          if (idx === -1) next.push(field);
          else next.splice(idx, 0, field);
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
        let toIdx: number;
        if (overId === 'canvas-droppable') {
          toIdx = prev.fields.length - 1;
        } else {
          toIdx = prev.fields.findIndex((f) => f.id === overId);
          if (toIdx === -1) return prev;
        }
        if (fromIdx === toIdx) return prev;
        return { ...prev, fields: arrayMove(prev.fields, fromIdx, toIdx) };
      });
    }
  }

  async function saveDraft(): Promise<SchemaVersion> {
    if (schema.versionId.startsWith('draft-')) {
      const created = await schemaApi.createStandaloneDraft({
        name: schema.name,
        taskId: schema.taskId,
        description: schema.description,
        fields: schema.fields,
      });
      setSchema(created);
      setActiveFieldId(created.fields[0]?.id ?? null);
      setUsingFallback(false);
      navigate(`/owner/templates/designer?versionId=${encodeURIComponent(created.versionId)}`, {
        replace: true,
      });
      return created;
    }

    const updated = await schemaApi.updateDraft(schema.versionId, {
      name: schema.name,
      taskId: schema.taskId,
      description: schema.description,
      fields: schema.fields,
    });
    setSchema(updated);
    setActiveFieldId(updated.fields[0]?.id ?? null);
    setUsingFallback(false);
    return updated;
  }

  async function handleSave() {
    try {
      await saveDraft();
      message.success('草稿已保存');
    } catch (error) {
      message.error(getApiErrorMessage(error, '草稿保存失败,请确认后端接口和模板状态。'));
    }
  }

  async function handlePublish() {
    Modal.confirm({
      title: '确认发布该 Schema 版本?',
      content:
        '发布后此版本将冻结,绑定的任务将按此版本渲染答题界面;后续修改需要新建草稿。',
      okText: '立即发布',
      onOk: async () => {
        try {
          const draft = schema.versionId.startsWith('draft-') ? await saveDraft() : schema;
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

  const submittableCount = schema.fields.filter((f) => f.kind !== 'show-item' && f.kind !== 'group' && f.kind !== 'multi-tab').length;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
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
          <Tag color={schema.status === 'published' ? 'success' : 'processing'}>
            {schema.status === 'published' ? '已发布' : '草稿'}
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
          <Button icon={<SaveOutlined />} onClick={() => void handleSave()}>
            保存草稿
          </Button>
          <Button type="primary" icon={<CheckOutlined />} onClick={handlePublish}>
            保存并发布
          </Button>
        </Space>
      </div>

      <div className="designer-subtitle">
        Schema 与渲染解耦:左物料 → 中画布 → 右属性,产物为可序列化 JSON Schema。当前模板包含
        <strong> {schema.fields.length} </strong>
        个字段({submittableCount} 个参与提交)。
      </div>

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
        <PreviewRenderer fields={schema.fields} />
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

      {/* 拖拽时的浮动跟随物 */}
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
      </DragOverlay>
    </DndContext>
  );
}

/** 中间画布 */
function Canvas({
  fields,
  activeFieldId,
  onSelect,
  onMove,
  onRemove,
  onAdd,
}: {
  fields: SchemaField[];
  activeFieldId: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: 'canvas-droppable' });

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
  isFirst,
  isLast,
  onSelect,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  field: SchemaField;
  active: boolean;
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
      className={`field-card ${active ? 'is-active' : ''}`}
      onClick={onSelect}
    >
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
  onChange,
}: {
  field: SchemaField;
  onChange: (patch: Partial<SchemaField>) => void;
}) {
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
                  <Field label="选项(逗号分隔)">
                    <Input
                      value={(field.options ?? []).map((o) => o.label).join(',')}
                      onChange={(event) => {
                        const labels = event.target.value
                          .split(/[,，]/)
                          .map((s) => s.trim())
                          .filter(Boolean);
                        onChange({
                          options: labels.map((label, idx) => ({
                            value: field.options?.[idx]?.value ?? `opt_${idx + 1}`,
                            label,
                          })),
                        });
                      }}
                    />
                  </Field>
                )}
                {field.kind === 'show-item' && (
                  <Field label="展示文本">
                    <Input.TextArea
                      rows={3}
                      value={field.showText ?? ''}
                      onChange={(event) => onChange({ showText: event.target.value })}
                    />
                  </Field>
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
                    value={field.validations?.regex ?? ''}
                    onChange={(event) =>
                      onChange({
                        validations: { ...field.validations, regex: event.target.value },
                      })
                    }
                  />
                </Field>
                <Field label="自定义函数">
                  <Select
                    allowClear
                    placeholder="选择白名单中的校验函数"
                    options={[
                      { label: 'noEmoji(value)', value: 'noEmoji(value)' },
                      { label: 'lengthBetween(value, 4, 35)', value: 'lengthBetween(value, 4, 35)' },
                      { label: 'isJsonObject(value)', value: 'isJsonObject(value)' },
                    ]}
                    value={field.validations?.customFn}
                    onChange={(value) =>
                      onChange({ validations: { ...field.validations, customFn: value } })
                    }
                  />
                </Field>
              </Space>
            ),
          },
          {
            key: 'linkage',
            label: '联动',
            children: (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                {(field.linkages ?? []).map((rule, idx) => (
                  <div key={idx} className="linkage-rule">
                    <div className="linkage-rule-when">当 <code>{rule.when}</code> 时</div>
                    {rule.hide && rule.hide.length > 0 && (
                      <div>隐藏 {rule.hide.map((f) => <code key={f}>{f}</code>)}</div>
                    )}
                    {rule.show && rule.show.length > 0 && (
                      <div>显示 {rule.show.map((f) => <code key={f}>{f}</code>)}</div>
                    )}
                  </div>
                ))}
                <Button
                  type="dashed"
                  icon={<PlusOutlined />}
                  block
                  onClick={() =>
                    onChange({
                      linkages: [
                        ...(field.linkages ?? []),
                        { when: 'fieldName == "value"', hide: [], show: [] },
                      ],
                    })
                  }
                >
                  新增联动规则
                </Button>
              </Space>
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
