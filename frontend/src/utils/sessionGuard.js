import axios from 'axios';

// 서버(backend/security.py SESSION_REPLACED_MESSAGE)와 같은 문구여야 한다.
export const SESSION_REPLACED_MESSAGE = '다른 곳에서 같은 계정으로 로그인하여 접속이 종료되었습니다.';
export const LOGIN_NOTICE_KEY = 'login_notice';

const AUTH_KEYS = ['access_token', 'user_name', 'user_email', 'user_company', 'user_companyname', 'user_authority'];
let redirecting = false;

// 같은 계정으로 다른 곳에서 로그인하면 이 화면의 토큰은 401 로 거절된다.
// 어느 화면에서 요청했든 한 번만 로그아웃시키고 로그인 화면에 사유를 보여 준다.
export function installSessionGuard() {
  axios.interceptors.response.use(undefined, (error) => {
    const response = error?.response;
    if (response?.status === 401 && response.data?.detail === SESSION_REPLACED_MESSAGE && !redirecting) {
      redirecting = true;
      AUTH_KEYS.forEach((key) => localStorage.removeItem(key));
      try { sessionStorage.setItem(LOGIN_NOTICE_KEY, SESSION_REPLACED_MESSAGE); } catch { /* 저장 불가여도 이동은 한다 */ }
      window.location.assign('/login');
    }
    return Promise.reject(error);
  });
}
