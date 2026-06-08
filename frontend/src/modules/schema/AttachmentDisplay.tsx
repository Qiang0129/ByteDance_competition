import { DeleteOutlined, DownloadOutlined, FileImageOutlined, PaperClipOutlined } from '@ant-design/icons';
import { useEffect, useMemo, useState } from 'react';
import { App as AntdApp, Button, Typography } from 'antd';

import { attachmentApi, type AssignmentAttachment } from '../../api/attachments';

export interface NormalizedAttachment extends AssignmentAttachment {
  size: number;
}

export function normalizeAttachmentValue(value: unknown): {
  attachments: NormalizedAttachment[];
  legacyText?: string;
} {
  if (Array.isArray(value)) {
    return {
      attachments: value
        .map((item) => normalizeAttachmentItem(item))
        .filter((item): item is NormalizedAttachment => Boolean(item)),
    };
  }
  if (typeof value === 'string' && value.trim()) {
    return { attachments: [], legacyText: value.trim() };
  }
  return { attachments: [] };
}

export function formatAttachmentSize(size: number | undefined): string {
  if (size == null || Number.isNaN(size)) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function isImageAttachment(attachment: Pick<NormalizedAttachment, 'mimeType' | 'name'>) {
  if (attachment.mimeType?.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|bmp)$/i.test(attachment.name);
}

export function AttachmentDisplayList({
  value,
  assignmentId,
  emptyText = '暂无附件',
  className,
  onRemove,
}: {
  value: unknown;
  assignmentId?: string;
  emptyText?: string;
  className?: string;
  onRemove?: (fileId: string) => void;
}) {
  const { message } = AntdApp.useApp();
  const { attachments, legacyText } = useMemo(() => normalizeAttachmentValue(value), [value]);

  if (legacyText) {
    return <Typography.Text>{legacyText}</Typography.Text>;
  }
  if (attachments.length === 0) {
    return <Typography.Text type="secondary">{emptyText}</Typography.Text>;
  }
  return (
    <div className={`lh-attachment-list${className ? ` ${className}` : ''}`}>
      {attachments.map((attachment) => (
        <AttachmentItem
          key={`${attachment.fileId}-${attachment.name}`}
          attachment={attachment}
          assignmentId={assignmentId}
          onError={(error) => message.error(error)}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
}

function AttachmentItem({
  attachment,
  assignmentId,
  onError,
  onRemove,
}: {
  attachment: NormalizedAttachment;
  assignmentId?: string;
  onError: (message: string) => void;
  onRemove?: (fileId: string) => void;
}) {
  const [previewUrl, setPreviewUrl] = useState<string>();
  const canDownload = Boolean(assignmentId && attachment.fileId);
  const image = isImageAttachment(attachment);

  useEffect(() => {
    if (!assignmentId || !attachment.fileId || !image) {
      setPreviewUrl(undefined);
      return undefined;
    }
    let revoked = false;
    let objectUrl: string | undefined;
    attachmentApi
      .downloadAssignmentAttachment(assignmentId, attachment.fileId)
      .then((blob) => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
      })
      .catch(() => {
        if (!revoked) setPreviewUrl(undefined);
      });
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assignmentId, attachment.fileId, image]);

  const handleDownload = async () => {
    if (!assignmentId || !attachment.fileId) {
      onError('当前附件缺少下载权限上下文');
      return;
    }
    try {
      const blob = await attachmentApi.downloadAssignmentAttachment(assignmentId, attachment.fileId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = attachment.name || 'attachment';
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      onError(error instanceof Error ? error.message : '附件下载失败');
    }
  };

  return (
    <div className="lh-attachment-item">
      <div className="lh-attachment-thumb">
        {previewUrl ? (
          <img src={previewUrl} alt={attachment.name} />
        ) : image ? (
          <FileImageOutlined />
        ) : (
          <PaperClipOutlined />
        )}
      </div>
      <div className="lh-attachment-main">
        <div className="lh-attachment-name" title={attachment.name}>
          {attachment.name}
        </div>
        <div className="lh-attachment-meta">
          {attachment.mimeType || 'unknown'}
          {attachment.size != null ? ` · ${formatAttachmentSize(attachment.size)}` : ''}
        </div>
      </div>
      <Button
        type="text"
        size="small"
        icon={<DownloadOutlined />}
        disabled={!canDownload}
        onClick={() => void handleDownload()}
        aria-label="下载附件"
      />
      {onRemove && (
        <Button
          type="text"
          size="small"
          danger
          icon={<DeleteOutlined />}
          onClick={() => onRemove(attachment.fileId)}
          aria-label="移除附件"
        />
      )}
    </div>
  );
}

function normalizeAttachmentItem(item: unknown): NormalizedAttachment | null {
  if (!item || typeof item !== 'object') return null;
  const record = item as Record<string, unknown>;
  const fileId = toText(record.fileId);
  const name = toText(record.name);
  if (!fileId || !name) return null;
  return {
    fileId,
    name,
    mimeType: toText(record.mimeType) || 'application/octet-stream',
    size: toNumber(record.size),
    checksum: toText(record.checksum) || '',
  };
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
