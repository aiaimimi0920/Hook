@echo off
setlocal EnableExtensions
title Build Hook Release

set "HOOK_TAG=%~1"
set "HOOK_NO_ZIP=%~2"

set "ARGS="
if not "%HOOK_TAG%"=="" set "ARGS=%ARGS% -Tag %HOOK_TAG%"
if /I "%HOOK_NO_ZIP%"=="--no-zip" set "ARGS=%ARGS% -NoZip"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0package-hook-release.ps1" %ARGS%
exit /b %ERRORLEVEL%
