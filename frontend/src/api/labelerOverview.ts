import { apiRequest } from './client';
import type { LabelerOverview } from '../types/labelerOverview';

export const labelerOverviewApi = {
  getOverview(): Promise<LabelerOverview> {
    return apiRequest<LabelerOverview>('/labeler/overview');
  },
};
