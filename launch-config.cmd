@echo off

if not defined HOOK_STARTUP_MODE set "HOOK_STARTUP_MODE=silent"
if not defined HOOK_INITIAL_UI_MODE set "HOOK_INITIAL_UI_MODE=overlay"
if not defined HOOK_ENABLE_ARTLOOM set "HOOK_ENABLE_ARTLOOM=0"
if not defined HOOK_CAPTURE_BACKEND set "HOOK_CAPTURE_BACKEND=gdi"
if not defined ARTLOOM_WS_URL set "ARTLOOM_WS_URL=ws://127.0.0.1:19820"
if not defined ARTNEXUS_WAIT_FOR_ARTLOOM_SEC set "ARTNEXUS_WAIT_FOR_ARTLOOM_SEC=25"

if exist "%~dp0hook.exe" (
    set "HOOK_PORTABLE_DIR=%~dp0"
) else (
    set "HOOK_PORTABLE_DIR=%~dp0dist\desktop\Hook"
)

if exist "%~dp0artloom.exe" (
    set "ARTLOOM_PORTABLE_DIR=%~dp0"
) else (
    set "ARTLOOM_PORTABLE_DIR=%~dp0..\Loom\dist\desktop\ArtLoom"
)

set "HOOK_EXE=%HOOK_PORTABLE_DIR%\hook.exe"
if not defined HOOK_LOG_DIR set "HOOK_LOG_DIR=%LOCALAPPDATA%\Hook\logs"
set "ARTLOOM_EXE=%ARTLOOM_PORTABLE_DIR%\artloom.exe"
