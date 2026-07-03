@echo off
setlocal

pushd "%~dp0.."
if errorlevel 1 exit /b %errorlevel%

call node_modules\.bin\vitest.cmd --pool threads --maxWorkers 1 --no-file-parallelism %*
set EXIT_CODE=%ERRORLEVEL%

popd
exit /b %EXIT_CODE%
