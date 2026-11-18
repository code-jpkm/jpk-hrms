@echo off
title JPK attendance relay - keep this window open
rem ---------------------------------------------------------------
rem  Put your HRMS server address here (the API address, not the
rem  website). Example: https://jpk-hrms-api.onrender.com
rem ---------------------------------------------------------------
set APP_URL=https://YOUR-HRMS.onrender.com

cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed on this computer.
  echo   Install the LTS version from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)
node attendance-relay.js
pause
