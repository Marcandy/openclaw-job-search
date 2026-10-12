[CmdletBinding(SupportsShouldProcess = $true)]
param([string]$CliPath = $env:OPENCLAW_CLI)
$ErrorActionPreference = 'Stop'
$tool = Join-Path $PSScriptRoot 'tools/sync-cron.mjs'
$arguments = @($tool)
if ($CliPath) { $arguments += @('--cli', $CliPath) }
if ($PSCmdlet.ShouldProcess('OpenClaw research schedule', 'sync from canonical runtime')) { $arguments += '--apply' }
& node @arguments
if ($LASTEXITCODE -ne 0) { throw 'Cron synchronization failed' }
