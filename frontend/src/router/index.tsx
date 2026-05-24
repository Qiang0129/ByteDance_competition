import { Navigate, Route, Routes } from 'react-router-dom';

import AppLayout from '../layouts/AppLayout';

import { Login, NotFound } from '../pages';
import {
  Drafts,
  LabelerOverview,
  MyTasks,
  ReturnedItems,
  TaskMarket,
} from '../pages/labeler';
import {
  OwnerAiReview,
  OwnerDashboard,
  OwnerDatasets,
  OwnerExport,
  OwnerReview,
  OwnerTasks,
  OwnerTemplates,
} from '../pages/owner';
import ReviewerHome from '../pages/reviewer';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<Login />} />

      <Route element={<AppLayout />}>
        {/* Owner 端:计划书 4.1 / 4.2 / 4.4 / 4.5 / 4.6 */}
        <Route path="/owner" element={<Navigate to="/owner/tasks" replace />} />
        <Route path="/owner/tasks" element={<OwnerTasks />} />
        <Route path="/owner/templates" element={<OwnerTemplates />} />
        <Route path="/owner/datasets" element={<OwnerDatasets />} />
        <Route path="/owner/ai-review" element={<OwnerAiReview />} />
        <Route path="/owner/review" element={<OwnerReview />} />
        <Route path="/owner/dashboard" element={<OwnerDashboard />} />
        <Route path="/owner/export" element={<OwnerExport />} />

        {/* Labeler 端:计划书 4.3 */}
        <Route path="/labeler" element={<LabelerOverview />} />
        <Route path="/labeler/market" element={<TaskMarket />} />
        <Route path="/labeler/my-tasks" element={<MyTasks />} />
        <Route path="/labeler/drafts" element={<Drafts />} />
        <Route path="/labeler/returned" element={<ReturnedItems />} />

        <Route path="/reviewer" element={<ReviewerHome />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
