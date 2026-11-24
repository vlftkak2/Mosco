// 화면(페이지) CSS 를 화면 JS 보다 먼저, 예전과 같은 순서로 불러온다.
// 화면 JS 는 React.lazy 로 나눠 받지만, CSS 까지 나눠 받으면 Mantine 기본 스타일(@mantine/core/styles.css)보다 뒤에 붙어
// 같은 우선순위 규칙의 승패가 바뀐다. 그래서 CSS 는 여기서 한 번에 (Mantine 앞에) 싣는다 — App.jsx 에서 Mantine 보다 먼저 import.
// 순서를 바꾸지 말 것. 새 화면 CSS 를 추가하면 여기에도 넣어 준다 (빠뜨리면 그 화면을 처음 열 때 Mantine 뒤에 붙는다).
// CSS 모듈은 내보낸 값을 쓰지 않으면 번들에서 빠져(화면 조각으로 옮겨져) 순서가 바뀌므로, 값을 모아 App 에 매달아 둔다.
import s0 from './styles/components/ErpDateInput.module.css';
import s1 from './styles/components/DashboardKit.module.css';
import s2 from './styles/pages/InboundRegister.module.css';
import s3 from './styles/pages/ManagementShared.module.css';
import s4 from './styles/pages/SimpleTheme.module.css';
import s5 from './styles/pages/InboundSearch.module.css';
import s6 from './styles/pages/HomeDashboard.module.css';
import s7 from './styles/components/PickerModal.module.css';
import s8 from './styles/pages/User.module.css';
import s9 from './styles/pages/UserMenu.module.css';
import s10 from './styles/pages/CustomerPage.module.css';
import s11 from './styles/components/ExcelBulkActions.module.css';
import s12 from './styles/components/UseSwitch.module.css';
import s13 from './styles/pages/CodeMasterPage.module.css';
import s14 from './styles/pages/CodeMasterScreen.module.css';
import s15 from './styles/components/ConfirmDeleteModal.module.css';
import s16 from './styles/pages/ItemMaster.module.css';
import s17 from './styles/pages/OutboundRegister.module.css';
import s18 from './styles/pages/ItemMasterScreen.module.css';
import s19 from './styles/pages/ItemProcessMaster.module.css';
import s20 from './styles/pages/ItemProcessRegister.module.css';
import s21 from './styles/pages/ItemProcessSearch.module.css';
import s22 from './styles/pages/OutboundPrintDocument.module.css';
import s23 from './styles/pages/StockStand.module.css';
import s24 from './styles/pages/AIOrder.module.css';
import s25 from './styles/pages/AIOrderRegistry.module.css';
import s26 from './styles/pages/AIOrderOptimization.module.css';
import s27 from './styles/pages/AIOrderManage.module.css';
import s28 from './styles/pages/Board.module.css';
import s29 from './styles/pages/Company.module.css';
import s30 from './styles/pages/Workplace.module.css';
import s31 from './styles/pages/MonthClose.module.css';
import s32 from './styles/pages/UserInfo.module.css';
import s33 from './styles/pages/InoutmoveRegister.module.css';
import s34 from './styles/pages/ReceiptPayment.module.css';
import s35 from './styles/pages/ReceiptPaymentSearch.module.css';
import s36 from './styles/pages/InstrumentStatus.module.css';
import s37 from './styles/pages/CustomerLedger.module.css';
import s38 from './styles/pages/CustomerBalanceDashboard.module.css';
import s39 from './styles/pages/GrossProfit.module.css';
import s40 from './styles/pages/GrossProfitDashboard.module.css';
import s41 from './styles/pages/LicenseRevenue.module.css';
import s42 from './styles/pages/SharedStock.module.css';
import s43 from './styles/pages/ControlManagement.module.css';

const pageStyleModules = [s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14, s15, s16, s17, s18, s19, s20, s21, s22, s23, s24, s25, s26, s27, s28, s29, s30, s31, s32, s33, s34, s35, s36, s37, s38, s39, s40, s41, s42, s43];
export default pageStyleModules;
