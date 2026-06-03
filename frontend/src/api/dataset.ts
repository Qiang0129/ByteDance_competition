import { apiRequest } from './client';
import type {
  CreateDatasetRequest,
  DatasetItemOption,
  DatasetItem,
  DatasetMeta,
  ImportDatasetRequest,
} from '../types/dataset';
import type { PageResult } from '../types/owner';

export const datasetApi = {
  listDatasets(): Promise<PageResult<DatasetMeta>> {
    return apiRequest<PageResult<DatasetMeta>>('/datasets');
  },

  listItems(datasetId: string): Promise<DatasetItem[]> {
    return apiRequest<DatasetItem[]>(`/datasets/${datasetId}/items`);
  },

  listItemOptions(
    datasetId: string,
    params: { keyword?: string; page?: number; pageSize?: number } = {},
  ): Promise<PageResult<DatasetItemOption>> {
    const search = new URLSearchParams();
    if (params.keyword) search.set('keyword', params.keyword);
    if (params.page) search.set('page', String(params.page));
    if (params.pageSize) search.set('pageSize', String(params.pageSize));
    const qs = search.toString();
    return apiRequest<PageResult<DatasetItemOption>>(
      `/datasets/${datasetId}/item-options${qs ? `?${qs}` : ''}`,
    );
  },

  createDataset(payload: CreateDatasetRequest): Promise<DatasetMeta> {
    return apiRequest<DatasetMeta>('/datasets', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  importDataset(payload: ImportDatasetRequest): Promise<DatasetMeta> {
    const formData = new FormData();
    if (payload.taskId) {
      formData.append('taskId', payload.taskId);
    }
    formData.append('kind', payload.kind);
    formData.append('name', payload.name);
    formData.append('file', payload.file);

    return apiRequest<DatasetMeta>('/datasets/import', {
      method: 'POST',
      body: formData,
    });
  },

  importItems(datasetId: string, file: File): Promise<DatasetMeta> {
    const formData = new FormData();
    formData.append('file', file);

    return apiRequest<DatasetMeta>(`/datasets/${datasetId}/items/import`, {
      method: 'POST',
      body: formData,
    });
  },

  /**
   * 删除数据集.
   * 后端预留:DELETE /api/datasets/{datasetId},
   * 仅允许当前 Owner 删除自己创建的数据集.成功返回 204 No Content.
   */
  deleteDataset(datasetId: string): Promise<void> {
    return apiRequest<void>(`/datasets/${datasetId}`, {
      method: 'DELETE',
    });
  },
};
