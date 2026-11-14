import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import { ToastProvider } from './components/Toast';
import Home from './pages/Home';
import Company from './pages/Company';
import Erp from './pages/Erp';
import Inquiry from './pages/Inquiry';

// 예전 정적 사이트 주소(company.html 등)로 들어와도 같은 페이지로 보낸다 (#위치는 유지)
function LegacyRedirect({ to }) {
  const { hash } = useLocation();
  return <Navigate to={`${to}${hash}`} replace />;
}

export default function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="company" element={<Company />} />
          <Route path="erp" element={<Erp />} />
          <Route path="inquiry" element={<Inquiry />} />
        </Route>
        <Route path="index.html" element={<LegacyRedirect to="/" />} />
        <Route path="company.html" element={<LegacyRedirect to="/company" />} />
        <Route path="erp.html" element={<LegacyRedirect to="/erp" />} />
        <Route path="inquiry.html" element={<LegacyRedirect to="/inquiry" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ToastProvider>
  );
}
