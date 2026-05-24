/**
 * 数据集类型定义,字段对齐《项目实施计划书》1.4 与 5.1:
 * - qa_quality:单回答评估(模型答 vs 参考答),保留多模态字段
 * - preference_compare:A/B 偏好对比
 * 后端 import 时需保留 raw_payload / media_type / media_url / content_markdown。
 */

export type DatasetKind = 'qa_quality' | 'preference_compare';
export type MediaType = 'text' | 'image' | 'video' | 'markdown';

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
  tags: string[];
  source: string;
  expected_dimensions: string[];
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
  dimensions: string[];
  safety_flag: boolean;
  annotator_note: string;
}

export type DatasetItem = QaQualityItem | PreferenceCompareItem;

/** 数据集元数据(列表卡用) */
export interface DatasetMeta {
  id: string;
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
  /** 资源相对地址,前端从 public 拉取 */
  resourceUrl: string;
  /** 版本 */
  version: string;
}
