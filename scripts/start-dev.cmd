@echo off
cd /d "%~dp0.."
start "PortalGuard Dev" cmd /k npm run dev -- --host 0.0.0.0
