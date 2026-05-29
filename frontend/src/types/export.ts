export type ExportFormat = 'json' | 'jsonl' | 'csv' | 'xlsx';

export type ExportJobStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export interface ExportJob {
  exportId: string;
  taskId: string;
  format: ExportFormat;
  status: ExportJobStatus;
  progress: number;
  errorSummary?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateExportRequest {
  taskId: string;
  format: ExportFormat;
  mappingJson?: Record<string, unknown>;
}
