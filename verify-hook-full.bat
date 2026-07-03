@echo off
setlocal

pushd "%~dp0" || goto :fail

echo ==========================================
echo Verifying Hook full local gate
echo ==========================================

echo [1/4] npm run typecheck
call npm run typecheck || goto :fail

echo [2/4] npm test
call npm test || goto :fail

echo [3/4] npm run build
call npm run build || goto :fail

echo [4/4] build-hook-release.bat
call build-hook-release.bat || goto :fail

echo ==========================================
echo Hook full verification passed.
echo ==========================================
popd
exit /b 0

:fail
echo.
echo Hook full verification failed.
if "%CD%" neq "%~dp0" popd
exit /b 1
