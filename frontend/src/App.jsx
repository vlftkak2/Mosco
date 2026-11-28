import { lazy, useContext } from "react";
import { BrowserRouter, Navigate, Routes, Route,Outlet } from 'react-router-dom';

import MainLayout, { MenuAccessContext } from "./components/layout/MainLayout";
import LoginPage from "./components/auth/LoginPage";
import ErrorBoundary from "./components/common/ErrorBoundary";
// 화면 CSS (Mantine 기본 스타일보다 먼저 — 순서 이유는 pageStyles.js 참고)
import pageStyleModules from './pageStyles';

// Mantine 기본 스타일 
import '@mantine/core/styles.css';

import { pageLoaders } from './utils/pagePreload';
// 화면은 처음 열 때 내려받는다 (탭 보관 · Suspense 는 MainLayout 의 KeepAlivePage)
const HomePage = lazy(pageLoaders['/HomePage']);

const User = lazy(pageLoaders['/User']);
const UserMenu = lazy(pageLoaders['/UserMenu']);
const CustomerPage = lazy(pageLoaders['/CustomerPage']);
const CodeMasterPage = lazy(pageLoaders['/CodeMasterPage']);
const ItemMaster = lazy(pageLoaders['/ItemMasterPage']);
const ItemProcessMaster = lazy(pageLoaders['/ItemProcessMaster']);
const ItemProcessRegister = lazy(pageLoaders['/ItemProcessRegister']);
const ItemProcessSearch = lazy(pageLoaders['/ItemProcessSearch']);
const InboundRegisterPage = lazy(pageLoaders['/InboundRegisterPage']);
const InboundSearchPage = lazy(pageLoaders['/InboundSearchPage']);
const OutboundRegisterPage = lazy(pageLoaders['/OutboundRegisterPage']);
const OutboundSearchPage = lazy(pageLoaders['/OutboundSearchPage']);
const StockStandPage = lazy(pageLoaders['/StockStandPage']);
const CurrentStockPage = lazy(pageLoaders['/CurrentStockPage']);
const SharedStock = lazy(pageLoaders['/SharedStock']);
const IniopStockPage = lazy(pageLoaders['/IniopStockPage']);
const AIOrderPage = lazy(pageLoaders['/AIOrderPage']);
const AIOrderOptimization = lazy(pageLoaders['/AIOrderOptimization']);
const AIOrderManage = lazy(pageLoaders['/AIOrderManage']);
const Board = lazy(pageLoaders['/Board']);
const Company = lazy(pageLoaders['/Company']);
const LicenseRevenue = lazy(pageLoaders['/LicenseRevenue']);
const Workplace = lazy(pageLoaders['/Workplace']);
const MonthClose = lazy(pageLoaders['/MonthClose']);
const ControlManagement = lazy(pageLoaders['/ControlManagement']);
const EApproval = lazy(pageLoaders['/EApproval']);
const EApprovalForm = lazy(pageLoaders['/EApprovalForm']);
const LeaveStatus = lazy(pageLoaders['/LeaveStatus']);
const PayrollEntry = lazy(pageLoaders['/PayrollEntry']);
const PayrollLedger = lazy(pageLoaders['/PayrollLedger']);
const MyPayroll = lazy(pageLoaders['/MyPayroll']);
const AiCost = lazy(pageLoaders['/AiCost']);
const AIAssistantPage = lazy(pageLoaders['/AIAssistant']);
const UserInfo = lazy(pageLoaders['/UserInfo']);
const InoutmoveRegister = lazy(pageLoaders['/InoutmoveRegister']);
const InoutmoveSearch = lazy(pageLoaders['/InoutmoveSearch']);
const ReceiptPayment = lazy(pageLoaders['/ReceiptPayment']);
const ReceiptPaymentSearch = lazy(pageLoaders['/ReceiptPaymentSearch']);
const InstrumentStatus = lazy(pageLoaders['/InstrumentStatus']);
const CustomerLedger = lazy(pageLoaders['/CustomerLedger']);
const CustomerBalanceDashboard = lazy(pageLoaders['/CustomerBalanceDashboard']);
const GrossProfit = lazy(pageLoaders['/GrossProfit']);
const GrossProfitDashboard = lazy(pageLoaders['/GrossProfitDashboard']);


const RequireMenuAccess = ({ menuid, children }) => {
  const access = useContext(MenuAccessContext);
  if (!access.loaded) return null;
  if ((access.companyid === '001' && access.authority === 'MASTER') || access.menuids.includes(menuid)) return children;
  return <Navigate to={access.fallbackPath || '/login'} replace />;
};

// 로그인하지 않았으면(토큰 없음) 빈 화면 대신 로그인 화면으로 보낸다
const RequireAuth = ({ children }) => {
  if (!localStorage.getItem('access_token')) return <Navigate to="/login" replace />;
  return children;
};

const menuPage = (menuid, element) => <RequireMenuAccess menuid={menuid}>{element}</RequireMenuAccess>;

function App() {
  return (
    // MantineProvider(테마 · 빨강 기본색)는 main.jsx 에 하나만 둔다
    <ErrorBoundary fullPage>
      <BrowserRouter>
        <Routes>
          {/* 로그인 페이지 */}
          <Route path="/" element={<LoginPage />} />
          <Route path="/login" element={<LoginPage />} />

          {/* 메인 페이지 */}
         <Route element={
            <RequireAuth>
              <MainLayout>
                <Outlet />
              </MainLayout>
            </RequireAuth>
          }>
          <Route path="/HomePage" element={menuPage('HOME', <HomePage />)} />

  
          <Route path="/User" element={menuPage('COMPANY_USER_MANAGEMENT', <User />)} />
          <Route path="/UserMenu" element={menuPage('USER_MENU_PERMISSION', <UserMenu />)} />
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
          <Route path="/SharedStock" element={menuPage('SHARED_STOCK', <SharedStock />)} />
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
          {/* 결재 문서 메뉴 4개: 같은 화면을 메뉴별로 (권한은 전자결재 하나) */}
          <Route path="/EApproval" element={menuPage('EAPPROVAL', <EApproval box="write" />)} />
          <Route path="/EApprovalDrafts" element={menuPage('EAPPROVAL', <EApproval box="drafts" />)} />
          <Route path="/EApprovalMine" element={menuPage('EAPPROVAL', <EApproval box="mine" />)} />
          <Route path="/EApprovalInbox" element={menuPage('EAPPROVAL', <EApproval box="inbox" />)} />
          {/* 결재설정 / 휴가설정: 같은 화면을 탭 묶음별로 (권한은 결재양식관리 하나) */}
          <Route path="/EApprovalForm" element={menuPage('EAPPROVAL_FORM', <EApprovalForm screen="approval" />)} />
          <Route path="/LeaveSetting" element={menuPage('EAPPROVAL_FORM', <EApprovalForm screen="leave" />)} />
          <Route path="/LeaveStatus" element={menuPage('EAPPROVAL', <LeaveStatus />)} />
          <Route path="/PayrollEntry" element={menuPage('PAYROLL', <PayrollEntry />)} />
          <Route path="/PayrollLedger" element={menuPage('PAYROLL', <PayrollLedger />)} />
          <Route path="/MyPayroll" element={menuPage('PAYROLL_MY', <MyPayroll />)} />
          <Route path="/UserInfo" element={menuPage('USER_MANAGEMENT', <UserInfo />)} />
          <Route path="/Company" element={menuPage('COMPANY_REGISTRATION', <Company />)} />
          <Route path="/LicenseRevenue" element={menuPage('LICENSE_REVENUE', <LicenseRevenue />)} />
          <Route path="/AiCost" element={menuPage('AI_COST', <AiCost />)} />
          <Route path="/AIAssistant" element={menuPage('AI_ASSISTANT', <AIAssistantPage />)} />

          </Route>
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

// 화면 CSS 가 번들 앞쪽(Mantine 앞)에 남도록 붙잡아 둔다 (pageStyles.js 참고)
App.pageStyleModules = pageStyleModules;

export default App;
