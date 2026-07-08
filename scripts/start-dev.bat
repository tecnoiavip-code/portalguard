@echo off
setlocal
cd /d "%~dp0.."

start "" cmd /c "for /L %%i in (1,1,30) do (timeout /t 2 /nobreak >nul && curl -I -s http://127.0.0.1:5173 >nul 2>&1 && start \"\" http://127.0.0.1:5173 && exit)"

echo Iniciando PortalGuard...
npm run dev -- --host 0.0.0.0
