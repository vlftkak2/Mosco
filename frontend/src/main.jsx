import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { startAppVersionCheck } from './utils/appVersion.js'
import { installSessionGuard } from './utils/sessionGuard.js'

// 필수 CSS 임포트
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
// 네비게이션 · 상단 리본 글꼴 (필요한 글자만 내려받는 분할 버전)
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';

import { MantineProvider, createTheme } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
// 다크 모드 색표 (화면 CSS 의 var(--dk-…) 값). <html data-steel-theme="dark"> 일 때만 적용
import './styles/darkPalette.css';
import './styles/darkCharts.css';

const theme = createTheme({
  primaryColor: 'red', // 비즈니스용으로 가장 신뢰감 있는 블루 선택
  fontFamily: "'Malgun Gothic', Arial, sans-serif",
  // 다크일 때 Mantine 기본 부품(드롭다운 · 창 · 표 등) 색: 셸 시안 색에 맞춤 (0 글자 … 4 선 … 7 바탕)
  colors: {
    dark: ['#E4E7EB', '#AEB5C0', '#8B95A5', '#6B7585', '#363C47', '#2A2F38', '#20242B', '#1A1D23', '#111317', '#0B0D10'],
  },
});
// 라이트 / 다크는 로그인 후 화면(MainLayout)이 정한다. Mantine 이 따로 기억하지 않게 (로그인 화면은 늘 라이트)
const colorSchemeManager = {
  get: () => 'light',
  set: () => {},
  subscribe: () => {},
  unsubscribe: () => {},
  clear: () => {},
};

startAppVersionCheck();
installSessionGuard();

createRoot(document.getElementById('root')).render(
    <MantineProvider theme={theme} colorSchemeManager={colorSchemeManager} defaultColorScheme="light">
      <Notifications />
      <App />
    </MantineProvider>
)
