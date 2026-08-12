# Builds the Windows installer and publishes it to a GitHub Release.
#
#   npm run release
#
# The release is tagged from the `version` field in package.json, so bump that first.
# Re-running for a version that already has a published release re-uploads the assets
# rather than creating a second one.

$ErrorActionPreference = "Stop"

Set-Location (Split-Path -Parent $PSScriptRoot)

$package = Get-Content package.json -Raw | ConvertFrom-Json
$version = $package.version
$builder = Get-Content electron-builder.yml -Raw
$repo = ([regex]::Match($builder, '(?m)^\s*owner:\s*(\S+)')).Groups[1].Value + "/" +
        ([regex]::Match($builder, '(?m)^\s*repo:\s*(\S+)')).Groups[1].Value

Write-Host ""
Write-Host "InfinityPlay $version -> $repo" -ForegroundColor Cyan
Write-Host ""

# electron-builder needs a token with `repo` scope to create the release and upload the
# installer. Reuse the credential Git already holds for github.com so there is nothing
# extra to configure.
if (-not $env:GH_TOKEN) {
  # The query goes through a temp file rather than a pipe: Windows PowerShell prefixes a
  # BOM onto native stdin, which makes git read the first key as garbage and reject the
  # request with "credential missing protocol field".
  $query = [System.IO.Path]::GetTempFileName()
  try {
    [System.IO.File]::WriteAllText(
      $query, "protocol=https`nhost=github.com`n`n", (New-Object System.Text.UTF8Encoding $false))
    $credential = cmd /c "git credential fill < ""$query"""
  } finally {
    Remove-Item $query -Force -ErrorAction SilentlyContinue
  }
  $password = $credential | Where-Object { $_ -like "password=*" } | Select-Object -First 1
  if ($password) { $env:GH_TOKEN = $password -replace '^password=', '' }
}

if (-not $env:GH_TOKEN) {
  throw "No GitHub token. Set `$env:GH_TOKEN to a personal access token with 'repo' scope, then run again."
}

if (-not (Test-Path RELEASES.md)) {
  throw "RELEASES.md is missing. electron-builder.yml uses it as the release description."
}

# No test suite, so the type checker is the gate before a build that gets published.
Write-Host "[1/3] Type-checking..." -ForegroundColor Yellow
npm run typecheck
if ($LASTEXITCODE -ne 0) { throw "Type check failed. Nothing was published." }

Write-Host "[2/3] Bundling main, preload and renderer..." -ForegroundColor Yellow
npx electron-vite build
if ($LASTEXITCODE -ne 0) { throw "Build failed. Nothing was published." }

Write-Host "[3/3] Packaging installer and uploading to GitHub..." -ForegroundColor Yellow
npx electron-builder --win --publish always
if ($LASTEXITCODE -ne 0) { throw "Publish failed. Check the token has 'repo' scope and that $repo exists." }

Write-Host ""
Write-Host "Published v$version" -ForegroundColor Green
Write-Host "  https://github.com/$repo/releases/tag/v$version"
Write-Host ""
Write-Host "Installer and update feed are in .\release\" -ForegroundColor DarkGray
