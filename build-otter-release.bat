@echo off
setlocal EnableExtensions
title Build Otter Release

set "HOOK_OUTPUT_DIR=%~1"
set "HOOK_FORCE=%~2"

set "ARGS="
if not "%HOOK_OUTPUT_DIR%"=="" set "ARGS=%ARGS% -OutputDir \"%HOOK_OUTPUT_DIR%\""
if /I "%HOOK_FORCE%"=="--force" set "ARGS=%ARGS% -Force"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0package-otter-release.ps1" %ARGS%
exit /b %ERRORLEVEL%
