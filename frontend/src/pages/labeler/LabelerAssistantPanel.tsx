import { useCallback, useMemo, useRef, useState } from 'react';
import {
  CloseOutlined,
  CopyOutlined,
  DeleteOutlined,
  SendOutlined,
  ThunderboltFilled,
} from '@ant-design/icons';
import { App as AntdApp, Button, Drawer, Input, Tooltip, Typography } from 'antd';

import { labelerApi } from '../../api/labeler';
import { getApiErrorMessage } from '../../api/client';
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
}

/** 几条引导问题,标注员卡壳时点击直接发送,降低开口成本 */
const SUGGESTED_PROMPTS = [
  '帮我用一句话解释当前题目要做什么',
  '当前 Schema 字段分别表示什么意思?',
  '我应该从哪些维度判断这条标注的好坏?',
];

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
      setMessages((prev) => [...prev, userMsg]);
      setInput('');
      setPending(true);
      scrollToBottom();
      try {
        const response = await labelerApi.askAssistant(item.assignmentId, {
          question: text,
          history: messages.map((msg) => ({ role: msg.role, content: msg.content })),
        });
        const reply: AssistantMessage = {
          id: idSeed.current++,
          role: 'assistant',
          content: response.answer,
          createdAt: response.createdAt || new Date().toISOString(),
        };
        setMessages((prev) => [...prev, reply]);
      } catch (error) {
        message.error(getApiErrorMessage(error, 'AI 助手请求失败,请稍后重试。'));
      } finally {
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
        aria-label="打开 AI 答题助手"
      >
        <AiAssistantIcon style={{ fontSize: 22 }} />
      </button>

      <Drawer
        title={
          <span className="labeler-assistant-title">
            <AiAssistantIcon /> AI 答题助手
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
                <div className="labeler-assistant-msg-bubble">{msg.content}</div>
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
          {pending && (
            <div className="labeler-assistant-msg is-assistant">
              <div className="labeler-assistant-msg-meta">
                <span>AI 助手</span>
                <span>正在思考…</span>
              </div>
              <div className="labeler-assistant-msg-bubble is-thinking">
                <span className="labeler-assistant-dots">
                  <i />
                  <i />
                  <i />
                </span>
              </div>
            </div>
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
