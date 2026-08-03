[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$HookExe,
    [ValidateRange(10, 86400)]
    [int]$DurationSeconds = 60,
    [ValidateRange(0, 3600)]
    [int]$WarmupSeconds = 10,
    [ValidateRange(100, 60000)]
    [int]$SampleIntervalMs = 1000,
    [ValidateRange(1, 65536)]
    [int]$MaxPrivateGrowthMb = 128,
    [ValidateRange(0, 1000)]
    [double]$MaxPrivateGrowthPercent = 20,
    [ValidateRange(0, 1000000)]
    [int]$MaxCriticalOverflows = 0,
    [ValidateRange(0, 1)]
    [double]$MaxDragLongFrameRatio = 0.10,
    [switch]$RequireDragSamples,
    [string]$OutputPath = "artifacts\runtime-performance\hook-runtime-soak.json"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$resolvedExe = [System.IO.Path]::GetFullPath($HookExe)
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
if (-not (Test-Path -LiteralPath $resolvedExe -PathType Leaf)) {
    throw "Hook runtime soak executable does not exist: $resolvedExe"
}
if ($WarmupSeconds -ge $DurationSeconds) {
    throw "WarmupSeconds must be smaller than DurationSeconds."
}

$runId = [System.Guid]::NewGuid().ToString("N")
$tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$appDataDir = Join-Path $tempRoot "hook-runtime-soak-$runId-appdata"
$logDir = Join-Path $tempRoot "hook-runtime-soak-$runId-logs"
$runtimeLog = Join-Path $logDir "hook-runtime.log"
$outputDir = Split-Path -Parent $resolvedOutput
New-Item -ItemType Directory -Path $appDataDir -Force | Out-Null
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null

$previousAppData = [Environment]::GetEnvironmentVariable("HOOK_APPDATA_DIR")
$previousLogDir = [Environment]::GetEnvironmentVariable("HOOK_LOG_DIR")
$process = $null
$samples = [System.Collections.Generic.List[object]]::new()

try {
    $env:HOOK_APPDATA_DIR = $appDataDir
    $env:HOOK_LOG_DIR = $logDir
    $process = Start-Process -FilePath $resolvedExe -WindowStyle Hidden -PassThru
    Start-Sleep -Milliseconds 1500
    if ($process.HasExited) {
        throw "Hook exited before the runtime soak started. Close any existing Hook instance and retry."
    }

    $startedAt = [DateTimeOffset]::UtcNow
    while (([DateTimeOffset]::UtcNow - $startedAt).TotalSeconds -lt $DurationSeconds) {
        $process.Refresh()
        if ($process.HasExited) {
            throw "Hook exited during the runtime soak with code $($process.ExitCode)."
        }
        $elapsedSeconds = ([DateTimeOffset]::UtcNow - $startedAt).TotalSeconds
        $samples.Add([pscustomobject][ordered]@{
            elapsedSeconds = [Math]::Round($elapsedSeconds, 3)
            workingSetBytes = [int64]$process.WorkingSet64
            privateBytes = [int64]$process.PrivateMemorySize64
        })
        Start-Sleep -Milliseconds $SampleIntervalMs
    }

    $postWarmup = @($samples | Where-Object { $_.elapsedSeconds -ge $WarmupSeconds })
    if ($postWarmup.Count -lt 2) {
        throw "Runtime soak did not collect enough post-warmup samples."
    }
    $baselinePrivate = [int64]$postWarmup[0].privateBytes
    $finalPrivate = [int64]$postWarmup[-1].privateBytes
    $peakPrivate = [int64](($postWarmup | Measure-Object -Property privateBytes -Maximum).Maximum)
    $privateGrowth = [Math]::Max(0, $finalPrivate - $baselinePrivate)
    $privateGrowthPercent = if ($baselinePrivate -gt 0) {
        ($privateGrowth / $baselinePrivate) * 100
    } else {
        0
    }

    $logText = if (Test-Path -LiteralPath $runtimeLog -PathType Leaf) {
        Get-Content -LiteralPath $runtimeLog -Raw
    } else {
        ""
    }
    $criticalOverflowValues = @(
        [regex]::Matches($logText, 'critical_overflows=(\d+)') |
            ForEach-Object { [int]$_.Groups[1].Value }
    )
    $maxCriticalOverflow = if ($criticalOverflowValues.Count -gt 0) {
        ($criticalOverflowValues | Measure-Object -Maximum).Maximum
    } else {
        0
    }
    $queueMaxDepthValues = @(
        [regex]::Matches($logText, 'capture_mouse_queue ::[^\r\n]*max_depth=(\d+)') |
            ForEach-Object { [int]$_.Groups[1].Value }
    )
    $maxQueueDepth = if ($queueMaxDepthValues.Count -gt 0) {
        ($queueMaxDepthValues | Measure-Object -Maximum).Maximum
    } else {
        0
    }
    $dragMatches = [regex]::Matches(
        $logText,
        'sticker-drag-performance ::[^\r\n]*frames=(\d+)[^\r\n]*longFrames=(\d+)'
    )
    $dragFrames = 0
    $dragLongFrames = 0
    foreach ($match in $dragMatches) {
        $dragFrames += [int]$match.Groups[1].Value
        $dragLongFrames += [int]$match.Groups[2].Value
    }
    $dragLongFrameRatio = if ($dragFrames -gt 0) { $dragLongFrames / $dragFrames } else { 0 }

    $violations = [System.Collections.Generic.List[string]]::new()
    if ($privateGrowth -gt ($MaxPrivateGrowthMb * 1MB)) {
        $violations.Add("private memory growth exceeded ${MaxPrivateGrowthMb}MB")
    }
    if ($privateGrowthPercent -gt $MaxPrivateGrowthPercent) {
        $violations.Add("private memory growth exceeded $MaxPrivateGrowthPercent percent")
    }
    if ($maxCriticalOverflow -gt $MaxCriticalOverflows) {
        $violations.Add("capture queue critical overflows exceeded $MaxCriticalOverflows")
    }
    if ($dragFrames -gt 0 -and $dragLongFrameRatio -gt $MaxDragLongFrameRatio) {
        $violations.Add("drag long-frame ratio exceeded $MaxDragLongFrameRatio")
    }
    if ($RequireDragSamples -and $dragFrames -eq 0) {
        $violations.Add("no drag performance samples were recorded")
    }

    $report = [ordered]@{
        schemaVersion = 1
        executable = $resolvedExe
        durationSeconds = $DurationSeconds
        warmupSeconds = $WarmupSeconds
        sampleCount = $samples.Count
        memory = [ordered]@{
            baselinePrivateBytes = $baselinePrivate
            finalPrivateBytes = $finalPrivate
            peakPrivateBytes = $peakPrivate
            growthBytes = [int64]$privateGrowth
            growthPercent = [Math]::Round($privateGrowthPercent, 3)
        }
        queue = [ordered]@{
            maxDepth = [int]$maxQueueDepth
            maxCriticalOverflows = [int]$maxCriticalOverflow
        }
        drag = [ordered]@{
            samples = $dragMatches.Count
            frames = $dragFrames
            longFrames = $dragLongFrames
            longFrameRatio = [Math]::Round($dragLongFrameRatio, 5)
        }
        thresholds = [ordered]@{
            maxPrivateGrowthMb = $MaxPrivateGrowthMb
            maxPrivateGrowthPercent = $MaxPrivateGrowthPercent
            maxCriticalOverflows = $MaxCriticalOverflows
            maxDragLongFrameRatio = $MaxDragLongFrameRatio
            requireDragSamples = $RequireDragSamples.IsPresent
        }
        passed = ($violations.Count -eq 0)
        violations = @($violations)
        samples = @($samples)
    }
    $utf8 = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText(
        $resolvedOutput,
        ($report | ConvertTo-Json -Depth 8) + "`n",
        $utf8
    )

    if ($violations.Count -gt 0) {
        throw "Hook runtime soak failed: $($violations -join '; ')"
    }
    Write-Host "[hook-runtime-soak] Passed: $resolvedOutput"
}
finally {
    if ($null -ne $process -and -not $process.HasExited) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        $process.WaitForExit(5000) | Out-Null
    }
    if ($null -eq $previousAppData) {
        Remove-Item Env:HOOK_APPDATA_DIR -ErrorAction SilentlyContinue
    } else {
        $env:HOOK_APPDATA_DIR = $previousAppData
    }
    if ($null -eq $previousLogDir) {
        Remove-Item Env:HOOK_LOG_DIR -ErrorAction SilentlyContinue
    } else {
        $env:HOOK_LOG_DIR = $previousLogDir
    }
    foreach ($path in @($appDataDir, $logDir)) {
        $resolvedPath = [System.IO.Path]::GetFullPath($path)
        if ($resolvedPath.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
            Remove-Item -LiteralPath $resolvedPath -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}
