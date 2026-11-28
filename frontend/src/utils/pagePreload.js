// 화면 코드 미리 받기.
// App.jsx 의 lazy 화면과 같은 import 를 쓰므로, 미리 받아 두면 메뉴를 누를 때 내려받기를 기다리지 않는다.
//  - 메뉴에 마우스를 올리거나(포커스) 누르는 순간: preloadPage(path)
//  - 로그인 후 브라우저가 한가할 때: 열 수 있는 메뉴 화면을 하나씩 (preloadPagesWhenIdle)
// 한 번 받은 화면은 브라우저가 기억하므로 다시 받지 않는다.
export const pageLoaders = {
  '/HomePage': () => import('../pages/dashboard/HomePage'),
  '/User': () => import('../pages/system/User'),
  '/UserMenu': () => import('../pages/system/UserMenu'),
  '/CustomerPage': () => import('../pages/masterdata/CustomerPage'),
  '/CodeMasterPage': () => import('../pages/masterdata/CodeMasterPage'),
  '/ItemMasterPage': () => import('../pages/masterdata/ItemMasterPage'),
  '/ItemProcessMaster': () => import('../pages/process/ItemProcessMaster'),
  '/ItemProcessRegister': () => import('../pages/process/ItemProcessRegister'),
  '/ItemProcessSearch': () => import('../pages/process/ItemProcessSearch'),
  '/InboundRegisterPage': () => import('../pages/inbound/InboundRegisterPage'),
  '/InboundSearchPage': () => import('../pages/inbound/InboundSearchPage'),
  '/OutboundRegisterPage': () => import('../pages/outbound/OutboundRegisterPage'),
  '/OutboundSearchPage': () => import('../pages/outbound/OutboundSearchPage'),
  '/StockStandPage': () => import('../pages/inventory/StockStandPage'),
  '/CurrentStockPage': () => import('../pages/inventory/CurrentStockPage'),
  '/SharedStock': () => import('../pages/inventory/SharedStock'),
  '/IniopStockPage': () => import('../pages/inventory/IniopStockPage'),
  '/AIOrderPage': () => import('../pages/ai/AIOrderPage'),
  '/AIAssistant': () => import('../pages/ai/AIAssistantPage'),
  '/AIOrderOptimization': () => import('../pages/ai/AIOrderOptimization'),
  '/AIOrderManage': () => import('../pages/ai/AIOrderManage'),
  '/Board': () => import('../pages/system/Board'),
  '/Company': () => import('../pages/system/Company'),
  '/LicenseRevenue': () => import('../pages/system/LicenseRevenue'),
  '/Workplace': () => import('../pages/system/Workplace'),
  '/MonthClose': () => import('../pages/system/MonthClose'),
  '/ControlManagement': () => import('../pages/system/ControlManagement'),
  '/EApproval': () => import('../pages/eapproval/EApproval'),
  '/EApprovalForm': () => import('../pages/eapproval/EApprovalForm'),
  // 같은 화면을 메뉴별로 나눈 주소 (결재 문서 4개 · 결재설정 / 휴가설정)
  '/EApprovalDrafts': () => import('../pages/eapproval/EApproval'),
  '/EApprovalMine': () => import('../pages/eapproval/EApproval'),
  '/EApprovalInbox': () => import('../pages/eapproval/EApproval'),
  '/LeaveSetting': () => import('../pages/eapproval/EApprovalForm'),
  '/LeaveStatus': () => import('../pages/eapproval/LeaveStatus'),
  '/PayrollEntry': () => import('../pages/payroll/PayrollEntry'),
  '/PayrollLedger': () => import('../pages/payroll/PayrollLedger'),
  '/MyPayroll': () => import('../pages/payroll/MyPayroll'),
  '/AiCost': () => import('../pages/system/AiCost'),
  '/UserInfo': () => import('../pages/system/UserInfo'),
  '/InoutmoveRegister': () => import('../pages/inoutmove/InoutmoveRegister'),
  '/InoutmoveSearch': () => import('../pages/inoutmove/inoutmoveSearch'),
  '/ReceiptPayment': () => import('../pages/receiptpayment/ReceiptPayment'),
  '/ReceiptPaymentSearch': () => import('../pages/receiptpayment/ReceiptPaymentSearch'),
  '/InstrumentStatus': () => import('../pages/receiptpayment/InstrumentStatus'),
  '/CustomerLedger': () => import('../pages/receiptpayment/CustomerLedger'),
  '/CustomerBalanceDashboard': () => import('../pages/receiptpayment/CustomerBalanceDashboard'),
  '/GrossProfit': () => import('../pages/outbound/GrossProfit'),
  '/GrossProfitDashboard': () => import('../pages/outbound/GrossProfitDashboard'),
};
const aliases = { '/CustomPage': '/CustomerPage', '/CustomerSupport': '/Board' };

const requested = new Map();
const loaderFor = (path) => {
  const clean = String(path || '').split(/[?#]/)[0];
  return pageLoaders[aliases[clean] || clean];
};

// 실패(네트워크 끊김 등)하면 기록을 지워 다음에 다시 시도한다. 실제로 화면을 여는 lazy 는 따로 import 하므로 영향 없음.
export function preloadPage(path) {
  const loader = loaderFor(path);
  if (!loader) return null;
  const key = loader;
  if (!requested.has(key)) {
    const promise = loader().catch(() => { requested.delete(key); });
    requested.set(key, promise);
  }
  return requested.get(key);
}

// 열 수 있는 화면들을 한가할 때 하나씩 받는다 (앞 화면 받기가 끝나야 다음). 앞쪽 경로가 먼저.
export function preloadPagesWhenIdle(paths) {
  const queue = [...new Set(paths)].filter((path) => loaderFor(path));
  let cancelled = false;
  const idle = window.requestIdleCallback
    ? (callback) => window.requestIdleCallback(callback, { timeout: 3000 })
    : (callback) => window.setTimeout(callback, 400);
  const next = () => {
    if (cancelled || !queue.length) return;
    idle(() => {
      if (cancelled) return;
      Promise.resolve(preloadPage(queue.shift())).finally(next);
    });
  };
  next();
  return () => { cancelled = true; };
}
