@echo off
setlocal EnableExtensions
title Start Otter

call "%~dp0launch-config.cmd"
wscript.exe //nologo "%~dp0start-otter.vbs"
exit /b %ERRORLEVEL%
