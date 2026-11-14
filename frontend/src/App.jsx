import { useContext } from "react";
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { BrowserRouter, Navigate, Routes, Route,Outlet } from 'react-router-dom';

import MainLayout, { MenuAccessContext } from "./components/layout/MainLayout";
import LoginPage from "./components/auth/LoginPage";
import HomePage from "./pages/dashboard/HomePage";

import User from "./pages/system/User";
import UserMenu from "./pages/system/UserMenu";
import CustomerPage from "./pages/masterdata/CustomerPage";
import CodeMasterPage from "./pages/masterdata/CodeMasterPage";
import ItemMaster from "./pages/masterdata/ItemMasterPage";
import ItemProcessMaster from "./pages/process/ItemProcessMaster";
import ItemProcessRegister from "./pages/process/ItemProcessRegister";
import ItemProcessSearch from "./pages/process/ItemProcessSearch";
import InboundRegisterPage from "./pages/inbound/InboundRegisterPage";
import InboundSearchPage from "./pages/inbound/InboundSearchPage";
import OutboundRegisterPage from "./pages/outbound/OutboundRegisterPage";
import OutboundSearchPage from "./pages/outbound/OutboundSearchPage";
import StockStandPage from "./pages/inventory/StockStandPage";
import CurrentStockPage from "./pages/inventory/CurrentStockPage";
import IniopStockPage from "./pages/inventory/IniopStockPage";
import AIOrderPage from "./pages/ai/AIOrderPage";
import AIOrderOptimization from "./pages/ai/AIOrderOptimization";
import AIOrderManage from "./pages/ai/AIOrderManage";
import Board from "./pages/system/Board";
import Company from "./pages/system/Company";
import Workplace from "./pages/system/Workplace";
import MonthClose from "./pages/system/MonthClose";
import UserInfo from "./pages/system/UserInfo";
import InoutmoveRegister from "./pages/inoutmove/InoutmoveRegister";
import InoutmoveSearch from "./pages/inoutmove/inoutmoveSearch";
import ReceiptPayment from "./pages/receiptpayment/ReceiptPayment";
import ReceiptPaymentSearch from "./pages/receiptpayment/ReceiptPaymentSearch";
import InstrumentStatus from "./pages/receiptpayment/InstrumentStatus";
import CustomerLedger from "./pages/receiptpayment/CustomerLedger";
import CustomerBalanceDashboard from "./pages/receiptpayment/CustomerBalanceDashboard";
import GrossProfit from "./pages/outbound/GrossProfit";
import GrossProfitDashboard from "./pages/outbound/GrossProfitDashboard";


// Mantine 기본 스타일 
import '@mantine/core/styles.css';

const RequireAuthority = ({ allowed, children }) => {
  const access = useContext(MenuAccessContext);
  if (!access.loaded) return null;
  const authority = String(access.authority || 'USER').toUpperCase();
  const companyid = String(access.companyid || '');
  // MASTER 는 001(플랫폼)에서만, SUBMASTER 는 001 이외 고객사에서만 인정한다 (서버 규칙과 같게)
  const isAllowed = allowed.includes(authority)
    && (authority !== 'MASTER' || companyid === '001')
    && (authority !== 'SUBMASTER' || companyid !== '001');
  return isAllowed ? children : <Navigate to={access.fallbackPath || '/login'} replace />;
};

const RequireMenuAccess = ({ menuid, children }) => {
  const access = useContext(MenuAccessContext);
  if (!access.loaded) return null;
  if ((access.companyid === '001' && access.authority === 'MASTER') || access.menuids.includes(menuid)) return children;
  return <Navigate to={access.fallbackPath || '/login'} replace />;
};

// 사용자관리: 고객사 관리자는 메뉴 권한 없이도 들어간다 (플랫폼 관리자는 RequireMenuAccess 에서 통과)
const RequireUserManagement = ({ children }) => {
  const access = useContext(MenuAccessContext);
  if (!access.loaded) return null;
  if (String(access.authority || '').toUpperCase() === 'SUBMASTER' && access.companyid !== '001') return children;
  return <RequireMenuAccess menuid="USER_MANAGEMENT">{children}</RequireMenuAccess>;
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

  
          <Route path="/User" element={<RequireAuthority allowed={['MASTER', 'SUBMASTER']}><User /></RequireAuthority>} />
          <Route path="/UserMenu" element={<RequireAuthority allowed={['MASTER', 'SUBMASTER']}><UserMenu /></RequireAuthority>} />
          <Route path="/CustomerPage" element={menuPage('DATA_CUSTOMER', <CustomerPage />)} />
          <Route path="/CustomPage" element={menuPage('DATA_CUSTOMER', <CustomerPage />)} />
          <Route path="/CodeMasterPage" element={menuPage('DATA_CODE', <CodeMasterPage />)} />
          <Route path="/ItemMasterPage" element={menuPage('DATA_ITEM', <ItemMaster />)} />
          <Route path="/ItemProcessMaster" element={menuPage('ITEM_PROCESS_MASTER', <ItemProcessMaster />)} />
          <Route path="/ItemProcessRegister" element={menuPage('ITEM_PROCESS_REGISTER', <ItemProcessRegister />)} />
          <Route path="/ItemProcessSearch" element={menuPage('ITEM_PROCESS_SEARCH', <ItemProcessSearch />)} />
          <Route path="/InboundRegisterPage" element={menuPage('INBOUND_REGISTER', <InboundRegisterPage />)} />
          <Route path="/InboundSearchPage" element={menuPage('INBOUND_SEARCH', <InboundSearchPage />)} />
          <Route path="/OutboundRegisterPage" element={menuPage('OUTBOUND_REGISTER', <OutboundRegisterPage />)} />
          <Route path="/OutboundSearchPage" element={menuPage('OUTBOUND_SEARCH', <OutboundSearchPage />)} />
          <Route path="/StockStandPage" element={menuPage('STOCK_INITIAL', <StockStandPage />)} />
          <Route path="/CurrentStockPage" element={menuPage('STOCK_CURRENT', <CurrentStockPage />)} />
          <Route path="/IniopStockPage" element={menuPage('STOCK_HISTORY', <IniopStockPage />)} />
          <Route path="/InoutmoveRegister" element={menuPage('INOUTMOVE_REGISTER', <InoutmoveRegister />)} />
          <Route path="/InoutmoveSearch" element={menuPage('INOUTMOVE_SEARCH', <InoutmoveSearch />)} />
          <Route path="/ReceiptPayment" element={menuPage('RECEIPT_PAYMENT', <ReceiptPayment />)} />
          <Route path="/ReceiptPaymentSearch" element={menuPage('RECEIPT_PAYMENT_SEARCH', <ReceiptPaymentSearch />)} />
          <Route path="/InstrumentStatus" element={menuPage('INSTRUMENT_STATUS', <InstrumentStatus />)} />
          <Route path="/CustomerLedger" element={menuPage('CUSTOMER_LEDGER', <CustomerLedger />)} />
          <Route path="/CustomerBalanceDashboard" element={menuPage('CUSTOMER_BALANCE_DASHBOARD', <CustomerBalanceDashboard />)} />
          <Route path="/GrossProfit" element={menuPage('GROSS_PROFIT', <GrossProfit />)} />
          <Route path="/GrossProfitDashboard" element={menuPage('GROSS_PROFIT_DASHBOARD', <GrossProfitDashboard />)} />
          <Route path="/AIOrderPage" element={menuPage('AI_ORDER_RECOGNITION', <AIOrderPage />)} />
          <Route path="/AIOrderOptimization" element={menuPage('AI_OPTIMIZATION', <AIOrderOptimization />)} />
          <Route path="/AIOrderManage" element={menuPage('AI_ORDER_MANAGEMENT', <AIOrderManage />)} />
          <Route path="/CustomerSupport" element={<Board />} />
          <Route path="/Board" element={<Board />} />
          <Route path="/Workplace" element={menuPage('WORKPLACE_MANAGEMENT', <Workplace />)} />
          <Route path="/MonthClose" element={menuPage('MONTH_CLOSING', <MonthClose />)} />
          <Route path="/UserInfo" element={<RequireUserManagement><UserInfo /></RequireUserManagement>} />
          <Route path="/Company" element={<RequireAuthority allowed={['MASTER']}><Company /></RequireAuthority>} />

          </Route>
        </Routes>
      </BrowserRouter>
      </ModalsProvider>
    </MantineProvider>
  );
}

export default App;
