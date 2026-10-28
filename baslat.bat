@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-local.ps1" %*
set "GES_EXIT=%ERRORLEVEL%"
if not "%GES_EXIT%"=="0" pause
exit /b %GES_EXIT%
