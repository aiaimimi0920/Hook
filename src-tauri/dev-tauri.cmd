@echo off
setlocal

pushd "%~dp0.."
if errorlevel 1 exit /b %errorlevel%

call scripts\dev-tauri.cmd
set EXIT_CODE=%ERRORLEVEL%

popd
exit /b %EXIT_CODE%
