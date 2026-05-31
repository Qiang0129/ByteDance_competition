import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
} from '@ant-design/icons';
import {
  Alert,
  App as AntdApp,
  Button,
  Checkbox,
  Drawer,
  Empty,
  Input,
  Modal,
  Spin,
  Tag,
} from 'antd';
import { useNavigate, useParams } from 'react-router-dom';

import { getApiErrorMessage } from '../../api/client';
import { reviewerApi } from '../../api/reviewer';
import { AiAssistantIcon } from '../../components/icons';
import { filterVisibleAnswer, LabelHubFormRenderer } from '../../modules/schema';
import type {
  AiReviewResult,
  AnnotationToReview,
} from '../../types/reviewer';

/**
 * AI 预审三栏审核工作台。
 *   - 左:按 AI 建议分组的标注列表(建议通过 / 建议打回 / 人工复核),支持批量操作;
 *   - 中:选中条目的详情(答案、AI 预审评分与评语、审核意见、风险标记、裁决按钮);
 *   - 右:今日审核统计 + 当前条目的审核时间线。
 * 数据来源:GET /reviewer/ai-review/tasks/{taskId}/annotations;
 * 裁决:POST /reviewer/annotations/{annotationId}/decision。
 */

type AiTab = 'PASS' | 'REJECT' | 'NEED_HUMAN_REVIEW';

const decisionMeta: Record<AiReviewResult['decision'], { color: string; label: string }> = {
  PASS: { color: 'success', label: '建议通过' },
  REJECT: { color: 'error', label: '建议打回' },
  NEED_HUMAN_REVIEW: { color: 'warning', label: '人工复核' },
};

export default function ReviewerAiWorkbench() {
  const { taskId = '' } = useParams<{ taskId: string }>();
  const { message } = AntdApp.useApp();
  const navigate = useNavigate();

  const [items, setItems] = useState<AnnotationToReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [taskTitle, setTaskTitle] = useState('AI 预审');
  const [tab, setTab] = useState<AiTab>('PASS');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [opinion, setOpinion] = useState('');
  const [todayApproved, setTodayApproved] = useState(0);
  const [todayReturned, setTodayReturned] = useState(0);
  // 左栏多选(批量操作)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [committingId, setCommittingId] = useState<string | null>(null);
  const [bulkCommitting, setBulkCommitting] = useState(false);
  const [reviseTarget, setReviseTarget] = useState<AnnotationToReview | null>(null);
  const [revisionAnswer, setRevisionAnswer] = useState<Record<string, unknown>>({});
  const [revisionSubmitting, setRevisionSubmitting] = useState(false);

  const loadAnnotations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await reviewerApi.listAiReviewAnnotations(taskId, { pageSize: 200 });
      setItems(resp.items ?? []);
    } catch (requestError) {
      const text = getApiErrorMessage(requestError, '加载任务标注失败');
      setError(text);
      message.error(text);
    } finally {
      setLoading(false);
    }
  }, [taskId, message]);

  useEffect(() => {
    void loadAnnotations();
  }, [loadAnnotations]);

  // 设置任务标题(真实接口下取第一条的 taskTitle)
  useEffect(() => {
    if (items.length > 0 && items[0].taskTitle) setTaskTitle(items[0].taskTitle);
  }, [items]);

  const grouped = useMemo(() => {
    const buckets: Record<AiTab, AnnotationToReview[]> = {
      PASS: [],
      REJECT: [],
      NEED_HUMAN_REVIEW: [],
    };
    for (const it of items) {
      const d = it.aiResult?.decision;
      if (d && buckets[d]) buckets[d].push(it);
    }
    return buckets;
  }, [items]);

  const currentList = grouped[tab];

  // 切换 tab 时自动选中该分组第一条
  useEffect(() => {
    if (currentList.length > 0) {
      if (!currentList.some((it) => it.annotationId === activeId)) {
        setActiveId(currentList[0].annotationId);
        setOpinion('');
      }
    } else {
      setActiveId(null);
    }
    setSelectedIds(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, items]);

  const active = useMemo(
    () => items.find((it) => it.annotationId === activeId) ?? null,
    [items, activeId],
  );

  function removeReviewedItem(annotationId: string) {
    setItems((prev) => prev.filter((it) => it.annotationId !== annotationId));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(annotationId);
      return next;
    });
  }

  async function commit(annotationId: string, decision: 'APPROVE' | 'RETURN') {
    const reason = opinion.trim();
    if (decision === 'RETURN' && !reason) {
      message.warning('打回时必须填写具体原因');
      return;
    }
    setCommittingId(annotationId);
    try {
      await reviewerApi.submitReview(annotationId, {
        decision,
        reason: reason || undefined,
      });
      removeReviewedItem(annotationId);
      setOpinion('');
      if (decision === 'APPROVE') setTodayApproved((n) => n + 1);
      if (decision === 'RETURN') setTodayReturned((n) => n + 1);
      message.success(decision === 'APPROVE' ? '已通过并入库' : '已打回');
    } catch (requestError) {
      message.error(getApiErrorMessage(requestError, '提交审核结论失败'));
    } finally {
      setCommittingId(null);
    }
  }

  function openRevise(item: AnnotationToReview) {
    if (!item.schemaFields?.length) {
      message.warning('缺少 Schema 快照,无法就地修订');
      return;
    }
    setReviseTarget(item);
    setRevisionAnswer(item.answerJson ?? {});
  }

  async function submitRevision() {
    if (!reviseTarget) return;
    const schema = reviseTarget.schemaFields ?? [];
    if (schema.length === 0) {
      message.warning('缺少 Schema 快照,无法就地修订');
      return;
    }
    setRevisionSubmitting(true);
    try {
      const answerJson = filterVisibleAnswer(schema, revisionAnswer);
      await reviewerApi.submitReview(reviseTarget.annotationId, {
        decision: 'REVISE',
        reason: opinion.trim() || undefined,
        answerJson,
      });
      removeReviewedItem(reviseTarget.annotationId);
      setReviseTarget(null);
      setRevisionAnswer({});
      setOpinion('');
      setTodayApproved((n) => n + 1);
      message.success('已修订并入库');
    } catch (requestError) {
      message.error(getApiErrorMessage(requestError, '直接修订失败'));
    } finally {
      setRevisionSubmitting(false);
    }
  }

  function toggleSelect(annotationId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(annotationId)) next.delete(annotationId);
      else next.add(annotationId);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      const allIds = currentList.map((it) => it.annotationId);
      const allSelected = allIds.length > 0 && allIds.every((id) => prev.has(id));
      return allSelected ? new Set() : new Set(allIds);
    });
  }

  /** 批量裁决:对当前选中项依次提交 */
  async function batchCommit(decision: 'APPROVE' | 'RETURN') {
    const ids = currentList
      .map((it) => it.annotationId)
      .filter((id) => selectedIds.has(id));
    if (ids.length === 0) return;
    if (decision === 'RETURN') {
      promptBatchReturn(ids);
      return;
    }
    await runBatchCommit(ids, decision);
  }

  function promptBatchReturn(ids: string[]) {
    let reason = '';
    Modal.confirm({
      title: `批量打回 ${ids.length} 条`,
      content: (
        <Input.TextArea
          rows={4}
          placeholder="请输入统一打回原因,将写入每条人工复审记录"
          onChange={(event) => {
            reason = event.target.value;
          }}
        />
      ),
      okText: '确认打回',
      okButtonProps: { danger: true },
      onOk: async () => {
        const trimmed = reason.trim();
        if (!trimmed) {
          message.warning('批量打回必须填写统一原因');
          return Promise.reject();
        }
        await runBatchCommit(ids, 'RETURN', trimmed);
      },
    });
  }

  async function runBatchCommit(ids: string[], decision: 'APPROVE' | 'RETURN', reason?: string) {
    setBulkCommitting(true);
    try {
      const results = await Promise.allSettled(
        ids.map((id) =>
          reviewerApi.submitReview(id, {
            decision,
            reason,
          }),
        ),
      );
      const succeededIds = ids.filter((_, index) => results[index].status === 'fulfilled');
      const failed = ids.length - succeededIds.length;
      if (succeededIds.length > 0) {
        const idSet = new Set(succeededIds);
        setItems((prev) => prev.filter((it) => !idSet.has(it.annotationId)));
        setSelectedIds((prev) => {
          const next = new Set(prev);
          succeededIds.forEach((id) => next.delete(id));
          return next;
        });
        if (decision === 'APPROVE') setTodayApproved((n) => n + succeededIds.length);
        if (decision === 'RETURN') setTodayReturned((n) => n + succeededIds.length);
      }
      if (failed > 0) {
        message.warning(
          `已${decision === 'APPROVE' ? '通过' : '打回'} ${succeededIds.length} 条,失败 ${failed} 条`,
        );
      } else {
        message.success(`已批量${decision === 'APPROVE' ? '通过' : '打回'} ${succeededIds.length} 条`);
      }
    } finally {
      setBulkCommitting(false);
    }
  }

  const selectedCount = currentList.filter((it) => selectedIds.has(it.annotationId)).length;
  const allSelected = currentList.length > 0 && selectedCount === currentList.length;

  const tabItems: { key: AiTab; label: string; count: number; tone: string }[] = [
    { key: 'PASS', label: '建议通过', count: grouped.PASS.length, tone: 'pass' },
    { key: 'NEED_HUMAN_REVIEW', label: '人工复核', count: grouped.NEED_HUMAN_REVIEW.length, tone: 'human' },
    { key: 'REJECT', label: '建议打回', count: grouped.REJECT.length, tone: 'reject' },
  ];

  return (
    <div className="ai-wb">
      <div className="ai-wb-topbar">
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/reviewer/ai')}>
          返回任务列表
        </Button>
        <span className="ai-wb-task-title">{taskTitle}</span>
        <Tag icon={<AiAssistantIcon />} color="processing">
          共 {items.length} 条待审
        </Tag>
      </div>

      <Spin spinning={loading}>
        {error && (
          <Alert
            className="ai-wb-error"
            type="error"
            showIcon
            message={error}
            action={<Button size="small" onClick={() => void loadAnnotations()}>重试</Button>}
          />
        )}
        <div className="ai-wb-grid">
          {/* 左栏:列表 */}
          <div className="ai-wb-list-col">
            <div className="ai-wb-list-inner">
              <div className="ai-wb-tabs" role="tablist">
                {tabItems.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.key}
                    className={`ai-wb-tab is-${t.tone}${tab === t.key ? ' is-active' : ''}`}
                    onClick={() => setTab(t.key)}
                  >
                    <span className="ai-wb-tab-label">{t.label}</span>
                    <span className="ai-wb-tab-count">{t.count}</span>
                  </button>
                ))}
              </div>

              {/* 批量操作栏 */}
              <div className="ai-wb-bulkbar">
                <Checkbox
                  checked={allSelected}
                  indeterminate={selectedCount > 0 && !allSelected}
                  onChange={toggleSelectAll}
                  disabled={currentList.length === 0}
                >
                  {selectedCount > 0 ? `已选 ${selectedCount} 条` : '全选'}
                </Checkbox>
                <div className="ai-wb-bulk-actions">
                  <Button
                    size="small"
                    className="ai-wb-bulk-btn is-approve"
                    disabled={selectedCount === 0}
                    loading={bulkCommitting}
                    onClick={() => void batchCommit('APPROVE')}
                  >
                    批量通过
                  </Button>
                  <Button
                    size="small"
                    className="ai-wb-bulk-btn is-return"
                    disabled={selectedCount === 0}
                    loading={bulkCommitting}
                    onClick={() => void batchCommit('RETURN')}
                  >
                    批量打回
                  </Button>
                </div>
              </div>

              <div className="ai-wb-list">
                {currentList.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该分组暂无待审条目" />
                ) : (
                  currentList.map((it) => (
                    <AnnotationListItem
                      key={it.annotationId}
                      item={it}
                      active={it.annotationId === activeId}
                      selected={selectedIds.has(it.annotationId)}
                      onToggleSelect={() => toggleSelect(it.annotationId)}
                      onClick={() => {
                        setActiveId(it.annotationId);
                        setOpinion('');
                      }}
                    />
                  ))
                )}
              </div>
            </div>
          </div>

          {/* 中栏:详情 */}
          <div className="ai-wb-detail-col">
            {active ? (
              <AnnotationDetail
                item={active}
                opinion={opinion}
                onOpinionChange={setOpinion}
                onReturn={() => void commit(active.annotationId, 'RETURN')}
                onRevise={() => openRevise(active)}
                onApprove={() => void commit(active.annotationId, 'APPROVE')}
                committing={committingId === active.annotationId}
              />
            ) : (
              <div className="ai-wb-detail-empty">
                <Empty description="请选择左侧待审条目" />
              </div>
            )}
          </div>

          {/* 右栏:统计 + 时间线 */}
          <div className="ai-wb-side-col">
            <div className="ai-wb-stat-grid">
              <div className="ai-wb-stat-card">
                <span className="ai-wb-stat-num">{todayApproved + todayReturned}</span>
                <span className="ai-wb-stat-label">今日已审</span>
              </div>
              <div className="ai-wb-stat-card">
                <span className="ai-wb-stat-num is-green">{todayApproved}</span>
                <span className="ai-wb-stat-label">今日通过</span>
              </div>
              <div className="ai-wb-stat-card">
                <span className="ai-wb-stat-num">{items.length}</span>
                <span className="ai-wb-stat-label">待我审核</span>
              </div>
              <div className="ai-wb-stat-card">
                <span className="ai-wb-stat-num is-amber">{todayReturned}</span>
                <span className="ai-wb-stat-label">今日打回</span>
              </div>
            </div>

            <div className="ai-wb-timeline-card">
              <div className="ai-wb-timeline-title">
                审核时间线 {active ? `（第 ${displayItemIndex(active)} 题）` : ''}
              </div>
              {active ? (
                <ReviewTimeline item={active} />
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无" />
              )}
            </div>
          </div>
        </div>
      </Spin>
      <Drawer
        title={reviseTarget ? `直接修订 · ${pickTitle(reviseTarget)}` : '直接修订'}
        open={!!reviseTarget}
        width={720}
        onClose={() => {
          if (!revisionSubmitting) {
            setReviseTarget(null);
            setRevisionAnswer({});
          }
        }}
        destroyOnClose
        extra={
          <Button
            type="primary"
            loading={revisionSubmitting}
            onClick={() => void submitRevision()}
          >
            修订并入库
          </Button>
        }
      >
        {reviseTarget && reviseTarget.schemaFields?.length ? (
          <div className="ai-wb-revise-drawer">
            <Alert
              type="info"
              showIcon
              message="修订提交后会生成新的 accepted 版本,不会重新进入 AI 预审。"
            />
            <LabelHubFormRenderer
              schema={reviseTarget.schemaFields}
              rawPayload={reviseTarget.rawPayload}
              value={revisionAnswer}
              readonly={revisionSubmitting}
              onChange={(next) => setRevisionAnswer(filterVisibleAnswer(reviseTarget.schemaFields ?? [], next))}
            />
          </div>
        ) : (
          <Empty description="缺少 Schema 快照,无法就地修订" />
        )}
      </Drawer>
    </div>
  );
}

/* ============ 左栏列表项 ============ */
function AnnotationListItem({
  item,
  active,
  selected,
  onToggleSelect,
  onClick,
}: {
  item: AnnotationToReview;
  active: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onClick: () => void;
}) {
  const ai = item.aiResult;
  const meta = ai ? decisionMeta[ai.decision] : null;
  const primaryTitle = pickTitle(item);
  const roundTagColor = item.revisionNo > 1 ? 'orange' : 'default';

  return (
    <div className={`ai-wb-item${active ? ' is-active' : ''}${selected ? ' is-selected' : ''}`}>
      <Checkbox
        className="ai-wb-item-check"
        checked={selected}
        onChange={onToggleSelect}
        onClick={(e) => e.stopPropagation()}
      />
      <button type="button" className="ai-wb-item-main" onClick={onClick}>
        <div className="ai-wb-item-head">
          <span className="ai-wb-item-id">第 {displayItemIndex(item)} 题</span>
          <span className="ai-wb-item-time">{item.submittedAt}</span>
        </div>
        <div className="ai-wb-item-title">{primaryTitle}</div>
        <div className="ai-wb-item-tags">
          {ai && <Tag className="ai-wb-item-score">AI {ai.total_score}</Tag>}
          <Tag color={roundTagColor} className="ai-wb-item-round">第 {item.revisionNo} 轮</Tag>
          {meta && <Tag color={meta.color} className="ai-wb-item-decision">{meta.label}</Tag>}
        </div>
      </button>
    </div>
  );
}

/* ============ 中栏详情 ============ */
function AnnotationDetail({
  item,
  opinion,
  onOpinionChange,
  onReturn,
  onRevise,
  onApprove,
  committing,
}: {
  item: AnnotationToReview;
  opinion: string;
  onOpinionChange: (v: string) => void;
  onReturn: () => void;
  onRevise: () => void;
  onApprove: () => void;
  committing?: boolean;
}) {
  const ai = item.aiResult;
  const answerEntries = Object.entries(item.answerJson ?? {});
  const prev = item.previousAnswerJson;
  const hasComparison = !!prev && Object.keys(prev).length > 0;
  const title = pickTitle(item);
  const itemIndex = displayItemIndex(item);

  return (
    <>
      <div className="ai-wb-detail-head">
        <div className="ai-wb-detail-headmain">
          <div className="ai-wb-detail-title">
            <span className="ai-wb-detail-id">第 {itemIndex} 题</span>
            <span className="ai-wb-detail-dot">·</span>
            <span className="ai-wb-detail-name">{title}</span>
          </div>
          <div className="ai-wb-detail-sub">
            任务 {item.taskTitle || item.taskId || '-'} · Item {item.itemId} · 模板 {item.schemaVersionId}
            {item.revisionNo > 1 ? ` · 第 ${item.revisionNo} 轮审核(上一轮标注员修改后重审)` : ''}
          </div>
        </div>
        <div className="ai-wb-detail-badges">
          {item.revisionNo > 1 && <Tag color="orange">第 {item.revisionNo} 轮</Tag>}
          <Tag color="processing">{item.revisionNo > 1 ? '复审中' : '待审'}</Tag>
        </div>
      </div>

      {/* 答案展示:有上一轮时双列对比,否则单列 */}
      {hasComparison ? (
        <div className="ai-wb-compare">
          <div className="ai-wb-compare-col">
            <div className="ai-wb-compare-title is-prev">
              第 {item.revisionNo - 1} 轮提交(已打回)
            </div>
            <div className="ai-wb-answer-fields">
              {Object.entries(prev!).map(([key, value]) => (
                <div key={key} className="ai-wb-answer-row">
                  <span className="ai-wb-answer-key">{key}</span>
                  <span className="ai-wb-answer-value">{formatAnswerValue(value)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="ai-wb-compare-col">
            <div className="ai-wb-compare-title is-curr">
              第 {item.revisionNo} 轮提交(本轮 · 修改后)
            </div>
            <div className="ai-wb-answer-fields">
              {answerEntries.map(([key, value]) => {
                const changed = !isSameValue(value, prev?.[key]);
                return (
                  <div key={key} className="ai-wb-answer-row">
                    <span className="ai-wb-answer-key">{key}</span>
                    <span className={`ai-wb-answer-value${changed ? ' is-changed' : ''}`}>
                      {formatAnswerValue(value)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="ai-wb-answer-card">
          <div className="ai-wb-answer-title">标注答案</div>
          <div className="ai-wb-answer-fields">
            {answerEntries.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无答案数据" />
            ) : (
              answerEntries.map(([key, value]) => (
                <div key={key} className="ai-wb-answer-row">
                  <span className="ai-wb-answer-key">{key}</span>
                  <span className="ai-wb-answer-value">{formatAnswerValue(value)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* AI 预审结果 */}
      {ai && (
        <div className="ai-wb-ai-card">
          <div className="ai-wb-ai-head">
            <span className="ai-wb-ai-title">
              <AiAssistantIcon /> AI 预审{item.revisionNo > 1 ? ' · 本轮重跑结果' : '结果'}
            </span>
            <span className="ai-wb-ai-head-right">
              {ai.version && <Tag className="ai-wb-ai-version">{ai.version}</Tag>}
              <Tag color={decisionMeta[ai.decision].color}>{decisionMeta[ai.decision].label}</Tag>
            </span>
          </div>
          <div className="ai-wb-score-row">
            {Object.entries(ai.scores ?? {}).map(([key, value]) => (
              <div key={key} className={`ai-wb-score ${scoreTone(value)}`}>
                <span className="ai-wb-score-label">{scoreLabel(key)}</span>
                <span className="ai-wb-score-num">{value ?? '-'}</span>
              </div>
            ))}
            <div className={`ai-wb-score is-total ${scoreTone(ai.total_score)}`}>
              <span className="ai-wb-score-label">综合</span>
              <span className="ai-wb-score-num">{ai.total_score}</span>
            </div>
          </div>
          {ai.comment && <div className="ai-wb-ai-comment">{ai.comment}</div>}
          {(ai.risk_flags?.length ?? 0) > 0 && (
            <div className="ai-wb-risk-flags">
              {ai.risk_flags.map((flag) => (
                <Tag key={flag} color="error">
                  # {flag}
                </Tag>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 审核意见 */}
      <div className="ai-wb-opinion">
        <div className="ai-wb-opinion-title">审核意见(打回时必填)</div>
        <Input.TextArea
          rows={3}
          value={opinion}
          onChange={(e) => onOpinionChange(e.target.value)}
          placeholder="填写本轮审核意见,打回时需说明具体问题…"
        />
      </div>

      {/* 裁决按钮 */}
      <div className="ai-wb-actions">
        <button type="button" className="ai-wb-action is-return" onClick={onReturn} disabled={committing}>
          <span className="ai-wb-action-main">↩ 打回</span>
          <span className="ai-wb-action-sub">退回标注员修改</span>
        </button>
        <button
          type="button"
          className="ai-wb-action is-revise"
          onClick={onRevise}
          disabled={committing || !item.schemaFields?.length}
          title={!item.schemaFields?.length ? '缺少 Schema 快照,无法就地修订' : undefined}
        >
          <span className="ai-wb-action-main">✎ 直接修订</span>
          <span className="ai-wb-action-sub">审核员就地改写并入库</span>
        </button>
        <button type="button" className="ai-wb-action is-approve" onClick={onApprove} disabled={committing}>
          <span className="ai-wb-action-main">✓ 通过 · 入库</span>
          <span className="ai-wb-action-sub">本条进入终审 / 可导出</span>
        </button>
      </div>
    </>
  );
}

/* ============ 右栏时间线 ============ */
function ReviewTimeline({ item }: { item: AnnotationToReview }) {
  if ((item.reviewTimeline?.length ?? 0) > 0) {
    return (
      <ul className="ai-wb-timeline">
        {item.reviewTimeline!.map((stage) => {
          const color =
            stage.stage === 'ai_review'
              ? stage.decision === 'PASS'
                ? '#22c55e'
                : stage.decision === 'REJECT'
                  ? '#ef4444'
                  : '#f59e0b'
              : stage.status === 'completed'
                ? 'var(--lh-primary)'
                : '#94a3b8';
          const text =
            stage.stage === 'ai_review'
              ? `${stage.decision ?? '等待预审'}${stage.score == null ? '' : ` · ${stage.score} 分`}${stage.comment ? ` · ${stage.comment}` : ''}`
              : stage.status === 'completed'
                ? `${stage.decision ?? '已复审'}${stage.reason ? ` · ${stage.reason}` : ''}`
                : (stage.comment ?? '等待 Reviewer 人工复审');
          return (
            <li key={`${stage.stage}-${stage.roundNo}-${stage.occurredAt ?? stage.status}`} className="ai-wb-timeline-item">
              <span className="ai-wb-timeline-dot" style={{ background: color }} />
              <div className="ai-wb-timeline-body">
                <div className="ai-wb-timeline-meta">
                  <span className="ai-wb-timeline-who">{stage.title}</span>
                  <span className="ai-wb-timeline-time">
                    <ClockCircleOutlined /> {stage.occurredAt || stage.actor}
                  </span>
                </div>
                <div className="ai-wb-timeline-text">{text}</div>
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  const ai = item.aiResult;
  // 基于现有数据构造一条最小可读的时间线(后端落地后可替换为真实事件流)
  const events: { time: string; who: string; text: string; color: string }[] = [
    { time: item.submittedAt, who: item.labelerName, text: '提交标注', color: '#94a3b8' },
  ];
  if (ai) {
    events.push({
      time: item.submittedAt,
      who: 'AI Agent',
      text: `预审 ${ai.total_score} 分 · ${decisionMeta[ai.decision].label}`,
      color: ai.decision === 'PASS' ? '#22c55e' : ai.decision === 'REJECT' ? '#ef4444' : '#f59e0b',
    });
  }

  return (
    <ul className="ai-wb-timeline">
      {events.map((ev, i) => (
        <li key={i} className="ai-wb-timeline-item">
          <span className="ai-wb-timeline-dot" style={{ background: ev.color }} />
          <div className="ai-wb-timeline-body">
            <div className="ai-wb-timeline-meta">
              <span className="ai-wb-timeline-who">{ev.who}</span>
              <span className="ai-wb-timeline-time">
                <ClockCircleOutlined /> {ev.time}
              </span>
            </div>
            <div className="ai-wb-timeline-text">{ev.text}</div>
          </div>
        </li>
      ))}
      <li className="ai-wb-timeline-item">
        <span className="ai-wb-timeline-dot" style={{ background: 'var(--lh-primary)' }} />
        <div className="ai-wb-timeline-body">
          <div className="ai-wb-timeline-meta">
            <span className="ai-wb-timeline-who">
              <CheckCircleFilled /> 待裁决
            </span>
          </div>
          <div className="ai-wb-timeline-text">本次裁决结果将写入终审</div>
        </div>
      </li>
    </ul>
  );
}

/* ============ 工具函数 ============ */
function pickTitle(item: AnnotationToReview): string {
  return item.taskTitle || item.taskId || '标注任务';
}

function displayItemIndex(item: AnnotationToReview): number | string {
  return item.itemIndex && item.itemIndex > 0 ? item.itemIndex : item.itemId;
}

function formatAnswerValue(value: unknown): string {
  if (value == null) return '—';
  if (Array.isArray(value)) return value.map((v) => String(v)).join('、');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** 比较两轮某字段是否一致(用于高亮本轮改动) */
function isSameValue(a: unknown, b: unknown): boolean {
  return formatAnswerValue(a) === formatAnswerValue(b);
}

function scoreLabel(key: string): string {
  const map: Record<string, string> = {
    relevance: '相关性',
    accuracy: '准确性',
    format_compliance: '格式合规',
    safety: '安全',
  };
  return map[key] ?? key;
}

/**
 * 100 分制色调:
 *   - >= 80 高分绿(is-good)
 *   - 70~80 中分黄(is-mid)
 *   - < 70 低分红(is-low)
 * 空值/非数字返回中性档(is-na)。
 */
function scoreTone(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return 'is-na';
  if (value >= 80) return 'is-good';
  if (value >= 70) return 'is-mid';
  return 'is-low';
}
