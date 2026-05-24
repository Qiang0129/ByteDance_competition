import OwnerComingSoon from './components/OwnerComingSoon';

/** AI 预审规则。计划书 4.4:Prompt 模板、评分维度、判定规则、失败重试。 */
export default function OwnerAiReview() {
  return (
    <OwnerComingSoon
      title="AI 预审规则"
      description="维护 Prompt 模板与评分维度,定义 PASS / REJECT / NEED_HUMAN_REVIEW 判定阈值与重试策略。"
      phase="Phase 5 · AI 与人工审核"
      apis={[
        'GET /ai-review/jobs',
        'POST /ai-review/jobs/{id}/retry',
        'GET /ai-review/results/{annotationId}',
      ]}
    />
  );
}
