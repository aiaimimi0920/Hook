# The launcher is an explicit, process-local opt-in; the standalone EXE stays off by default.
function Write-HookLoomLauncher {
    param([Parameter(Mandatory = $true)][string]$HookExe)

    $exe = Get-Item -LiteralPath $HookExe -ErrorAction Stop
    if ($exe.PSIsContainer -or $exe.Name -notmatch '^hook(?:-[0-9-]+)?\.exe$') {
        throw 'Expected a packaged Hook executable with a safe file name.'
    }
    $launcher = Join-Path $exe.DirectoryName ($exe.BaseName + '-with-loom.cmd')
    if (Test-Path -LiteralPath $launcher) {
        throw "Refusing to overwrite an existing Loom launcher: $launcher"
    }
    $content = @(
        '@echo off',
        'setlocal',
        'set "HOOK_ENABLE_LOOM_HOOK=1"',
        ('start "" "%~dp0' + $exe.Name + '"'),
        'endlocal',
        ''
    ) -join "`r`n"
    [IO.File]::WriteAllText($launcher, $content, [Text.UTF8Encoding]::new($false))
    return $launcher
}
