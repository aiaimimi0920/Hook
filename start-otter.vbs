Option Explicit

Dim shell, fso, processEnv
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
Set processEnv = shell.Environment("PROCESS")

Dim scriptDir
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

Dim otterExe
otterExe = fso.BuildPath(scriptDir, "otter.exe")
If Not fso.FileExists(otterExe) Then
    otterExe = fso.BuildPath(scriptDir, "dist\desktop\Otter\otter.exe")
End If

If Not fso.FileExists(otterExe) Then
    MsgBox "Missing Otter executable:" & vbCrLf & otterExe, vbExclamation, "Start Otter"
    WScript.Quit 1
End If

Call SetBrandDefaultEnv("OTTER_STARTUP_MODE", "HOOK_STARTUP_MODE", "silent")
Call SetBrandDefaultEnv("OTTER_INITIAL_UI_MODE", "HOOK_INITIAL_UI_MODE", "overlay")
Call SetBrandDefaultEnv("OTTER_ENABLE_LOOM_OTTER", "HOOK_ENABLE_LOOM_HOOK", "1")
Call SetBrandDefaultEnv("OTTER_LOG_DIR", "HOOK_LOG_DIR", shell.ExpandEnvironmentStrings("%LOCALAPPDATA%\Otter\logs"))

Call EnsureFolder(processEnv.Item("OTTER_LOG_DIR"))

' Preserve the previous launcher behavior: stop any existing Otter instance so
' the newly built release can replace it cleanly without visible shell windows.
shell.Run "cmd.exe /d /c taskkill /IM otter.exe /F >nul 2>nul", 0, True
WScript.Sleep 700

shell.CurrentDirectory = fso.GetParentFolderName(otterExe)
shell.Run Quote(otterExe), 0, False

Private Sub SetBrandDefaultEnv(ByVal key, ByVal legacyKey, ByVal value)
    If HasEnv(key) Then Exit Sub
    If HasEnv(legacyKey) Then
        processEnv.Item(key) = processEnv.Item(legacyKey)
    Else
        processEnv.Item(key) = value
    End If
End Sub

Private Function HasEnv(ByVal key)
    Dim entry
    HasEnv = False
    For Each entry In processEnv
        If LCase(Left(entry, Len(key) + 1)) = LCase(key & "=") Then
            HasEnv = True
            Exit Function
        End If
    Next
End Function

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
