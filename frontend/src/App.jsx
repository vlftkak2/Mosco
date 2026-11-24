import { lazy, useContext } from "react";
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { BrowserRouter, Navigate, Routes, Route,Outlet } from 'react-router-dom';

import MainLayout, { MenuAccessContext } from "./components/layout/MainLayout";
import LoginPage from "./components/auth/LoginPage";
// 화면 CSS (Mantine 기본 스타일보다 먼저 — 순서 이유는 pageStyles.js 참고)
import pageStyleModules from './pageStyles';

// Mantine 기본 스타일 
import '@mantine/core/styles.css';

// 화면은 처음 열 때 내려받는다 (탭 보관 · Suspense 는 MainLayout 의 KeepAlivePage)
const HomePage = lazy(() => import("./pages/dashboard/HomePage"));

const User = lazy(() => import("./pages/system/User"));
const UserMenu = lazy(() => import("./pages/system/UserMenu"));
const CustomerPage = lazy(() => import("./pages/masterdata/CustomerPage"));
const CodeMasterPage = lazy(() => import("./pages/masterdata/CodeMasterPage"));
const ItemMaster = lazy(() => import("./pages/masterdata/ItemMasterPage"));
const ItemProcessMaster = lazy(() => import("./pages/process/ItemProcessMaster"));
const ItemProcessRegister = lazy(() => import("./pages/process/ItemProcessRegister"));
const ItemProcessSearch = lazy(() => import("./pages/process/ItemProcessSearch"));
const InboundRegisterPage = lazy(() => import("./pages/inbound/InboundRegisterPage"));
const InboundSearchPage = lazy(() => import("./pages/inbound/InboundSearchPage"));
const OutboundRegisterPage = lazy(() => import("./pages/outbound/OutboundRegisterPage"));
const OutboundSearchPage = lazy(() => import("./pages/outbound/OutboundSearchPage"));
const StockStandPage = lazy(() => import("./pages/inventory/StockStandPage"));
const CurrentStockPage = lazy(() => import("./pages/inventory/CurrentStockPage"));
const SharedStock = lazy(() => import("./pages/inventory/SharedStock"));
const IniopStockPage = lazy(() => import("./pages/inventory/IniopStockPage"));
const AIOrderPage = lazy(() => import("./pages/ai/AIOrderPage"));
const AIOrderOptimization = lazy(() => import("./pages/ai/AIOrderOptimization"));
const AIOrderManage = lazy(() => import("./pages/ai/AIOrderManage"));
const Board = lazy(() => import("./pages/system/Board"));
const Company = lazy(() => import("./pages/system/Company"));
const LicenseRevenue = lazy(() => import("./pages/system/LicenseRevenue"));
const Workplace = lazy(() => import("./pages/system/Workplace"));
const MonthClose = lazy(() => import("./pages/system/MonthClose"));
const ControlManagement = lazy(() => import("./pages/system/ControlManagement"));
const UserInfo = lazy(() => import("./pages/system/UserInfo"));
const InoutmoveRegister = lazy(() => import("./pages/inoutmove/InoutmoveRegister"));
const InoutmoveSearch = lazy(() => import("./pages/inoutmove/inoutmoveSearch"));
const ReceiptPayment = lazy(() => import("./pages/receiptpayment/ReceiptPayment"));
const ReceiptPaymentSearch = lazy(() => import("./pages/receiptpayment/ReceiptPaymentSearch"));
const InstrumentStatus = lazy(() => import("./pages/receiptpayment/InstrumentStatus"));
const CustomerLedger = lazy(() => import("./pages/receiptpayment/CustomerLedger"));
const CustomerBalanceDashboard = lazy(() => import("./pages/receiptpayment/CustomerBalanceDashboard"));
const GrossProfit = lazy(() => import("./pages/outbound/GrossProfit"));
const GrossProfitDashboard = lazy(() => import("./pages/outbound/GrossProfitDashboard"));


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

// 타사 재고현황: 플랫폼 운영사(001 · 모스코) 계정만 (서버 require_platform_company 와 같은 규칙)
const RequirePlatformCompany = ({ children }) => {
  const access = useContext(MenuAccessContext);
  if (!access.loaded) return null;
  return access.companyid === '001' ? children : <Navigate to={access.fallbackPath || '/login'} replace />;
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
          <Route path="/SharedStock" element={<RequirePlatformCompany><SharedStock /></RequirePlatformCompany>} />
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
          <Route path="/CustomerSupport" element={menuPage('CUSTOMER_SUPPORT', <Board />)} />
          <Route path="/Board" element={menuPage('CUSTOMER_SUPPORT', <Board />)} />
          <Route path="/Workplace" element={menuPage('WORKPLACE_MANAGEMENT', <Workplace />)} />
          <Route path="/MonthClose" element={menuPage('MONTH_CLOSING', <MonthClose />)} />
          {/* 통제관리: 고객사에 승인 통제가 허용된 경우 (화면이 직접 확인) */}
          <Route path="/ControlManagement" element={<ControlManagement />} />
          <Route path="/UserInfo" element={<RequireUserManagement><UserInfo /></RequireUserManagement>} />
          <Route path="/Company" element={<RequireAuthority allowed={['MASTER']}><Company /></RequireAuthority>} />
          <Route path="/LicenseRevenue" element={<RequireAuthority allowed={['MASTER']}><LicenseRevenue /></RequireAuthority>} />

          </Route>
        </Routes>
      </BrowserRouter>
      </ModalsProvider>
    </MantineProvider>
  );
}

// 화면 CSS 가 번들 앞쪽(Mantine 앞)에 남도록 붙잡아 둔다 (pageStyles.js 참고)
App.pageStyleModules = pageStyleModules;

export default App;
