import React, { useContext } from "react";
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { BrowserRouter, Navigate, Routes, Route,Outlet } from 'react-router-dom';

import MainLayout, { MenuAccessContext } from "./components/layout/MainLayout";
import LoginPage from "./components/auth/LoginPage";
import HomePage from "./pages/HomePage";

import UserPage from "./pages/UserPage" 
import User from "./pages/User";
import UserMenu from "./pages/UserMenu";
import UserAuthPage from "./pages/UserAuthPage" 
import DepartmentPage from "./pages/DepartmentPage";
import DepartmentAuthPage from "./pages/DepartmentAuthPage";
import CustomerPage from "./pages/CustomerPage";
import CodeMasterPage from "./pages/CodeMasterPage";
import ItemMaster from "./pages/ItemMasterPage";
import InboundRegisterPage from "./pages/InboundRegisterPage";
import InboundSearchPage from "./pages/InboundSearchPage";
import PurchasePage from "./pages/PurchasePage";
import OutboundRegisterPage from "./pages/OutboundRegisterPage";
import OutboundSearchPage from "./pages/OutboundSearchPage";
import StockStandPage from "./pages/StockStandPage";
import CurrentStockPage from "./pages/CurrentStockPage";
import IniopStockPage from "./pages/IniopStockPage";
import AIOrderPage from "./pages/AIOrderPage";
import AIProcessingStandards from "./pages/AIProcessingStandards";
import AIOrderOptimization from "./pages/AIOrderOptimization";
import AIOrderManage from "./pages/AIOrderManage";
import CustomerSupport from "./pages/CustomerSupport";
import AIOrderConfirmPage from "./pages/AIOrderConfirmPage";
import Company from "./pages/Company";


// Mantine 기본 스타일 
import '@mantine/core/styles.css';

const RequireAuthority = ({ allowed, children }) => {
  const access = useContext(MenuAccessContext);
  if (!access.loaded) return null;
  const authority = String(access.authority || 'USER').toUpperCase();
  const companyid = String(access.companyid || '');
  const isAllowed = allowed.includes(authority) && (authority !== 'MASTER' || companyid === '001');
  return isAllowed ? children : <Navigate to={access.fallbackPath || '/login'} replace />;
};

const RequireMenuAccess = ({ menuid, children }) => {
  const access = useContext(MenuAccessContext);
  if (!access.loaded) return null;
  if ((access.companyid === '001' && access.authority === 'MASTER') || access.menuids.includes(menuid)) return children;
  return <Navigate to={access.fallbackPath || '/login'} replace />;
};

const menuPage = (menuid, element) => <RequireMenuAccess menuid={menuid}>{element}</RequireMenuAccess>;

function App() {
  return (
    <MantineProvider defaultColorScheme="light">
      <ModalsProvider>
      <BrowserRouter>
        <Routes>
          {/* 로그인 페이지 */}
          <Route path="/" element={<LoginPage />} />
          <Route path="/login" element={<LoginPage />} />

          {/* 메인 페이지 */}
         <Route element={
            <MainLayout>
              <Outlet /> 
            </MainLayout>
          }>
          <Route path="/HomePage" element={menuPage('HOME', <HomePage />)} />

  
          <Route path="/UserPage" element={<RequireAuthority allowed={['MASTER']}><UserPage /></RequireAuthority>} />
          <Route path="/User" element={<RequireAuthority allowed={['MASTER', 'SUBMASTER']}><User /></RequireAuthority>} />
          <Route path="/UserMenu" element={<RequireAuthority allowed={['MASTER', 'SUBMASTER']}><UserMenu /></RequireAuthority>} />
          <Route path="/UserAuthPage" element={<RequireAuthority allowed={['MASTER']}><UserAuthPage /></RequireAuthority>} />
          <Route path="/CustomerPage" element={menuPage('DATA_CUSTOMER', <CustomerPage />)} />
          <Route path="/CustomPage" element={menuPage('DATA_CUSTOMER', <CustomerPage />)} />
          <Route path="/CodeMasterPage" element={menuPage('DATA_CODE', <CodeMasterPage />)} />
          <Route path="/ItemMasterPage" element={menuPage('DATA_ITEM', <ItemMaster />)} />
          <Route path="/InboundRegisterPage" element={menuPage('INBOUND_REGISTER', <InboundRegisterPage />)} />
          <Route path="/InboundSearchPage" element={menuPage('INBOUND_SEARCH', <InboundSearchPage />)} />
          <Route path="/PurchasePage" element={menuPage('INBOUND_REGISTER', <PurchasePage />)} />
          <Route path="/OutboundRegisterPage" element={menuPage('OUTBOUND_REGISTER', <OutboundRegisterPage />)} />
          <Route path="/OutboundSearchPage" element={menuPage('OUTBOUND_SEARCH', <OutboundSearchPage />)} />
          <Route path="/StockStandPage" element={menuPage('STOCK_INITIAL', <StockStandPage />)} />
          <Route path="/CurrentStockPage" element={menuPage('STOCK_CURRENT', <CurrentStockPage />)} />
          <Route path="/IniopStockPage" element={menuPage('STOCK_HISTORY', <IniopStockPage />)} />
          <Route path="/AIOrderPage" element={menuPage('AI_ORDER_RECOGNITION', <AIOrderPage />)} />
          <Route path="/AIOrderOptimization" element={menuPage('AI_OPTIMIZATION', <AIOrderOptimization />)} />
          <Route path="/AIProcessingStandards" element={menuPage('AI_STANDARDS', <AIProcessingStandards />)} />
          <Route path="/AIOrderManage" element={menuPage('AI_ORDER_MANAGEMENT', <AIOrderManage />)} />
          <Route path="/CustomerSupport" element={<RequireAuthority allowed={['MASTER']}><CustomerSupport /></RequireAuthority>} />
          <Route path="/AIOrderConfirmPage" element={menuPage('AI_ORDER_MANAGEMENT', <AIOrderConfirmPage />)} />
          <Route path="/Company" element={<RequireAuthority allowed={['MASTER']}><Company /></RequireAuthority>} />

          </Route>
        </Routes>
      </BrowserRouter>
      </ModalsProvider>
    </MantineProvider>
  );
}

export default App;
