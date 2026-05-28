/**
 * 模板搭建(Schema Designer)API 预留层。
 * 路径与 payload 对齐《项目实施计划书》4.2 / 5.2,后端 Spring Boot 落地后无需修改前端。
 */

import { apiRequest } from './client';
import type {
  CreateSchemaDraftRequest,
  SchemaValidationResult,
  SchemaSummary,
  SchemaVersion,
  UpdateSchemaDraftRequest,
} from '../types/schema';
import type { PageResult } from '../types/owner';

export const schemaApi = {
  /** 模板列表 */
  listSchemas(): Promise<PageResult<SchemaSummary>> {
    return apiRequest<PageResult<SchemaSummary>>('/schemas');
  },

  /** 拉取某个版本的完整内容(给 Designer 编辑/预览用) */
  getSchema(versionId: string): Promise<SchemaVersion> {
    return apiRequest<SchemaVersion>(`/schemas/${versionId}`);
  },

  /** 在某个 task 下创建草稿 */
  createDraftForTask(taskId: string, payload: CreateSchemaDraftRequest): Promise<SchemaVersion> {
    return apiRequest<SchemaVersion>(`/tasks/${taskId}/schemas/draft`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /** 创建独立草稿(暂不绑定任务) */
  createStandaloneDraft(payload: CreateSchemaDraftRequest): Promise<SchemaVersion> {
    return apiRequest<SchemaVersion>(`/schemas/draft`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /** 校验模板结构,用于 Designer 保存/发布前检查 */
  validate(payload: CreateSchemaDraftRequest): Promise<SchemaValidationResult> {
    return apiRequest<SchemaValidationResult>('/schemas/validate', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /** 保存草稿 */
  updateDraft(versionId: string, payload: UpdateSchemaDraftRequest): Promise<SchemaVersion> {
    return apiRequest<SchemaVersion>(`/schemas/${versionId}/draft`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  /** 发布版本(冻结 Schema,Renderer 端按版本拉取) */
  publish(versionId: string): Promise<SchemaVersion> {
    return apiRequest<SchemaVersion>(`/schemas/${versionId}/publish`, {
      method: 'POST',
    });
  },

  /** 收回已发布版本:同一 versionId 回到 draft,可继续原地编辑 */
  withdraw(versionId: string): Promise<SchemaVersion> {
    return apiRequest<SchemaVersion>(`/schemas/${versionId}/withdraw`, {
      method: 'POST',
    });
  },

  /** 删除草稿模板。已发布模板需先收回发布,被任务或标注引用时后端会拒绝。 */
  deleteSchema(versionId: string): Promise<void> {
    return apiRequest<void>(`/schemas/${versionId}`, {
      method: 'DELETE',
    });
  },
};
