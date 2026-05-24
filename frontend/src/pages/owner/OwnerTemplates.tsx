import OwnerComingSoon from './components/OwnerComingSoon';

/** 模板搭建。计划书 4.2:Designer 拖拽 + 物料属性 + Schema 版本管理。 */
export default function OwnerTemplates() {
  return (
    <OwnerComingSoon
      title="模板搭建"
      description="拖拽物料 / 属性面板 / Schema 版本化,Designer 与 Renderer 共用一份 Schema。"
      phase="Phase 3 · 动态表单"
      apis={[
        'POST /tasks/{id}/schemas/draft',
        'POST /schemas/{id}/publish',
        'GET /schemas/{versionId}',
      ]}
    />
  );
}
