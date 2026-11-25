<#
.SYNOPSIS
  Share this Blockforge server on the internet for free, with no account and
  no payment method, using a Cloudflare quick tunnel.

.DESCRIPTION
  Starts the production server from ./data-live (if it is not already running)
  and then opens a public HTTPS address through cloudflared. WebSockets work
  through the tunnel, so multiplayer and live commands behave exactly like
  they do on the local network.

  Keep this window open while people are playing. Closing it (or turning off
  the computer) takes the public link offline. The address is different every
  time you run this script.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/live.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/live.ps1 -Port 4180
#>
param(
  [int]$Port = 4180
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

$dataDir = Join-Path $root 'data-live'
if (-not (Test-Path $dataDir)) {
  New-Item -ItemType Directory -Path $dataDir | Out-Null
}

$env:NODE_ENV = 'production'
$env:HOST = '0.0.0.0'
$env:PORT = "$Port"
$env:BLOCKFORGE_DATA = $dataDir

function Test-Health {
  try {
    $r = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2
    return [bool]$r.ok
  } catch {
    return $false
  }
}

if (-not (Test-Health)) {
  Write-Host "Starting Blockforge on port $Port ..." -ForegroundColor Cyan
  Start-Process -FilePath 'node' -ArgumentList 'server/index.js' -WorkingDirectory $root -WindowStyle Minimized
  $up = $false
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 250
    if (Test-Health) { $up = $true; break }
  }
  if (-not $up) {
    throw "The server did not start. Run 'node server/index.js' in this folder to see the error."
  }
}

Write-Host "Server is up at http://127.0.0.1:$Port" -ForegroundColor Green

$cf = Join-Path $env:TEMP 'bf-tools\cloudflared.exe'
if (-not (Test-Path $cf)) {
  Write-Host "Downloading cloudflared (one time, ~53 MB) ..." -ForegroundColor Cyan
  New-Item -ItemType Directory -Force -Path (Split-Path $cf) | Out-Null
  Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile $cf -UseBasicParsing
}

Write-Host ""
Write-Host "Your public link appears below (look for https://....trycloudflare.com)." -ForegroundColor Yellow
Write-Host "Leave this window open while playing. Press Ctrl+C to stop sharing." -ForegroundColor Yellow
Write-Host ""

& $cf tunnel --url "http://127.0.0.1:$Port" --no-autoupdate
