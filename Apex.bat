@echo off
REM Apex desktop launcher
REM Double-click this file to install dependencies (first run only) and
REM launch Apex as a native desktop application via Electron.

cd /d "%~dp0"

if not exist "node_modules" (
    echo Installing Apex dependencies, please wait...
    call npm install
)
if not exist "client\node_modules" (
    call npm install --prefix client
)
if not exist "server\node_modules" (
    call npm install --prefix server
)

echo Starting Apex...
call npm run electron
