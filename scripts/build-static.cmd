@echo off
setlocal

pushd "%~dp0.."
if errorlevel 1 exit /b %errorlevel%

node scripts\generate-javascript-surface-bootstrap.mjs
if errorlevel 1 goto :fail

call node_modules\.bin\vite.cmd build
if errorlevel 1 goto :fail

node scripts\clean-tauri-dist.mjs
if errorlevel 1 goto :fail

popd
exit /b 0

:fail
set EXIT_CODE=%ERRORLEVEL%
popd
exit /b %EXIT_CODE%
