@echo off
setlocal

pushd "%~dp0.."
if errorlevel 1 exit /b %errorlevel%

call node scripts\serve-static.mjs %*
set EXIT_CODE=%ERRORLEVEL%

popd
exit /b %EXIT_CODE%
