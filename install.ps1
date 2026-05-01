param(
    [string]$Repo = "Rogn/copilot-cli-work-overview",
    [string]$Ref = "master",
    [string]$SourcePath = "",
    [string]$InstallRoot = ""
)

$ErrorActionPreference = "Stop"

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("work-overview-install-" + [System.Guid]::NewGuid())
$zipPath = Join-Path $tempRoot "repo.zip"
$extractRoot = Join-Path $tempRoot "extract"
$installRoot = if ($InstallRoot) { $InstallRoot } else { Join-Path $HOME ".copilot\extensions" }
$targetDir = Join-Path $installRoot "work-overview"
$archiveUrl = "https://github.com/$Repo/archive/refs/heads/$Ref.zip"

function Sync-ExtensionTree {
    param(
        [string]$SourceDir,
        [string]$TargetDir
    )

    if (-not (Test-Path $TargetDir)) {
        New-Item -ItemType Directory -Force $TargetDir | Out-Null
    }
    else {
        Get-ChildItem -Force $TargetDir |
            Where-Object { $_.Name -ne "node_modules" } |
            ForEach-Object {
                Remove-Item -Path $_.FullName -Recurse -Force -ErrorAction Stop
            }
    }

    $copyOutput = & robocopy $SourceDir $TargetDir /MIR /XD node_modules /NFL /NDL /NJH /NJS /NP
    $exitCode = $LASTEXITCODE
    if ($exitCode -ge 8) {
        throw "robocopy failed with exit code $exitCode"
    }
    $global:LASTEXITCODE = 0
}

try {
    New-Item -ItemType Directory -Force $tempRoot, $extractRoot, $installRoot | Out-Null

    if ($SourcePath) {
        $sourceDir = Join-Path (Resolve-Path $SourcePath).Path ".github\extensions\work-overview"
    }
    else {
        Write-Host "Downloading $archiveUrl"
        Invoke-WebRequest -Uri $archiveUrl -OutFile $zipPath

        Expand-Archive -Path $zipPath -DestinationPath $extractRoot -Force

        $repoRoot = Get-ChildItem -Path $extractRoot -Directory | Select-Object -First 1
        if (-not $repoRoot) {
            throw "Could not find extracted repository root."
        }

        $sourceDir = Join-Path $repoRoot.FullName ".github\extensions\work-overview"
    }

    if (-not (Test-Path $sourceDir)) {
        throw "Extension folder missing: $sourceDir"
    }

    try {
        Sync-ExtensionTree -SourceDir $sourceDir -TargetDir $targetDir
    }
    catch {
        Write-Host ""
        Write-Host "ERROR: Cannot update the existing install — files are locked." -ForegroundColor Red
        Write-Host "A running Copilot CLI session can keep native modules like better_sqlite3.node loaded on Windows." -ForegroundColor Yellow
        Write-Host "This installer preserves node_modules during updates, but some runtime files are still locked." -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Fix: close Work Overview and reload or exit Copilot CLI, then re-run this script." -ForegroundColor Yellow
        Write-Host ""
        throw "Install aborted: $($_.Exception.Message)"
    }

    Write-Host "Installed Work Overview to $targetDir"
    Write-Host ""
    Write-Host "Next steps:"
    Write-Host "  1. Already in Copilot CLI?"
    Write-Host "     Reload extensions so dependency changes can be reconciled, then run /work-overview."
    Write-Host "  2. Starting fresh?"
    Write-Host "     Run: copilot --experimental"
    Write-Host "     Then: /work-overview"
}
finally {
    if (Test-Path $tempRoot) {
        Remove-Item -Path $tempRoot -Recurse -Force
    }
}
