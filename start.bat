@echo off
title Navigator runtime
cd /d "%~dp0"
echo ============================================
echo   NAVIGATOR  -  starting runtime
echo.
echo   Dashboard:  http://localhost:4319
echo   Guide:      http://localhost:4319/learn.html
echo ============================================
echo.
echo   Keep this window OPEN to keep the server up.
echo   Close it (or press Ctrl+C) to stop.
echo.
node navigator-server.js
echo.
echo [Navigator stopped] Press any key to close...
pause >nul
