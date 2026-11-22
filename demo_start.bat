@echo off
setlocal
set "ROOT=%~dp0"
title MOSCO 시연 서버 시작

echo.
echo [1/4] 기존 시연 서버/터널 종료
call "%ROOT%demo_stop.bat" quiet

echo.
echo [2/4] 최신 코드로 빌드
cd /d "%ROOT%frontend"
call npm run build
if errorlevel 1 goto fail
cd /d "%ROOT%public-site-react"
call npm run build
if errorlevel 1 goto fail

echo.
echo [3/4] 서버 실행 (새 창 3개가 뜹니다. 시연 중에는 닫지 마세요)
start "MOSCO 백엔드 :8000" /d "%ROOT%backend" cmd /k python -m uvicorn main:app --host 127.0.0.1 --port 8000
start "MOSCO ERP :4173" /d "%ROOT%frontend" cmd /k npx vite preview --host 0.0.0.0 --port 4173 --strictPort
start "MOSCO 홈페이지 :4174" /d "%ROOT%public-site-react" cmd /k npx vite preview --host 0.0.0.0 --port 4174 --strictPort

echo.
echo [4/4] Cloudflare 외부 접속 주소 발급 (최소화된 cloudflared 창 2개도 닫지 마세요)
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%demo_tunnel.ps1"
if errorlevel 1 goto fail

echo.
echo  이 창은 닫아도 됩니다. 종료할 때는 demo_stop.bat 실행.
pause
exit /b 0

:fail
echo.
echo [오류] 위 메시지를 확인하세요.
pause
exit /b 1
