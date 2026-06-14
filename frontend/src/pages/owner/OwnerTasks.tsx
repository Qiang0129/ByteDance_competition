import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import dayjs, { type Dayjs } from 'dayjs';
import {
  ArrowRightOutlined,
  CheckCircleFilled,
  CloseOutlined,
  DeleteOutlined,
  DownOutlined,
  FilterOutlined,
  MoreOutlined,
  PauseCircleFilled,
  PlusOutlined,
  ReloadOutlined,
  StopFilled,
  SyncOutlined,
  UpOutlined,
} from '@ant-design/icons';
import {
  Alert,
  App,
  Badge,
  Button,
  Card,
  Checkbox,
  Col,
  DatePicker,
  Dropdown,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Segmented,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  Switch,
} from 'antd';
import type { FormProps, MenuProps } from 'antd';
import type { ColumnsType } from 'antd/es/table';

import { getApiErrorMessage } from '../../api/client';
import { aiReviewApi } from '../../api/aiReview';
import { datasetApi } from '../../api/dataset';
import { ownerApi } from '../../api/owner';
import { schemaApi } from '../../api/schema';
import { AiAssistantIcon } from '../../components/icons';
import type { DatasetItemOption, DatasetMeta } from '../../types/dataset';
import type { AiReviewRule } from '../../types/aiReview';
import type {
  AssignableLabeler,
  CreateOwnerTaskRequest,
  OwnerAssignStrategy,
  OwnerItemSelectionMode,
  OwnerTaskDetail,
  OwnerTask,
  OwnerTaskReviewStatus,
  OwnerTaskState,
  TaskUserAllocation,
} from '../../types/owner';
import type { SchemaSummary } from '../../types/schema';

type TaskState = OwnerTaskState;
type OwnerTaskRow = OwnerTask;
type LabelingStatus = 'draft' | 'published' | 'labeling' | 'paused' | 'ended';

interface PublishFormValues {
  title: string;
  tags: string[];
  reward: string;
  rewardPerItem?: number | null;
  rewardCapType?: 'monthly' | 'none';
  rewardCapAmount?: number | null;
  quota: number | null;
  deadline: Dayjs | null;
  datasetId: string;
  itemSelectionMode: OwnerItemSelectionMode;
  selectedItemIds: string[];
  strategy: OwnerAssignStrategy;
  maxClaimPerUser?: number | null;
  assignedLabelerIds?: string[];
  labelerAllocations?: AllocationFormValue[];
  reviewerAssignmentMode?: 'auto' | 'manual';
  reviewerAllocations?: AllocationFormValue[];
  schema?: string;
  schemaVersionId?: string;
  aiReviewEnabled?: boolean;
  aiReviewRuleId?: string;
  /** 是否为标注员开启 LLM 标注助手 */
  llmAssistEnabled?: boolean;
}

interface AllocationFormValue {
  userId?: string;
  itemCount?: number | null;
}

const DATE_TIME_FORMAT = 'YYYY-MM-DD HH:mm';
const UNTITLED_DRAFT_TITLE_PREFIX = '未命名任务草稿';
const MOBILE_TASK_COLLAPSED_COUNT = 3;
const DATASET_ITEM_PAGE_SIZE = 20;
const DEFAULT_REWARD_TEXT = '0.30 元 / 条 · 月度封顶 1500 元';
const REWARD_PRESETS = [
  { label: '基础', rewardPerItem: 0.3, rewardCapType: 'monthly' as const, rewardCapAmount: 1500 },
  { label: '中等', rewardPerItem: 0.5, rewardCapType: 'monthly' as const, rewardCapAmount: 2000 },
  { label: '复杂', rewardPerItem: 0.8, rewardCapType: 'none' as const, rewardCapAmount: null },
];

function createUntitledDraftTitle() {
  return `${UNTITLED_DRAFT_TITLE_PREFIX} ${dayjs().format('MM-DD HH:mm')}`;
}

function isAutoNamedDraftTask(record: OwnerTaskRow) {
  return record.state === 'draft' && record.title.trim().startsWith(UNTITLED_DRAFT_TITLE_PREFIX);
}

function parseRewardRule(reward?: string) {
  const source = reward?.trim() || DEFAULT_REWARD_TEXT;
  const numberMatches = Array.from(source.matchAll(/(\d+(?:\.\d+)?)/g)).map((match) => Number(match[1]));
  const rewardPerItem = Number.isFinite(numberMatches[0]) ? numberMatches[0] : 0.3;
  const noCap = source.includes('无封顶');
  return {
    reward: source,
    rewardPerItem,
    rewardCapType: noCap ? 'none' as const : 'monthly' as const,
    rewardCapAmount: noCap ? null : Number.isFinite(numberMatches[1]) ? numberMatches[1] : 1500,
  };
}

function buildRewardRule(values: {
  rewardPerItem?: number | null;
  rewardCapType?: 'monthly' | 'none';
  rewardCapAmount?: number | null;
  reward?: string;
}) {
  const rewardPerItem = Number(values.rewardPerItem);
  if (!Number.isFinite(rewardPerItem) || rewardPerItem <= 0) {
    return values.reward?.trim() || DEFAULT_REWARD_TEXT;
  }
  if (values.rewardCapType === 'none') {
    return `${rewardPerItem.toFixed(2)} 元 / 条 · 无封顶`;
  }
  const capAmount = Number(values.rewardCapAmount);
  return `${rewardPerItem.toFixed(2)} 元 / 条 · 月度封顶 ${Number.isFinite(capAmount) && capAmount > 0 ? capAmount : 1500} 元`;
}

function formatMoneyText(value?: number | null) {
  if (value == null || !Number.isFinite(value)) {
    return '0';
  }
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

const publishFormFieldTabs: Record<string, string> = {
  title: 'basic',
  tags: 'basic',
  reward: 'basic',
  rewardPerItem: 'basic',
  rewardCapType: 'basic',
  rewardCapAmount: 'basic',
  deadline: 'basic',
  schemaVersionId: 'basic',
  aiReviewEnabled: 'basic',
  aiReviewRuleId: 'basic',
  llmAssistEnabled: 'basic',
  datasetId: 'scope',
  itemSelectionMode: 'scope',
  selectedItemIds: 'scope',
  strategy: 'distribution',
  maxClaimPerUser: 'distribution',
  assignedLabelerIds: 'distribution',
  labelerAllocations: 'distribution',
  reviewerAssignmentMode: 'review',
  reviewerAllocations: 'review',
};

function resolvePublishFormTab(namePath: readonly (string | number)[] | undefined) {
  const rootName = String(namePath?.[0] ?? '');
  return publishFormFieldTabs[rootName] ?? 'basic';
}

const labelingStatusMeta: Record<LabelingStatus, { label: string; color: string; icon: React.ReactNode }> = {
  draft: { label: '草稿', color: 'default', icon: <span className="state-dot dot-draft" /> },
  published: { label: '发布中', color: 'success', icon: <span className="state-dot dot-published" /> },
  labeling: { label: '进行中', color: 'processing', icon: <span className="state-dot dot-labeling" /> },
  paused: { label: '已暂停', color: 'warning', icon: <span className="state-dot dot-paused" /> },
  ended: { label: '已结束', color: 'default', icon: <span className="state-dot dot-ended" /> },
};

function resolveTaskStateLabel(state?: string) {
  if (state && state in labelingStatusMeta) {
    return labelingStatusMeta[state as LabelingStatus].label;
  }
  return state || '未知状态';
}

const reviewStatusMeta: Record<OwnerTaskReviewStatus, { label: string; color: string }> = {
  not_started: { label: '未开始', color: 'default' },
  ai_prereviewing: { label: 'AI预审中', color: 'processing' },
  human_first_review: { label: '人工初审', color: 'warning' },
  human_second_review: { label: '人工复审', color: 'orange' },
  human_final_review: { label: '人工终审', color: 'red' },
  completed: { label: '已完成', color: 'success' },
};

const strategyLabel: Record<OwnerAssignStrategy, string> = {
  'first-come': '先到先得',
  assigned: '指派',
  quota: '配额抢单',
};

const stateFilterOptions: { label: string; value: 'all' | LabelingStatus }[] = [
  { label: '全部标注状态', value: 'all' },
  { label: '草稿', value: 'draft' },
  { label: '发布中', value: 'published' },
  { label: '进行中', value: 'labeling' },
  { label: '已暂停', value: 'paused' },
  { label: '已结束', value: 'ended' },
];

const reviewStatusFilterOptions: { label: string; value: 'all' | OwnerTaskReviewStatus }[] = [
  { label: '审核状态:全部', value: 'all' },
  { label: '未开始', value: 'not_started' },
  { label: 'AI预审中', value: 'ai_prereviewing' },
  { label: '人工初审', value: 'human_first_review' },
  { label: '人工复审', value: 'human_second_review' },
  { label: '人工终审', value: 'human_final_review' },
  { label: '已完成', value: 'completed' },
];

const strategyFilterOptions = [
  { label: '分发策略:全部', value: 'all' },
  { label: '先到先得', value: 'first-come' },
  { label: '指派', value: 'assigned' },
  { label: '配额抢单', value: 'quota' },
];

function sumAllocationValues(values?: AllocationFormValue[]) {
  return (values ?? []).reduce((sum, item) => sum + (Number(item?.itemCount) || 0), 0);
}

function toAllocationPayload(values?: AllocationFormValue[]): TaskUserAllocation[] {
  return (values ?? [])
    .filter((item) => item?.userId && Number(item.itemCount) > 0)
    .map((item) => ({
      userId: item.userId!,
      itemCount: Number(item.itemCount),
    }));
}

function resolveLabelingStatus(record: OwnerTaskRow): LabelingStatus {
  if (record.state === 'published' && record.quotaUsed > 0) {
    return 'labeling';
  }
  return record.state;
}

function resolveReviewTooltip(record: OwnerTaskRow) {
  const reviewStatus = record.reviewStatus ?? 'not_started';
  switch (reviewStatus) {
    case 'human_first_review':
      return '第一轮人工审核';
    case 'human_second_review':
      return '第二轮人工审核';
    case 'human_final_review':
      return `第${record.reviewRound ?? 3}轮人工审核（第三轮及以上归为人工终审）`;
    case 'ai_prereviewing':
      return 'AI 预审进行中';
    case 'completed':
      return '当前任务暂无待审核题目';
    case 'not_started':
    default:
      return '暂无提交进入审核';
  }
}

function getTaskProgress(record: OwnerTaskRow) {
  const annotatedCount = record.annotatedItemCount ?? 0;
  const itemTotal = record.publishedItemTotal ?? 0;
  const rawPercent = itemTotal > 0 ? (annotatedCount / itemTotal) * 100 : 0;
  return {
    annotatedCount,
    itemTotal,
    barPercent: Math.min(Math.max(rawPercent, 0), 100),
    displayPercent: Math.min(Math.round(rawPercent), 100),
  };
}

function resolveTaskPrimaryActionLabel(record: OwnerTaskRow) {
  if (record.state === 'draft') {
    return '发布';
  }
  return '详情';
}

function AllocationEditor({
  name,
  userOptions,
  userPlaceholder,
  addText,
  total,
  taskItemCount,
}: {
  name: 'labelerAllocations' | 'reviewerAllocations';
  userOptions: { label: string; value: string }[];
  userPlaceholder: string;
  addText: string;
  total: number;
  taskItemCount: number;
}) {
  return (
    <div className="owner-allocation-editor">
      <Form.List name={name}>
        {(fields, { add, remove }) => (
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            {fields.map((field) => (
              <div className="owner-allocation-row" key={field.key}>
                <Form.Item
                  name={[field.name, 'userId']}
                  rules={[{ required: true, message: userPlaceholder }]}
                >
                  <Select
                    options={userOptions}
                    placeholder={userPlaceholder}
                    showSearch
                    optionFilterProp="label"
                  />
                </Form.Item>
                <Form.Item
                  name={[field.name, 'itemCount']}
                  rules={[{ required: true, message: '请输入题量' }]}
                >
                  <InputNumber min={1} placeholder="题量" />
                </Form.Item>
                <Button
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => remove(field.name)}
                  aria-label="删除分配"
                />
              </div>
            ))}
            <Button type="dashed" icon={<PlusOutlined />} onClick={() => add()}>
              {addText}
            </Button>
          </Space>
        )}
      </Form.List>
      <Typography.Text type={total === taskItemCount ? 'secondary' : 'danger'}>
        已分配 {total} / {taskItemCount || 0} 题
      </Typography.Text>
    </div>
  );
}

export default function OwnerTasks() {
  const { message } = App.useApp();
  const [searchParams] = useSearchParams();
  const [form] = Form.useForm<PublishFormValues>();
  const [stateFilter, setStateFilter] = useState<'all' | LabelingStatus>('all');
  const [reviewStatusFilter, setReviewStatusFilter] = useState<'all' | OwnerTaskReviewStatus>('all');
  const [strategyFilter, setStrategyFilter] = useState<string>('all');
  const [keyword, setKeyword] = useState('');
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);
  const [mobileListExpanded, setMobileListExpanded] = useState(false);
  const [expandedMobileTaskIds, setExpandedMobileTaskIds] = useState<Set<string>>(() => new Set());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeRow, setActiveRow] = useState<OwnerTaskRow | null>(null);
  const [rows, setRows] = useState<OwnerTaskRow[]>([]);
  const [datasets, setDatasets] = useState<DatasetMeta[]>([]);
  const [schemas, setSchemas] = useState<SchemaSummary[]>([]);
  const [aiRules, setAiRules] = useState<AiReviewRule[]>([]);
  const [assignableLabelers, setAssignableLabelers] = useState<AssignableLabeler[]>([]);
  const [assignableReviewers, setAssignableReviewers] = useState<AssignableLabeler[]>([]);
  const [datasetItemOptions, setDatasetItemOptions] = useState<DatasetItemOption[]>([]);
  const [itemOptionKeyword, setItemOptionKeyword] = useState('');
  const [itemOptionPage, setItemOptionPage] = useState(1);
  const [itemOptionTotal, setItemOptionTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [itemOptionLoading, setItemOptionLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activeFormTab, setActiveFormTab] = useState('basic');
  const submitStateRef = useRef<TaskState>('published');
  const lastSchemaSelectionRef = useRef<string | undefined>();
  const lastDatasetSelectionRef = useRef<string | undefined>();
  const mobileTaskListRef = useRef<HTMLDivElement | null>(null);
  const focusedTaskId = searchParams.get('focusTaskId') ?? '';

  const selectedStrategy = Form.useWatch('strategy', form);
  const selectedDatasetId = Form.useWatch('datasetId', form);
  const selectedItemSelectionMode = Form.useWatch('itemSelectionMode', form);
  const selectedItemIds = Form.useWatch('selectedItemIds', form);
  const selectedLabelerAllocations = Form.useWatch('labelerAllocations', form);
  const selectedReviewerAssignmentMode = Form.useWatch('reviewerAssignmentMode', form);
  const selectedReviewerAllocations = Form.useWatch('reviewerAllocations', form);
  const selectedSchemaVersionId = Form.useWatch('schemaVersionId', form);
  const selectedAiReviewEnabled = Form.useWatch('aiReviewEnabled', form);
  const selectedRewardPerItem = Form.useWatch('rewardPerItem', form);
  const selectedRewardCapType = Form.useWatch('rewardCapType', form);
  const selectedRewardCapAmount = Form.useWatch('rewardCapAmount', form);

  useEffect(() => {
    void Promise.all([
      loadTasks(),
      loadDatasets(),
      loadSchemas(),
      loadAiRules(),
      loadAssignableLabelers(),
      loadAssignableReviewers(),
    ]);
  }, []);

  useEffect(() => {
    if (focusedTaskId) {
      setKeyword(focusedTaskId);
    }
  }, [focusedTaskId]);

  useEffect(() => {
    setMobileListExpanded(false);
  }, [keyword, reviewStatusFilter, stateFilter, strategyFilter]);

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        if (stateFilter !== 'all' && resolveLabelingStatus(row) !== stateFilter) return false;
        if (reviewStatusFilter !== 'all' && (row.reviewStatus ?? 'not_started') !== reviewStatusFilter) {
          return false;
        }
        if (strategyFilter !== 'all' && row.assignStrategy !== strategyFilter) return false;
        if (keyword && !`${row.title} ${row.taskId} ${row.owner}`.includes(keyword)) return false;
        return true;
      }),
    [keyword, reviewStatusFilter, rows, stateFilter, strategyFilter],
  );

  const mobileRows = mobileListExpanded
    ? filteredRows
    : filteredRows.slice(0, MOBILE_TASK_COLLAPSED_COUNT);
  const activeTaskFilterCount = [
    stateFilter !== 'all',
    reviewStatusFilter !== 'all',
    strategyFilter !== 'all',
  ].filter(Boolean).length;

  const publishedCount = rows.filter((row) => resolveLabelingStatus(row) === 'published').length;
  const draftCount = rows.filter((row) => row.state === 'draft').length;
  const submittedCount = rows.reduce((sum, row) => sum + row.quotaUsed, 0);

  const datasetOptions = datasets.map((dataset) => ({
    label: `${dataset.name} · ${dataset.itemCount} 条 · 当前关联: ${dataset.taskTitle ?? '未命名任务'}`,
    value: dataset.id,
  }));

  const publishedSchemas = useMemo(
    () => schemas.filter((schema) => schema.status === 'published'),
    [schemas],
  );

  const schemaOptions = useMemo(
    () =>
      publishedSchemas.map((schema) => ({
        label: `${schema.name} (${schema.versionNumber}) · ${schema.fieldCount} 个字段`,
        value: schema.versionId,
      })),
    [publishedSchemas],
  );

  const aiRuleOptions = aiRules.map((rule) => ({
    label: `${rule.name} v${rule.version}`,
    value: rule.ruleId,
  }));

  useEffect(() => {
    if (!drawerOpen || !activeRow?.schemaVersionId) {
      return;
    }
    const hasPublishedSchema = publishedSchemas.some(
      (schema) => schema.versionId === activeRow.schemaVersionId,
    );
    if (hasPublishedSchema) {
      form.setFieldValue('schemaVersionId', activeRow.schemaVersionId);
    }
  }, [activeRow, drawerOpen, form, publishedSchemas]);

  useEffect(() => {
    if (!drawerOpen) {
      lastSchemaSelectionRef.current = undefined;
      lastDatasetSelectionRef.current = undefined;
      return;
    }
    if (!selectedSchemaVersionId) {
      lastSchemaSelectionRef.current = undefined;
      return;
    }
    if (lastSchemaSelectionRef.current === selectedSchemaVersionId) {
      return;
    }
    lastSchemaSelectionRef.current = selectedSchemaVersionId;
    const schema = publishedSchemas.find((item) => item.versionId === selectedSchemaVersionId);
    if (schema?.datasetId) {
      form.setFieldValue('datasetId', schema.datasetId);
    }
  }, [drawerOpen, form, publishedSchemas, selectedSchemaVersionId]);

  useEffect(() => {
    if (!drawerOpen || activeRow) {
      lastDatasetSelectionRef.current = selectedDatasetId;
      return;
    }
    if (!selectedDatasetId) {
      const firstDatasetId = datasets[0]?.id;
      if (firstDatasetId) {
        lastDatasetSelectionRef.current = firstDatasetId;
        form.setFieldsValue({
          datasetId: firstDatasetId,
          quota: resolveDatasetQuota(firstDatasetId),
        });
      } else {
        lastDatasetSelectionRef.current = selectedDatasetId;
      }
      return;
    }
    const quota = resolveDatasetQuota(selectedDatasetId);
    if (lastDatasetSelectionRef.current === selectedDatasetId) {
      const currentQuota = form.getFieldValue('quota');
      if ((currentQuota === null || currentQuota === undefined) && quota !== null) {
        form.setFieldValue('quota', quota);
      }
      return;
    }
    lastDatasetSelectionRef.current = selectedDatasetId;
    form.setFieldValue('quota', quota);
  }, [activeRow, drawerOpen, form, selectedDatasetId, datasets]);

  useEffect(() => {
    if (!drawerOpen || !selectedDatasetId || selectedItemSelectionMode !== 'partial') {
      setDatasetItemOptions([]);
      return;
    }
    void loadDatasetItemOptions(selectedDatasetId, itemOptionPage, itemOptionKeyword);
  }, [activeRow?.taskId, drawerOpen, selectedDatasetId, selectedItemSelectionMode, itemOptionPage, itemOptionKeyword]);

  useEffect(() => {
    if (!drawerOpen || activeRow) {
      return;
    }
    setItemOptionPage(1);
    setItemOptionKeyword('');
    form.setFieldValue('selectedItemIds', []);
  }, [activeRow, drawerOpen, form, selectedDatasetId]);

  const labelerOptions = assignableLabelers.map((labeler) => ({
    label: `${labeler.displayName} (${labeler.username})`,
    value: labeler.userId,
  }));

  const reviewerOptions = assignableReviewers.map((reviewer) => ({
    label: `${reviewer.displayName} (${reviewer.username})`,
    value: reviewer.userId,
  }));

  const selectedDataset = datasets.find((dataset) => dataset.id === selectedDatasetId);
  const selectedSchema = publishedSchemas.find(
    (schema) => schema.versionId === selectedSchemaVersionId,
  );
  const taskItemCount =
    selectedItemSelectionMode === 'partial'
      ? selectedItemIds?.length ?? 0
      : selectedDataset?.itemCount ?? 0;
  const labelerAllocationTotal = sumAllocationValues(selectedLabelerAllocations);
  const reviewerAllocationTotal = sumAllocationValues(selectedReviewerAllocations);
  const rewardPreview = buildRewardRule({
    reward: form.getFieldValue('reward'),
    rewardPerItem: selectedRewardPerItem,
    rewardCapType: selectedRewardCapType,
    rewardCapAmount: selectedRewardCapAmount,
  });
  const labelerRewardWarnings = useMemo(() => {
    const capAmount = selectedRewardCapType === 'monthly' ? Number(selectedRewardCapAmount) : null;
    const rewardPerItem = Number(selectedRewardPerItem);
    if (!capAmount || !Number.isFinite(capAmount) || capAmount <= 0 || !Number.isFinite(rewardPerItem) || rewardPerItem <= 0) {
      return [];
    }
    return (selectedLabelerAllocations ?? [])
      .map((allocation) => {
        if (!allocation?.userId || !allocation.itemCount) {
          return null;
        }
        const labeler = assignableLabelers.find((item) => item.userId === allocation.userId);
        if (!labeler) {
          return null;
        }
        const accepted = labeler.monthlyAcceptedReward ?? 0;
        const pending = labeler.monthlyPendingReward ?? 0;
        const current = Number(allocation.itemCount) * rewardPerItem;
        const projected = accepted + pending + current;
        if (projected <= capAmount) {
          return null;
        }
        return `${labeler.displayName} 预计 ${formatMoneyText(projected)} 元超过月度封顶 ${formatMoneyText(capAmount)} 元（已验收 ${formatMoneyText(accepted)} 元，待完成 ${formatMoneyText(pending)} 元，本次预计 ${formatMoneyText(current)} 元）`;
      })
      .filter((item): item is string => Boolean(item));
  }, [
    assignableLabelers,
    selectedLabelerAllocations,
    selectedRewardCapAmount,
    selectedRewardCapType,
    selectedRewardPerItem,
  ]);

  const columns: ColumnsType<OwnerTaskRow> = [
    {
      title: '任务',
      dataIndex: 'title',
      render: (_value, record) => {
        const autoNamedDraft = isAutoNamedDraftTask(record);
        return (
          <div className="owner-task-title">
            <div className="owner-task-name-row">
              <span className={`owner-task-name${autoNamedDraft ? ' owner-task-name-auto-draft' : ''}`}>
                {record.title}
              </span>
              {autoNamedDraft ? <Tag className="owner-task-auto-draft-tag">自动命名</Tag> : null}
              <span className="owner-task-name-separator">·</span>
              <Tag className="owner-task-total-quota">
                总配额 {record.quotaTotal.toLocaleString()}
              </Tag>
            </div>
            <div className="owner-task-meta">
              {record.taskId} · Owner: {record.owner} · 创建于 {record.createdAt}
            </div>
          </div>
        );
      },
    },
    {
      title: '审核状态',
      dataIndex: 'reviewStatus',
      width: 130,
      render: (status: OwnerTaskReviewStatus | undefined, record) => {
        const reviewStatus = status ?? 'not_started';
        const meta = reviewStatusMeta[reviewStatus] ?? reviewStatusMeta.not_started;
        return (
          <Tooltip title={resolveReviewTooltip(record)}>
            <Tag color={meta.color} className="owner-task-review-status">
              {meta.label}
            </Tag>
          </Tooltip>
        );
      },
    },
    {
      title: '标注状态',
      key: 'labelingStatus',
      width: 120,
      render: (_value, record) => {
        const labelingStatus = resolveLabelingStatus(record);
        const meta = labelingStatusMeta[labelingStatus];
        return (
          <span className="owner-task-state">
            {meta.icon}
            {meta.label}
          </span>
        );
      },
    },
    {
      title: '标注进度',
      dataIndex: 'annotatedItemCount',
      width: 220,
      render: (_value, record) => {
        const { annotatedCount, itemTotal, barPercent, displayPercent } = getTaskProgress(record);
        const tooltip = `已标注数量 ${annotatedCount.toLocaleString()}，任务总额 ${itemTotal.toLocaleString()}，总配额 ${record.quotaTotal.toLocaleString()}`;
        return (
          <Tooltip title={tooltip}>
            <div className="owner-task-quota" tabIndex={0}>
              <div className="owner-task-quota-numbers">
                <strong>{displayPercent}%</strong>
              </div>
              <div className="owner-task-quota-bar">
                <span style={{ width: `${barPercent}%` }} />
              </div>
            </div>
          </Tooltip>
        );
      },
    },
    {
      title: '分发策略',
      dataIndex: 'assignStrategy',
      width: 140,
      render: (strategy: OwnerAssignStrategy, record) => (
        <Space direction="vertical" size={2}>
          <span>{strategyLabel[strategy]}</span>
          {strategy === 'quota' && record.maxClaimPerUser ? (
            <Typography.Text type="secondary">
              每人最多 {record.maxClaimPerUser} 条
            </Typography.Text>
          ) : null}
          {strategy === 'assigned' && record.assignedLabelerIds.length > 0 ? (
            // 复用本页统计卡的圆角胶囊样式(owner-stat-trend + mute),保持气泡形态一致
            <Tag className="owner-stat-trend owner-stat-mute">
              已指派 {record.assignedLabelerIds.length} 人
            </Tag>
          ) : null}
        </Space>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 220,
      render: (_value, record) => (
        <Space size="small">
          {record.state === 'draft' && (
            <Button type="link" onClick={() => openDrawer(record)}>
              发布
            </Button>
          )}
          {record.state === 'published' && (
            <Button
              type="link"
              icon={<PauseCircleFilled />}
              onClick={() => void handleStateChange(record, 'paused')}
            >
              暂停
            </Button>
          )}
          {record.state === 'paused' && (
            <Button
              type="link"
              icon={<SyncOutlined />}
              onClick={() => void handleStateChange(record, 'published')}
            >
              恢复
            </Button>
          )}
          {(record.state === 'published' || record.state === 'paused') && (
            <Button
              type="link"
              danger
              icon={<StopFilled />}
              onClick={() => void handleStateChange(record, 'ended')}
            >
              结束
            </Button>
          )}
          <Button type="link" onClick={() => openDrawer(record)}>
            详情
          </Button>
          <Button
            type="link"
            danger
            icon={<DeleteOutlined />}
            onClick={() => void handleDelete(record)}
          >
            删除
          </Button>
        </Space>
      ),
    },
  ];

  async function loadTasks() {
    setLoading(true);
    try {
      const response = await ownerApi.listTasks();
      setRows(response.items);
    } catch (error) {
      message.error(getApiErrorMessage(error, '任务列表加载失败'));
    } finally {
      setLoading(false);
    }
  }

  async function loadDatasets() {
    try {
      const response = await datasetApi.listDatasets();
      setDatasets(response.items);
    } catch (error) {
      message.error(getApiErrorMessage(error, '数据集列表加载失败'));
    }
  }

  async function loadSchemas() {
    setSchemaLoading(true);
    try {
      const response = await schemaApi.listSchemas();
      setSchemas(response.items);
    } catch (error) {
      message.error(getApiErrorMessage(error, '模板列表加载失败'));
    } finally {
      setSchemaLoading(false);
    }
  }

  async function loadAiRules() {
    try {
      const response = await aiReviewApi.listRules({ status: 'enabled', page: 1, pageSize: 100 });
      setAiRules(response.items);
    } catch (error) {
      message.error(getApiErrorMessage(error, 'AI 预审规则加载失败'));
    }
  }

  async function loadAssignableLabelers() {
    try {
      const response = await ownerApi.listAssignableLabelers();
      setAssignableLabelers(response);
    } catch (error) {
      message.error(getApiErrorMessage(error, '标注员列表加载失败'));
    }
  }

  async function loadAssignableReviewers() {
    try {
      const response = await ownerApi.listAssignableReviewers();
      setAssignableReviewers(response);
    } catch (error) {
      message.error(getApiErrorMessage(error, '审核员列表加载失败'));
    }
  }

  async function loadDatasetItemOptions(datasetId: string, page = itemOptionPage, keyword = itemOptionKeyword) {
    setItemOptionLoading(true);
    try {
      const response = await datasetApi.listItemOptions(datasetId, {
        page,
        pageSize: DATASET_ITEM_PAGE_SIZE,
        keyword: keyword.trim() || undefined,
        excludeTaskId: activeRow?.taskId,
      });
      setDatasetItemOptions(response.items);
      setItemOptionPage(response.page);
      setItemOptionTotal(response.total);
    } catch (error) {
      message.error(getApiErrorMessage(error, '题目列表加载失败'));
    } finally {
      setItemOptionLoading(false);
    }
  }

  function renderItemUsageHint(item: DatasetItemOption) {
    const usedTaskCount = item.usedTaskCount ?? item.usedTasks?.length ?? 0;
    if (usedTaskCount <= 0) {
      return null;
    }
    const usedTasks = item.usedTasks ?? [];
    const overlay = usedTasks.length ? (
      <Space direction="vertical" size={4}>
        {usedTasks.map((task) => (
          <span key={task.taskId} className="owner-task-item-usage-row">
            {task.title || `任务 #${task.taskId}`}（#{task.taskId} · {resolveTaskStateLabel(task.state)}）
          </span>
        ))}
      </Space>
    ) : (
      <span>该题目已在发布类任务中使用</span>
    );
    return (
      <Tooltip title={overlay} placement="topLeft">
        <Tag color="warning" className="owner-task-item-usage-tag">
          已在 {usedTaskCount} 个任务中发布
        </Tag>
      </Tooltip>
    );
  }

  function inferDatasetId(row?: OwnerTaskRow) {
    if (!row) {
      return datasets[0]?.id ?? '';
    }
    if (row.datasetId) {
      return row.datasetId;
    }
    return datasets.find((dataset) => dataset.taskId === row.taskId)?.id ?? '';
  }

  function resolveDatasetQuota(datasetId?: string) {
    if (!datasetId) {
      return null;
    }
    return datasets.find((dataset) => dataset.id === datasetId)?.itemCount ?? null;
  }

  function toFormValues(row?: OwnerTaskRow, detail?: OwnerTaskDetail): PublishFormValues {
    const datasetId = inferDatasetId(row);
    const rewardFields = parseRewardRule(row?.reward);
    return {
      title: row?.title ?? '',
      tags: row?.tags?.length ? row.tags : ['电商', '中文'],
      ...rewardFields,
      quota: row?.quotaTotal ?? resolveDatasetQuota(datasetId),
      deadline: row?.deadline ? dayjs(row.deadline, DATE_TIME_FORMAT) : null,
      datasetId,
      itemSelectionMode: detail?.itemSelectionMode ?? 'all',
      selectedItemIds: detail?.selectedItemIds ?? [],
      strategy: row?.assignStrategy ?? 'first-come',
      maxClaimPerUser: row?.maxClaimPerUser ?? null,
      assignedLabelerIds: row?.assignedLabelerIds ?? [],
      labelerAllocations: detail?.labelerAllocations?.map(toAllocationFormValue) ?? [],
      reviewerAssignmentMode: detail?.reviewerAllocations?.length ? 'manual' : 'auto',
      reviewerAllocations: detail?.reviewerAllocations?.map(toAllocationFormValue) ?? [],
      schema: row ? `${row.title} (Schema ${row.schemaVersion})` : '',
      schemaVersionId:
        row?.schemaVersionId && publishedSchemas.some((schema) => schema.versionId === row.schemaVersionId)
          ? row.schemaVersionId
          : undefined,
      aiReviewEnabled: row?.aiReviewEnabled ?? true,
      aiReviewRuleId: row?.aiReviewRuleId ?? aiRules[0]?.ruleId,
      llmAssistEnabled: row ? row.llmAssistEnabled ?? false : true,
    };
  }

  function toAllocationFormValue(allocation: TaskUserAllocation): AllocationFormValue {
    return {
      userId: allocation.userId,
      itemCount: allocation.itemCount,
    };
  }

  async function openDrawer(row?: OwnerTaskRow) {
    setActiveRow(row ?? null);
    submitStateRef.current = row?.state ?? 'published';
    lastSchemaSelectionRef.current = row?.schemaVersionId || undefined;
    setActiveFormTab('basic');
    setItemOptionKeyword('');
    setItemOptionPage(1);
    setDrawerOpen(true);
    setDetailLoading(!!row);
    try {
      const detail = row ? await ownerApi.getTaskDetail(row.taskId) : undefined;
      const values = toFormValues(row, detail);
      lastDatasetSelectionRef.current = values.datasetId;
      form.setFieldsValue(values);
    } catch (error) {
      message.error(getApiErrorMessage(error, '任务详情加载失败'));
      closeDrawer();
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setActiveRow(null);
    setDetailLoading(false);
    setDatasetItemOptions([]);
    setItemOptionKeyword('');
    setItemOptionPage(1);
    setItemOptionTotal(0);
    form.resetFields();
  }

  function buildTaskPayload(values: PublishFormValues, status: TaskState): CreateOwnerTaskRequest {
    const schema = publishedSchemas.find((item) => item.versionId === values.schemaVersionId);
    const schemaLabel = schema ? `${schema.name} (${schema.versionNumber})` : values.schema?.trim();
    const itemSelectionMode = values.itemSelectionMode ?? 'all';
    const selectedItems = itemSelectionMode === 'partial' ? values.selectedItemIds ?? [] : [];
    const totalItems =
      itemSelectionMode === 'partial'
        ? selectedItems.length
        : datasets.find((dataset) => dataset.id === values.datasetId)?.itemCount ?? 0;
    const labelerAllocations =
      values.strategy === 'assigned' ? toAllocationPayload(values.labelerAllocations) : [];
    const reviewerAllocations =
      values.reviewerAssignmentMode === 'manual' ? toAllocationPayload(values.reviewerAllocations) : [];
    const draftTitleFallback =
      activeRow?.state === 'draft' && activeRow.title.trim().startsWith(UNTITLED_DRAFT_TITLE_PREFIX)
        ? activeRow.title.trim()
        : createUntitledDraftTitle();
    const title = values.title?.trim() || (status === 'draft' ? draftTitleFallback : '');
    const reward = buildRewardRule(values);
    return {
      title,
      tags: values.tags ?? [],
      reward,
      quota: totalItems || values.quota || undefined,
      deadline: values.deadline ? values.deadline.format(DATE_TIME_FORMAT) : undefined,
      datasetId: values.datasetId,
      itemSelectionMode,
      selectedItemIds: selectedItems,
      strategy: values.strategy,
      maxClaimPerUser:
        values.strategy === 'quota' ? values.maxClaimPerUser ?? undefined : undefined,
      assignedLabelerIds:
        values.strategy === 'assigned' ? labelerAllocations.map((item) => item.userId) : [],
      labelerAllocations,
      reviewerAllocations,
      schema: schemaLabel || undefined,
      schemaVersionId: schema?.versionId,
      aiReviewEnabled: values.aiReviewEnabled ?? true,
      aiReviewRuleId: values.aiReviewEnabled === false ? undefined : values.aiReviewRuleId,
      llmAssistEnabled: values.llmAssistEnabled ?? true,
      status,
    };
  }

  async function saveTask(values: PublishFormValues, targetState: TaskState) {
    setSubmitting(true);
    try {
      const payload = buildTaskPayload(values, targetState);
      if (activeRow) {
        await ownerApi.updateTask(activeRow.taskId, payload);
        message.success(targetState === 'published' ? '任务已更新并发布' : '任务内容已保存');
      } else {
        await ownerApi.createTask(payload);
        message.success(targetState === 'published' ? '任务已发布' : '任务草稿已保存');
      }
      closeDrawer();
      await Promise.all([loadTasks(), loadDatasets()]);
    } catch (error) {
      message.error(getApiErrorMessage(error, '任务保存失败'));
    } finally {
      setSubmitting(false);
    }
  }

  function secondarySubmitState() {
    if (!activeRow || activeRow.state === 'draft') {
      return 'draft' as TaskState;
    }
    return activeRow.state;
  }

  function primarySubmitState() {
    if (!activeRow || activeRow.state === 'draft' || activeRow.state === 'ended') {
      return 'published' as TaskState;
    }
    return activeRow.state;
  }

  async function handleStateChange(row: OwnerTaskRow, state: TaskState) {
    try {
      await ownerApi.updateTaskState(row.taskId, state);
      message.success('任务状态已更新');
      await loadTasks();
    } catch (error) {
      message.error(getApiErrorMessage(error, '任务状态更新失败'));
    }
  }

  async function handleDelete(row: OwnerTaskRow) {
    Modal.confirm({
      title: '确认删除该任务?',
      content: `任务「${row.title}」将从任务列表和 Labeler 端隐藏; 已领取和已提交的标注会标记为作废, 原始答案仍保留在数据库中。`,
      okText: '确认删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await ownerApi.deleteTask(row.taskId);
          message.success('任务已删除');
          await loadTasks();
        } catch (error) {
          message.error(getApiErrorMessage(error, '删除失败'));
        }
      },
    });
  }

  async function handlePublishFinish(values: PublishFormValues) {
    const targetState = submitStateRef.current;
    const selectedCount =
      values.itemSelectionMode === 'partial'
        ? values.selectedItemIds?.length ?? 0
        : datasets.find((dataset) => dataset.id === values.datasetId)?.itemCount ?? 0;
    if (targetState === 'published' && selectedCount <= 0) {
      message.error('发布任务前请至少选择 1 道题目');
      setActiveFormTab('scope');
      return;
    }
    if (
      targetState === 'published' &&
      values.strategy === 'assigned' &&
      sumAllocationValues(values.labelerAllocations) !== selectedCount
    ) {
      message.error('标注员分配题量总和必须等于任务题目数');
      setActiveFormTab('distribution');
      return;
    }
    if (
      targetState === 'published' &&
      values.reviewerAssignmentMode === 'manual' &&
      sumAllocationValues(values.reviewerAllocations) !== selectedCount
    ) {
      message.error('审核员分配题量总和必须等于任务题目数');
      setActiveFormTab('review');
      return;
    }
    await saveTask(values, targetState);
  }

  async function handleSaveDraft() {
    const targetState = secondarySubmitState();
    submitStateRef.current = targetState;
    if (targetState !== 'draft') {
      form.submit();
      return;
    }
    await saveTask(form.getFieldsValue(true) as PublishFormValues, targetState);
  }

  function handlePublishFailed({ errorFields }: Parameters<NonNullable<FormProps<PublishFormValues>['onFinishFailed']>>[0]) {
    const firstError = errorFields[0];
    const firstMessage = firstError?.errors?.[0];
    setActiveFormTab(resolvePublishFormTab(firstError?.name));
    message.error(firstMessage ? `请完善任务配置：${firstMessage}` : '请完善任务配置后再提交');
  }

  function resetTaskFilters() {
    setStateFilter('all');
    setReviewStatusFilter('all');
    setStrategyFilter('all');
  }

  function buildTaskMoreMenu(record: OwnerTaskRow): MenuProps['items'] {
    const items: MenuProps['items'] = [];
    if (record.state === 'published') {
      items.push(
        { key: 'pause', icon: <PauseCircleFilled />, label: '暂停任务' },
        { key: 'end', icon: <StopFilled />, label: '结束任务', danger: true },
      );
    }
    if (record.state === 'paused') {
      items.push(
        { key: 'resume', icon: <SyncOutlined />, label: '恢复任务' },
        { key: 'end', icon: <StopFilled />, label: '结束任务', danger: true },
      );
    }
    if (items.length > 0) {
      items.push({ type: 'divider' });
    }
    items.push({ key: 'delete', icon: <DeleteOutlined />, label: '删除任务', danger: true });
    return items;
  }

  function handleTaskMoreMenuClick(record: OwnerTaskRow, key: string) {
    switch (key) {
      case 'pause':
        void handleStateChange(record, 'paused');
        break;
      case 'resume':
        void handleStateChange(record, 'published');
        break;
      case 'end':
        void handleStateChange(record, 'ended');
        break;
      case 'delete':
        void handleDelete(record);
        break;
      default:
        break;
    }
  }

  function handleMobileItemToggle(itemId: string, checked: boolean) {
    const nextSelectedIds = new Set<string>((form.getFieldValue('selectedItemIds') ?? []).map(String));
    if (checked) {
      nextSelectedIds.add(itemId);
    } else {
      nextSelectedIds.delete(itemId);
    }
    form.setFieldValue('selectedItemIds', Array.from(nextSelectedIds));
  }

  function toggleMobileTaskExpanded(taskId: string) {
    setExpandedMobileTaskIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  }

  function handleMobileTaskListToggle() {
    if (!mobileListExpanded) {
      setMobileListExpanded(true);
      return;
    }

    setMobileListExpanded(false);
    window.setTimeout(() => {
      mobileTaskListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }

  function renderMobileTaskCard(record: OwnerTaskRow) {
    const labelingStatus = resolveLabelingStatus(record);
    const labelingMeta = labelingStatusMeta[labelingStatus];
    const reviewStatus = record.reviewStatus ?? 'not_started';
    const reviewMeta = reviewStatusMeta[reviewStatus] ?? reviewStatusMeta.not_started;
    const progress = getTaskProgress(record);
    const autoNamedDraft = isAutoNamedDraftTask(record);
    const isFocused = record.taskId === focusedTaskId;
    const isExpanded = expandedMobileTaskIds.has(record.taskId);
    return (
      <article
        className={`owner-task-mobile-card${isFocused ? ' owner-task-mobile-card-focused' : ''}`}
        key={record.taskId}
      >
        <div className="owner-task-mobile-head">
          <div className="owner-task-mobile-title-block">
            <div className={`owner-task-mobile-title${autoNamedDraft ? ' owner-task-name-auto-draft' : ''}`}>
              {record.title}
            </div>
            <div className="owner-task-mobile-tags">
              {autoNamedDraft ? <Tag className="owner-task-auto-draft-tag">自动命名</Tag> : null}
              <span className="owner-task-state">
                {labelingMeta.icon}
                {labelingMeta.label}
              </span>
              <Tooltip title={resolveReviewTooltip(record)}>
                <Tag color={reviewMeta.color} className="owner-task-review-status">
                  {reviewMeta.label}
                </Tag>
              </Tooltip>
            </div>
          </div>
          <Dropdown
            trigger={['click']}
            menu={{
              items: buildTaskMoreMenu(record),
              onClick: ({ key }) => handleTaskMoreMenuClick(record, String(key)),
            }}
          >
            <Button
              type="text"
              icon={<MoreOutlined />}
              className="owner-task-mobile-more"
              aria-label="更多任务操作"
            />
          </Dropdown>
        </div>

        {isExpanded ? (
          <div className="owner-task-mobile-meta">
            <span>任务 ID：{record.taskId}</span>
            <span>Owner：{record.owner}</span>
            <span>创建时间：{record.createdAt}</span>
            <span>分发策略：{strategyLabel[record.assignStrategy]}</span>
            <span>总配额：{record.quotaTotal.toLocaleString()}</span>
            {record.assignStrategy === 'quota' && record.maxClaimPerUser ? (
              <span>每人最多：{record.maxClaimPerUser.toLocaleString()} 条</span>
            ) : null}
          </div>
        ) : null}

        <div className="owner-task-mobile-progress">
          <div className="owner-task-mobile-progress-head">
            <span>标注进度</span>
            <strong>{progress.displayPercent}%</strong>
          </div>
          <div className="owner-task-quota-bar">
            <span style={{ width: `${progress.barPercent}%` }} />
          </div>
          <div className="owner-task-mobile-progress-meta">
            已标注 {progress.annotatedCount.toLocaleString()} / {progress.itemTotal.toLocaleString()} 题
          </div>
        </div>

        <Button
          type="text"
          className="owner-task-mobile-expand"
          icon={isExpanded ? <UpOutlined /> : <DownOutlined />}
          onClick={() => toggleMobileTaskExpanded(record.taskId)}
          aria-expanded={isExpanded}
        >
          {isExpanded ? '收起' : '展开'}
        </Button>

        <Button
          type={record.state === 'draft' ? 'primary' : 'default'}
          block
          onClick={() => openDrawer(record)}
        >
          {resolveTaskPrimaryActionLabel(record)}
        </Button>
      </article>
    );
  }

  function renderMobileItemPicker() {
    const selectedIdSet = new Set((selectedItemIds ?? []).map(String));
    const pageTotal = Math.max(Math.ceil(itemOptionTotal / DATASET_ITEM_PAGE_SIZE), 1);
    const pageStart = itemOptionTotal === 0 ? 0 : (itemOptionPage - 1) * DATASET_ITEM_PAGE_SIZE + 1;
    const pageEnd = Math.min(itemOptionPage * DATASET_ITEM_PAGE_SIZE, itemOptionTotal);
    return (
      <div className="owner-task-mobile-item-picker">
        {itemOptionLoading ? (
          <div className="owner-task-mobile-empty">题目加载中...</div>
        ) : datasetItemOptions.length > 0 ? (
          datasetItemOptions.map((item) => (
            <label className="owner-task-mobile-item-card" key={item.itemId}>
              <Checkbox
                checked={selectedIdSet.has(item.itemId)}
                onChange={(event) => handleMobileItemToggle(item.itemId, event.target.checked)}
              />
              <span className="owner-task-mobile-item-main">
                <span className="owner-task-mobile-item-title">{item.label}</span>
                <span className="owner-task-mobile-item-id">#{item.itemId}</span>
                {renderItemUsageHint(item)}
                <span className="owner-task-mobile-item-summary">{item.summary}</span>
                <Tag>{item.mediaType}</Tag>
              </span>
            </label>
          ))
        ) : (
          <div className="owner-task-mobile-empty">暂无匹配题目</div>
        )}
        <div className="owner-task-mobile-item-pagination">
          <Typography.Text type="secondary">
            {itemOptionTotal === 0
              ? '暂无题目'
              : `${pageStart}-${pageEnd} / ${itemOptionTotal} 题`}
          </Typography.Text>
          <Space size={8}>
            <Button
              size="small"
              disabled={itemOptionPage <= 1 || itemOptionLoading}
              onClick={() => setItemOptionPage((page) => Math.max(page - 1, 1))}
            >
              上一页
            </Button>
            <Button
              size="small"
              disabled={itemOptionPage >= pageTotal || itemOptionLoading}
              onClick={() => setItemOptionPage((page) => Math.min(page + 1, pageTotal))}
            >
              下一页
            </Button>
          </Space>
        </div>
      </div>
    );
  }

  return (
    <Space direction="vertical" size="large" className="page-stack owner-task-page">
      <div className="page-title-row">
        <Space direction="vertical" size={4}>
          <Typography.Title level={3}>任务管理</Typography.Title>
          <Typography.Text type="secondary">
            维护任务全生命周期：草稿、发布中、已暂停、已结束。
          </Typography.Text>
        </Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openDrawer()}>
          新建任务
        </Button>
      </div>

      <Row gutter={16} className="owner-task-stat-row">
        <Col span={8}>
          <Card className="owner-stat-card">
            <div className="owner-stat-label">发布中任务</div>
            <div className="owner-stat-value owner-stat-primary">{publishedCount}</div>
            <Tag color="success" className="owner-stat-trend">
              <CheckCircleFilled /> 当前在线
            </Tag>
          </Card>
        </Col>
        <Col span={8}>
          <Card className="owner-stat-card">
            <div className="owner-stat-label">草稿</div>
            <div className="owner-stat-value">{draftCount}</div>
            <Tag className="owner-stat-trend owner-stat-mute">待完善后发布</Tag>
          </Card>
        </Col>
        <Col span={8}>
          <Card className="owner-stat-card">
            <div className="owner-stat-label">累计已认领</div>
            <div className="owner-stat-value owner-stat-primary">
              {submittedCount.toLocaleString()}
            </div>
            <Tag color="processing" className="owner-stat-trend">
              <AiAssistantIcon /> AI 预审已开启
            </Tag>
          </Card>
        </Col>
      </Row>

      <Card className="owner-toolbar">
        <Space size={12} wrap className="owner-toolbar-desktop">
          <Input.Search
            placeholder="搜索任务名 / ID / 负责人"
            allowClear
            style={{ width: 280 }}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onSearch={setKeyword}
          />
          <Select
            options={stateFilterOptions}
            value={stateFilter}
            onChange={setStateFilter}
            style={{ width: 140 }}
          />
          <Select
            options={reviewStatusFilterOptions}
            value={reviewStatusFilter}
            onChange={setReviewStatusFilter}
            style={{ width: 150 }}
          />
          <Select
            options={strategyFilterOptions}
            value={strategyFilter}
            onChange={setStrategyFilter}
            style={{ width: 160 }}
          />
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadTasks()}>
            刷新
          </Button>
        </Space>
        <div className="owner-toolbar-mobile">
          <Input.Search
            placeholder="搜索任务名 / ID / 负责人"
            allowClear
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onSearch={setKeyword}
          />
          <Button icon={<FilterOutlined />} onClick={() => setMobileFilterOpen(true)}>
            筛选
            <Badge count={activeTaskFilterCount} size="small" offset={[6, -2]} />
          </Button>
          <Button
            icon={<ReloadOutlined />}
            loading={loading}
            aria-label="刷新任务"
            onClick={() => void loadTasks()}
          />
        </div>
      </Card>

      <Card className="owner-table-card">
        <Table<OwnerTaskRow>
          columns={columns}
          dataSource={filteredRows}
          rowKey="taskId"
          loading={loading}
          pagination={{ defaultPageSize: 10, showSizeChanger: true, showTotal: (total: number) => `共 ${total} 条匹配记录`, pageSizeOptions: [10, 20, 50, 100, 200] }}
          rowClassName={(record) => (
            record.taskId === focusedTaskId
              ? 'owner-task-row owner-task-row-focused'
              : 'owner-task-row'
          )}
        />
      </Card>

      <div className="owner-task-mobile-list" ref={mobileTaskListRef}>
        {loading ? (
          <div className="owner-task-mobile-empty">任务加载中...</div>
        ) : mobileRows.length > 0 ? (
          mobileRows.map(renderMobileTaskCard)
        ) : (
          <div className="owner-task-mobile-empty">暂无匹配任务</div>
        )}
        {!loading && filteredRows.length > MOBILE_TASK_COLLAPSED_COUNT ? (
          <Button
            block
            className="owner-task-mobile-list-toggle"
            onClick={handleMobileTaskListToggle}
          >
            {mobileListExpanded
              ? `收回（显示前 ${MOBILE_TASK_COLLAPSED_COUNT} 条）`
              : `展开全部（共 ${filteredRows.length} 条）`}
          </Button>
        ) : !loading && mobileRows.length > 0 ? (
          <Typography.Text type="secondary" className="owner-task-mobile-count">
            已显示全部 {filteredRows.length} 条匹配任务
          </Typography.Text>
        ) : null}
      </div>

      <Drawer
        title="筛选任务"
        placement="bottom"
        height={360}
        open={mobileFilterOpen}
        onClose={() => setMobileFilterOpen(false)}
        rootClassName="owner-task-filter-drawer"
        footer={
          <div className="owner-task-filter-footer">
            <Button onClick={resetTaskFilters}>重置筛选</Button>
            <Button type="primary" onClick={() => setMobileFilterOpen(false)}>
              完成
            </Button>
          </div>
        }
      >
        <Space direction="vertical" size={14} className="owner-task-filter-fields">
          <Select
            options={stateFilterOptions}
            value={stateFilter}
            onChange={setStateFilter}
          />
          <Select
            options={reviewStatusFilterOptions}
            value={reviewStatusFilter}
            onChange={setReviewStatusFilter}
          />
          <Select
            options={strategyFilterOptions}
            value={strategyFilter}
            onChange={setStrategyFilter}
          />
        </Space>
      </Drawer>

      <Drawer
        title={activeRow ? `发布任务 · ${activeRow.title}` : '新建标注任务'}
        width={760}
        open={drawerOpen}
        onClose={closeDrawer}
        closeIcon={<CloseOutlined />}
        rootClassName="owner-task-publish-drawer"
        footer={
          <Space className="owner-drawer-footer">
            <Button
              loading={submitting}
              disabled={detailLoading}
              onClick={() => void handleSaveDraft()}
            >
              {!activeRow || activeRow.state === 'draft' ? '存为草稿' : '保存更改'}
            </Button>
            <Button
              type="primary"
              icon={<ArrowRightOutlined />}
              loading={submitting}
              disabled={detailLoading}
              onClick={() => {
                submitStateRef.current = primarySubmitState();
                form.submit();
              }}
            >
              {!activeRow || activeRow.state === 'draft'
                ? '立即发布'
                : activeRow.state === 'ended'
                  ? '续期发布'
                  : '保存并关闭'}
            </Button>
          </Space>
        }
      >
        <div className="owner-drawer-banner">
          发布后任务会进入「发布中」状态。题目范围会固定为当前选择，审核与标注分配按本页配置执行。
        </div>

        <Form<PublishFormValues>
          form={form}
          layout="vertical"
          requiredMark={false}
          disabled={detailLoading}
          onFinish={handlePublishFinish}
          onFinishFailed={handlePublishFailed}
        >
          <Tabs
            className="owner-task-form-tabs"
            activeKey={activeFormTab}
            onChange={setActiveFormTab}
            items={[
              {
                key: 'basic',
                label: '基础信息',
                children: (
                  <Space direction="vertical" size={14} style={{ width: '100%' }}>
                    <Form.Item
                      label="任务标题"
                      name="title"
                      rules={[{ required: true, message: '请输入任务标题' }]}
                    >
                      <Input placeholder="例如：商品标题清洗 v3" />
                    </Form.Item>
                    <Form.Item label="标签" name="tags">
                      <Select mode="tags" placeholder="按回车输入标签" />
                    </Form.Item>
                    <Form.Item name="reward" hidden>
                      <Input />
                    </Form.Item>
                    <div className="owner-reward-editor">
                      <div className="owner-reward-editor-head">
                        <Typography.Text strong>奖励规则</Typography.Text>
                        <Space size={6} wrap>
                          {REWARD_PRESETS.map((preset) => (
                            <Button
                              key={preset.label}
                              size="small"
                              onClick={() => {
                                form.setFieldsValue({
                                  rewardPerItem: preset.rewardPerItem,
                                  rewardCapType: preset.rewardCapType,
                                  rewardCapAmount: preset.rewardCapAmount,
                                  reward: buildRewardRule(preset),
                                });
                              }}
                            >
                              {preset.label}
                            </Button>
                          ))}
                        </Space>
                      </div>
                      <Row gutter={12}>
                        <Col xs={24} sm={8}>
                          <Form.Item
                            label="单价"
                            name="rewardPerItem"
                            rules={[{ required: true, message: '请输入单条奖励' }]}
                          >
                            <InputNumber
                              min={0.01}
                              precision={2}
                              step={0.01}
                              addonAfter="元 / 条"
                              style={{ width: '100%' }}
                            />
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={8}>
                          <Form.Item label="封顶类型" name="rewardCapType">
                            <Segmented
                              block
                              options={[
                                { label: '月度封顶', value: 'monthly' },
                                { label: '无封顶', value: 'none' },
                              ]}
                            />
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={8}>
                          {selectedRewardCapType !== 'none' ? (
                            <Form.Item
                              label="封顶金额"
                              name="rewardCapAmount"
                              rules={[{ required: true, message: '请输入月度封顶金额' }]}
                            >
                              <InputNumber
                                min={1}
                                precision={0}
                                addonAfter="元"
                                style={{ width: '100%' }}
                              />
                            </Form.Item>
                          ) : (
                            <Form.Item label="封顶金额">
                              <Input disabled value="无封顶" />
                            </Form.Item>
                          )}
                        </Col>
                      </Row>
                      <div className="owner-reward-preview">
                        <span>提交文案</span>
                        <strong>{rewardPreview}</strong>
                      </div>
                    </div>
                    <Form.Item
                      label="截止时间"
                      name="deadline"
                      rules={[
                        { required: true, message: '请选择截止时间' },
                        {
                          validator: async (_rule, value) => {
                            if (submitStateRef.current === 'published' && value && value.isBefore(dayjs())) {
                              throw new Error('发布时间必须晚于当前时间');
                            }
                          },
                        },
                      ]}
                    >
                      <DatePicker
                        showTime={{ format: 'HH:mm' }}
                        format={DATE_TIME_FORMAT}
                        style={{ width: '100%' }}
                        placeholder="选择截止时间"
                        disabledDate={(current) => !!current && current.endOf('day').isBefore(dayjs())}
                      />
                    </Form.Item>
                    <Form.Item
                      label="关联模板"
                      name="schemaVersionId"
                      extra={
                        publishedSchemas.length === 0
                          ? '暂无已发布模板，请先到「模板搭建」页发布模板。'
                          : '任务发布后，Labeler 将按该模板版本渲染标注表单。'
                      }
                      rules={[
                        {
                          validator: async (_rule, value) => {
                            if (
                              submitStateRef.current === 'published' &&
                              !publishedSchemas.some((schema) => schema.versionId === value)
                            ) {
                              throw new Error('发布任务前请选择一个已发布模板');
                            }
                          },
                        },
                      ]}
                    >
                      <Select
                        placeholder="选择已发布模板"
                        options={schemaOptions}
                        loading={schemaLoading}
                        showSearch
                        allowClear
                        optionFilterProp="label"
                      />
                    </Form.Item>
                    {selectedSchema ? (
                      <Card size="small" className="owner-stat-card">
                        <Space direction="vertical" size={2}>
                          <Typography.Text strong>{selectedSchema.name}</Typography.Text>
                          <Typography.Text type="secondary">
                            {selectedSchema.versionNumber} · {selectedSchema.fieldCount} 个字段 · 更新于{' '}
                            {selectedSchema.updatedAt}
                          </Typography.Text>
                          {selectedSchema.datasetName ? (
                            <Typography.Text type="secondary">
                              模板默认数据集：{selectedSchema.datasetName}
                            </Typography.Text>
                          ) : null}
                        </Space>
                      </Card>
                    ) : null}
                    <Row gutter={12}>
                      <Col xs={24} sm={12}>
                        <Form.Item label="启用 AI 预审" name="aiReviewEnabled" valuePropName="checked">
                          <Switch checkedChildren="开启" unCheckedChildren="关闭" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} sm={12}>
                        <Form.Item
                          label="启用 LLM 标注助手"
                          name="llmAssistEnabled"
                          valuePropName="checked"
                          extra="开启后，标注员答题页可向 AI 助手提问。"
                        >
                          <Switch checkedChildren="开启" unCheckedChildren="关闭" />
                        </Form.Item>
                      </Col>
                    </Row>
                    {selectedAiReviewEnabled !== false ? (
                      <Form.Item
                        label="AI 预审规则"
                        name="aiReviewRuleId"
                        extra="任务启用 AI 预审时，发布前必须绑定一条启用中的规则。"
                        rules={[
                          {
                            validator: async (_rule, value) => {
                              if (submitStateRef.current === 'published' && !value) {
                                throw new Error('请选择 AI 预审规则');
                              }
                            },
                          },
                        ]}
                      >
                        <Select
                          placeholder="选择启用中的 AI 预审规则"
                          options={aiRuleOptions}
                          showSearch
                          allowClear
                          optionFilterProp="label"
                        />
                      </Form.Item>
                    ) : null}
                  </Space>
                ),
              },
              {
                key: 'scope',
                label: '数据范围',
                children: (
                  <Space direction="vertical" size={14} style={{ width: '100%' }}>
                    <Form.Item
                      label="关联数据集"
                      name="datasetId"
                      rules={[{ required: true, message: '请选择一个现有数据集' }]}
                    >
                      <Select
                        placeholder="选择本任务使用的数据集"
                        options={datasetOptions}
                        showSearch
                        optionFilterProp="label"
                      />
                    </Form.Item>
                    {selectedDataset ? (
                      <Card size="small" className="owner-stat-card">
                        <Space direction="vertical" size={2}>
                          <Typography.Text strong>{selectedDataset.name}</Typography.Text>
                          <Typography.Text type="secondary">
                            {selectedDataset.itemCount} 条 · 当前任务：{selectedDataset.taskTitle || '未关联'}
                          </Typography.Text>
                        </Space>
                      </Card>
                    ) : null}
                    <Form.Item label="题目范围" name="itemSelectionMode">
                      <Segmented
                        block
                        options={[
                          { label: '全部题目', value: 'all' },
                          { label: '部分题目', value: 'partial' },
                        ]}
                      />
                    </Form.Item>
                    <Form.Item name="selectedItemIds" hidden>
                      <Select mode="multiple" />
                    </Form.Item>
                    <div className="owner-task-scope-summary">
                      <Tag color="processing">任务总配额 {taskItemCount || 0}</Tag>
                      <Typography.Text type="secondary">
                        {selectedItemSelectionMode === 'partial'
                          ? `已选择 ${selectedItemIds?.length ?? 0} 道题`
                          : '发布时固定为当前数据集全部题目'}
                      </Typography.Text>
                    </div>
                    {selectedItemSelectionMode === 'partial' ? (
                      <Card size="small" className="owner-task-item-picker">
                        <Input.Search
                          placeholder="搜索题目 ID / 内容"
                          allowClear
                          value={itemOptionKeyword}
                          onChange={(event) => {
                            setItemOptionKeyword(event.target.value);
                            setItemOptionPage(1);
                          }}
                          onSearch={(value) => {
                            setItemOptionKeyword(value);
                            setItemOptionPage(1);
                          }}
                        />
                        <Table<DatasetItemOption>
                          size="small"
                          rowKey="itemId"
                          loading={itemOptionLoading}
                          dataSource={datasetItemOptions}
                          rowSelection={{
                            selectedRowKeys: selectedItemIds ?? [],
                            preserveSelectedRowKeys: true,
                            onChange: (keys) => {
                              form.setFieldValue('selectedItemIds', keys.map(String));
                            },
                          }}
                          columns={[
                            {
                              title: '题目',
                              dataIndex: 'label',
                              width: 180,
                              render: (label: string, record) => (
                                <Space direction="vertical" size={2}>
                                  <Typography.Text strong>{label}</Typography.Text>
                                  <Typography.Text type="secondary">#{record.itemId}</Typography.Text>
                                  {renderItemUsageHint(record)}
                                </Space>
                              ),
                            },
                            {
                              title: '摘要',
                              dataIndex: 'summary',
                              render: (summary: string) => (
                                <Typography.Text className="owner-task-item-summary">{summary}</Typography.Text>
                              ),
                            },
                            {
                              title: '类型',
                              dataIndex: 'mediaType',
                              width: 88,
                              render: (mediaType: string) => <Tag>{mediaType}</Tag>,
                            },
                          ]}
                          pagination={{
                            current: itemOptionPage,
                            pageSize: DATASET_ITEM_PAGE_SIZE,
                            total: itemOptionTotal,
                            showSizeChanger: false,
                            onChange: (page) => setItemOptionPage(page),
                          }}
                        />
                        {renderMobileItemPicker()}
                      </Card>
                    ) : null}
                  </Space>
                ),
              },
              {
                key: 'distribution',
                label: '标注分发',
                children: (
                  <Space direction="vertical" size={14} style={{ width: '100%' }}>
                    <Form.Item label="分发策略" name="strategy">
                      <Segmented
                        block
                        options={[
                          { label: '先到先得', value: 'first-come' },
                          { label: '指派', value: 'assigned' },
                          { label: '配额抢单', value: 'quota' },
                        ]}
                      />
                    </Form.Item>
                    {selectedStrategy === 'assigned' ? (
                      <AllocationEditor
                        name="labelerAllocations"
                        userOptions={labelerOptions}
                        userPlaceholder="选择标注员"
                        addText="添加标注员"
                        total={labelerAllocationTotal}
                        taskItemCount={taskItemCount}
                      />
                    ) : null}
                    {selectedStrategy === 'assigned' && labelerRewardWarnings.length > 0 ? (
                      <Alert
                        type="warning"
                        showIcon
                        message="月度封顶风险提示"
                        description={
                          <div className="owner-reward-warning-list">
                            {labelerRewardWarnings.map((warning) => (
                              <div key={warning}>{warning}</div>
                            ))}
                          </div>
                        }
                      />
                    ) : null}
                    {selectedStrategy === 'quota' ? (
                      <Form.Item
                        label="每人最多可认领"
                        name="maxClaimPerUser"
                        rules={[{ required: true, message: '请输入每人最多可认领数量' }]}
                      >
                        <InputNumber min={1} style={{ width: '100%' }} placeholder="例如：2" />
                      </Form.Item>
                    ) : null}
                    {selectedStrategy !== 'assigned' ? (
                      <Typography.Text type="secondary">
                        当前任务题目数 {taskItemCount || 0}，标注员按策略领取后生成作业。
                      </Typography.Text>
                    ) : null}
                  </Space>
                ),
              },
              {
                key: 'review',
                label: '审核分配',
                children: (
                  <Space direction="vertical" size={14} style={{ width: '100%' }}>
                    <Form.Item label="审核分配方式" name="reviewerAssignmentMode">
                      <Segmented
                        block
                        options={[
                          { label: '自动平均', value: 'auto' },
                          { label: '指定审核员', value: 'manual' },
                        ]}
                      />
                    </Form.Item>
                    {selectedReviewerAssignmentMode === 'manual' ? (
                      <AllocationEditor
                        name="reviewerAllocations"
                        userOptions={reviewerOptions}
                        userPlaceholder="选择审核员"
                        addText="添加审核员"
                        total={reviewerAllocationTotal}
                        taskItemCount={taskItemCount}
                      />
                    ) : (
                      <Card size="small" className="owner-stat-card">
                        <Space direction="vertical" size={4}>
                          <Typography.Text strong>自动平均分配</Typography.Text>
                          <Typography.Text type="secondary">
                            系统会把 {taskItemCount || 0} 道题平均分给 {assignableReviewers.length} 位审核员。
                          </Typography.Text>
                        </Space>
                      </Card>
                    )}
                  </Space>
                ),
              },
            ]}
          />
        </Form>
      </Drawer>
    </Space>
  );
}
