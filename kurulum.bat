@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-local.ps1" %*
set "GES_EXIT_CODE=%ERRORLEVEL%"
if not "%GES_EXIT_CODE%"=="0" pause
exit /b %GES_EXIT_CODE%
