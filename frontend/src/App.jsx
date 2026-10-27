import React from "react";
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { BrowserRouter, Navigate, Routes, Route,Outlet } from 'react-router-dom';

import MainLayout from "./components/layout/MainLayout";
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
  const authority = String(localStorage.getItem('user_authority') || 'USER').toUpperCase();
  return allowed.includes(authority) ? children : <Navigate to="/HomePage" replace />;
};

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
          <Route path="/HomePage" element={<HomePage />} />

  
          <Route path="/UserPage" element={<UserPage />} />
          <Route path="/User" element={<RequireAuthority allowed={['MASTER', 'SUBMASTER']}><User /></RequireAuthority>} />
          <Route path="/UserMenu" element={<UserMenu />} />
          <Route path="/UserAuthPage" element={<UserAuthPage />} />
          <Route path="/CustomerPage" element={<CustomerPage />} />
          <Route path="/CustomPage" element={<CustomerPage />} />
          <Route path="/CodeMasterPage" element={<CodeMasterPage />} />
          <Route path="/ItemMasterPage" element={<ItemMaster />} />
          <Route path="/InboundRegisterPage" element={<InboundRegisterPage />} />
          <Route path="/InboundSearchPage" element={<InboundSearchPage />} />
          <Route path="/PurchasePage" element={<PurchasePage />} />
          <Route path="/OutboundRegisterPage" element={<OutboundRegisterPage />} />
          <Route path="/OutboundSearchPage" element={<OutboundSearchPage />} />
          <Route path="/StockStandPage" element={<StockStandPage />} />
          <Route path="/CurrentStockPage" element={<CurrentStockPage />} />
          <Route path="/IniopStockPage" element={<IniopStockPage />} />
          <Route path="/AIOrderPage" element={<AIOrderPage />} />
          <Route path="/AIOrderOptimization" element={<AIOrderOptimization />} />
          <Route path="/AIProcessingStandards" element={<AIProcessingStandards />} />
          <Route path="/AIOrderManage" element={<AIOrderManage />} />
          <Route path="/CustomerSupport" element={<CustomerSupport />} />
          <Route path="/AIOrderConfirmPage" element={<AIOrderConfirmPage />} />
          <Route path="/Company" element={<Company />} />

          </Route>
        </Routes>
      </BrowserRouter>
      </ModalsProvider>
    </MantineProvider>
  );
}

export default App;
