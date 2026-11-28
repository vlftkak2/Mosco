import axios from 'axios';
import { clearAllDirty } from './dirtyRegistry';

// 서버(backend/security.py)와 같은 문구여야 한다.
export const SESSION_REPLACED_MESSAGE = '다른 곳에서 같은 계정으로 로그인하여 접속이 종료되었습니다.';
export const SESSION_ENDED_MESSAGE = '접속이 종료되었습니다. 다시 로그인해 주세요.';
export const SESSION_EXPIRED_MESSAGE = '로그인이 만료되었습니다. 다시 로그인해 주세요.';
export const LOGIN_NOTICE_KEY = 'login_notice';

export const AUTH_KEYS = ['access_token', 'user_name', 'user_email', 'user_company', 'user_companyname', 'user_authority'];
let redirecting = false;
let installed = false;

export function clearAuthStorage() {
  AUTH_KEYS.forEach((key) => { try { localStorage.removeItem(key); } catch { /* 무시 */ } });
}

// 401 이어도 로그아웃시키지 않는 요청: 로그인 시도 · 비밀번호 변경(현재 비밀번호 틀림 등은 화면이 직접 안내)
function isExcludedUrl(url) {
  const path = String(url || '').replace(/^https?:\/\/[^/]+/i, '').split('?')[0].toLowerCase();
  return path === '/api/login' || path.startsWith('/passwordapi/') || path === '/api/logout';
}

function isApiUrl(url) {
  const path = String(url || '').replace(/^https?:\/\/[^/]+/i, '').toLowerCase();
  return path.startsWith('/api/') || path.startsWith('/passwordapi/');
}

function noticeFor(detail) {
  if (detail === SESSION_REPLACED_MESSAGE || detail === SESSION_ENDED_MESSAGE) return detail;
  return SESSION_EXPIRED_MESSAGE;
}

// 토큰이 거절되면(401: 만료 · 다른 곳 로그인 · 로그아웃 · 비밀번호 변경 · 계정 중지)
// 어느 화면에서 요청했든 한 번만 로그아웃시키고 로그인 화면에 사유를 보여 준다.
export function installSessionGuard() {
  if (installed) return;
  installed = true;
  axios.interceptors.response.use(undefined, (error) => {
    const response = error?.response;
    const url = error?.config?.url;
    if (response?.status === 401 && isApiUrl(url) && !isExcludedUrl(url) && !redirecting) {
      redirecting = true;
      clearAuthStorage();
      const detail = typeof response.data?.detail === 'string' ? response.data.detail : '';
      try { sessionStorage.setItem(LOGIN_NOTICE_KEY, noticeFor(detail)); } catch { /* 저장 불가여도 이동은 한다 */ }
      clearAllDirty();   // 세션이 끝나 저장할 수 없으므로 '나가시겠습니까' 경고 없이 이동
      window.location.assign('/login');
    }
    return Promise.reject(error);
  });
}

// 로그아웃: 서버 세션도 끊는다 (응답은 기다리지 않음 · 실패해도 무시)
export function logoutOnServer() {
  const token = localStorage.getItem('access_token');
  if (!token) return;
  axios.post('/api/logout', null, { headers: { Authorization: `Bearer ${token}` } }).catch(() => { /* 무시 */ });
}
