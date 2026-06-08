import { useMemo, useRef, useState } from 'react';
import {
  BoldOutlined,
  CodeOutlined,
  EditOutlined,
  EyeOutlined,
  FontSizeOutlined,
  ItalicOutlined,
  LinkOutlined,
  OrderedListOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { Button, Input, Segmented, Space, Tooltip } from 'antd';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

type RichTextMode = 'edit' | 'preview';

export interface RichTextMarkdownProps {
  source?: string;
  className?: string;
  emptyText?: string;
}

export interface RichTextEditorProps {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  readOnly?: boolean;
  status?: 'error' | 'warning';
  rows?: number;
  className?: string;
  previewClassName?: string;
}

const markdownPlugins = [remarkGfm];

const markdownComponents: Components = {
  a: ({ children, href }) => {
    const safeHref = normalizeSafeHref(href);
    if (!safeHref) {
      return <span className="lh-rich-text-md-link is-disabled">{children}</span>;
    }
    return (
      <a
        className="lh-rich-text-md-link"
        href={safeHref}
        target="_blank"
        rel="noreferrer"
      >
        {children}
      </a>
    );
  },
  p: ({ children }) => <p className="lh-rich-text-md-p">{children}</p>,
  h1: ({ children }) => <h1 className="lh-rich-text-md-heading">{children}</h1>,
  h2: ({ children }) => <h2 className="lh-rich-text-md-heading">{children}</h2>,
  h3: ({ children }) => <h3 className="lh-rich-text-md-heading">{children}</h3>,
  ul: ({ children }) => <ul className="lh-rich-text-md-list">{children}</ul>,
  ol: ({ children }) => <ol className="lh-rich-text-md-list lh-rich-text-md-ordered">{children}</ol>,
  blockquote: ({ children }) => (
    <blockquote className="lh-rich-text-md-quote">{children}</blockquote>
  ),
  pre: ({ children }) => <pre className="lh-rich-text-md-code">{children}</pre>,
  code: ({ className, children, ...props }) => (
    <code className={className} {...props}>
      {children}
    </code>
  ),
};

export function RichTextMarkdown({
  source,
  className,
  emptyText = '暂无富文本内容',
}: RichTextMarkdownProps) {
  const text = source ?? '';
  if (!text.trim()) {
    return <div className={`lh-rich-text-empty${className ? ` ${className}` : ''}`}>{emptyText}</div>;
  }
  return (
    <div className={`lh-rich-text-markdown${className ? ` ${className}` : ''}`}>
      <ReactMarkdown
        remarkPlugins={markdownPlugins}
        skipHtml
        components={markdownComponents}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  maxLength,
  disabled,
  readOnly,
  status,
  rows = 6,
  className,
  previewClassName,
}: RichTextEditorProps) {
  const [mode, setMode] = useState<RichTextMode>('edit');
  const textAreaRef = useRef<TextAreaRef | null>(null);
  const currentValue = value ?? '';
  const canEdit = !disabled && !readOnly;
  const rootClassName = [
    'lh-rich-text-editor',
    readOnly ? 'is-readonly' : '',
    disabled ? 'is-disabled' : '',
    className ?? '',
  ].filter(Boolean).join(' ');

  const toolbarItems = useMemo(
    () => [
      {
        key: 'bold',
        title: '加粗',
        icon: <BoldOutlined />,
        onClick: () => wrapSelection('**', '**', '加粗文本'),
      },
      {
        key: 'italic',
        title: '斜体',
        icon: <ItalicOutlined />,
        onClick: () => wrapSelection('*', '*', '斜体文本'),
      },
      {
        key: 'heading',
        title: '标题',
        icon: <FontSizeOutlined />,
        onClick: () => prefixLines('### ', '标题'),
      },
      {
        key: 'unordered-list',
        title: '无序列表',
        icon: <UnorderedListOutlined />,
        onClick: () => prefixLines('- ', '列表项'),
      },
      {
        key: 'ordered-list',
        title: '有序列表',
        icon: <OrderedListOutlined />,
        onClick: () => prefixLines('1. ', '列表项'),
      },
      {
        key: 'quote',
        title: '引用',
        icon: <span className="lh-rich-text-toolbar-text">“</span>,
        onClick: () => prefixLines('> ', '引用内容'),
      },
      {
        key: 'code',
        title: '代码块',
        icon: <CodeOutlined />,
        onClick: () => wrapSelection('```\n', '\n```', 'code'),
      },
      {
        key: 'link',
        title: '链接',
        icon: <LinkOutlined />,
        onClick: insertLink,
      },
    ],
    [currentValue, maxLength, onChange],
  );

  if (readOnly) {
    return (
      <div className={rootClassName}>
        <RichTextMarkdown
          source={currentValue}
          className={previewClassName}
        />
      </div>
    );
  }

  return (
    <div className={rootClassName}>
      <div className="lh-rich-text-toolbar">
        <Space size={4} wrap>
          {toolbarItems.map((item) => (
            <Tooltip key={item.key} title={item.title}>
              <Button
                type="text"
                size="small"
                icon={item.icon}
                disabled={!canEdit}
                onClick={item.onClick}
              />
            </Tooltip>
          ))}
        </Space>
        <Segmented
          size="small"
          className="lh-rich-text-mode"
          value={mode}
          onChange={(next) => setMode(next as RichTextMode)}
          options={[
            { label: <EditOutlined />, value: 'edit' },
            { label: <EyeOutlined />, value: 'preview' },
          ]}
        />
      </div>

      {mode === 'edit' ? (
        <Input.TextArea
          ref={textAreaRef}
          className="lh-rich-text-area"
          rows={rows}
          placeholder={placeholder ?? '请输入 Markdown 富文本内容'}
          value={currentValue}
          maxLength={maxLength}
          showCount={Boolean(maxLength)}
          status={status}
          disabled={disabled}
          readOnly={readOnly}
          onChange={(event) => onChange?.(event.target.value)}
        />
      ) : (
        <RichTextMarkdown
          source={currentValue}
          className={`lh-rich-text-preview${previewClassName ? ` ${previewClassName}` : ''}`}
        />
      )}
    </div>
  );

  function wrapSelection(prefix: string, suffix: string, fallback: string) {
    const textarea = textAreaRef.current?.resizableTextArea?.textArea;
    const start = textarea?.selectionStart ?? currentValue.length;
    const end = textarea?.selectionEnd ?? currentValue.length;
    const selected = currentValue.slice(start, end) || fallback;
    const nextValue = applyMaxLength(
      `${currentValue.slice(0, start)}${prefix}${selected}${suffix}${currentValue.slice(end)}`,
    );
    const nextStart = start + prefix.length;
    const nextEnd = Math.min(nextStart + selected.length, nextValue.length);
    emitChange(nextValue, nextStart, nextEnd);
  }

  function prefixLines(prefix: string, fallback: string) {
    const textarea = textAreaRef.current?.resizableTextArea?.textArea;
    const start = textarea?.selectionStart ?? currentValue.length;
    const end = textarea?.selectionEnd ?? currentValue.length;
    const selected = currentValue.slice(start, end) || fallback;
    const lineText = selected
      .split(/\r?\n/)
      .map((line) => `${prefix}${line || fallback}`)
      .join('\n');
    const nextValue = applyMaxLength(
      `${currentValue.slice(0, start)}${lineText}${currentValue.slice(end)}`,
    );
    emitChange(nextValue, start, Math.min(start + lineText.length, nextValue.length));
  }

  function insertLink() {
    const textarea = textAreaRef.current?.resizableTextArea?.textArea;
    const start = textarea?.selectionStart ?? currentValue.length;
    const end = textarea?.selectionEnd ?? currentValue.length;
    const selected = currentValue.slice(start, end) || '链接文本';
    const href = window.prompt('请输入链接地址', 'https://');
    if (!href) return;
    const linkText = `[${selected}](${href.trim()})`;
    const nextValue = applyMaxLength(
      `${currentValue.slice(0, start)}${linkText}${currentValue.slice(end)}`,
    );
    emitChange(nextValue, start, Math.min(start + linkText.length, nextValue.length));
  }

  function emitChange(nextValue: string, selectionStart: number, selectionEnd: number) {
    onChange?.(nextValue);
    window.requestAnimationFrame(() => {
      const textarea = textAreaRef.current?.resizableTextArea?.textArea;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(selectionStart, selectionEnd);
    });
  }

  function applyMaxLength(nextValue: string) {
    if (typeof maxLength !== 'number' || maxLength <= 0) return nextValue;
    return nextValue.length > maxLength ? nextValue.slice(0, maxLength) : nextValue;
  }
}

function normalizeSafeHref(href?: string) {
  if (!href) return undefined;
  const trimmed = href.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('/') || trimmed.startsWith('#')) return trimmed;
  try {
    const parsed = new URL(trimmed);
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol) ? trimmed : undefined;
  } catch {
    return undefined;
  }
}
