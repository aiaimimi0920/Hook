@echo off
setlocal EnableExtensions
title Stop Hook

echo Stopping Hook...
taskkill /IM hook.exe /F >nul 2>nul
exit /b 0
