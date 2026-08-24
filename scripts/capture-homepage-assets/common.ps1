# Shared path, directory, encoding, and Playwright helpers for homepage capture.

function Resolve-HookExePath {
    param(
        [string]$RequestedPath,
        [string]$RepoRoot
    )

    if ($RequestedPath) {
        return (Resolve-Path $RequestedPath).Path
    }
    $releaseRoot = (Resolve-Path (Join-Path $RepoRoot "..\release")).Path
    $candidates = Get-ChildItem -Path $releaseRoot -Recurse -Filter "hook.exe" |
        Where-Object { $_.FullName -match "\\Hook(\\|-)" } |
        Sort-Object LastWriteTime -Descending
    if (-not $candidates) {
        throw "No hook.exe found under $releaseRoot"
    }
    return $candidates[0].FullName
}

function Ensure-Directory {
    param([string]$Path)
    New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

function Write-Utf8NoBomFile {
    param(
        [string]$Path,
        [string]$Content
    )

    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Render-DemoCards {
    param(
        [string]$RepoRoot,
        [string]$CardDir
    )

    $sourceDir = Join-Path $RepoRoot "docs\assets\homepage-demo-source"
    $nodeScript = @'
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const [sourceDir, outDir] = process.argv.slice(2);
const files = ["demo-capture.svg", "demo-sticker.svg", "demo-workflow.svg"];
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
} catch {
  browser = await chromium.launch({ headless: true });
}
try {
  const page = await browser.newPage({
    viewport: { width: 960, height: 540 },
    deviceScaleFactor: 1
  });
  for (const file of files) {
    const svgPath = path.join(sourceDir, file);
    const outputPath = path.join(outDir, file.replace(/\.svg$/i, ".png"));
    const svg = fs.readFileSync(svgPath, "utf8");
    await page.setContent(
      `<html><body style="margin:0;background:transparent;display:grid;place-items:center;min-height:100vh;">${svg}</body></html>`,
      { waitUntil: "load" }
    );
    await page.locator("svg").screenshot({ path: outputPath });
  }
} finally {
  await browser.close();
}
'@

    Push-Location $RepoRoot
    try {
        $nodeScript | & node --input-type=module - $sourceDir $CardDir
        if ($LASTEXITCODE -ne 0) {
            throw "Demo-card renderer failed with exit code $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }
}
