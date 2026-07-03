@echo off
setlocal

pushd "%~dp0.."
if errorlevel 1 exit /b %errorlevel%

node node_modules\vinxi\bin\cli.mjs %*
set EXIT_CODE=%ERRORLEVEL%

popd
exit /b %EXIT_CODE%
