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
import OwnerHome from '../pages/owner';
import ReviewerHome from '../pages/reviewer';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<Login />} />

      <Route element={<AppLayout />}>
        <Route path="/owner" element={<OwnerHome />} />

        {/* Labeler 端工作台:对齐计划书 4.3 子页面 */}
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
