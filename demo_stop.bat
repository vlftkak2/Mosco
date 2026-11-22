@echo off
rem 시연 서버(백엔드 8000, ERP 4173, 홈페이지 4174)와 cloudflared 터널 종료. 개발서버(5173/5174)와 DB는 건드리지 않음.
for %%P in (8000 4173 4174) do (
  for /f "tokens=5" %%I in ('netstat -ano ^| findstr /C:":%%P " ^| findstr LISTENING') do (
    taskkill /PID %%I /T /F >nul 2>&1 && echo  - 포트 %%P 종료 ^(PID %%I^)
  )
)
taskkill /IM cloudflared.exe /F >nul 2>&1 && echo  - cloudflared 터널 종료
if /i not "%~1"=="quiet" (
  echo 시연 서버를 종료했습니다.
  pause
)
