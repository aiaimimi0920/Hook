@echo off
setlocal EnableExtensions
title Start Hook Capture Test

set "HOOK_AUTOSTART_CAPTURE=1"
set "HOOK_ENABLE_ARTLOOM=0"
set "HOOK_STARTUP_MODE=silent"
set "HOOK_INITIAL_UI_MODE=overlay"

call "%~dp0start-hook.bat"
