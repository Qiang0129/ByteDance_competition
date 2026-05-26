import { useCallback, useEffect, useRef, useState } from 'react';
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
  Col,
  Empty,
  Input,
  Modal,
  Progress,
  Radio,
  Row,
  Space,
  Tag,
  Typography,
} from 'antd';
import { useNavigate, useParams } from 'react-router-dom';

import { labelerApi } from '../../api/labeler';
import type { AssignmentItem } from '../../types/labeler';

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

  // 用 ref 把答案与 assignmentId 同步给 setTimeout 回调,避免闭包问题
  const answerRef = useRef(answer);
  const assignmentIdRef = useRef(assignmentId);
  answerRef.current = answer;
  assignmentIdRef.current = assignmentId;

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
      } catch {
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
      setItem(data);
      // 优先使用草稿;打回项 returnReason 单独显示
      const initial = data.draft?.answerJson ?? {};
      setAnswer(initial);
      setDraftSavedAt(data.draft?.updatedAt ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId]);

  /** 草稿自动保存:答案变化后节流 1.5s */
  useEffect(() => {
    if (!assignmentId) return;
    if (!item) return;
    if (Object.keys(answer).length === 0) return;
    const timer = window.setTimeout(() => {
      void persistDraft();
    }, DRAFT_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answer]);

  /** 离开页面前主动保存一次 */
  useEffect(() => {
    return () => {
      // 卸载时:同步发一次草稿(浏览器关闭走 sendBeacon 更靠谱,这里走普通请求)
      const aid = assignmentIdRef.current;
      if (!aid) return;
      const payload = answerRef.current;
      if (Object.keys(payload).length === 0) return;
      void labelerApi.saveDraft(aid, payload).catch(() => {
        /* 演示模式下静默失败 */
      });
    };
  }, []);

  const persistDraft = useCallback(async () => {
    if (!assignmentId) return;
    setSavingDraft(true);
    try {
      await labelerApi.saveDraft(assignmentId, answer);
      setDraftSavedAt(new Date().toLocaleTimeString());
    } catch {
      // 演示模式:仍然标记本地保存时间
      setDraftSavedAt(`${new Date().toLocaleTimeString()} (本地)`);
    } finally {
      setSavingDraft(false);
    }
  }, [answer, assignmentId]);

  function updateField(fieldName: string, value: unknown) {
    setAnswer((prev) => ({ ...prev, [fieldName]: value }));
    // 编辑后清掉该字段的旧报错
    setErrors((prev) => {
      if (!prev[fieldName]) return prev;
      const next = { ...prev };
      delete next[fieldName];
      return next;
    });
  }

  /** 校验:必填 + maxLength + JSON 解析 */
  function validate(): boolean {
    if (!item) return false;
    const next: Record<string, string> = {};
    item.fields.forEach((field) => {
      if (field.kind === 'show-item') return;
      const value = answer[field.fieldName];
      if (field.required) {
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
      if (field.kind === 'json-editor' && typeof value === 'string' && value.trim()) {
        try {
          JSON.parse(value);
        } catch {
          next[field.fieldName] = 'JSON 格式不合法';
        }
      }
    });
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit() {
    if (!item) return;
    if (!validate()) {
      message.warning('请按提示修正后再提交');
      return;
    }
    setSubmitting(true);
    try {
      await labelerApi.submitAnnotation(item.assignmentId, {
        schemaVersionId: item.schemaVersionId,
        answerJson: answer,
      });
      message.success('已提交,等待 AI 预审与人工审核');
      // 跳到下一题(若有);否则回我的任务
      if (item.position.nextAssignmentId) {
        navigate(`/labeler/answer/${item.position.nextAssignmentId}`);
      } else {
        navigate('/labeler/my-tasks');
      }
    } catch (error) {
      message.error(getSubmitErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  function handleSkip() {
    if (item?.position.nextAssignmentId) {
      navigate(`/labeler/answer/${item.position.nextAssignmentId}`);
    } else {
      message.info('已经是最后一题');
    }
  }

  function handlePrev() {
    if (item?.position.prevAssignmentId) {
      navigate(`/labeler/answer/${item.position.prevAssignmentId}`);
    } else {
      message.info('已经是第一题');
    }
  }

  function handleClose() {
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
        </Space>
        <Space size={12} wrap>
          <span className="answer-draft-tip">
            {savingDraft ? (
              <>
                <CloudSyncOutlined spin /> 草稿保存中...
              </>
            ) : draftSavedAt ? (
              <>
                <CheckCircleFilled style={{ color: '#22c55e' }} /> 已保存于 {draftSavedAt}
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
          <Button onClick={handleSkip}>
            跳过 <ArrowRightOutlined />
          </Button>
          <Button type="primary" loading={submitting} onClick={() => void handleSubmit()}>
            提交并继续
          </Button>
        </Space>
      </div>

      {/* 进度条 */}
      <Progress
        percent={progressPct}
        showInfo={false}
        strokeColor={{ from: '#6fb6ff', to: '#2f7bff' }}
        className="answer-progress"
      />

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

      <Row gutter={[16, 16]}>
        {/* 左:原题 + 媒体 */}
        <Col xs={24} xl={10}>
          <Card title="题目数据" className="answer-section">
            <RawPayloadView payload={item.rawPayload} />
          </Card>
        </Col>

        {/* 右:Schema 渲染表单 */}
        <Col xs={24} xl={14}>
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
              {item.fields.map((field) => (
                <FieldRenderer
                  key={field.id}
                  field={field}
                  value={answer[field.fieldName]}
                  error={errors[field.fieldName]}
                  onChange={(value) => updateField(field.fieldName, value)}
                />
              ))}
            </Space>
          </Card>
        </Col>
      </Row>
    </Space>
  );
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

/* ============ 原题渲染 ============ */
function RawPayloadView({ payload }: { payload: AssignmentItem['rawPayload'] }) {
  const { media_type, media_url, content_markdown, ...rest } = payload;
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

      {/* 其他原题字段(prompt / origin_title / model_answer / source ...) */}
      {Object.entries(rest).map(([key, value]) => (
        <div key={key} className="answer-raw-field">
          <div className="answer-raw-key">{key}</div>
          <div className="answer-raw-value">{formatValue(value)}</div>
        </div>
      ))}

      {!media_url &&
        !content_markdown &&
        Object.keys(rest).length === 0 && (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="该题暂无展示数据"
          />
        )}
    </Space>
  );
}

function formatValue(value: unknown): React.ReactNode {
  if (value == null) return <Typography.Text type="secondary">—</Typography.Text>;
  if (typeof value === 'string') return value;
  return <pre className="answer-json">{JSON.stringify(value, null, 2)}</pre>;
}

/* ============ Schema 字段渲染器 ============ */
function FieldRenderer({
  field,
  value,
  error,
  onChange,
}: {
  field: AssignmentItem['fields'][number];
  value: unknown;
  error?: string;
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
              />
            );
          case 'single-choice':
            return (
              <Radio.Group
                value={value as string}
                onChange={(event) => onChange(event.target.value)}
                className="answer-radio-group"
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
                      onChange={(checked) => {
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
