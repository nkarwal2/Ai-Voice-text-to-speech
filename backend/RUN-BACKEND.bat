@echo off
cd /d "%~dp0"
echo Starting backend (avoid npm to prevent EPERM on Ctrl+C)...
node server.js
pause
