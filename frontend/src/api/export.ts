import { apiRequest } from './client';
import type { CreateExportRequest, ExportJob } from '../types/export';

export const exportApi = {
  listExports(): Promise<ExportJob[]> {
    return apiRequest<ExportJob[]>('/exports');
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
};
