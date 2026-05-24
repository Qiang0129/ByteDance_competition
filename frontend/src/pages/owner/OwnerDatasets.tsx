import OwnerComingSoon from './components/OwnerComingSoon';

/** 数据集。计划书 4.1 / 1.4:JSON/JSONL/Excel 导入,保留 raw_payload / media_type。 */
export default function OwnerDatasets() {
  return (
    <OwnerComingSoon
      title="数据集"
      description="导入 JSON / JSONL / Excel 数据,识别 qa_quality 与 preference_compare 类型,保留 raw_payload 与多模态字段。"
      phase="Phase 2 · 任务与数据集"
      apis={[
        'POST /datasets/import',
        'GET /datasets',
        'POST /datasets/{id}/import-profiles',
      ]}
    />
  );
}
