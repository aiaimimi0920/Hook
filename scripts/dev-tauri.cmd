@echo off
setlocal

pushd "%~dp0.."
if errorlevel 1 exit /b %errorlevel%

if not exist ".output\\public\\index.html" (
  echo [Hook dev-tauri] Missing .output/public/index.html
  echo [Hook dev-tauri] Run npm run build once before starting tauri dev.
  exit /b 1
)

echo [Hook dev-tauri] Serving .output/public on http://localhost:1420
call node scripts\serve-static.mjs --port 1420 --root .output/public

set EXIT_CODE=%ERRORLEVEL%

popd
exit /b %EXIT_CODE%
