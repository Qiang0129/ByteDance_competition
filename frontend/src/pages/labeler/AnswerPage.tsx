import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  CheckCircleFilled,
  CloseOutlined,
  CloudSyncOutlined,
  ExclamationCircleFilled,
  PictureOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import {
  Alert,
  App as AntdApp,
  Breadcrumb,
  Button,
  Card,
  Checkbox,
  Empty,
  Input,
  Modal,
  Radio,
  Space,
  Tag,
  Typography,
} from 'antd';
import { useNavigate, useParams } from 'react-router-dom';

import { ApiError, getApiErrorMessage } from '../../api/client';
import { labelerApi } from '../../api/labeler';
import { filterVisibleAnswer, LabelHubFormRenderer, resolveRuntimeRules, resolveSemanticType } from '../../modules/schema';
import type { AssignmentItem, BatchSubmitInvalidItem } from '../../types/labeler';

/**
 * Labeler 答题页(Renderer)。
 * 计划书 4.3:
 *   - 进入页面拉取 raw + Schema + 草稿(GET /assignments/{id}/item)
 *   - 字段渲染按 Schema 类型(text / single-choice / multi / tags / json / show-item)
 *   - 草稿自动保存(节流到 PUT /assignments/{id}/draft)
 *   - 提交时按必填 / maxLength 校验,通过则 POST /assignments/{id}/submit
 *   - 上一题/下一题/跳过 按钮支持 prev/next assignment 跳转
 *   - 打回项进入时显示上一轮 returnReason
 */

const DRAFT_DEBOUNCE_MS = 1500;

/** 分栏左侧宽度持久化:键名与默认值 */
const SPLIT_STORAGE_KEY = 'labelhub:answer:split-left-percent';
const DEFAULT_SPLIT_PERCENT = 42;

/** 读取上次保存的左侧分栏占比,非法或越界时回退默认值 */
function loadSplitPercent(): number {
  try {
    const raw = localStorage.getItem(SPLIT_STORAGE_KEY);
    if (raw) {
      const value = Number(raw);
      if (Number.isFinite(value) && value >= 25 && value <= 70) {
        return value;
      }
    }
  } catch {
    /* localStorage 不可用时忽略,使用默认值 */
  }
  return DEFAULT_SPLIT_PERCENT;
}

/** 保存当前左侧分栏占比 */
function saveSplitPercent(percent: number) {
  try {
    localStorage.setItem(SPLIT_STORAGE_KEY, String(Math.round(percent)));
  } catch {
    /* localStorage 不可用时静默失败 */
  }
}

export default function AnswerPage() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();

  const [item, setItem] = useState<AssignmentItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [usingFallback, setUsingFallback] = useState(false);
  const [answer, setAnswer] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savingDraft, setSavingDraft] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [editCurrentSchema, setEditCurrentSchema] = useState(false);
  const [batchInvalidItems, setBatchInvalidItems] = useState<BatchSubmitInvalidItem[]>([]);
  // 左右卡片分栏:左侧占比(百分比),通过中间拖拽条调节,并持久化到 localStorage
  const [leftPercent, setLeftPercent] = useState(loadSplitPercent);
  const splitRef = useRef<HTMLDivElement | null>(null);

  // 用 ref 把答案与 assignmentId 同步给 setTimeout 回调,避免闭包问题
  const answerRef = useRef(answer);
  const itemRef = useRef<AssignmentItem | null>(null);
  const assignmentIdRef = useRef(assignmentId);
  const editableRef = useRef(false);
  const dirtyRef = useRef(false);
  const canEdit = item ? item.editable ?? isEditableStatus(item.status) : false;
  const submittedSnapshotFields = item?.latestAnnotation?.schemaSnapshot?.fields;
  const showSubmittedSnapshot =
    !!item?.latestAnnotation && !editCurrentSchema && item.status === 'submitted';
  const renderFields = showSubmittedSnapshot && submittedSnapshotFields?.length
    ? submittedSnapshotFields
    : item?.fields ?? [];
  const renderReadonly = !canEdit || showSubmittedSnapshot;
  const activeSchemaDigest = showSubmittedSnapshot ? undefined : item?.schemaDigest;
  const invalidIndexes = useMemo(
    () => new Set(batchInvalidItems.map((invalidItem) => invalidItem.index)),
    [batchInvalidItems],
  );
  const currentInvalidItem = item
    ? batchInvalidItems.find((invalidItem) => invalidItem.index === item.position.index)
    : undefined;
  const rawAnswerFallback = useMemo(() => {
    const submittedAnswer = item?.latestAnnotation?.answerJson;
    if (!item || !submittedAnswer || typeof submittedAnswer !== 'object') {
      return null;
    }
    const currentFieldNames = new Set(
      renderFields
        .filter((field) => field.kind !== 'show-item' && field.fieldName)
        .map((field) => field.fieldName),
    );
    const hasUnmatchedAnswerKey = Object.keys(submittedAnswer).some(
      (key) => !currentFieldNames.has(key),
    );
    return hasUnmatchedAnswerKey ? submittedAnswer : null;
  }, [item, renderFields]);
  answerRef.current = answer;
  itemRef.current = item;
  assignmentIdRef.current = assignmentId;
  editableRef.current = canEdit;
  dirtyRef.current = dirty;

  /** 拉取题目 */
  useEffect(() => {
    if (!assignmentId) return;
    let cancelled = false;
    setLoading(true);
    setErrors({});

    (async () => {
      try {
        const data = await labelerApi.getAssignmentItem(assignmentId);
        if (cancelled) return;
        applyItem(data);
        setUsingFallback(false);
      } catch (error) {
        if (error instanceof ApiError) {
          if (!cancelled) {
            message.error(getApiErrorMessage(error, '加载题目失败'));
            setItem(null);
            setUsingFallback(false);
          }
          return;
        }
        try {
          const res = await fetch('/sample-datasets/labeler-assignment.json');
          const data = (await res.json()) as AssignmentItem;
          if (cancelled) return;
          applyItem({ ...data, assignmentId });
          setUsingFallback(true);
        } catch {
          if (!cancelled) message.error('加载题目失败');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };

    function applyItem(data: AssignmentItem) {
      const normalized: AssignmentItem = {
        ...data,
        status: data.status ?? (data.latestAnnotation ? 'submitted' : 'claimed'),
      };
      setItem(normalized);
      setEditCurrentSchema(false);
      if (itemRef.current?.taskId && itemRef.current.taskId !== normalized.taskId) {
        setBatchInvalidItems([]);
      }
      // 可编辑时优先恢复草稿;已锁定时优先展示正式提交答案。
      const initial = normalized.latestAnnotation && normalized.status === 'submitted'
        ? normalized.latestAnnotation.answerJson
        : normalized.editable === false
        ? normalized.latestAnnotation?.answerJson ?? normalized.draft?.answerJson ?? {}
        : normalized.draft?.answerJson ?? normalized.latestAnnotation?.answerJson ?? {};
      setAnswer(initial);
      setDraftSavedAt(normalized.draft?.updatedAt ?? null);
      setDirty(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId]);

  /** 草稿自动保存:答案变化后节流 1.5s */
  useEffect(() => {
    if (!assignmentId) return;
    if (!item) return;
    if (!canEdit) return;
    if (!dirty) return;
    if (Object.keys(answer).length === 0) return;
    const timer = window.setTimeout(() => {
      void persistDraft();
    }, DRAFT_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answer, canEdit, dirty]);

  /** 离开页面前主动保存一次 */
  useEffect(() => {
    return () => {
      // 卸载时:同步发一次草稿(浏览器关闭走 sendBeacon 更靠谱,这里走普通请求)
      const aid = assignmentIdRef.current;
      if (!aid) return;
      if (!editableRef.current) return;
      if (!dirtyRef.current) return;
      const payload = answerRef.current;
      if (Object.keys(payload).length === 0) return;
      const currentItem = itemRef.current;
      const draftPayload = currentItem ? filterVisibleAnswer(currentItem.fields, payload) : payload;
      void labelerApi.saveDraft(aid, draftPayload, currentItem?.schemaDigest).catch(() => {
        /* 演示模式下静默失败 */
      });
    };
  }, []);

  const saveCurrentDraft = useCallback(async (force: boolean) => {
    if (!assignmentId) return;
    if (!editableRef.current) return;
    if (!force && !dirtyRef.current) return true;
    if (!force && Object.keys(answer).length === 0) return true;
    const draftAnswer = item ? filterVisibleAnswer(renderFields, answer) : answer;
    setSavingDraft(true);
    try {
      await labelerApi.saveDraft(assignmentId, draftAnswer, activeSchemaDigest);
      setDraftSavedAt(new Date().toLocaleTimeString());
      setDirty(false);
      return true;
    } catch (error) {
      if (error instanceof ApiError) {
        message.error(getApiErrorMessage(error, '保存草稿失败'));
        setItem((prev) => (prev ? { ...prev, editable: false, status: 'voided' } : prev));
        setDirty(false);
        return false;
      }
      // 演示模式:仍然标记本地保存时间
      setDraftSavedAt(`${new Date().toLocaleTimeString()} (本地)`);
      setDirty(false);
      return true;
    } finally {
      setSavingDraft(false);
    }
  }, [activeSchemaDigest, answer, assignmentId, item, message, renderFields]);

  const persistDraft = useCallback(async () => {
    return saveCurrentDraft(false);
  }, [saveCurrentDraft]);

  function updateField(fieldName: string, value: unknown) {
    if (!canEdit) return;
    setAnswer((prev) => ({ ...prev, [fieldName]: value }));
    setDirty(true);
    // 编辑后清掉该字段的旧报错
    setErrors((prev) => {
      if (!prev[fieldName]) return prev;
      const next = { ...prev };
      delete next[fieldName];
      return next;
    });
  }

  /** 校验:必填 + maxLength + JSON 解析 */
  function handleEditCurrentSchema() {
    if (!item || !canEdit) return;
    setEditCurrentSchema(true);
    setAnswer(item.draft?.answerJson ?? item.latestAnnotation?.answerJson ?? {});
    setDirty(false);
    setErrors({});
  }

  function validate(): boolean {
    const next = collectValidationErrors();
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function collectValidationErrors(): Record<string, string> {
    if (!item) return {};
    const next: Record<string, string> = {};
    const runtimeRules = resolveRuntimeRules(renderFields, answer);
    renderFields.forEach((field) => {
      const semanticType = resolveSemanticType(field);
      if (semanticType === 'display' || semanticType === 'layout') return;
      if (runtimeRules.visible[field.fieldName] === false) return;
      const value = answer[field.fieldName];
      if (runtimeRules.required[field.fieldName]) {
        const empty =
          value === undefined ||
          value === null ||
          value === '' ||
          (Array.isArray(value) && value.length === 0);
        if (empty) {
          next[field.fieldName] = `${field.label} 必填`;
          return;
        }
      }
      if (
        field.maxLength &&
        typeof value === 'string' &&
        value.length > field.maxLength
      ) {
        next[field.fieldName] = `不能超过 ${field.maxLength} 字符`;
      }
      if (semanticType === 'json' && typeof value === 'string' && value.trim()) {
        try {
          JSON.parse(value);
        } catch {
          next[field.fieldName] = 'JSON 格式不合法';
        }
      }
    });
    return next;
  }

  async function handleSubmit() {
    if (!item) return;
    if (!canEdit) {
      message.info('当前题目已超过截止时间或已完成审核,只能查看答案。');
      return;
    }
    const currentErrors = collectValidationErrors();
    setErrors(currentErrors);
    markCurrentValidation(Object.keys(currentErrors).length === 0, currentErrors);
    const saved = await saveCurrentDraft(true);
    if (!saved) {
      return;
    }
    setSubmitting(true);
    try {
      const response = await labelerApi.submitTaskAssignments(item.taskId);
      setBatchInvalidItems([]);
      message.success(`已提交 ${response.submittedCount} 题,等待 AI 预审与人工审核`);
      navigate('/labeler/my-tasks');
    } catch (error) {
      const invalidItems = getBatchInvalidItems(error);
      if (invalidItems.length > 0) {
        setBatchInvalidItems(invalidItems);
        const firstInvalid = invalidItems[0];
        message.error(firstInvalid.reason || getSubmitErrorMessage(error));
        if (firstInvalid.assignmentId && firstInvalid.assignmentId !== item.assignmentId) {
          navigate(`/labeler/answer/${firstInvalid.assignmentId}`);
        }
      } else {
        message.error(getSubmitErrorMessage(error));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSkip() {
    if (item?.position.nextAssignmentId) {
      if (canEdit) {
        const currentErrors = collectValidationErrors();
        const valid = Object.keys(currentErrors).length === 0;
        setErrors(currentErrors);
        markCurrentValidation(valid, currentErrors);
        const saved = await saveCurrentDraft(true);
        if (!saved) return;
        if (!valid) {
          message.warning('当前题还有未完成项，已保存草稿，可稍后回来修正。');
        }
      }
      navigate(`/labeler/answer/${item.position.nextAssignmentId}`);
    } else {
      message.info('已经是最后一题');
    }
  }

  async function handlePrev() {
    if (item?.position.prevAssignmentId) {
      if (canEdit) {
        const saved = await saveCurrentDraft(true);
        if (!saved) return;
      }
      navigate(`/labeler/answer/${item.position.prevAssignmentId}`);
    } else {
      message.info('已经是第一题');
    }
  }

  /** 进度条点击任意题:与上/下一题一致先保存草稿,再跳转到目标 assignment */
  async function handleJump(targetAssignmentId: string) {
    if (!item) return;
    if (targetAssignmentId === item.assignmentId) return;
    if (canEdit) {
      const saved = await saveCurrentDraft(true);
      if (!saved) return;
    }
    navigate(`/labeler/answer/${targetAssignmentId}`);
  }

  function markCurrentValidation(valid: boolean, fieldErrors: Record<string, string>) {
    if (!item) return;
    setBatchInvalidItems((prev) => {
      const next = prev.filter((invalidItem) => invalidItem.index !== item.position.index);
      if (valid) {
        return next;
      }
      return [
        ...next,
        {
          assignmentId: item.assignmentId,
          itemId: item.itemId,
          index: item.position.index,
          reason: '当前题还有未完成项',
          fieldErrors,
        },
      ];
    });
  }

  function handleClose() {
    if (!canEdit) {
      navigate('/labeler/my-tasks');
      return;
    }
    Modal.confirm({
      title: '退出答题?',
      content: '当前草稿已自动保存,可在「草稿箱」继续作答。',
      okText: '退出',
      onOk: () => {
        void persistDraft();
        navigate('/labeler/my-tasks');
      },
    });
  }

  /** 拖拽中间分隔条调节左右卡片宽度,限制在 25%~70% 之间 */
  function handleSplitDrag(startEvent: React.MouseEvent) {
    startEvent.preventDefault();
    const container = splitRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();

    const onMove = (event: MouseEvent) => {
      const ratio = ((event.clientX - rect.left) / rect.width) * 100;
      setLeftPercent(Math.min(70, Math.max(25, ratio)));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // 拖拽结束后持久化当前宽度,下次进入答题页沿用
      setLeftPercent((current) => {
        saveSplitPercent(current);
        return current;
      });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  if (loading) {
    return (
      <Card>
        <div className="market-loading">加载题目...</div>
      </Card>
    );
  }

  if (!item) {
    return (
      <Card>
        <Empty description="题目不存在或已被回收" />
      </Card>
    );
  }

  const progressPct =
    item.position.total === 0
      ? 0
      : Math.round((item.position.index / item.position.total) * 100);
  const statusLabel = assignmentStatusText(item.status);
  const isLastQuestion = !item.position.nextAssignmentId;
  const primaryActionText = showSubmittedSnapshot ? '重新修改' : '提交';
  const handlePrimaryAction = showSubmittedSnapshot
    ? handleEditCurrentSchema
    : () => void handleSubmit();
  const showPrimaryAction = showSubmittedSnapshot || isLastQuestion;

  return (
    <Space direction="vertical" size="large" className="page-stack answer-page">
      {/* 顶部:面包屑 + 进度 + 操作 */}
      <div className="answer-topbar">
        <Space size={12} wrap>
          <Button icon={<CloseOutlined />} onClick={handleClose}>
            退出
          </Button>
          <Breadcrumb
            items={[
              { title: '我的任务' },
              { title: <span>{item.taskTitle}</span> },
              {
                title: (
                  <span>
                    第 {item.position.index} / {item.position.total} 题
                  </span>
                ),
              },
            ]}
          />
          {usingFallback && <Tag color="gold">演示模式</Tag>}
          <Tag color={canEdit ? 'processing' : 'blue'}>{statusLabel}</Tag>
        </Space>

        {/* 中间留白处:分段圆点进度条,点击任意题跳转 */}
        <SegmentedProgress
          index={item.position.index}
          total={item.position.total}
          percent={progressPct}
          invalidIndexes={invalidIndexes}
          assignmentIds={item.position.assignmentIds}
          statuses={item.position.statuses}
          onJump={handleJump}
        />

        <Space size={12} wrap>
          <span className="answer-draft-tip">
            {!canEdit ? (
              <>
                <CheckCircleFilled style={{ color: 'var(--lh-primary)' }} /> 已锁定,当前为查看模式
              </>
            ) : savingDraft ? (
              <>
                <CloudSyncOutlined spin /> 草稿保存中...
              </>
            ) : draftSavedAt ? (
              <>
                <CheckCircleFilled style={{ color: '#22c55e' }} /> 已保存于 {draftSavedAt}
              </>
            ) : item.status === 'submitted' ? (
              <>
                <SaveOutlined /> 截止前可修改,编辑后将自动保存
              </>
            ) : (
              <>
                <SaveOutlined /> 编辑后将自动保存
              </>
            )}
          </span>
          <Button onClick={handlePrev} disabled={!item.position.prevAssignmentId}>
            <ArrowLeftOutlined /> 上一题
          </Button>
          <Button
            onClick={() => void handleSkip()}
            disabled={!item.position.nextAssignmentId}
          >
            下一题 <ArrowRightOutlined />
          </Button>
          {showPrimaryAction && (
            <Button
              type="primary"
              loading={submitting}
              disabled={!canEdit}
              onClick={handlePrimaryAction}
            >
              {canEdit ? primaryActionText : '已锁定'}
            </Button>
          )}
        </Space>
      </div>

      {currentInvalidItem && (
        <Alert
          type="error"
          showIcon
          message={`第 ${currentInvalidItem.index} 题尚未完成`}
          description={currentInvalidItem.reason || '请修正红色提示字段后再最终提交。'}
        />
      )}

      {/* 打回原因 */}
      {item.returnReason && (
        <Alert
          type="warning"
          showIcon
          icon={<ExclamationCircleFilled />}
          message="该条目曾被打回,以下是上一轮审核意见"
          description={item.returnReason}
        />
      )}

      <div className="answer-split" ref={splitRef}>
        {/* 左:原题数据 */}
        <div className="answer-split-pane" style={{ width: `${leftPercent}%` }}>
          <Card
            title={<RawPayloadTitle payload={item.rawPayload} />}
            className="answer-section"
          >
            <RawPayloadView payload={item.rawPayload} />
          </Card>
        </div>

        {/* 中间可拖拽分隔条 */}
        <div
          className="answer-split-handle"
          role="separator"
          aria-orientation="vertical"
          onMouseDown={handleSplitDrag}
        >
          <span className="answer-split-handle-bar" />
        </div>

        {/* 右:Schema 渲染表单 */}
        <div className="answer-split-pane" style={{ width: `${100 - leftPercent}%` }}>
          <Card
            title={
              <Space>
                <span>请填写</span>
                <Tag>Schema {item.schemaVersionId}</Tag>
              </Space>
            }
            className="answer-section"
          >
            <Space direction="vertical" size={20} style={{ width: '100%' }}>
              <LabelHubFormRenderer
                schema={renderFields}
                rawPayload={item.rawPayload}
                value={answer}
                readonly={renderReadonly}
                onChange={(next) => {
                  const nextAnswer = filterVisibleAnswer(renderFields, next);
                  setAnswer(nextAnswer);
                  setDirty(true);
                  setErrors({});
                }}
              />
              {rawAnswerFallback ? (
                <Alert
                  type="warning"
                  showIcon
                  message="当前模板字段与已提交答案不完全匹配"
                  description={
                    <pre className="answer-json">
                      {JSON.stringify(rawAnswerFallback, null, 2)}
                    </pre>
                  }
                />
              ) : null}
            </Space>
          </Card>
        </div>
      </div>
    </Space>
  );
}

/* ============ 分段圆点进度条 ============ */
/**
 * 进度条圆点数量固定上限,避免题量过大时圆点过密:
 *   - 题数 <= 上限:一题一点,点击跳到该题,悬停气泡显示「第 N 题」;
 *   - 题数 > 上限:每个点代表一段连续题目,点击跳到该段首题。
 * 逐题着色:已提交或有草稿且必填齐全为绿,必填缺失为黄,未作答为灰;
 * 当前题所在点高亮,批量提交失败的题标红(优先级最高)。
 */
function SegmentedProgress({
  index,
  total,
  percent,
  invalidIndexes,
  assignmentIds,
  statuses,
  onJump,
}: {
  index: number;
  total: number;
  percent: number;
  invalidIndexes: Set<number>;
  assignmentIds?: string[];
  statuses?: Array<'completed' | 'incomplete' | 'empty'>;
  onJump?: (assignmentId: string) => void;
}) {
  const [hovered, setHovered] = useState<number | null>(null);

  const clickable = !!assignmentIds && assignmentIds.length > 0 && !!onJump;
  const dots = buildProgressDots(total, assignmentIds);

  // 距悬停点的距离 -> 缩放与上浮量,实现波浪效果(幅度较克制,避免拥挤)。
  function waveStyle(i: number): React.CSSProperties {
    if (hovered === null) return {};
    const distance = Math.abs(i - hovered);
    const scale = distance === 0 ? 1.55 : distance === 1 ? 1.25 : distance === 2 ? 1.1 : 1;
    const lift = distance === 0 ? 4 : distance === 1 ? 2 : 0;
    return { transform: `translateY(${-lift}px) scale(${scale})` };
  }

  return (
    <div
      className="answer-progress"
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={clickable ? 'answer-progress-dots is-clickable' : 'answer-progress-dots'}
        onMouseLeave={() => setHovered(null)}
      >
        {dots.map((dot, i) => {
          const isCurrent = index >= dot.startQ && index <= dot.endQ;
          const isInvalid = rangeHasInvalid(dot.startQ, dot.endQ, invalidIndexes);
          // 段内聚合状态:全完成绿,含必填缺失黄,否则灰。
          const segStatus = resolveSegmentStatus(dot.startQ, dot.endQ, statuses);
          // 区间用于无障碍/title 文案;气泡只展示单个数字(段首题号)。
          const rangeLabel = dot.startQ === dot.endQ ? `${dot.startQ}` : `${dot.startQ}-${dot.endQ}`;
          const numLabel = `${dot.startQ}`;
          const className = [
            'answer-progress-dot',
            `is-${segStatus}`,
            isCurrent ? 'is-current' : '',
            isInvalid ? 'is-invalid' : '',
          ]
            .filter(Boolean)
            .join(' ');

          const handleClick = () => {
            if (clickable && dot.assignmentId) onJump!(dot.assignmentId);
          };

          return (
            <button
              key={i}
              type="button"
              className={className}
              disabled={!clickable}
              aria-label={`第 ${rangeLabel} 题`}
              title={clickable ? `跳转到第 ${rangeLabel} 题` : `第 ${rangeLabel} 题`}
              onMouseEnter={() => setHovered(i)}
              onFocus={() => setHovered(i)}
              onClick={handleClick}
            >
              <span className="answer-progress-dot-core" style={waveStyle(i)} />
              <span className="answer-progress-dot-num">{numLabel}</span>
            </button>
          );
        })}
      </div>
      <span className="answer-progress-pct">{percent}%</span>
    </div>
  );
}

interface ProgressDot {
  /** 该点覆盖的题号区间(1-based, 闭区间) */
  startQ: number;
  endQ: number;
  /** 段首题的 assignmentId(有列表时可点击跳转) */
  assignmentId?: string;
}

/**
 * 把 total 道题映射到至多 MAX_DOTS 个圆点。
 * 题数不超过上限时一题一点;否则按段均分,每段覆盖若干连续题。
 */
function buildProgressDots(total: number, assignmentIds?: string[]): ProgressDot[] {
  const MAX_DOTS = 21;
  if (total <= 0) return [];
  const dotCount = Math.min(total, MAX_DOTS);
  return Array.from({ length: dotCount }, (_, i) => {
    const startQ = Math.floor((i * total) / dotCount) + 1;
    const endQ = Math.floor(((i + 1) * total) / dotCount);
    return {
      startQ,
      endQ,
      assignmentId: assignmentIds?.[startQ - 1],
    };
  });
}

/**
 * 聚合区间 [startQ, endQ] 的着色状态:
 *   全部 completed -> completed(绿);
 *   含 incomplete(必填缺失) -> incomplete(黄);
 *   其余(全 empty 或无状态数据) -> empty(灰)。
 */
function resolveSegmentStatus(
  startQ: number,
  endQ: number,
  statuses?: Array<'completed' | 'incomplete' | 'empty'>,
): 'completed' | 'incomplete' | 'empty' {
  if (!statuses || statuses.length === 0) return 'empty';
  let allCompleted = true;
  let hasIncomplete = false;
  for (let q = startQ; q <= endQ; q += 1) {
    const s = statuses[q - 1];
    if (s !== 'completed') allCompleted = false;
    if (s === 'incomplete') hasIncomplete = true;
  }
  if (allCompleted) return 'completed';
  if (hasIncomplete) return 'incomplete';
  return 'empty';
}

/** 判断题号区间 [startQ, endQ] 内是否存在无效题 */
function rangeHasInvalid(startQ: number, endQ: number, invalidIndexes: Set<number>): boolean {
  for (let q = startQ; q <= endQ; q += 1) {
    if (invalidIndexes.has(q)) return true;
  }
  return false;
}

function getBatchInvalidItems(error: unknown): BatchSubmitInvalidItem[] {
  if (!(error instanceof ApiError)) return [];
  if (!error.payload || typeof error.payload !== 'object') return [];
  const invalidItems = (error.payload as { invalidItems?: unknown }).invalidItems;
  return Array.isArray(invalidItems)
    ? invalidItems.filter(isBatchSubmitInvalidItem)
    : [];
}

function isBatchSubmitInvalidItem(value: unknown): value is BatchSubmitInvalidItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<BatchSubmitInvalidItem>;
  return typeof item.assignmentId === 'string'
    && typeof item.itemId === 'string'
    && typeof item.index === 'number'
    && typeof item.reason === 'string';
}

function getSubmitErrorMessage(error: unknown) {
  if (typeof error === 'object' && error !== null && 'payload' in error) {
    const payload = (error as { payload?: unknown }).payload;
    if (typeof payload === 'object' && payload !== null && 'message' in payload) {
      const message = (payload as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) {
        return message;
      }
    }
    if (typeof payload === 'string' && payload.trim()) {
      return payload;
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return '提交失败,请稍后重试。';
}

function isEditableStatus(status?: string) {
  return status === 'claimed' || status === 'returned' || status === 'submitted';
}

function assignmentStatusText(status?: string) {
  switch (status) {
    case 'claimed':
      return '进行中';
    case 'returned':
      return '已打回';
    case 'submitted':
      return '已提交';
    case 'accepted':
      return '已通过';
    case 'voided':
      return '已作废';
    default:
      return status || '未知状态';
  }
}

/* ============ 原题渲染 ============ */

/** 左卡片标题:题目 ID + 分类/难度/标签胶囊 */
function RawPayloadTitle({ payload }: { payload: AssignmentItem['rawPayload'] }) {
  const id = payload.id ?? payload.item_id ?? payload.qid;
  const category = payload.category;
  const difficulty = payload.difficulty;
  const tags = normalizeStringList(payload.tags);

  return (
    <div className="answer-raw-title">
      <span className="answer-raw-title-id">{id != null ? String(id) : '题目数据'}</span>
      <div className="answer-raw-title-caps">
        {category != null && String(category).trim() && (
          <Tag className="answer-cap answer-cap-category">{String(category)}</Tag>
        )}
        {difficulty != null && String(difficulty).trim() && (
          <Tag className={`answer-cap ${difficultyClass(String(difficulty))}`}>
            {String(difficulty)}
          </Tag>
        )}
        {tags.map((tag) => (
          <Tag key={tag} className="answer-cap answer-cap-tag">
            {tag}
          </Tag>
        ))}
      </div>
    </div>
  );
}

/** 难度 -> 颜色类名,兼容中英文常见写法 */
function difficultyClass(difficulty: string): string {
  const d = difficulty.trim().toLowerCase();
  if (['简单', 'easy', 'low', '低', '初级'].includes(d)) return 'answer-cap-easy';
  if (['困难', '难', 'hard', 'high', '高', '高级'].includes(d)) return 'answer-cap-hard';
  if (['中等', '中', 'medium', 'mid', 'normal', '中级'].includes(d)) return 'answer-cap-medium';
  return 'answer-cap-medium';
}

/** 把任意值规整成字符串数组(用于 tags / expected_dimensions) */
function normalizeStringList(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.filter((v) => v != null).map((v) => String(v));
  }
  if (typeof value === 'string') {
    return value.trim() ? [value] : [];
  }
  return [String(value)];
}

function RawPayloadView({ payload }: { payload: AssignmentItem['rawPayload'] }) {
  const {
    media_type,
    media_url,
    content_markdown,
    // 标题区已展示,正文不再重复
    id: _id,
    item_id: _itemId,
    qid: _qid,
    category: _category,
    difficulty: _difficulty,
    tags: _tags,
    // 按需求去掉 lang / source
    lang: _lang,
    source: _source,
    // 单独排版的字段
    prompt,
    question,
    model_answer,
    reference,
    expected_dimensions,
    ...rest
  } = payload as Record<string, unknown> & AssignmentItem['rawPayload'];

  const promptValue = prompt ?? question;
  const dimensions = normalizeStringList(expected_dimensions);
  const hasAnything =
    media_url ||
    content_markdown ||
    promptValue != null ||
    model_answer != null ||
    reference != null ||
    dimensions.length > 0 ||
    Object.keys(rest).length > 0;

  return (
    <Space direction="vertical" size={14} style={{ width: '100%' }}>
      {media_type === 'image' && media_url && (
        <img src={media_url} alt="原题" className="answer-media" />
      )}
      {media_type === 'video' && media_url && (
        <video controls preload="metadata" className="answer-media-video" src={media_url}>
          您的浏览器不支持 video 标签。
        </video>
      )}
      {media_type === 'markdown' && content_markdown && (
        <pre className="answer-markdown">{content_markdown}</pre>
      )}

      {/* 题目正文:独占一行 */}
      {promptValue != null && (
        <div className="answer-raw-field">
          <div className="answer-raw-key">题目</div>
          <div className="answer-raw-value">{formatValue(promptValue)}</div>
        </div>
      )}

      {/* model_answer 与 reference:同一行两列 */}
      {(model_answer != null || reference != null) && (
        <div className="answer-raw-cols">
          {model_answer != null && (
            <div className="answer-raw-field">
              <div className="answer-raw-key">MODEL_ANSWER</div>
              <div className="answer-raw-value">{formatValue(model_answer)}</div>
            </div>
          )}
          {reference != null && (
            <div className="answer-raw-field">
              <div className="answer-raw-key">REFERENCE</div>
              <div className="answer-raw-value">{formatValue(reference)}</div>
            </div>
          )}
        </div>
      )}

      {/* expected_dimensions:独占一行,胶囊展示 */}
      {dimensions.length > 0 && (
        <div className="answer-raw-field">
          <div className="answer-raw-key">EXPECTED_DIMENSIONS</div>
          <div className="answer-raw-value">
            <Space wrap size={[6, 6]} className="answer-raw-tags">
              {dimensions.map((d, index) => (
                <Tag key={`${d}-${index}`} className="answer-raw-tag">
                  {d}
                </Tag>
              ))}
            </Space>
          </div>
        </div>
      )}

      {/* 其余未单独排版的字段 */}
      {Object.entries(rest).map(([key, value]) => (
        <div key={key} className="answer-raw-field">
          <div className="answer-raw-key">{key}</div>
          <div className="answer-raw-value">{formatValue(value)}</div>
        </div>
      ))}

      {!hasAnything && (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="该题暂无展示数据"
        />
      )}
    </Space>
  );
}

function formatValue(value: unknown, semanticType?: string): React.ReactNode {
  if (value == null) return <Typography.Text type="secondary">—</Typography.Text>;
  if (semanticType === 'tags' || semanticType === 'multi_choice') {
    const list = Array.isArray(value) ? value : [value];
    if (list.length === 0) return <Typography.Text type="secondary">—</Typography.Text>;
    return (
      <Space wrap size={[6, 6]} className="answer-raw-tags">
        {list.map((item, index) => (
          <Tag key={`${String(item)}-${index}`} className="answer-raw-tag">
            {String(item)}
          </Tag>
        ))}
      </Space>
    );
  }
  if (semanticType === 'json') {
    if (typeof value === 'string') {
      try {
        return <pre className="answer-json">{JSON.stringify(JSON.parse(value), null, 2)}</pre>;
      } catch {
        return <pre className="answer-json">{value}</pre>;
      }
    }
    return <pre className="answer-json">{JSON.stringify(value, null, 2)}</pre>;
  }
  if (typeof value === 'string') return value;
  // 数组:基本类型(string/number/boolean)渲染成 Tag 标签组,比 JSON 文本更易读;
  // 含对象/嵌套数组的复杂数组仍回退到 JSON 展示。
  if (Array.isArray(value)) {
    if (value.length === 0) return <Typography.Text type="secondary">—</Typography.Text>;
    const allPrimitive = value.every(
      (item) =>
        item != null &&
        (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'),
    );
    if (allPrimitive) {
      return (
        <Space wrap size={[6, 6]} className="answer-raw-tags">
          {value.map((item, index) => (
            <Tag key={`${String(item)}-${index}`} className="answer-raw-tag">
              {String(item)}
            </Tag>
          ))}
        </Space>
      );
    }
  }
  return <pre className="answer-json">{JSON.stringify(value, null, 2)}</pre>;
}

/* ============ Schema 字段渲染器 ============ */
function FieldRenderer({
  field,
  value,
  error,
  readOnly,
  onChange,
}: {
  field: AssignmentItem['fields'][number];
  value: unknown;
  error?: string;
  readOnly: boolean;
  onChange: (value: unknown) => void;
}) {
  if (field.kind === 'show-item') {
    return (
      <div className="answer-field answer-field-show">
        <div className="answer-field-label">
          <PictureOutlined /> {field.label}
          <Tag className="answer-show-tag">仅展示</Tag>
        </div>
        <div className="answer-show-text">{field.showText ?? '(展示项内容)'}</div>
      </div>
    );
  }

  return (
    <div className="answer-field">
      <div className="answer-field-label">
        {field.label}
        {field.required && <span className="field-required">*</span>}
        {field.maxLength && (
          <span className="answer-field-len">
            {(typeof value === 'string' ? value.length : 0)} / {field.maxLength}
          </span>
        )}
      </div>

      {(() => {
        switch (field.kind) {
          case 'text-single':
            return (
              <Input
                placeholder={field.placeholder}
                value={(value as string) ?? ''}
                onChange={(event) => onChange(event.target.value)}
                maxLength={field.maxLength}
                status={error ? 'error' : undefined}
                disabled={readOnly}
              />
            );
          case 'text-multi':
            return (
              <Input.TextArea
                rows={3}
                placeholder={field.placeholder}
                value={(value as string) ?? ''}
                onChange={(event) => onChange(event.target.value)}
                maxLength={field.maxLength}
                status={error ? 'error' : undefined}
                disabled={readOnly}
              />
            );
          case 'rich-text':
            return (
              <Input.TextArea
                rows={5}
                placeholder={field.placeholder ?? '请输入富文本(MVP 暂用纯文本)'}
                value={(value as string) ?? ''}
                onChange={(event) => onChange(event.target.value)}
                status={error ? 'error' : undefined}
                disabled={readOnly}
              />
            );
          case 'single-choice':
            return (
              <Radio.Group
                value={value as string}
                onChange={(event) => onChange(event.target.value)}
                className="answer-radio-group"
                disabled={readOnly}
              >
                <Space wrap>
                  {(field.options ?? []).map((opt) => (
                    <Radio.Button key={opt.value} value={opt.value}>
                      {opt.label}
                    </Radio.Button>
                  ))}
                </Space>
              </Radio.Group>
            );
          case 'multi-choice':
            return (
              <Checkbox.Group
                value={(value as string[]) ?? []}
                onChange={(values) => onChange(values)}
                disabled={readOnly}
              >
                <Space wrap size={[8, 8]}>
                  {(field.options ?? []).map((opt) => (
                    <Checkbox key={opt.value} value={opt.value}>
                      {opt.label}
                    </Checkbox>
                  ))}
                </Space>
              </Checkbox.Group>
            );
          case 'tags':
            return (
              <Space wrap size={[8, 8]} className="answer-tag-group">
                {(field.options ?? []).map((opt) => {
                  const list = (value as string[]) ?? [];
                  const active = list.includes(opt.value);
                  return (
                    <Tag.CheckableTag
                      key={opt.value}
                      checked={active}
                      className={readOnly ? 'answer-tag-readonly' : undefined}
                      onChange={(checked) => {
                        if (readOnly) return;
                        const next = checked
                          ? Array.from(new Set([...list, opt.value]))
                          : list.filter((v) => v !== opt.value);
                        onChange(next);
                      }}
                    >
                      {opt.label}
                    </Tag.CheckableTag>
                  );
                })}
              </Space>
            );
          case 'json-editor':
            return (
              <Input.TextArea
                rows={6}
                placeholder='{ "key": "value" }'
                value={(value as string) ?? ''}
                onChange={(event) => onChange(event.target.value)}
                style={{ fontFamily: 'monospace' }}
                status={error ? 'error' : undefined}
                disabled={readOnly}
              />
            );
          default:
            return null;
        }
      })()}

      {error && <div className="answer-field-error">{error}</div>}
    </div>
  );
}
