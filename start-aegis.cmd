@echo off
rem Double-click to run AEGIS locally: API on :8000 and web app on :3000, in their own window.
setlocal
cd /d "%~dp0"

if not exist "backend\.venv\Scripts\python.exe" (
  echo Backend virtual environment missing. See README "Run locally" for one-time setup.
  pause
  exit /b 1
)

rem Already running? Just open it. Half running? Explain instead of failing silently.
set API_UP=0
set WEB_UP=0
netstat -ano | findstr /R /C:":8000 .*LISTENING" >nul && set API_UP=1
netstat -ano | findstr /R /C:":3000 .*LISTENING" >nul && set WEB_UP=1
if %API_UP%%WEB_UP%==11 (
  echo AEGIS is already running. Opening it...
  start "" http://localhost:3000/login
  exit /b 0
)
if %API_UP%%WEB_UP%==10 goto :busy
if %API_UP%%WEB_UP%==01 goto :busy

if not exist "node_modules" call npm install
if not exist "frontend\node_modules" call npm --prefix frontend install

start "AEGIS servers (close this window to stop)" cmd /k npm run dev

rem Wait until the API answers (up to ~60s), then open the app.
for /l %%i in (1,1,30) do (
  ping -n 3 127.0.0.1 >nul
  curl -s -o nul http://localhost:8000/health && goto :open
)
echo The API did not start. Check the "AEGIS servers" window for the error.
pause
exit /b 1

:open
ping -n 5 127.0.0.1 >nul
start "" http://localhost:3000/login
exit /b 0

:busy
echo Only part of AEGIS is running (API port 8000 in use: %API_UP%, web port 3000 in use: %WEB_UP%).
echo Close any old AEGIS / uvicorn / "npm run dev" windows, then run this again.
pause
exit /b 1
