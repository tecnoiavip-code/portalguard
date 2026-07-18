@echo off
setlocal
cd /d "%~dp0.."

echo ==================================================
echo    PortalGuard - Banco Local (PC)
echo ==================================================
echo.
echo Iniciando... O Docker Desktop precisa estar aberto.
echo.

start "" cmd /c "for /L %%i in (1,1,60) do (timeout /t 2 /nobreak >nul && curl -s http://127.0.0.1:8080 >nul 2>&1 && start "" http://127.0.0.1:8080 && exit)"

npm run dev:local
