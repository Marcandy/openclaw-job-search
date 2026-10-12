<#
.SYNOPSIS
  Start the job campaign dashboard on http://127.0.0.1:4545

.DESCRIPTION
  Zero dependencies beyond Node. Reads the campaign state file, the CSV ledger,
  and the latest discovery leads, then serves a single page showing quota
  progress, what needs your attention, what needs a custom essay, and a
  "Search again" button that triggers the OpenClaw research cron.

  Binds to loopback only. The page shows application history and must not be
  reachable from the network.

.PARAMETER Port
  Port to listen on. Default 4545.

.PARAMETER Foreground
  Run attached to this terminal instead of in the background.
#>
param(
    [int]$Port = 4545,
    [switch]$Foreground
)

$ErrorActionPreference = 'Stop'
$env:PATH = "%USERPROFILE%\AppData\Roaming\fnm\node-versions\v24.15.0\installation;$env:PATH"

$server = Join-Path $PSScriptRoot 'server.mjs'
if (-not (Test-Path $server)) { throw "server.mjs not found next to this script" }

# Don't start a second copy on the same port.
$busy = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
if ($busy) {
    Write-Host "Port $Port is already listening (PID $($busy[0].OwningProcess))." -ForegroundColor Yellow
    Write-Host "Dashboard: http://127.0.0.1:$Port" -ForegroundColor Cyan
    return
}

if ($Foreground) {
    & node $server --port $Port
} else {
    Start-Process -FilePath node -ArgumentList "`"$server`" --port $Port" -WindowStyle Hidden
    Start-Sleep -Seconds 2
    try {
        $r = Invoke-WebRequest "http://127.0.0.1:$Port/" -TimeoutSec 8 -UseBasicParsing
        Write-Host "Dashboard up (HTTP $($r.StatusCode)): http://127.0.0.1:$Port" -ForegroundColor Green
    } catch {
        Write-Host "Started, but the health check failed: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}
