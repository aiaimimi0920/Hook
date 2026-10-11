@echo off

if not defined OTTER_STARTUP_MODE if defined HOOK_STARTUP_MODE set "OTTER_STARTUP_MODE=%HOOK_STARTUP_MODE%"
if not defined OTTER_STARTUP_MODE set "OTTER_STARTUP_MODE=silent"
if not defined OTTER_INITIAL_UI_MODE if defined HOOK_INITIAL_UI_MODE set "OTTER_INITIAL_UI_MODE=%HOOK_INITIAL_UI_MODE%"
if not defined OTTER_INITIAL_UI_MODE set "OTTER_INITIAL_UI_MODE=overlay"
if not defined OTTER_ENABLE_LOOM_OTTER if defined HOOK_ENABLE_LOOM_HOOK set "OTTER_ENABLE_LOOM_OTTER=%HOOK_ENABLE_LOOM_HOOK%"
if not defined OTTER_ENABLE_LOOM_OTTER set "OTTER_ENABLE_LOOM_OTTER=1"

if exist "%~dp0otter.exe" (
    set "OTTER_PORTABLE_DIR=%~dp0"
) else (
    set "OTTER_PORTABLE_DIR=%~dp0dist\desktop\Otter"
)

set "OTTER_EXE=%OTTER_PORTABLE_DIR%\otter.exe"
if not defined OTTER_LOG_DIR if defined HOOK_LOG_DIR set "OTTER_LOG_DIR=%HOOK_LOG_DIR%"
if not defined OTTER_LOG_DIR set "OTTER_LOG_DIR=%LOCALAPPDATA%\Otter\logs"
