@echo off
setlocal EnableExtensions
title Stop Otter

echo Stopping Otter...
taskkill /IM otter.exe /F >nul 2>nul
exit /b 0
