/**
 * 数据集类型定义,字段对齐《项目实施计划书》1.4 与 5.1:
 * - qa_quality:单回答评估(模型答 vs 参考答),保留多模态字段
 * - preference_compare:A/B 偏好对比
 * 后端 import 时需保留 raw_payload / media_type / media_url / content_markdown。
 */

export type KnownDatasetKind = 'qa_quality' | 'preference_compare';
export type DatasetKind = KnownDatasetKind | (string & {});
export type MediaType = 'text' | 'image' | 'video' | 'markdown';
export type TextListLike = string[] | string;

/** qa_quality 单条记录 */
export interface QaQualityItem {
  id: string;
  category: string;
  difficulty: string;
  lang: string;
  media_type: MediaType;
  media_url: string;
  content_markdown: string;
  prompt: string;
  model_answer: string;
  reference: string;
  tags: TextListLike;
  source: string;
  expected_dimensions: TextListLike;
}

/** preference_compare 单条记录 */
export interface PreferenceCompareItem {
  id: string;
  task_type: string;
  lang: string;
  prompt: string;
  response_a: string;
  response_b: string;
  model_a: string;
  model_b: string;
  preferred: 'A' | 'B' | 'TIE';
  margin: string;
  dimensions: TextListLike;
  safety_flag: boolean | string;
  annotator_note: string;
}

export type DatasetItem = QaQualityItem | PreferenceCompareItem | Record<string, unknown>;

/** 数据集元数据(列表卡用) */
export interface DatasetMeta {
  id: string;
  taskId?: string;
  taskTitle?: string;
  name: string;
  kind: DatasetKind;
  description: string;
  itemCount: number;
  /** 文件大小(字节),用于展示 */
  size: number;
  /** 上传/导入时间 */
  importedAt: string;
  /** 主要 media_type 分布,便于渲染媒体能力标签 */
  mediaDistribution?: Partial<Record<MediaType, number>>;
  /** 后端数据项接口地址 */
  resourceUrl?: string;
  /** 版本 */
  version: string;
  importStatus?: string;
  errorCount?: number;
  errorSummary?: string;
}

export interface CreateDatasetRequest {
  taskId?: string;
  name: string;
  kind: DatasetKind;
}

export interface ImportDatasetRequest extends CreateDatasetRequest {
  file: File;
}
