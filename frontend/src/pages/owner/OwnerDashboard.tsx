import OwnerComingSoon from './components/OwnerComingSoon';

/** 数据看板。计划书 4.6:任务进度、AI 通过率、标注员效率、争议样本统计。 */
export default function OwnerDashboard() {
  return (
    <OwnerComingSoon
      title="数据看板"
      description="任务进度、AI 通过率、标注员效率、争议样本与抽检结果一览。"
      phase="Phase 6 · 数据交付"
      apis={['GET /dashboard/overview', 'GET /dashboard/tasks/{id}']}
    />
  );
}
