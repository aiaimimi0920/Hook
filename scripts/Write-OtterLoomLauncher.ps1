# Compatibility launcher: the native EXE also defaults on; explicit opt-out wins.
function Write-OtterLoomLauncher {
    param([Parameter(Mandatory = $true)][string]$OtterExe)

    $exe = Get-Item -LiteralPath $OtterExe -ErrorAction Stop
    if ($exe.PSIsContainer -or $exe.Name -notmatch '^(?:otter|hook)(?:-[0-9-]+)?\.exe$') {
        throw 'Expected a packaged Otter executable with a safe file name.'
    }
    $launcher = Join-Path $exe.DirectoryName ($exe.BaseName + '-with-loom.cmd')
    if (Test-Path -LiteralPath $launcher) {
        throw "Refusing to overwrite an existing Loom launcher: $launcher"
    }
    $content = @(
        '@echo off',
        'setlocal',
        'if not defined HOOK_ENABLE_LOOM_HOOK set "HOOK_ENABLE_LOOM_HOOK=1"',
        ('start "" "%~dp0' + $exe.Name + '"'),
        'endlocal',
        ''
    ) -join "`r`n"
    [IO.File]::WriteAllText($launcher, $content, [Text.UTF8Encoding]::new($false))
    return $launcher
}
