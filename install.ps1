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

    if (Test-Path $targetDir) {
        try {
            Remove-Item -Path $targetDir -Recurse -Force -ErrorAction Stop
        }
        catch {
            Write-Host ""
            Write-Host "ERROR: Cannot remove existing install — files are locked." -ForegroundColor Red
            Write-Host "Close the Work Overview window (or exit Copilot CLI), then re-run this script." -ForegroundColor Yellow
            Write-Host ""
            throw "Install aborted: $($_.Exception.Message)"
        }
    }

    Copy-Item -Path $sourceDir -Destination $targetDir -Recurse -Force

    Write-Host "Installed Work Overview to $targetDir"
    Write-Host ""
    Write-Host "Next steps:"
    Write-Host "  1. Already in Copilot CLI?"
    Write-Host "     Reload extensions, then run /work-overview."
    Write-Host "  2. Starting fresh?"
    Write-Host "     Run: copilot --experimental"
    Write-Host "     Then: /work-overview"
}
finally {
    if (Test-Path $tempRoot) {
        Remove-Item -Path $tempRoot -Recurse -Force
    }
}
