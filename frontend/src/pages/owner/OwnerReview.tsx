import OwnerComingSoon from './components/OwnerComingSoon';

/** 人工审核。计划书 4.5:初审 / 复审 / 终审 + 抽检 + 返工率。 */
export default function OwnerReview() {
  return (
    <OwnerComingSoon
      title="人工审核"
      description="跟踪初审 / 复审 / 终审进度,支持批量通过与打回,审计日志可追溯到具体审核员。"
      phase="Phase 5 · AI 与人工审核"
      apis={[
        'GET /reviews',
        'POST /reviews/{id}/decision',
        'GET /reviews/audit-log',
      ]}
    />
  );
}
