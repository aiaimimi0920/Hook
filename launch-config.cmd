@echo off

if not defined HOOK_STARTUP_MODE set "HOOK_STARTUP_MODE=silent"
if not defined HOOK_INITIAL_UI_MODE set "HOOK_INITIAL_UI_MODE=overlay"
if not defined HOOK_ENABLE_LOOM_HOOK set "HOOK_ENABLE_LOOM_HOOK=0"
if not defined LOOM_HOOK_WS_URL set "LOOM_HOOK_WS_URL=ws://127.0.0.1:19820"

if exist "%~dp0hook.exe" (
    set "HOOK_PORTABLE_DIR=%~dp0"
) else (
    set "HOOK_PORTABLE_DIR=%~dp0dist\desktop\Hook"
)

set "HOOK_EXE=%HOOK_PORTABLE_DIR%\hook.exe"
if not defined HOOK_LOG_DIR set "HOOK_LOG_DIR=%LOCALAPPDATA%\Hook\logs"
