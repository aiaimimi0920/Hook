Option Explicit

Dim shell, fso, processEnv
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
Set processEnv = shell.Environment("PROCESS")

Dim scriptDir
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

Dim hookExe
hookExe = fso.BuildPath(scriptDir, "hook.exe")
If Not fso.FileExists(hookExe) Then
    hookExe = fso.BuildPath(scriptDir, "dist\desktop\Hook\hook.exe")
End If

If Not fso.FileExists(hookExe) Then
    MsgBox "Missing Hook executable:" & vbCrLf & hookExe, vbExclamation, "Start Hook"
    WScript.Quit 1
End If

Call SetDefaultEnv("HOOK_STARTUP_MODE", "silent")
Call SetDefaultEnv("HOOK_INITIAL_UI_MODE", "overlay")
Call SetDefaultEnv("HOOK_ENABLE_ARTLOOM", "0")
Call SetDefaultEnv("HOOK_CAPTURE_BACKEND", "gdi")
Call SetDefaultEnv("ARTLOOM_WS_URL", "ws://127.0.0.1:19820")
Call SetDefaultEnv("ARTNEXUS_WAIT_FOR_ARTLOOM_SEC", "25")
Call SetDefaultEnv("HOOK_LOG_DIR", shell.ExpandEnvironmentStrings("%LOCALAPPDATA%\Hook\logs"))

Call EnsureFolder(processEnv.Item("HOOK_LOG_DIR"))

' Preserve the previous launcher behavior: stop any existing Hook instance so
' the newly built release can replace it cleanly without visible shell windows.
shell.Run "cmd.exe /d /c taskkill /IM hook.exe /F >nul 2>nul", 0, True
WScript.Sleep 700

shell.CurrentDirectory = fso.GetParentFolderName(hookExe)
shell.Run Quote(hookExe), 0, False

Private Sub SetDefaultEnv(ByVal key, ByVal value)
    If Trim(processEnv.Item(key)) = "" Then
        processEnv.Item(key) = value
    End If
End Sub

Private Sub EnsureFolder(ByVal path)
    If Trim(path) = "" Then
        Exit Sub
    End If

    If fso.FolderExists(path) Then
        Exit Sub
    End If

    Dim parentPath
    parentPath = fso.GetParentFolderName(path)
    If Trim(parentPath) <> "" And Not fso.FolderExists(parentPath) Then
        EnsureFolder parentPath
    End If

    If Not fso.FolderExists(path) Then
        fso.CreateFolder path
    End If
End Sub

Private Function Quote(ByVal value)
    Quote = Chr(34) & value & Chr(34)
End Function
