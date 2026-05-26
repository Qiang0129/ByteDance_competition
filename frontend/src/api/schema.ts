/**
 * 模板搭建(Schema Designer)API 预留层。
 * 路径与 payload 对齐《项目实施计划书》4.2 / 5.2,后端 Spring Boot 落地后无需修改前端。
 */

import { apiRequest } from './client';
import type {
  CreateSchemaDraftRequest,
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
};
