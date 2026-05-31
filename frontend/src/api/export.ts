import { apiRequest } from './client';
import type { CreateExportRequest, ExportJob, ExportOverview } from '../types/export';

/**
 * 导出中心 API。
 * 对齐计划书 4.6 / 5.2:
 *   - GET    /exports              导出任务列表
 *   - GET    /exports/overview     导出 KPI 概览
 *   - POST   /exports              创建导出任务
 *   - POST   /exports/{id}/start   开始执行
 *   - POST   /exports/{id}/complete 标记完成
 *   - POST   /exports/{id}/fail    标记失败
 *   - GET    /exports/{id}/download 下载导出文件(后端返回文件流或重定向)
 */
export const exportApi = {
  listExports(): Promise<ExportJob[]> {
    return apiRequest<ExportJob[]>('/exports');
  },

  /** 导出 KPI 概览(后端待实现,前端先回落到本地计算) */
  getOverview(): Promise<ExportOverview> {
    return apiRequest<ExportOverview>('/exports/overview');
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

  /** 下载导出文件(后端返回文件流,前端用 window.open 触发浏览器下载) */
  getDownloadUrl(exportId: string): string {
    const base = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');
    return `${base}/exports/${exportId}/download`;
  },
};
