import OwnerComingSoon from './components/OwnerComingSoon';

/** 导出中心。计划书 4.6:JSON / JSONL / CSV / Excel 异步导出与历史。 */
export default function OwnerExport() {
  return (
    <OwnerComingSoon
      title="导出中心"
      description="支持 JSON / JSONL / CSV / Excel 多格式异步导出,提供下载历史和重新导出能力。"
      phase="Phase 6 · 数据交付"
      apis={[
        'POST /exports',
        'GET /exports',
        'GET /exports/{id}/download',
      ]}
    />
  );
}
