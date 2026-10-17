import React from "react";
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { BrowserRouter, Routes, Route,Outlet } from 'react-router-dom';

import MainLayout from "./components/layout/MainLayout";
import LoginPage from "./components/auth/LoginPage";
import HomePage from "./pages/HomePage";

import UserPage from "./pages/UserPage" 
import UserAuthPage from "./pages/UserAuthPage" 
import DepartmentPage from "./pages/DepartmentPage";
import DepartmentAuthPage from "./pages/DepartmentAuthPage";
import CustomerPage from "./pages/CustomerPage";
import CodeMasterPage from "./pages/CodeMasterPage";
import ItemMaster from "./pages/ItemMasterPage";
import InboundRegisterPage from "./pages/InboundRegisterPage";
import InboundSearchPage from "./pages/InboundSearchPage";
import OutboundRegisterPage from "./pages/OutboundRegisterPage";
import OutboundSearchPage from "./pages/OutboundSearchPage";
import StockStandPage from "./pages/StockStandPage";


// Mantine 기본 스타일 
import '@mantine/core/styles.css';

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
          <Route path="/UserAuthPage" element={<UserAuthPage />} />
          <Route path="/CustomerPage" element={<CustomerPage />} />
          <Route path="/CustomPage" element={<CustomerPage />} />
          <Route path="/CodeMasterPage" element={<CodeMasterPage />} />
          <Route path="/ItemMasterPage" element={<ItemMaster />} />
          <Route path="/InboundRegisterPage" element={<InboundRegisterPage />} />
          <Route path="/InboundSearchPage" element={<InboundSearchPage />} />
          <Route path="/OutboundRegisterPage" element={<OutboundRegisterPage />} />
          <Route path="/OutboundSearchPage" element={<OutboundSearchPage />} />
          <Route path="/StockStandPage" element={<StockStandPage />} />

          </Route>
        </Routes>
      </BrowserRouter>
      </ModalsProvider>
    </MantineProvider>
  );
}

export default App;
