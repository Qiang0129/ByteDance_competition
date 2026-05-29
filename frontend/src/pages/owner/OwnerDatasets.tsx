import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircleFilled,
  CloseOutlined,
  CloudUploadOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  FileTextOutlined,
  PictureOutlined,
  ReloadOutlined,
  SearchOutlined,
  TagsOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import {
  Alert,
  App as AntdApp,
  AutoComplete,
  Button,
  Card,
  Col,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Row,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { UploadFile } from 'antd/es/upload/interface';
import { datasetApi } from '../../api/dataset';
import { ownerApi } from '../../api/owner';
import type {
  DatasetItem,
  DatasetKind,
  DatasetMeta,
  MediaType,
  PreferenceCompareItem,
  QaQualityItem,
} from '../../types/dataset';
import type { OwnerTask } from '../../types/owner';

/**
 * 数据集页面(Owner 端)。
 * 对齐《项目实施计划书》4.1 / 1.4 / 5.1 / 5.2:
 *   - 支持 JSON / JSONL / Excel 导入
 *   - 识别 qa_quality / preference_compare 类型
 *   - 保留 raw_payload / media_type / media_url / content_markdown
 *   - GET /datasets 从 MySQL 读取数据集列表
 *   - GET /datasets/{id}/items 从 items.raw_payload 读取预览数据
 *   - POST /datasets/import 上传并解析文件写入 MySQL
 *   - POST /datasets 创建空数据集
 */

interface MediaTypeMeta {
  label: string;
  color: string;
  icon: React.ReactNode;
}

const mediaTypeMeta: Record<MediaType, MediaTypeMeta> = {
  text: { label: 'Text', color: '#2f7bff', icon: <FileTextOutlined /> },
  image: { label: 'Image', color: '#22c55e', icon: <PictureOutlined /> },
  video: { label: 'Video', color: '#a855f7', icon: <VideoCameraOutlined /> },
  markdown: { label: 'Markdown', color: '#f59e0b', icon: <TagsOutlined /> },
};

interface DatasetFormValues {
  taskId?: string;
  name: string;
  kind: DatasetKind;
}

/** 字段映射表用,直接从计划书 1.4 与 5.1 抄过来 */
const fieldGuide = {
  qa_quality: [
    { key: 'id', desc: '稳定主键,用于打回追溯', required: true },
    { key: 'media_type', desc: 'text / image / video / markdown', required: true },
    { key: 'media_url', desc: '图像/视频远程链接', required: false },
    { key: 'content_markdown', desc: 'Markdown 富文本内容,Renderer 渲染', required: false },
    { key: 'prompt', desc: '题目 / 问题', required: true },
    { key: 'model_answer', desc: '待评估的模型回答', required: true },
    { key: 'reference', desc: '参考答案或评分依据', required: false },
    { key: 'tags / expected_dimensions', desc: '辅助维度,模板可读取', required: false },
  ],
  preference_compare: [
    { key: 'id', desc: '稳定主键', required: true },
    { key: 'prompt', desc: '题目 / 问题', required: true },
    { key: 'response_a / model_a', desc: 'A 候选答案与所属模型', required: true },
    { key: 'response_b / model_b', desc: 'B 候选答案与所属模型', required: true },
    { key: 'preferred', desc: 'A / B / TIE,允许打回时清空', required: false },
    { key: 'margin', desc: '强度判断:明显优于 / 略好 / 持平', required: false },
    { key: 'dimensions', desc: '准确性、完整性、可读性等多维度标签', required: false },
    { key: 'safety_flag', desc: '是否触发安全风险标记', required: false },
  ],
} satisfies Record<'qa_quality' | 'preference_compare', Array<{ key: string; desc: string; required: boolean }>>;

const datasetKindOptions = [
  { label: 'qa_quality · 问答质量评估', value: 'qa_quality' },
  { label: 'preference_compare · 偏好对比 A/B', value: 'preference_compare' },
];

function getDatasetKindMeta(kind?: string) {
  if (kind === 'qa_quality') {
    return { color: 'blue', label: 'QA Quality', guide: fieldGuide.qa_quality };
  }
  if (kind === 'preference_compare') {
    return { color: 'purple', label: 'Preference', guide: fieldGuide.preference_compare };
  }
  return {
    color: 'default',
    label: kind || 'Custom',
    guide: [
      { key: 'id', desc: '建议保留稳定主键,便于追踪和后续绑定任务', required: false },
      { key: 'raw_payload', desc: '自定义类型会按原始 JSON 字段通用展示', required: false },
    ],
  };
}

function DatasetKindTag({ kind }: { kind?: string }) {
  const meta = getDatasetKindMeta(kind);
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

function normalizeDatasetFormValues(values: DatasetFormValues): DatasetFormValues {
  return {
    ...values,
    taskId: values.taskId?.trim() || undefined,
    kind: values.kind.trim(),
  };
}

function getRecordText(record: unknown) {
  if (record == null) return '';
  if (typeof record === 'string') return record;
  if (typeof record === 'number' || typeof record === 'boolean') return String(record);
  try {
    return JSON.stringify(record);
  } catch {
    return String(record);
  }
}

function getRecordId(record: Record<string, unknown>, index: number) {
  const id = record.id ?? record.item_key ?? record.key;
  return id == null || String(id).trim() === '' ? `row-${index + 1}` : String(id);
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function toTextList(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => toTextList(item));
  }
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return [];
    if (text.startsWith('[') && text.endsWith(']')) {
      try {
        const parsed = JSON.parse(text) as unknown;
        if (Array.isArray(parsed)) return toTextList(parsed);
      } catch {
        // 保留原始字符串,让表格导入的非标准数组文本也能继续展示。
      }
    }
    return text
      .split(/[,，;；、|\n]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return [String(value)];
  }
  try {
    return [JSON.stringify(value)];
  } catch {
    return [String(value)];
  }
}

function toBoolean(value: unknown) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return false;
    if (['true', '1', 'yes', 'y', '是'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', '否'].includes(normalized)) return false;
  }
  return Boolean(value);
}

export default function OwnerDatasets() {
  const { message } = AntdApp.useApp();
  const [importForm] = Form.useForm<DatasetFormValues>();
  const [datasets, setDatasets] = useState<DatasetMeta[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [items, setItems] = useState<DatasetItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [datasetLoading, setDatasetLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [mediaFilter, setMediaFilter] = useState<MediaType | 'all'>('all');
  const [activeItem, setActiveItem] = useState<DatasetItem | null>(null);
  const [showAllModal, setShowAllModal] = useState(false);
  const [ownerTasks, setOwnerTasks] = useState<OwnerTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [appendOpen, setAppendOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [importFileList, setImportFileList] = useState<UploadFile[]>([]);
  const [appendFileList, setAppendFileList] = useState<UploadFile[]>([]);
  const [itemsReloadKey, setItemsReloadKey] = useState(0);

  const activeDataset = datasets.find((d) => d.id === activeId);

  const taskOptions = useMemo(
    () =>
      ownerTasks.map((task) => ({
        label: `${task.title} · ${task.state}`,
        value: task.taskId,
      })),
    [ownerTasks],
  );

  const loadTasks = useCallback(async () => {
    setTasksLoading(true);
    try {
      const result = await ownerApi.listTasks();
      setOwnerTasks(result.items);
    } catch {
      setOwnerTasks([]);
      message.error('任务列表加载失败,请确认后端已启动并已登录 Owner。');
    } finally {
      setTasksLoading(false);
    }
  }, [message]);

  const loadDatasets = useCallback(
    async (preferredId?: string) => {
      setDatasetLoading(true);
      try {
        const result = await datasetApi.listDatasets();
        setDatasets(result.items);
        setActiveId((current) => {
          if (preferredId && result.items.some((ds) => ds.id === preferredId)) {
            return preferredId;
          }
          if (current && result.items.some((ds) => ds.id === current)) {
            return current;
          }
          return result.items[0]?.id ?? '';
        });
        if (result.items.length === 0) {
          setItems([]);
          setActiveItem(null);
        }
      } catch {
        setDatasets([]);
        setActiveId('');
        setItems([]);
        message.error('数据集列表加载失败,请确认后端已启动并已登录 Owner。');
      } finally {
        setDatasetLoading(false);
      }
    },
    [message],
  );

  useEffect(() => {
    loadDatasets();
    loadTasks();
  }, [loadDatasets, loadTasks]);

  useEffect(() => {
    if (importOpen) {
      void loadTasks();
    }
  }, [importOpen, loadTasks]);

  /** 拉取选中的 MySQL 数据集条目 */
  useEffect(() => {
    if (!activeDataset) {
      setItems([]);
      setActiveItem(null);
      return;
    }
    // 切换数据集时立刻清空旧数据并关闭抽屉,
    // 防止上一份(不同 kind)记录被新 columns 渲染导致字段缺失崩溃
    setItems([]);
    setActiveItem(null);
    setKeyword('');
    setMediaFilter('all');
    setLoading(true);
    datasetApi
      .listItems(activeDataset.id)
      .then((data) => setItems(data))
      .catch(() => {
        setItems([]);
        message.error('数据集条目加载失败,请检查 MySQL 数据或后端接口。');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [activeDataset?.id, itemsReloadKey, message]);

  const filteredItems = useMemo(() => {
    if (!activeDataset) return [];
    const lowerKeyword = keyword.toLowerCase();
    return items.filter((item) => {
      if (activeDataset.kind === 'qa_quality') {
        const it = item as QaQualityItem;
        if (mediaFilter !== 'all' && it.media_type !== mediaFilter) return false;
        if (keyword) {
          const hay = `${it.id} ${it.prompt} ${it.model_answer} ${it.category}`.toLowerCase();
          if (!hay.includes(lowerKeyword)) return false;
        }
      } else if (activeDataset.kind === 'preference_compare') {
        const it = item as PreferenceCompareItem;
        if (keyword) {
          const hay = `${it.id} ${it.prompt} ${it.response_a} ${it.response_b}`.toLowerCase();
          if (!hay.includes(lowerKeyword)) return false;
        }
      } else if (keyword && !getRecordText(item).toLowerCase().includes(lowerKeyword)) {
        return false;
      }
      return true;
    });
  }, [items, activeDataset, mediaFilter, keyword]);

  const qaColumns: ColumnsType<QaQualityItem> = [
    {
      title: 'ID',
      dataIndex: 'id',
      width: 90,
      render: (id: string) => <code className="dataset-id">{id}</code>,
    },
    {
      title: 'Type',
      dataIndex: 'media_type',
      width: 110,
      render: (mt: MediaType | undefined) => {
        const meta = mt ? mediaTypeMeta[mt] : undefined;
        if (!meta) return <Tag>-</Tag>;
        return (
          <Tag
            className="dataset-media-tag"
            style={{ background: `${meta.color}15`, color: meta.color, border: 'none' }}
          >
            {meta.icon} {meta.label}
          </Tag>
        );
      },
    },
    { title: '类别', dataIndex: 'category', width: 110 },
    {
      title: 'Prompt',
      dataIndex: 'prompt',
      ellipsis: true,
      render: (text: string) => <span className="dataset-prompt">{text}</span>,
    },
    {
      title: '模型回答',
      dataIndex: 'model_answer',
      ellipsis: true,
      render: (text: string) => <span className="dataset-answer">{text}</span>,
    },
    {
      title: '维度',
      dataIndex: 'expected_dimensions',
      width: 180,
      render: (dims: unknown) => {
        const normalizedDims = toTextList(dims);
        if (normalizedDims.length === 0) return <Typography.Text type="secondary">-</Typography.Text>;
        return (
          <Space size={4} wrap>
            {normalizedDims.map((d) => (
              <Tag key={d} className="dataset-dim-tag">
                {d}
              </Tag>
            ))}
          </Space>
        );
      },
    },
  ];

  const prefColumns: ColumnsType<PreferenceCompareItem> = [
    {
      title: 'ID',
      dataIndex: 'id',
      width: 90,
      render: (id: string) => <code className="dataset-id">{id}</code>,
    },
    { title: '类型', dataIndex: 'task_type', width: 120 },
    {
      title: 'Prompt',
      dataIndex: 'prompt',
      ellipsis: true,
    },
    {
      title: 'A · model_a',
      dataIndex: 'response_a',
      ellipsis: true,
      render: (text: string, record) => (
        <div className="dataset-pref-cell">
          <Tag className="dataset-model-tag">{record.model_a}</Tag>
          <span>{text}</span>
        </div>
      ),
    },
    {
      title: 'B · model_b',
      dataIndex: 'response_b',
      ellipsis: true,
      render: (text: string, record) => (
        <div className="dataset-pref-cell">
          <Tag className="dataset-model-tag">{record.model_b}</Tag>
          <span>{text}</span>
        </div>
      ),
    },
    {
      title: '偏好',
      dataIndex: 'preferred',
      width: 100,
      render: (preferred: 'A' | 'B' | 'TIE', record) => (
        <Space direction="vertical" size={2}>
          <Tag color={preferred === 'A' ? 'blue' : preferred === 'B' ? 'purple' : 'default'}>
            {preferred}
          </Tag>
          <span className="dataset-margin">{record.margin}</span>
        </Space>
      ),
    },
  ];

  const genericColumns: ColumnsType<Record<string, unknown>> = [
    {
      title: 'ID',
      key: 'id',
      width: 120,
      render: (_value, record, index) => <code className="dataset-id">{getRecordId(record, index)}</code>,
    },
    {
      title: '原始数据摘要',
      key: 'payload',
      ellipsis: true,
      render: (_value, record) => <span className="dataset-prompt">{getRecordText(record)}</span>,
    },
  ];

  const showItemDetail = (record: DatasetItem) => {
    setActiveItem(record);
  };

  // 数据集创建入口已合并到"新建数据集"按钮(原"上传文件数据"流程),
  // 不再使用 openCreateModal / submitCreateDataset / createForm 等独立"新建空数据集"链路.
  // 相关 state 与 Modal 已删除,API datasetApi.createDataset 仍保留以备后续使用.

  const openImportModal = () => {
    importForm.resetFields();
    importForm.setFieldsValue({
      kind: 'qa_quality',
    });
    setImportFileList([]);
    setImportOpen(true);
  };

  /**
   * 新建数据集分支:
   * 1. 表单字段校验通过后,根据是否上传文件分两条路径
   *    - 有文件:走 importDataset 上传并解析数据
   *    - 无文件:Modal.confirm 二次确认 → 走 createDataset 创建空数据集
   * 2. 用户被告知"未上传文件将创建空数据集",降低误操作概率
   */
  const submitImportDataset = async () => {
    const values = normalizeDatasetFormValues(await importForm.validateFields());
    const file = importFileList[0]?.originFileObj;

    // 分支 A:有文件,直接上传导入
    if (file) {
      setSubmitting(true);
      try {
        const created = await datasetApi.importDataset({ ...values, file });
        message.success('数据文件已导入 MySQL。');
        setImportOpen(false);
        setImportFileList([]);
        await loadDatasets(created.id);
      } catch {
        message.error('上传导入失败,请确认文件格式为 JSON / JSONL / CSV / 基础 XLSX。');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // 分支 B:无文件,二次确认创建空数据集
    Modal.confirm({
      title: '将创建空数据集',
      content: '当前未上传任何数据文件,将创建一个空数据集。后续可通过详情卡的"添加数据"向其追加文件。',
      okText: '确认创建',
      cancelText: '继续上传文件',
      async onOk() {
        setSubmitting(true);
        try {
          const created = await datasetApi.createDataset(values);
          message.success(`已创建空数据集「${created.name}」`);
          setImportOpen(false);
          setImportFileList([]);
          await loadDatasets(created.id);
        } catch {
          message.error('创建空数据集失败,请检查数据集名称与类型。');
        } finally {
          setSubmitting(false);
        }
      },
    });
  };

  const openAppendModal = () => {
    setAppendFileList([]);
    setAppendOpen(true);
  };

  const submitAppendItems = async () => {
    if (!activeDataset) {
      message.error('请先选择一个数据集。');
      return;
    }
    const file = appendFileList[0]?.originFileObj;
    if (!file) {
      message.error('请先选择要添加的数据文件。');
      return;
    }
    setSubmitting(true);
    try {
      const updated = await datasetApi.importItems(activeDataset.id, file);
      message.success(`已向 ${updated.name} 添加数据。`);
      setAppendOpen(false);
      setAppendFileList([]);
      await loadDatasets(updated.id);
      setItemsReloadKey((key) => key + 1);
    } catch {
      message.error('添加数据失败,请确认文件格式和当前数据集权限。');
    } finally {
      setSubmitting(false);
    }
  };

  const refreshActiveDataset = async () => {
    await loadDatasets(activeDataset?.id);
    setItemsReloadKey((key) => key + 1);
  };

  /**
   * 删除数据集.调用 DELETE /api/datasets/{datasetId}.
   * 后端实现前会兜底友好提示,不影响其它操作.
   */
  const handleDeleteDataset = (ds: DatasetMeta, event?: React.MouseEvent) => {
    // 阻止冒泡,避免触发外层 button 的 setActiveId
    event?.stopPropagation();
    Modal.confirm({
      title: '确认删除该数据集?',
      content: (
        <div>
          <div>
            <strong>{ds.name}</strong>
          </div>
          <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>
            包含 {ds.itemCount} 条数据 · {formatSize(ds.size)}
          </div>
          <div style={{ marginTop: 8 }}>
            删除后该数据集与其条目将不可恢复.若已被任务绑定,需先解绑或删除任务.
          </div>
        </div>
      ),
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      async onOk() {
        try {
          await datasetApi.deleteDataset(ds.id);
          message.success(`已删除数据集「${ds.name}」`);
          // 删除后从本地列表中剔除,选中态切到剩余第一项
          setDatasets((prev) => prev.filter((d) => d.id !== ds.id));
          setActiveId((current) => {
            if (current !== ds.id) return current;
            const remaining = datasets.filter((d) => d.id !== ds.id);
            return remaining[0]?.id ?? '';
          });
        } catch (err) {
          message.error(
            err instanceof Error ? err.message : '删除数据集失败,请确认后端已启动并你拥有数据集所有权.',
          );
        }
      },
    });
  };

  return (
    <Space direction="vertical" size="large" className="page-stack">
      {/* 标题 + CTA */}
      <div className="page-title-row">
        <Space direction="vertical" size={4}>
          <Typography.Title level={3}>数据集</Typography.Title>
          <Typography.Text type="secondary">
            从 MySQL 的 datasets / items 读取数据,支持导入 JSON / JSONL / CSV / 基础 XLSX,
            保留 raw_payload 与多模态字段。
          </Typography.Text>
        </Space>
        <Space>
          {/*
            原本"上传文件数据 + 新建数据集"两个按钮功能重叠,统一收敛为一个
            主按钮"新建数据集",点击弹出原导入流程(可选关联任务 + 数据集类型 + 文件).
            真正"新建空数据集"的入口暂不再暴露,createDataset API 仍保留以备后续使用.
          */}
          <Button type="primary" icon={<DatabaseOutlined />} onClick={openImportModal}>
            新建数据集
          </Button>
        </Space>
      </div>

      <Row gutter={16} className="dataset-row-equal">
        {/* 左侧:数据集列表 */}
        <Col xs={24} xl={8}>
          <Card
            className="dataset-list-card"
            title={
              <Space size={8} align="center">
                <span>我的数据集</span>
                {/* 醒目数字徽章:显示当前数据集总数,数量变化时重播弹跳动画 */}
                <span key={datasets.length} className="dataset-count-badge">
                  {datasets.length}
                </span>
              </Space>
            }
            loading={datasetLoading}
            extra={
              datasets.length > 0 ? (
                <Button
                  type="link"
                  size="small"
                  className="dataset-view-all-btn"
                  onClick={() => setShowAllModal(true)}
                >
                  查看全部
                </Button>
              ) : null
            }
          >
            {datasets.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="MySQL 中暂无数据集"
              />
            ) : (
              <div className="dataset-list-scroll">
                {datasets.map((ds) => (
                  <button
                    type="button"
                    key={ds.id}
                    className={`dataset-list-item ${ds.id === activeId ? 'is-active' : ''}`}
                    onClick={() => setActiveId(ds.id)}
                  >
                    <div className="dataset-list-head">
                      <span className="dataset-list-name">{ds.name}</span>
                      <Space size={6} align="center">
                        <DatasetKindTag kind={ds.kind} />
                        <Button
                          type="text"
                          size="small"
                          icon={<DeleteOutlined />}
                          className="dataset-list-delete"
                          aria-label={`删除数据集 ${ds.name}`}
                          onClick={(event) => handleDeleteDataset(ds, event)}
                        />
                      </Space>
                    </div>
                    <div className="dataset-list-meta">
                      <span>{ds.itemCount} 条</span>
                      <span>·</span>
                      <span>{formatSize(ds.size)}</span>
                      <span>·</span>
                      <span>{ds.version}</span>
                    </div>
                    {ds.mediaDistribution && (
                      <div className="dataset-list-media">
                        {(Object.keys(ds.mediaDistribution) as MediaType[]).map((mt) => {
                          const meta = mediaTypeMeta[mt];
                          if (!meta) return null;
                          return (
                            <span
                              key={mt}
                              className="dataset-media-pill"
                              style={{ color: meta.color, background: `${meta.color}15` }}
                            >
                              {meta.icon} {ds.mediaDistribution?.[mt]}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </Card>
        </Col>

        {/* 右侧:元数据 + 字段映射 */}
        <Col xs={24} xl={16}>
          {activeDataset ? (
            <Card
              className="dataset-meta-card"
              title={
                <Space size={8}>
                  <DatabaseOutlined style={{ color: 'var(--lh-primary)' }} />
                  <span>{activeDataset.name}</span>
                  <DatasetKindTag kind={activeDataset.kind} />
                </Space>
              }
              extra={
                <Space>
                  <Button
                    size="small"
                    icon={<CloudUploadOutlined />}
                    onClick={openAppendModal}
                  >
                    添加数据
                  </Button>
                  <Button
                    size="small"
                    icon={<ReloadOutlined />}
                    loading={datasetLoading || loading}
                    onClick={refreshActiveDataset}
                  >
                    刷新数据
                  </Button>
                </Space>
              }
            >
              <Typography.Paragraph type="secondary" className="dataset-desc">
                {activeDataset.description}
              </Typography.Paragraph>

              <Row gutter={[16, 12]} className="dataset-meta-row">
                <Col span={8}>
                  <div className="dataset-meta-label">条目数</div>
                  <div className="dataset-meta-value">{activeDataset.itemCount}</div>
                </Col>
                <Col span={8}>
                  <div className="dataset-meta-label">文件大小</div>
                  <div className="dataset-meta-value">{formatSize(activeDataset.size)}</div>
                </Col>
                <Col span={8}>
                  <div className="dataset-meta-label">导入时间</div>
                  <div className="dataset-meta-value">{activeDataset.importedAt || '-'}</div>
                </Col>
              </Row>

              <div className="dataset-fields-block">
                <div className="dataset-fields-title">
                  <CheckCircleFilled style={{ color: '#22c55e' }} /> 字段映射
                </div>
                <ul className="dataset-fields-list">
                  {getDatasetKindMeta(activeDataset.kind).guide.map((field) => (
                    <li key={field.key}>
                      <code>{field.key}</code>
                      <span>{field.desc}</span>
                      {field.required && <Tag color="red">必填</Tag>}
                    </li>
                  ))}
                </ul>
              </div>
            </Card>
          ) : (
            <Card className="dataset-meta-card">
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="请先新建数据集"
              />
            </Card>
          )}
        </Col>
      </Row>

      {/* 数据预览 */}
      <Card
        className="dataset-preview-card"
        title="数据预览"
        extra={
          <Space size={12} wrap>
            <Input
              prefix={<SearchOutlined />}
              placeholder="按 ID / Prompt / 类别搜索"
              allowClear
              style={{ width: 260 }}
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
            {activeDataset?.kind === 'qa_quality' && (
              <Segmented
                options={[
                  { label: '全部', value: 'all' },
                  { label: 'Text', value: 'text' },
                  { label: 'Image', value: 'image' },
                  { label: 'Video', value: 'video' },
                  { label: 'Markdown', value: 'markdown' },
                ]}
                value={mediaFilter}
                onChange={(val) => setMediaFilter(val as MediaType | 'all')}
              />
            )}
          </Space>
        }
      >
        {!activeDataset ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无可预览的数据集"
          />
        ) : activeDataset.kind === 'qa_quality' ? (
          <Table<QaQualityItem>
            columns={qaColumns}
            dataSource={filteredItems as QaQualityItem[]}
            rowKey="id"
            loading={loading}
            pagination={{ defaultPageSize: 10, showSizeChanger: true, showTotal: (total: number) => `共 ${total} 条匹配记录`, pageSizeOptions: [10, 20, 50, 100, 200] }}
            onRow={(record) => ({ onClick: () => showItemDetail(record) })}
            rowClassName="dataset-table-row"
          />
        ) : activeDataset.kind === 'preference_compare' ? (
          <Table<PreferenceCompareItem>
            columns={prefColumns}
            dataSource={filteredItems as PreferenceCompareItem[]}
            rowKey="id"
            loading={loading}
            pagination={{ defaultPageSize: 10, showSizeChanger: true, showTotal: (total: number) => `共 ${total} 条匹配记录`, pageSizeOptions: [10, 20, 50, 100, 200] }}
            onRow={(record) => ({ onClick: () => showItemDetail(record) })}
            rowClassName="dataset-table-row"
          />
        ) : (
          <Table<Record<string, unknown>>
            columns={genericColumns}
            dataSource={filteredItems as Record<string, unknown>[]}
            rowKey={(record, index) => getRecordId(record, index ?? 0)}
            loading={loading}
            pagination={{ defaultPageSize: 10, showSizeChanger: true, showTotal: (total: number) => `共 ${total} 条匹配记录`, pageSizeOptions: [10, 20, 50, 100, 200] }}
            onRow={(record) => ({ onClick: () => showItemDetail(record) })}
            rowClassName="dataset-table-row"
          />
        )}
      </Card>

      {/* 单条详情抽屉 */}
      <Drawer
        title="数据条目详情"
        width={560}
        open={!!activeItem}
        onClose={() => setActiveItem(null)}
        closeIcon={<CloseOutlined />}
      >
        {activeItem && activeDataset ? (
          <ItemDetail item={activeItem} kind={activeDataset.kind} />
        ) : (
          <Empty />
        )}
      </Drawer>

      {/* 查看全部数据集 Modal */}
      <Modal
        title="全部数据集"
        open={showAllModal}
        onCancel={() => setShowAllModal(false)}
        footer={null}
        width={640}
      >
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          {datasets.map((ds) => (
            <button
              type="button"
              key={ds.id}
              className={`dataset-list-item ${ds.id === activeId ? 'is-active' : ''}`}
              onClick={() => {
                setActiveId(ds.id);
                setShowAllModal(false);
              }}
            >
              <div className="dataset-list-head">
                <span className="dataset-list-name">{ds.name}</span>
                <Space size={6} align="center">
                  <DatasetKindTag kind={ds.kind} />
                  <Button
                    type="text"
                    size="small"
                    icon={<DeleteOutlined />}
                    className="dataset-list-delete"
                    aria-label={`删除数据集 ${ds.name}`}
                    onClick={(event) => handleDeleteDataset(ds, event)}
                  />
                </Space>
              </div>
              <div className="dataset-list-meta">
                <span>{ds.itemCount} 条</span>
                <span>·</span>
                <span>{formatSize(ds.size)}</span>
                <span>·</span>
                <span>{ds.version}</span>
                <span>·</span>
                <span>{ds.importedAt}</span>
              </div>
              {ds.mediaDistribution && (
                <div className="dataset-list-media">
                  {(Object.keys(ds.mediaDistribution) as MediaType[]).map((mt) => {
                    const meta = mediaTypeMeta[mt];
                    if (!meta) return null;
                    return (
                      <span
                        key={mt}
                        className="dataset-media-pill"
                        style={{ color: meta.color, background: `${meta.color}15` }}
                      >
                        {meta.icon} {ds.mediaDistribution?.[mt]}
                      </span>
                    );
                  })}
                </div>
              )}
            </button>
          ))}
        </Space>
      </Modal>

      <Drawer
        title="新建数据集"
        open={importOpen}
        onClose={() => setImportOpen(false)}
        width={480}
        destroyOnClose
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => setImportOpen(false)} disabled={submitting}>
              取消
            </Button>
            <Button
              type="primary"
              onClick={submitImportDataset}
              loading={submitting}
            >
              完成
            </Button>
          </div>
        }
      >
        <Form form={importForm} layout="vertical">
          {ownerTasks.length === 0 && (
            <Alert
              type="info"
              showIcon
              message="当前账号还没有可关联任务"
              description="可以先导入未绑定任务的数据集,后续在任务发布页选择该数据集完成绑定。"
              style={{ marginBottom: 16 }}
            />
          )}
          <Form.Item
            name="taskId"
            label="关联任务（可选）"
          >
            <Select
              placeholder="可先不关联,后续在任务发布页绑定"
              loading={tasksLoading}
              options={taskOptions}
              allowClear
              showSearch
              optionFilterProp="label"
            />
          </Form.Item>
          <Form.Item
            name="name"
            label="数据集名称"
            rules={[{ required: true, message: '请输入数据集名称' }]}
          >
            <Input placeholder="默认可使用文件名" maxLength={255} />
          </Form.Item>
          <Form.Item
            name="kind"
            label="数据集类型"
            rules={[
              { required: true, message: '请选择或输入数据集类型' },
              { max: 64, message: '数据集类型最多 64 个字符' },
            ]}
          >
            <AutoComplete
              options={datasetKindOptions}
              placeholder="选择内置类型或输入自定义类型"
              filterOption={(inputValue, option) =>
                String(option?.label ?? option?.value ?? '')
                  .toLowerCase()
                  .includes(inputValue.toLowerCase())
              }
            />
          </Form.Item>
          <Form.Item label="数据文件 (可选)">
            <Upload.Dragger
              accept=".json,.jsonl,.ndjson,.csv,.xlsx"
              maxCount={1}
              fileList={importFileList}
              beforeUpload={() => false}
              onChange={({ fileList }) => {
                const nextList = fileList.slice(-1);
                setImportFileList(nextList);
                const selectedName = nextList[0]?.name;
                if (selectedName && !importForm.getFieldValue('name')) {
                  importForm.setFieldValue('name', selectedName.replace(/\.[^.]+$/, ''));
                }
              }}
            >
              <p className="ant-upload-drag-icon">
                <CloudUploadOutlined />
              </p>
              <p className="ant-upload-text">点击或拖拽 JSON / JSONL / CSV / XLSX 文件到这里</p>
              <p className="ant-upload-hint">
                后端会解析为 items.raw_payload,并保留 media_type / media_url / content_markdown。
              </p>
            </Upload.Dragger>
            {/* 提示:未上传文件时点击"完成"会创建空数据集 */}
            <Typography.Text type="secondary" style={{ fontSize: 12, marginTop: 6, display: 'block' }}>
              未上传文件时,点击"完成"将创建一个空数据集,后续可在详情卡用"添加数据"追加文件.
            </Typography.Text>
          </Form.Item>
        </Form>
      </Drawer>

      <Modal
        title="向当前数据集添加数据"
        open={appendOpen}
        onCancel={() => setAppendOpen(false)}
        onOk={submitAppendItems}
        confirmLoading={submitting}
        okText="添加到当前数据集"
        cancelText="取消"
        width={620}
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          {activeDataset ? (
            <Alert
              type="info"
              showIcon
              message={`当前数据集:${activeDataset.name}`}
              description={`新增文件会追加写入 dataset_id=${activeDataset.id} 的 items 表,不会再创建新的数据集。`}
            />
          ) : (
            <Alert
              type="warning"
              showIcon
              message="请先选择一个数据集"
              description="需要有当前数据集后才能追加数据。"
            />
          )}
          <Upload.Dragger
            accept=".json,.jsonl,.ndjson,.csv,.xlsx"
            maxCount={1}
            fileList={appendFileList}
            beforeUpload={() => false}
            onChange={({ fileList }) => setAppendFileList(fileList.slice(-1))}
          >
            <p className="ant-upload-drag-icon">
              <CloudUploadOutlined />
            </p>
            <p className="ant-upload-text">点击或拖拽 JSON / JSONL / CSV / XLSX 文件到这里</p>
            <p className="ant-upload-hint">
              文件内容会追加为当前数据集的新 items.raw_payload。
            </p>
          </Upload.Dragger>
        </Space>
      </Modal>
    </Space>
  );
}

/** 单条数据详情 */
function ItemDetail({ item, kind }: { item: DatasetItem; kind: DatasetKind }) {
  if (kind === 'qa_quality') {
    const it = item as QaQualityItem;
    const meta = it.media_type ? mediaTypeMeta[it.media_type] : undefined;
    return (
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Space size={8}>
          <code className="dataset-id-large">{it.id}</code>
          {meta && (
            <Tag style={{ background: `${meta.color}15`, color: meta.color, border: 'none' }}>
              {meta.icon} {meta.label}
            </Tag>
          )}
          {it.category && <Tag>{it.category}</Tag>}
          {it.difficulty && <Tag>{it.difficulty}</Tag>}
          {it.lang && <Tag>{it.lang.toUpperCase()}</Tag>}
        </Space>

        {it.media_url && it.media_type === 'image' && (
          <img src={it.media_url} alt={it.id} className="dataset-detail-image" />
        )}
        {it.media_url && it.media_type === 'video' && (
          <video
            controls
            preload="metadata"
            className="dataset-detail-video-player"
            src={it.media_url}
          >
            您的浏览器不支持 video 标签。
          </video>
        )}
        {it.content_markdown && (
          <div className="dataset-detail-markdown">
            <MarkdownPreview source={it.content_markdown} />
          </div>
        )}

        <DetailField label="Prompt" value={it.prompt} />
        <DetailField label="Model Answer" value={it.model_answer} />
        <DetailField label="Reference" value={it.reference} />

        <div className="dataset-detail-row">
          <span className="dataset-detail-label">Tags</span>
          <Space size={4} wrap>
            {toTextList(it.tags).map((t) => (
              <Tag key={t}>{t}</Tag>
            ))}
          </Space>
        </div>

        <div className="dataset-detail-row">
          <span className="dataset-detail-label">Expected Dimensions</span>
          <Space size={4} wrap>
            {toTextList(it.expected_dimensions).map((d) => (
              <Tag key={d} color="blue">
                {d}
              </Tag>
            ))}
          </Space>
        </div>

        <div className="dataset-detail-row">
          <span className="dataset-detail-label">Source</span>
          <code>{it.source}</code>
        </div>
      </Space>
    );
  }

  if (kind === 'preference_compare') {
    const it = item as PreferenceCompareItem;
    return (
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Space size={8}>
          <code className="dataset-id-large">{it.id}</code>
          <Tag>{it.task_type}</Tag>
          {it.lang && <Tag>{it.lang.toUpperCase()}</Tag>}
          {toBoolean(it.safety_flag) && <Tag color="red">Safety</Tag>}
        </Space>

        <DetailField label="Prompt" value={it.prompt} />

        <div className="dataset-pref-pair">
          <div className={`dataset-pref-block ${it.preferred === 'A' ? 'is-preferred' : ''}`}>
            <div className="dataset-pref-block-head">
              <Tag color="blue">A</Tag>
              <span>{it.model_a}</span>
              {it.preferred === 'A' && <Tag color="success">Preferred</Tag>}
            </div>
            <div className="dataset-pref-block-body">{it.response_a}</div>
          </div>
          <div className={`dataset-pref-block ${it.preferred === 'B' ? 'is-preferred' : ''}`}>
            <div className="dataset-pref-block-head">
              <Tag color="purple">B</Tag>
              <span>{it.model_b}</span>
              {it.preferred === 'B' && <Tag color="success">Preferred</Tag>}
            </div>
            <div className="dataset-pref-block-body">{it.response_b}</div>
          </div>
        </div>

        <div className="dataset-detail-row">
          <span className="dataset-detail-label">Margin</span>
          <Tag>{it.margin}</Tag>
        </div>

        <div className="dataset-detail-row">
          <span className="dataset-detail-label">Dimensions</span>
          <Space size={4} wrap>
            {toTextList(it.dimensions).map((d) => (
              <Tag key={d} color="blue">
                {d}
              </Tag>
            ))}
          </Space>
        </div>

        <DetailField label="Annotator Note" value={it.annotator_note} />
      </Space>
    );
  }

  const record = item as Record<string, unknown>;
  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Space size={8}>
        <code className="dataset-id-large">{getRecordId(record, 0)}</code>
        <DatasetKindTag kind={kind} />
      </Space>
      <pre className="dataset-json-preview">{JSON.stringify(record, null, 2)}</pre>
    </Space>
  );
}

function DetailField({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="dataset-detail-block">
      <div className="dataset-detail-label">{label}</div>
      <div className="dataset-detail-value">{value}</div>
    </div>
  );
}

/**
 * 轻量 Markdown 预览。
 * 仅覆盖样例数据中实际出现的语法,无需引入 markdown 库:
 *   - "# / ## / ###" 标题
 *   - 空行段落与单换行 <br />
 *   - ![alt](url) 图片
 *   - <video src="..." controls width="..."> ... </video> 直出原生标签
 *   - [text](url) 普通链接
 * 其余字符均按纯文本渲染,不解析 HTML 注入,避免 XSS。
 */
function MarkdownPreview({ source }: { source: string }) {
  // 先按行扫描,把 video 标签拆出来作为独立块
  const blocks: Array<
    | { type: 'video'; src: string }
    | { type: 'heading'; level: 1 | 2 | 3; text: string }
    | { type: 'paragraph'; text: string }
  > = [];
  const lines = source.split(/\r?\n/);
  let buf: string[] = [];
  const flushParagraph = () => {
    if (buf.length === 0) return;
    blocks.push({ type: 'paragraph', text: buf.join('\n') });
    buf = [];
  };
  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      return;
    }
    const videoMatch = line.match(/<video[^>]*src=["']([^"']+)["'][^>]*>.*?<\/video>/i);
    if (videoMatch) {
      flushParagraph();
      blocks.push({ type: 'video', src: videoMatch[1] });
      return;
    }
    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length as 1 | 2 | 3,
        text: headingMatch[2],
      });
      return;
    }
    buf.push(rawLine);
  });
  flushParagraph();

  return (
    <>
      {blocks.map((block, idx) => {
        if (block.type === 'video') {
          return (
            <video
              key={idx}
              controls
              preload="metadata"
              className="dataset-md-video"
              src={block.src}
            >
              您的浏览器不支持 video 标签。
            </video>
          );
        }
        if (block.type === 'heading') {
          const Tag = `h${block.level}` as 'h1' | 'h2' | 'h3';
          return (
            <Tag key={idx} className={`dataset-md-h dataset-md-h${block.level}`}>
              {block.text}
            </Tag>
          );
        }
        return (
          <p key={idx} className="dataset-md-p">
            {renderInline(block.text)}
          </p>
        );
      })}
    </>
  );
}

/** 行内解析:图片 ![alt](url)、链接 [text](url),其中 url 是视频后缀时升级为 <video> */
function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(!?)\[([^\]]*)\]\(([^)]+)\)/g;
  let cursor = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) {
      const seg = text.slice(cursor, match.index);
      nodes.push(...splitByNewline(seg, key++));
    }
    const [, bang, label, url] = match;
    const isVideoUrl = /\.(mp4|webm|ogg|mov|m4v)(\?.*)?$/i.test(url);
    const isImageUrl = /\.(png|jpe?g|gif|webp|svg|bmp)(\?.*)?$/i.test(url);
    if (bang === '!' || (bang === '' && isImageUrl && !isVideoUrl)) {
      nodes.push(<img key={key++} src={url} alt={label} className="dataset-md-img" />);
    } else if (isVideoUrl) {
      // [文本](xxx.mp4) 形式视为视频:在视频上方保留文本作为标题
      nodes.push(
        <span key={key++} className="dataset-md-video-caption">
          {label}
        </span>,
      );
      nodes.push(
        <video
          key={key++}
          controls
          preload="metadata"
          className="dataset-md-video"
          src={url}
        >
          您的浏览器不支持 video 标签。
        </video>,
      );
    } else {
      nodes.push(
        <a key={key++} href={url} target="_blank" rel="noreferrer" className="dataset-md-link">
          {label}
        </a>,
      );
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) {
    nodes.push(...splitByNewline(text.slice(cursor), key++));
  }
  return nodes;
}

/** 把段落内的单换行变 <br /> */
function splitByNewline(text: string, baseKey: number): React.ReactNode[] {
  const parts = text.split(/\n/);
  const out: React.ReactNode[] = [];
  parts.forEach((p, i) => {
    if (i > 0) out.push(<br key={`br-${baseKey}-${i}`} />);
    if (p) out.push(<span key={`t-${baseKey}-${i}`}>{p}</span>);
  });
  return out;
}
