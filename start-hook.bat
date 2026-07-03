@echo off
setlocal EnableExtensions
title Start Hook

call "%~dp0launch-config.cmd"
wscript.exe //nologo "%~dp0start-hook.vbs"
exit /b %ERRORLEVEL%
