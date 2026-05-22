import { Navigate, Route, Routes } from 'react-router-dom';
import AppLayout from '../layouts/AppLayout';
import { Login, NotFound } from '../pages';
import LabelerHome from '../pages/labeler';
import OwnerHome from '../pages/owner';
import ReviewerHome from '../pages/reviewer';



export function AppRoutes() {

  return (

    <Routes>

      <Route path="/" element={<Navigate to="/login" replace />} />

      <Route path="/login" element={<Login />} />



      <Route element={<AppLayout />}>

        <Route path="/owner" element={<OwnerHome />} />

        <Route path="/labeler" element={<LabelerHome />} />

        <Route path="/reviewer" element={<ReviewerHome />} />

      </Route>



      <Route path="*" element={<NotFound />} />

    </Routes>

  );

}
