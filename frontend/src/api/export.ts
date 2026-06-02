import { ApiError, apiRequest, buildApiUrl, getAuthToken } from './client';
import type {
  CreateExportRequest,
  ExportJob,
  ExportOverview,
  ExportTaskOptions,
} from '../types/export';

function parseFilename(contentDisposition: string | null) {
  if (!contentDisposition) return null;

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].replace(/"/g, ''));
    } catch {
      return utf8Match[1].replace(/"/g, '');
    }
  }

  const plainMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
  return plainMatch?.[1] ?? null;
}

async function throwDownloadError(response: Response): Promise<never> {
  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();
  throw new ApiError(response.status, response.statusText, payload);
}

function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const exportApi = {
  listExports(): Promise<ExportJob[]> {
    return apiRequest<ExportJob[]>('/exports');
  },

  getOverview(): Promise<ExportOverview> {
    return apiRequest<ExportOverview>('/exports/overview');
  },

  getTaskOptions(taskId: string): Promise<ExportTaskOptions> {
    return apiRequest<ExportTaskOptions>(`/exports/tasks/${taskId}/options`);
  },

  createExport(payload: CreateExportRequest): Promise<ExportJob> {
    return apiRequest<ExportJob>('/exports', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  startExport(exportId: string): Promise<ExportJob> {
    return apiRequest<ExportJob>(`/exports/${exportId}/start`, {
      method: 'POST',
    });
  },

  completeExport(exportId: string): Promise<ExportJob> {
    return apiRequest<ExportJob>(`/exports/${exportId}/complete`, {
      method: 'POST',
    });
  },

  failExport(exportId: string, errorSummary?: string): Promise<ExportJob> {
    return apiRequest<ExportJob>(`/exports/${exportId}/fail`, {
      method: 'POST',
      body: JSON.stringify({ errorSummary }),
    });
  },

  async downloadExport(exportId: string, suggestedFilename?: string): Promise<void> {
    const headers = new Headers();
    const token = getAuthToken();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const response = await fetch(buildApiUrl(`/exports/${exportId}/download`), { headers });
    if (!response.ok) {
      await throwDownloadError(response);
    }

    const blob = await response.blob();
    const filename =
      parseFilename(response.headers.get('content-disposition')) ??
      suggestedFilename ??
      `export-${exportId}`;
    triggerBrowserDownload(blob, filename);
  },
};
