import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { startAppVersionCheck } from './utils/appVersion.js'

// 필수 CSS 임포트
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';

import { MantineProvider, createTheme } from '@mantine/core';
import { Notifications } from '@mantine/notifications';

const theme = createTheme({
  primaryColor: 'red', // 비즈니스용으로 가장 신뢰감 있는 블루 선택
  fontFamily: "'Malgun Gothic', Arial, sans-serif",
});

startAppVersionCheck();

createRoot(document.getElementById('root')).render(
    <MantineProvider theme={theme}>
      <Notifications />
      <App />
    </MantineProvider>
)
