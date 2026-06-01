import { useCallback, useMemo, useRef, useState } from 'react';
import {
  CloseOutlined,
  CopyOutlined,
  DeleteOutlined,
  SendOutlined,
  ThunderboltFilled,
} from '@ant-design/icons';
import { App as AntdApp, Button, Drawer, Input, Tooltip, Typography } from 'antd';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { labelerApi } from '../../api/labeler';
import { AiAssistantIcon } from '../../components/icons';
import type { AssignmentItem } from '../../types/labeler';

/**
 * Labeler 答题页的 LLM 助手面板。
 *
 * 设计要点(对齐 AGENTS.md 决议):
 *   - 入口:右下角浮动按钮(只在 item.llmAssistEnabled === true 时渲染);
 *   - 展开:antd Drawer 从右滑入,360px 宽,与系统其它 Drawer(报告问题 / 任务发布)风格一致;
 *   - 数据流:调用后端 LLM 助手接口,后端负责模型配置、上下文裁剪与审计。
 *   - 安全边界:助手只能"复制到剪贴板",绝不直接写答案字段,避免污染人类标注。
 *   - 上下文:把 raw_payload 的非媒体字段 + 当前 schema 字段名作为系统提示发给 LLM(后端落地时实现)。
 *
 * 之所以做成独立组件而不是直接塞 AnswerPage:
 *   1. AnswerPage 已经超过 1500 行,继续堆积会增加维护成本;
 *   2. 组件级隔离便于后续做单元测试和样式回归。
 */

interface AssistantMessage {
  /** 本地自增 ID,用于 React key */
  id: number;
  role: 'user' | 'assistant';
  content: string;
  /** ISO 时间戳,展示时格式化为 HH:mm */
  createdAt: string;
  /** 当前 AI 消息是否仍在接收流式 token */
  streaming?: boolean;
  /** 流式请求失败时标记,用于样式提示 */
  failed?: boolean;
}

/** 几条引导问题,标注员卡壳时点击直接发送,降低开口成本 */
const SUGGESTED_PROMPTS = [
  '帮我用一句话解释当前题目要做什么',
  '当前 Schema 字段分别表示什么意思?',
  '我应该从哪些维度判断这条标注的好坏?',
];
const ASSISTANT_STREAM_TIMEOUT_MS = 120_000;

export default function LabelerAssistantPanel({ item }: { item: AssignmentItem }) {
  const { message } = AntdApp.useApp();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const idSeed = useRef(1);
  const listRef = useRef<HTMLDivElement | null>(null);

  /** 滚到对话底部:每次发消息后调用,保证最新内容可见 */
  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  const send = useCallback(
    async (raw?: string) => {
      const text = (raw ?? input).trim();
      if (!text || pending) return;
      const now = new Date();
      const time = now.toISOString();
      const userMsg: AssistantMessage = {
        id: idSeed.current++,
        role: 'user',
        content: text,
        createdAt: time,
      };
      const assistantId = idSeed.current++;
      const assistantMsg: AssistantMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        createdAt: new Date().toISOString(),
        streaming: true,
      };
      const history = messages.map((msg) => ({ role: msg.role, content: msg.content }));
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setInput('');
      setPending(true);
      scrollToBottom();
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), ASSISTANT_STREAM_TIMEOUT_MS);
      try {
        await labelerApi.streamAssistant(
          item.assignmentId,
          { question: text, history },
          {
            signal: controller.signal,
            onDelta: (delta) => {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantId
                    ? { ...msg, content: msg.content + delta, streaming: false }
                    : msg,
                ),
              );
              scrollToBottom();
            },
            onDone: () => {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantId ? { ...msg, streaming: false } : msg,
                ),
              );
            },
          },
        );
      } catch (error) {
        const isAbort = error instanceof DOMException && error.name === 'AbortError';
        const fallbackText = isAbort ? 'AI 助手响应超时,请重新发送。' : 'AI 助手请求失败,请稍后重试。';
        message.error(error instanceof Error && !isAbort ? error.message : fallbackText);
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantId
              ? {
                  ...msg,
                  content: msg.content || fallbackText,
                  streaming: false,
                  failed: true,
                }
              : msg,
          ),
        );
      } finally {
        window.clearTimeout(timeoutId);
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantId ? { ...msg, streaming: false } : msg,
          ),
        );
        setPending(false);
        scrollToBottom();
      }
    },
    [input, item.assignmentId, message, messages, pending, scrollToBottom],
  );

  const clearAll = useCallback(() => {
    if (messages.length === 0) return;
    setMessages([]);
  }, [messages.length]);

  const copyToClipboard = useCallback(
    (text: string) => {
      const fallback = () => {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy');
          message.success('已复制到剪贴板');
        } finally {
          document.body.removeChild(ta);
        }
      };
      if (navigator.clipboard?.writeText) {
        navigator.clipboard
          .writeText(text)
          .then(() => message.success('已复制到剪贴板'))
          .catch(fallback);
      } else {
        fallback();
      }
    },
    [message],
  );

  const headerExtra = useMemo(
    () => (
      <Tooltip title={messages.length === 0 ? '暂无对话记录' : '清空对话'}>
        <Button
          type="text"
          size="small"
          icon={<DeleteOutlined />}
          disabled={messages.length === 0}
          onClick={clearAll}
        />
      </Tooltip>
    ),
    [clearAll, messages.length],
  );

  return (
    <>
      {/* 浮动入口按钮:右下角悬浮,内容不滚动跟随 */}
      <button
        type="button"
        className="labeler-assistant-trigger"
        onClick={() => setOpen(true)}
        aria-label="打开 AI 标注助手"
      >
        <AiAssistantIcon style={{ fontSize: 22 }} />
      </button>

      <Drawer
        title={
          <span className="labeler-assistant-title">
            <AiAssistantIcon /> AI 标注助手
          </span>
        }
        open={open}
        width={400}
        onClose={() => setOpen(false)}
        closeIcon={<CloseOutlined />}
        extra={headerExtra}
        styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column' } }}
        rootClassName="labeler-assistant-drawer"
      >
        {/* 顶部说明:让标注员清楚助手能做什么、不能做什么 */}
        <div className="labeler-assistant-tip">
          <ThunderboltFilled style={{ color: 'var(--lh-primary)' }} />
          <span>
            助手可以解释题目、Schema 字段和判断思路,只给参考,
            <Typography.Text strong>不会直接写入答案</Typography.Text>。
          </span>
        </div>

        {/* 消息列表 */}
        <div className="labeler-assistant-messages" ref={listRef}>
          {messages.length === 0 ? (
            <div className="labeler-assistant-empty">
              <p className="labeler-assistant-empty-title">还没有对话,试试这些问题:</p>
              <div className="labeler-assistant-suggestions">
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    className="labeler-assistant-suggestion"
                    onClick={() => send(prompt)}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`labeler-assistant-msg is-${msg.role}`}
              >
                <div className="labeler-assistant-msg-meta">
                  <span>{msg.role === 'user' ? '我' : 'AI 助手'}</span>
                  <span>{formatHHmm(msg.createdAt)}</span>
                </div>
                <div
                  className={[
                    'labeler-assistant-msg-bubble',
                    msg.role === 'assistant' && msg.streaming && !msg.content ? 'is-thinking' : '',
                    msg.failed ? 'is-error' : '',
                  ].filter(Boolean).join(' ')}
                >
                  {msg.role === 'assistant' && msg.streaming && !msg.content ? (
                    <span className="labeler-assistant-dots">
                      <i />
                      <i />
                      <i />
                    </span>
                  ) : msg.role === 'assistant' ? (
                    <AssistantMarkdown source={msg.content} />
                  ) : (
                    msg.content
                  )}
                </div>
                {msg.role === 'assistant' && (
                  <div className="labeler-assistant-msg-actions">
                    <Button
                      type="link"
                      size="small"
                      icon={<CopyOutlined />}
                      onClick={() => copyToClipboard(msg.content)}
                    >
                      复制为参考
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* 底部输入区:输入框与发送按钮同行,类似现代 Chat 应用 */}
        <div className="labeler-assistant-input">
          <div className="labeler-assistant-input-row">
            <Input.TextArea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPressEnter={(e) => {
                if (!e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="输入你的问题…"
              autoSize={{ minRows: 1, maxRows: 4 }}
              disabled={pending}
              maxLength={500}
              className="labeler-assistant-textarea"
            />
            <button
              type="button"
              className="labeler-assistant-send-btn"
              disabled={!input.trim() || pending}
              onClick={() => send()}
              aria-label="发送"
            >
              <SendOutlined />
            </button>
          </div>
          <span className="labeler-assistant-input-hint">
            Enter 发送 · Shift+Enter 换行 · {input.length}/500
          </span>
        </div>
      </Drawer>
    </>
  );
}

/** 时间戳格式化为 HH:mm,与系统其它对话气泡风格一致 */
function formatHHmm(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function AssistantMarkdown({ source }: { source: string }) {
  const normalizedSource = normalizeAssistantMarkdown(source);
  return (
    <div className="labeler-assistant-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          h1: ({ children }) => <h1 className="labeler-assistant-md-heading">{children}</h1>,
          h2: ({ children }) => <h2 className="labeler-assistant-md-heading">{children}</h2>,
          h3: ({ children }) => <h3 className="labeler-assistant-md-heading">{children}</h3>,
          h4: ({ children }) => <h4 className="labeler-assistant-md-heading">{children}</h4>,
          p: ({ children }) => <p className="labeler-assistant-md-p">{children}</p>,
          ul: ({ children }) => <ul className="labeler-assistant-md-list">{children}</ul>,
          ol: ({ children }) => <ol className="labeler-assistant-md-list labeler-assistant-md-ordered">{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="labeler-assistant-md-quote">{children}</blockquote>
          ),
          code: ({ className, children, ...props }) => (
            <code className={className} {...props}>
              {children}
            </code>
          ),
          pre: ({ children }) => <pre className="labeler-assistant-md-code">{children}</pre>,
          a: ({ children, href }) => (
            <a
              className="labeler-assistant-md-link"
              href={href}
              target="_blank"
              rel="noreferrer"
            >
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="labeler-assistant-md-table-wrap">
              <table className="labeler-assistant-md-table">{children}</table>
            </div>
          ),
          th: ({ children }) => <th>{children}</th>,
          td: ({ children }) => <td>{children}</td>,
          hr: () => <hr className="labeler-assistant-md-hr" />,
        }}
      >
        {normalizedSource}
      </ReactMarkdown>
    </div>
  );
}

function normalizeAssistantMarkdown(source: string): string {
  return source
    .split(/(```[\s\S]*?```)/g)
    .map((part) => (part.startsWith('```') ? part : normalizeCompressedTables(part)))
    .join('');
}

function normalizeCompressedTables(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => normalizeCompressedTableLine(line))
    .join('\n');
}

function normalizeCompressedTableLine(line: string): string {
  if (!line.includes('||')) return line;
  const rows = line
    .trim()
    .split(/\s*\|\|\s*/g)
    .map((row) => normalizeTableRow(row))
    .filter((row) => row !== null);
  if (rows.length < 3 || !rows.some(isMarkdownTableDivider)) {
    return line;
  }
  return `\n${rows.join('\n')}\n`;
}

function normalizeTableRow(row: string): string | null {
  const trimmed = row.trim();
  if (!trimmed || !trimmed.includes('|')) {
    return null;
  }
  const cells = trimmed
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
    .filter(Boolean);
  if (cells.length < 2) {
    return null;
  }
  return `| ${cells.join(' | ')} |`;
}

function isMarkdownTableDivider(row: string): boolean {
  const cells = row
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}
