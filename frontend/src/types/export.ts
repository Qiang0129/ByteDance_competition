export type ExportFormat = 'json' | 'jsonl' | 'csv' | 'xlsx';

export type ExportJobStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export interface ExportColumnConfig {
  key: string;
  label: string;
  source: string;
  path: string;
}

export interface ExportMappingJson {
  columns: ExportColumnConfig[];
}

export interface ExportJob {
  exportId: string;
  taskId: string;
  taskTitle?: string;
  format: ExportFormat;
  status: ExportJobStatus;
  progress: number;
  exportedCount?: number;
  fileSizeBytes?: number;
  downloadUrl?: string;
  mappingJson?: ExportMappingJson | Record<string, unknown> | null;
  errorSummary?: string;
  createdAt: string;
  updatedAt: string;
  downloadedAt?: string;
  createdBy?: string;
}

export interface CreateExportRequest {
  taskId: string;
  format: ExportFormat;
  mappingJson?: ExportMappingJson;
}

export interface ExportOverview {
  totalJobs: number;
  succeededJobs: number;
  failedJobs: number;
  monthlyExportedItems: number;
  monthlyFileSizeBytes: number;
}

export interface ExportFieldOption {
  key: string;
  label: string;
  source: string;
  path: string;
  defaultSelected: boolean;
}

export interface ExportTaskOptions {
  taskId: string;
  taskTitle: string;
  acceptedCount: number;
  exportableCount: number;
  fields: ExportFieldOption[];
}
