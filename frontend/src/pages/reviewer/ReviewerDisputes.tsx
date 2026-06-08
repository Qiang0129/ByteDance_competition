import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircleFilled,
  ClockCircleOutlined,
  ExclamationCircleFilled,
  HistoryOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import {
  App as AntdApp,
  Empty,
  Input,
  Modal,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';

import { getApiErrorMessage } from '../../api/client';
import { reviewerApi } from '../../api/reviewer';
import { AiAssistantIcon } from '../../components/icons';
import { RichTextMarkdown } from '../../modules/schema';
import { toAnswerDisplayEntries, type AnswerDisplayEntry } from '../../modules/schema/answerDisplay';
import type {
  AiReviewResult,
  AnnotationToReview,
  DisputeDetail,
  DisputeItem,
} from '../../types/reviewer';

/**
 * Reviewer 争议样本三栏处理台。
 * 左:争议样本列表
 * 中:题目原文 / 标注答案 / AI 预审结果
 * 右:争议原因 / 审核时间线 / 终审操作
 */

const aiDecisionMeta: Record<AiReviewResult['decision'], { color: string; label: string }> = {
  PASS: { color: 'success', label: '建议通过' },
  REJECT: { color: 'error', label: '建议打回' },
  NEED_HUMAN_REVIEW: { color: 'warning', label: '人工复核' },
};

function humanDecisionMeta(
  decision: AnnotationToReview['decision'],
): { color: string; label: string } | null {
  if (!decision) return null;
  const key = decision.toString().toUpperCase();
  switch (key) {
    case 'APPROVE':
      return { color: 'success', label: '通过' };
    case 'RETURN':
      return { color: 'error', label: '打回' };
    case 'REVISE':
      return { color: 'processing', label: '直接修订' };
    case 'ESCALATE':
      return { color: 'magenta', label: '已升级争议' };
    default:
      return { color: 'default', label: key };
  }
}

export default function ReviewerDisputes() {
  const { message } = AntdApp.useApp();
  const [items, setItems] = useState<DisputeItem[]>([]);
  const [detail, setDetail] = useState<DisputeDetail | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'open' | 'resolved'>('all');
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [usingFallback, setUsingFallback] = useState(false);
  const [opinion, setOpinion] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const resp = await reviewerApi.listDisputes({ status: 'all', pageSize: 100 });
        if (cancelled) return;
        const nextItems = resp.items ?? [];
        setItems(nextItems);
        setUsingFallback(false);
        setActiveId((prev) => prev ?? nextItems[0]?.disputeId ?? null);
      } catch {
        try {
          const res = await fetch('/sample-datasets/reviewer-disputes.json');
          const data = await res.json();
          if (cancelled) return;
          const nextItems = (data.items as DisputeItem[]) ?? [];
          setItems(nextItems);
          setUsingFallback(true);
          setActiveId((prev) => prev ?? nextItems[0]?.disputeId ?? null);
        } catch {
          if (!cancelled) {
            message.error('加载争议样本失败');
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [message]);

  const filtered = useMemo(() => {
    return items.filter((it) => {
      if (filter !== 'all' && it.status !== filter) return false;
      if (!keyword) return true;
      const kw = keyword.toLowerCase();
      return `${it.taskTitle} ${it.disputeId} ${it.reason}`.toLowerCase().includes(kw);
    });
  }, [items, filter, keyword]);

  useEffect(() => {
    if (filtered.length === 0) {
      setActiveId(null);
      setDetail(null);
      return;
    }
    if (!filtered.some((item) => item.disputeId === activeId)) {
      setActiveId(filtered[0].disputeId);
      setOpinion('');
    }
  }, [activeId, filtered]);

  useEffect(() => {
    let cancelled = false;
    async function loadDetail(disputeId: string) {
      setDetailLoading(true);
      try {
        const nextDetail = usingFallback
          ? await loadFallbackDetail(disputeId, items)
          : await reviewerApi.getDisputeDetail(disputeId);
        if (cancelled) return;
        setDetail(nextDetail);
      } catch (requestError) {
        if (!cancelled) {
          setDetail(null);
          message.error(getApiErrorMessage(requestError, '加载争议详情失败'));
        }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    }

    if (!activeId) {
      setDetail(null);
      return;
    }
    void loadDetail(activeId);
    return () => {
      cancelled = true;
    };
  }, [activeId, usingFallback, items, message]);

  async function resolveCurrent(resolution: 'approve' | 'reject', note?: string) {
    if (!detail) return;
    setResolving(true);
    try {
      const resolvedDispute = await reviewerApi.resolveDispute(detail.dispute.disputeId, { resolution, note });
      let refreshedDetail: DisputeDetail | null = null;
      if (!usingFallback) {
        try {
          refreshedDetail = await reviewerApi.getDisputeDetail(resolvedDispute.disputeId);
        } catch {
          message.warning('终审已提交，刷新详情失败，请手动刷新页面确认最新时间线');
        }
      }
      const nextDetail = refreshedDetail ?? {
        dispute: resolvedDispute,
        annotation: {
          ...detail.annotation,
          decision: resolution === 'approve' ? 'APPROVE' : 'RETURN',
          humanReason: note ?? detail.annotation.humanReason,
          humanReviewedAt: detail.annotation.humanReviewedAt,
          humanReviewerName: detail.annotation.humanReviewerName,
        },
      };
      setItems((prevItems) =>
        prevItems.map((item) =>
          item.disputeId === nextDetail.dispute.disputeId ? nextDetail.dispute : item,
        ),
      );
      setDetail(nextDetail);
      setOpinion('');
      message.success(resolution === 'approve' ? '终审通过' : '终审驳回');
    } catch (requestError) {
      message.error(getApiErrorMessage(requestError, '提交终审失败'));
    } finally {
      setResolving(false);
    }
  }

  function openResolveDialog(resolution: 'approve' | 'reject') {
    if (!detail) return;
    let note = opinion.trim();
    Modal.confirm({
      title: resolution === 'approve' ? '终审通过' : '终审驳回',
      content: (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            {detail.dispute.taskTitle} · {detail.dispute.disputeId} · {detail.dispute.escalationStageLabel ?? '争议升级'}
          </Typography.Paragraph>
          {resolution === 'reject' && (
            <Input.TextArea
              rows={4}
              defaultValue={note}
              placeholder="请输入终审打回原因"
              onChange={(event) => {
                note = event.target.value;
              }}
            />
          )}
        </Space>
      ),
      okText: '确认',
      onOk: async () => {
        const trimmed = note.trim();
        if (resolution === 'reject' && !trimmed) {
          message.warning('终审打回必须填写原因');
          return Promise.reject();
        }
        await resolveCurrent(resolution, trimmed || undefined);
      },
    });
  }

  const summary = {
    total: items.length,
    open: items.filter((item) => item.status === 'open').length,
    resolved: items.filter((item) => item.status === 'resolved').length,
  };

  const canResolve = detail?.dispute.canResolve !== false && detail?.dispute.status === 'open';
  const tabItems: Array<{
    key: typeof filter;
    label: string;
    count: number;
    tone: 'human' | 'reject' | 'pass';
  }> = [
    { key: 'all', label: '全部', count: summary.total, tone: 'human' },
    { key: 'open', label: '待处理', count: summary.open, tone: 'reject' },
    { key: 'resolved', label: '已解决', count: summary.resolved, tone: 'pass' },
  ];

  return (
    <div className="ai-wb dispute-wb">
      <div className="ai-wb-topbar">
        <span className="ai-wb-task-title">争议样本</span>
        <Tag color="error">待处理 {summary.open}</Tag>
        <Tag color="success">已解决 {summary.resolved}</Tag>
        {usingFallback && <Tag color="gold">演示模式 · 本地详情</Tag>}
      </div>

      <Spin spinning={loading}>
        <div className="ai-wb-grid">
          <div className="ai-wb-list-col">
            <div className="ai-wb-list-inner">
              <Input
                allowClear
                className="dispute-wb-search"
                prefix={<SearchOutlined />}
                placeholder="搜索任务名 / 争议 ID / 原因"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
              />

              <div className="ai-wb-tabs" role="tablist">
                {tabItems.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    aria-selected={filter === tab.key}
                    className={`ai-wb-tab is-${tab.tone}${filter === tab.key ? ' is-active' : ''}`}
                    onClick={() => setFilter(tab.key)}
                  >
                    <span className="ai-wb-tab-label">{tab.label}</span>
                    <span className="ai-wb-tab-count">{tab.count}</span>
                  </button>
                ))}
              </div>

              <div className="ai-wb-list">
              {filtered.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无争议样本" />
              ) : (
                filtered.map((item) => {
                  const active = item.disputeId === activeId;
                  return (
                    <div
                      key={item.disputeId}
                      className={`ai-wb-item dispute-wb-list-item${active ? ' is-active' : ''}`}
                    >
                      <button
                        type="button"
                        className="ai-wb-item-main"
                        onClick={() => {
                          setActiveId(item.disputeId);
                          setOpinion('');
                        }}
                      >
                        <div className="ai-wb-item-head">
                          <span className="ai-wb-item-id">争议 {item.disputeId}</span>
                          <span className="ai-wb-item-time">{item.raisedAt}</span>
                        </div>
                        <div className="ai-wb-item-title">{item.taskTitle}</div>
                        <div className="ai-wb-item-tags">
                          <Tag>{item.annotationId}</Tag>
                          <Tag color="orange" className="ai-wb-item-round">
                            {item.escalationStageLabel ?? '争议升级'}
                          </Tag>
                          {item.status === 'resolved' ? (
                            <Tag color="success" className="ai-wb-item-decision">已解决</Tag>
                          ) : item.canResolve === false ? (
                            <Tag color="processing" className="ai-wb-item-decision">需他人终审</Tag>
                          ) : (
                            <Tag color="error" className="ai-wb-item-decision">待终审</Tag>
                          )}
                        </div>
                        <div className="dispute-wb-reason">
                          <ExclamationCircleFilled /> {item.reason}
                        </div>
                        <div className="dispute-wb-meta">
                          <HistoryOutlined /> 由 {item.raisedBy} 升级
                        </div>
                      </button>
                    </div>
                  );
                })
              )}
              </div>
            </div>
          </div>

          <div className="ai-wb-detail-col">
            <Spin spinning={detailLoading}>
              {detail ? (
                <DisputeAnnotationDetail annotation={detail.annotation} dispute={detail.dispute} />
              ) : (
                <div className="ai-wb-detail-empty">
                  <Empty description="请选择左侧争议样本" />
                </div>
              )}
            </Spin>
          </div>

          <div className="ai-wb-side-col">
            <Spin spinning={detailLoading}>
              {detail ? (
                <>
                  <div className="dispute-wb-side-card">
                    <Space direction="vertical" size={10} style={{ width: '100%' }}>
                      <div className="dispute-wb-side-title">争议信息</div>
                      <Tag color="orange">{detail.dispute.escalationStageLabel ?? '争议升级'}</Tag>
                      <div className="dispute-wb-side-reason">{detail.dispute.reason}</div>
                      <Typography.Text type="secondary">
                        由 {detail.dispute.raisedBy} 升级 · {detail.dispute.raisedAt}
                      </Typography.Text>
                      {detail.dispute.canResolve === false && detail.dispute.status === 'open' && (
                        <div className="dispute-wb-lock-tip">
                          该争议由你升级,需交由其他 Reviewer 终审。
                        </div>
                      )}
                    </Space>
                  </div>

                  <div className="ai-wb-timeline-card">
                    <div className="ai-wb-timeline-title">
                      审核时间线（第 {displayItemIndex(detail.annotation)} 题）
                    </div>
                    <ReviewTimeline item={detail.annotation} dispute={detail.dispute} />
                  </div>

                  <div className="dispute-wb-side-card">
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                      <div className="dispute-wb-side-title">终审操作</div>
                      {detail.dispute.status === 'resolved' ? (
                        <div className="ai-wb-readonly-result">
                          <div className="ai-wb-readonly-title">已完成终审</div>
                          <div className="ai-wb-readonly-meta">
                            {humanDecisionMeta(detail.annotation.decision) && (
                              <Tag
                                color={humanDecisionMeta(detail.annotation.decision)!.color}
                                className="ai-wb-readonly-decision"
                              >
                                {humanDecisionMeta(detail.annotation.decision)!.label}
                              </Tag>
                            )}
                            {detail.annotation.humanReviewerName && (
                              <span className="ai-wb-readonly-actor">
                                审核员:{detail.annotation.humanReviewerName}
                              </span>
                            )}
                            {detail.annotation.humanReviewedAt && (
                              <span className="ai-wb-readonly-time">{detail.annotation.humanReviewedAt}</span>
                            )}
                          </div>
                          <div className="ai-wb-readonly-reason">
                            {detail.annotation.humanReason || '无书面理由'}
                          </div>
                        </div>
                      ) : (
                        <>
                          {!canResolve && (
                            <div className="dispute-wb-lock-tip">
                              当前样本需要其他 Reviewer 完成终审。
                            </div>
                          )}
                          <Input.TextArea
                            rows={4}
                            value={opinion}
                            onChange={(event) => setOpinion(event.target.value)}
                            placeholder="填写终审意见,终审驳回时必须说明具体原因…"
                          />
                          <div className="ai-wb-actions dispute-wb-final-actions">
                            <button
                              type="button"
                              className="ai-wb-action is-approve"
                              disabled={!canResolve}
                              onClick={() => openResolveDialog('approve')}
                            >
                              <span className="ai-wb-action-main">{resolving ? '提交中' : '✓ 终审通过'}</span>
                              <span className="ai-wb-action-sub">通过后进入最终结果</span>
                            </button>
                            <button
                              type="button"
                              className="ai-wb-action is-return"
                              disabled={!canResolve}
                              onClick={() => openResolveDialog('reject')}
                            >
                              <span className="ai-wb-action-main">{resolving ? '提交中' : '× 终审驳回'}</span>
                              <span className="ai-wb-action-sub">写明原因并打回</span>
                            </button>
                          </div>
                        </>
                      )}
                    </Space>
                  </div>
                </>
              ) : (
                <div className="ai-wb-timeline-card">
                  <Empty description="暂无详情" />
                </div>
              )}
            </Spin>
          </div>
        </div>
      </Spin>
    </div>
  );
}

function DisputeAnnotationDetail({
  annotation,
  dispute,
}: {
  annotation: AnnotationToReview;
  dispute: DisputeItem;
}) {
  const title = pickTitle(annotation);
  const stageLabel = reviewStageLabel(annotation.revisionNo);
  const stageColor = reviewStageColor(annotation.revisionNo);
  const statusMeta = disputeDetailStatusMeta(dispute, annotation);
  const answerEntries = toAnswerDisplayEntries(annotation.answerJson, annotation.schemaFields);
  const payloadEntries = Object.entries(annotation.rawPayload ?? {});
  const ai = annotation.aiResult;

  return (
    <>
      <div className="ai-wb-detail-head">
        <div className="ai-wb-detail-headmain">
          <div className="ai-wb-detail-title">
            <span className="ai-wb-detail-name">{title}</span>
            <span className="ai-wb-detail-dot">|</span>
            <span className="ai-wb-detail-id">第 {displayItemIndex(annotation)} 题</span>
          </div>
          <div className="ai-wb-detail-sub">
            任务 {annotation.taskTitle || annotation.taskId || '-'} · Item {annotation.itemId} · 模板 {annotation.schemaVersionId}
            {annotation.revisionNo > 1 ? ` · Revision ${annotation.revisionNo}(打回后重提)` : ''}
          </div>
        </div>
        <div className="ai-wb-detail-badges">
          <Tag color={stageColor}>{stageLabel}</Tag>
          <Tag color={statusMeta.color}>{statusMeta.label}</Tag>
        </div>
      </div>

      <div className="ai-wb-answer-card dispute-wb-raw-block">
        <div className="ai-wb-answer-title">题目原文 / 原始数据</div>
        <KeyValueRows entries={payloadEntries} emptyText="暂无原始数据" />
      </div>

      <div className="ai-wb-answer-card">
        <div className="ai-wb-answer-title">标注答案</div>
        <AnswerRows entries={answerEntries} emptyText="无答案数据" />
      </div>

      {ai && (
        <div className="ai-wb-ai-card">
          <div className="ai-wb-ai-head">
            <span className="ai-wb-ai-title">
              <AiAssistantIcon /> AI 预审结果
            </span>
            <span className="ai-wb-ai-head-right">
              {ai.version && <Tag className="ai-wb-ai-version">{ai.version}</Tag>}
              <Tag color={aiDecisionMeta[ai.decision].color}>{aiDecisionMeta[ai.decision].label}</Tag>
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
    </>
  );
}

function KeyValueRows({
  entries,
  emptyText,
}: {
  entries: [string, unknown][];
  emptyText: string;
}) {
  if (entries.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />;
  }
  return (
    <div className="ai-wb-answer-fields">
      {entries.map(([key, value]) => (
        <div key={key} className="ai-wb-answer-row">
          <span className="ai-wb-answer-key">{key}</span>
          <span className="ai-wb-answer-value">{formatAnswerValue(value)}</span>
        </div>
      ))}
    </div>
  );
}

function AnswerRows({
  entries,
  emptyText,
}: {
  entries: AnswerDisplayEntry[];
  emptyText: string;
}) {
  if (entries.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />;
  }
  return (
    <div className="ai-wb-answer-fields">
      {entries.map((entry) => (
        <AnswerRow key={entry.key} entry={entry} />
      ))}
    </div>
  );
}

function AnswerRowValue({ entry }: { entry: AnswerDisplayEntry }) {
  return <span className="ai-wb-answer-value">{entry.displayValue}</span>;
}

function AnswerRow({ entry }: { entry: AnswerDisplayEntry }) {
  if (entry.field?.kind === 'rich-text') {
    const markdownSource = typeof entry.value === 'string' ? entry.value : '';
    return (
      <div className="ai-wb-answer-row is-rich-text">
        <div className="ai-wb-answer-rich-head">{entry.label}</div>
        <div className="ai-wb-answer-rich-content">
          <RichTextMarkdown source={markdownSource} emptyText="无富文本内容" />
        </div>
      </div>
    );
  }
  return (
    <div className="ai-wb-answer-row">
      <span className="ai-wb-answer-key">{entry.label}</span>
      <AnswerRowValue entry={entry} />
    </div>
  );
}

function ReviewTimeline({ item, dispute }: { item: AnnotationToReview; dispute?: DisputeItem }) {
  if ((item.reviewTimeline?.length ?? 0) > 0) {
    const timeline = item.reviewTimeline!;
    let finalHumanIndex = -1;
    if (dispute?.status === 'resolved') {
      timeline.forEach((stage, index) => {
        const decision = normalizeTimelineDecision(stage.decision);
        if (stage.stage === 'human_review' && (decision === 'APPROVE' || decision === 'RETURN')) {
          finalHumanIndex = index;
        }
      });
    }
    return (
      <ul className="ai-wb-timeline">
        {timeline.map((stage, index) => {
          const isFinalDisputeDecision = index === finalHumanIndex;
          const color = timelineStageColor(stage, isFinalDisputeDecision);
          const text =
            stage.stage === 'ai_review'
              ? `${stage.decision ?? '等待预审'}${stage.score == null ? '' : ` · ${stage.score} 分`}${stage.comment ? ` · ${stage.comment}` : ''}`
              : stage.status === 'completed'
                ? humanTimelineText(stage, isFinalDisputeDecision)
                : (stage.comment ?? `等待 Reviewer ${stage.title || '人工审核'}`);
          return (
            <li key={`${stage.stage}-${stage.roundNo}-${stage.occurredAt ?? stage.status}`} className="ai-wb-timeline-item">
              <span className="ai-wb-timeline-dot" style={{ background: color }} />
              <div className="ai-wb-timeline-body">
                <div className="ai-wb-timeline-meta">
                  <span className="ai-wb-timeline-who">
                    {stage.stage === 'human_review'
                      ? humanTimelineTitle(stage, isFinalDisputeDecision)
                      : stage.title}
                  </span>
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

  const fallbackEvents = buildFallbackTimeline(item);
  return (
    <ul className="ai-wb-timeline">
      {fallbackEvents.map((event, index) => (
        <li key={index} className="ai-wb-timeline-item">
          <span className="ai-wb-timeline-dot" style={{ background: event.color }} />
          <div className="ai-wb-timeline-body">
            <div className="ai-wb-timeline-meta">
              <span className="ai-wb-timeline-who">{event.who}</span>
              <span className="ai-wb-timeline-time">
                <ClockCircleOutlined /> {event.time}
              </span>
            </div>
            <div className="ai-wb-timeline-text">{event.text}</div>
          </div>
        </li>
      ))}
      <li className="ai-wb-timeline-item">
        <span className="ai-wb-timeline-dot" style={{ background: 'var(--lh-primary)' }} />
        <div className="ai-wb-timeline-body">
          <div className="ai-wb-timeline-meta">
            <span className="ai-wb-timeline-who">
              <CheckCircleFilled /> 待终审
            </span>
          </div>
          <div className="ai-wb-timeline-text">本次终审将写入争议闭环结果</div>
        </div>
      </li>
    </ul>
  );
}

function buildFallbackTimeline(item: AnnotationToReview) {
  const events: { time: string; who: string; text: string; color: string }[] = [
    { time: item.submittedAt, who: item.labelerName, text: '提交标注', color: '#94a3b8' },
  ];
  const ai = item.aiResult;
  if (ai) {
    events.push({
      time: item.submittedAt,
      who: 'AI Agent',
      text: `预审 ${ai.total_score} 分 · ${aiDecisionMeta[ai.decision].label}`,
      color: ai.decision === 'PASS' ? '#22c55e' : ai.decision === 'REJECT' ? '#ef4444' : '#f59e0b',
    });
  }
  return events;
}

function disputeDetailStatusMeta(
  dispute: DisputeItem,
  annotation: AnnotationToReview,
): { color: string; label: string } {
  if (dispute.status === 'resolved') {
    const decision = normalizeTimelineDecision(annotation.decision);
    if (decision === 'APPROVE') {
      return { color: 'success', label: '已解决 · 终审通过' };
    }
    if (decision === 'RETURN') {
      return { color: 'error', label: '已解决 · 终审驳回' };
    }
    return { color: 'success', label: '已解决' };
  }
  if (dispute.canResolve === false) {
    return { color: 'processing', label: '需他人终审' };
  }
  return { color: 'error', label: '待终审' };
}

function timelineStageColor(stage: NonNullable<AnnotationToReview['reviewTimeline']>[number], finalDecision: boolean): string {
  if (stage.stage === 'ai_review') {
    if (stage.decision === 'PASS') return '#22c55e';
    if (stage.decision === 'REJECT') return '#ef4444';
    return '#f59e0b';
  }
  const decision = normalizeTimelineDecision(stage.decision);
  if (finalDecision && decision === 'APPROVE') return '#22c55e';
  if (finalDecision && decision === 'RETURN') return '#ef4444';
  if (decision === 'ESCALATE') return '#f59e0b';
  return stage.status === 'completed' ? 'var(--lh-primary)' : '#94a3b8';
}

function humanTimelineTitle(stage: NonNullable<AnnotationToReview['reviewTimeline']>[number], finalDecision: boolean): string {
  const decision = normalizeTimelineDecision(stage.decision);
  if (finalDecision && decision === 'APPROVE') return '终审通过';
  if (finalDecision && decision === 'RETURN') return '终审驳回';
  if (decision === 'ESCALATE') return `${reviewStageLabel(stage.roundNo)}升级`;
  return stage.title;
}

function humanTimelineText(stage: NonNullable<AnnotationToReview['reviewTimeline']>[number], finalDecision: boolean): string {
  const decision = normalizeTimelineDecision(stage.decision);
  const label =
    finalDecision && decision === 'APPROVE'
      ? '终审通过'
      : finalDecision && decision === 'RETURN'
        ? '终审驳回'
        : decision === 'ESCALATE'
          ? `${reviewStageLabel(stage.roundNo)}升级`
          : (humanDecisionMeta(decision as AnnotationToReview['decision'])?.label ?? stage.decision ?? '已审核');
  return `${label}${stage.reason ? ` · ${stage.reason}` : ''}`;
}

function normalizeTimelineDecision(decision: unknown): string {
  return decision == null ? '' : String(decision).toUpperCase();
}

async function loadFallbackDetail(disputeId: string, items: DisputeItem[]): Promise<DisputeDetail> {
  const dispute = items.find((item) => item.disputeId === disputeId);
  if (!dispute) {
    throw new Error('DISPUTE_NOT_FOUND');
  }
  const res = await fetch('/sample-datasets/reviewer-annotations.json');
  const data = await res.json();
  const annotations = (data.items as AnnotationToReview[]) ?? [];
  const annotation = annotations.find((item) => item.annotationId === dispute.annotationId) ?? {
    annotationId: dispute.annotationId,
    assignmentId: '',
    itemId: dispute.annotationId,
    schemaVersionId: '',
    labelerName: 'Labeler',
    submittedAt: dispute.raisedAt,
    taskId: dispute.taskId,
    taskTitle: dispute.taskTitle,
    taskType: '',
    itemIndex: 0,
    answerJson: {},
    rawPayload: {},
    revisionNo: dispute.escalationStageLabel === '初审升级' ? 1 : 2,
    isDispute: true,
  };
  return {
    dispute,
    annotation,
  };
}

function pickTitle(item: AnnotationToReview): string {
  return item.taskTitle || item.taskId || '标注任务';
}

function reviewStageLabel(revisionNo: number): string {
  if (revisionNo <= 1) {
    return '初审';
  }
  if (revisionNo === 2) {
    return '复审';
  }
  return '终审';
}

function reviewStageColor(revisionNo: number): string {
  if (revisionNo <= 1) {
    return 'default';
  }
  if (revisionNo === 2) {
    return 'orange';
  }
  return 'purple';
}

function displayItemIndex(item: AnnotationToReview): number | string {
  return item.itemIndex && item.itemIndex > 0 ? item.itemIndex : item.itemId;
}

function formatAnswerValue(value: unknown): string {
  if (value == null) return '—';
  if (Array.isArray(value)) return value.map((entry) => String(entry)).join('、');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
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

function scoreTone(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return 'is-na';
  if (value >= 80) return 'is-good';
  if (value >= 70) return 'is-mid';
  return 'is-low';
}
