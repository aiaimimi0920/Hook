@echo off
setlocal

pushd "%~dp0.."
if errorlevel 1 exit /b %errorlevel%

if /I "%~1"=="dev" (
  echo [Hook tauri] Preparing static frontend before tauri dev...
  call npm run build
  if errorlevel 1 goto :end
)

call node_modules\.bin\tauri.cmd %*

:end
set EXIT_CODE=%ERRORLEVEL%

popd
exit /b %EXIT_CODE%
