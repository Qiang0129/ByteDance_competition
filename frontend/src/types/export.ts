export type ExportFormat = 'json' | 'jsonl' | 'csv' | 'xlsx';

export type ExportJobStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export interface ExportJob {
  exportId: string;
  taskId: string;
  /** 任务标题(后端 join 返回,前端不再二次查询) */
  taskTitle?: string;
  format: ExportFormat;
  status: ExportJobStatus;
  progress: number;
  /** 导出条目数(succeeded 后填充) */
  exportedCount?: number;
  /** 导出文件大小(字节,succeeded 后填充) */
  fileSizeBytes?: number;
  /** 导出文件下载 URL(succeeded 后填充) */
  downloadUrl?: string;
  /** 字段映射配置快照 */
  mappingJson?: Record<string, unknown>;
  errorSummary?: string;
  createdAt: string;
  updatedAt: string;
  /** 创建人 */
  createdBy?: string;
}

export interface CreateExportRequest {
  taskId: string;
  format: ExportFormat;
  mappingJson?: Record<string, unknown>;
}

/** 导出中心 KPI 概览 */
export interface ExportOverview {
  /** 导出任务总数 */
  totalJobs: number;
  /** 成功数 */
  succeededJobs: number;
  /** 失败数 */
  failedJobs: number;
  /** 本月导出条目总数 */
  monthlyExportedItems: number;
  /** 本月导出文件总大小(字节) */
  monthlyFileSizeBytes: number;
}
