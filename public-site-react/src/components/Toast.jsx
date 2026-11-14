import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

// 화면 아래 안내 메시지 (예: "카카오톡 채널 주소는 등록 후 연결됩니다.")
const ToastContext = createContext(() => {});

export function ToastProvider({ children }) {
  const [toast, setToast] = useState({ message: '', show: false });
  const timer = useRef();

  const notify = useCallback((message) => {
    setToast({ message, show: true });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast((t) => ({ ...t, show: false })), 3200);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div className={`toast${toast.show ? ' show' : ''}`} role="status" aria-live="polite">{toast.message}</div>
    </ToastContext.Provider>
  );
}

export const useNotify = () => useContext(ToastContext);

// 아직 연결되지 않은 링크 — 누르면 안내 메시지만 보여준다
export function PendingLink({ msg, children, ...rest }) {
  const notify = useNotify();
  return (
    <a href="#" {...rest} onClick={(e) => { e.preventDefault(); notify(msg); }}>{children}</a>
  );
}

export const SUBMIT_PENDING = '문의 접수 기능은 서버 연결 후 활성화됩니다. 급한 문의는 1600-2579로 전화해주세요.';

// 입력 확인만 하고, 서버 연결 전이라는 안내를 띄우는 폼
export function DemoForm({ children, ...rest }) {
  const notify = useNotify();
  const onSubmit = (e) => {
    e.preventDefault();
    if (!e.currentTarget.reportValidity()) return;
    notify(SUBMIT_PENDING);
  };
  return <form className="form" noValidate onSubmit={onSubmit} {...rest}>{children}</form>;
}
