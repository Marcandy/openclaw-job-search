<#
.SYNOPSIS
  Sync the OpenClaw cron schedule to the four-market campaign (3 Newark corridor / 2 San Jose / 5 Chicago / 2 Atlanta).

.DESCRIPTION
  Replaces the legacy hourly newark-san-jose-3x2 job with a single DAILY research
  job, per the handoff's engineering priority 3: an hourly agent is heavier than
  necessary and contributed to stale gateway sessions. Submission is no longer on
  a timer at all - it is a one-shot run triggered only after the user authorizes
  an exact destination batch.

  The cron payload is a compact bootstrap that instructs the agent to read
  openclaw-tri-city-research.txt at run time. The prompt file is therefore the
  single source of truth: editing it changes behavior on the next run with no
  cron change at all. The bootstrap also restates the two non-negotiable limits
  inline, so a scheduled run that somehow cannot read the file still cannot
  transmit applicant data.

.PARAMETER WhatIf
  Show the actions without applying them.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$ResearchPrompt = "%USERPROFILE%\OneDrive\Documents\job search\openclaw-tri-city-research.txt",
    [string]$LegacyJobId    = "9315da6f-e90c-4655-8b43-53f1c9d5e09a",
    [string]$Schedule       = "30 12 * * *",
    [string]$TimeZone       = "America/New_York"
)

$ErrorActionPreference = 'Stop'
$env:PATH = "%USERPROFILE%\AppData\Roaming\fnm\node-versions\v24.15.0\installation;$env:PATH"

$declarationKey = "job-search:newark-sanjose-chicago-3-2-2:research"
$displayName    = "Job Campaign (Newark/JC 3 / San Jose 2 / Chicago 5 / Atlanta 2)"
$jobName        = "newark-sanjose-chicago-3-2-2"

if (-not (Test-Path $ResearchPrompt)) {
    throw "Research prompt not found: $ResearchPrompt"
}
$promptChars = (Get-Content -Raw -Path $ResearchPrompt).Length
Write-Host "Research prompt present: $promptChars chars at $ResearchPrompt" -ForegroundColor Cyan

# Compact bootstrap. Keeps the cron payload small and free of shell-escaping
# hazards, and guarantees the run uses the current prompt file.
$message = @"
Read the file below in full and execute it exactly as written. It is the complete
operating procedure for today's run.

  $ResearchPrompt

Campaign: newark-sanjose-chicago-3-2-2 (version 5). Daily quota is 3 confirmed
submissions in the Newark/Jersey City NJ corridor, 2 in San Jose CA, 5 in Chicago IL,
and 2 in Atlanta GA. This supersedes the retired newark-san-jose-3x2 campaign; ignore
its 3x3 Newark/San Jose quota.

Two limits apply to this scheduled job no matter what:
1. THIS JOB IS PUBLIC RESEARCH ONLY. Never upload the resume, fill an employer form,
   create an ATS account, click Apply, or transmit any applicant data. Submission
   happens only in a separate one-shot run after the user authorizes exact
   destinations.
2. Never present a role pool that has not exited 0 from:
     node "%USERPROFILE%\OneDrive\Documents\job search\openclaw-campaign\validate-pool.mjs" <candidates.json> --write-state

If you cannot read the prompt file, do nothing further and report that failure.
"@

# Windows PowerShell 5.1 passes native-command arguments through a quoting layer
# that treats an embedded double quote as an argument delimiter, which silently
# splits this message into several argv entries and makes OpenClaw see a stray
# positional. Escape them so the whole message arrives as one argument.
$messageArg = $message -replace '"', '\"'

# --- 1. Retire the legacy hourly job -------------------------------------------------
# Disabled rather than removed so its run history stays inspectable.
Write-Host "`n[1/3] Disabling legacy hourly job $LegacyJobId ..." -ForegroundColor Cyan
$legacy = & openclaw cron get $LegacyJobId 2>&1 | Out-String
if ($LASTEXITCODE -eq 0 -and $legacy -match '"enabled"\s*:\s*true') {
    if ($PSCmdlet.ShouldProcess($LegacyJobId, "disable legacy hourly cron job")) {
        & openclaw cron disable $LegacyJobId
        if ($?) { Write-Host "  legacy hourly job disabled" -ForegroundColor Green }
    }
} elseif ($LASTEXITCODE -ne 0) {
    Write-Host "  legacy job not found - nothing to disable" -ForegroundColor Yellow
} else {
    Write-Host "  legacy job already disabled" -ForegroundColor Green
}

# --- 2. Find an existing tri-city job ------------------------------------------------
Write-Host "`n[2/3] Looking for an existing tri-city research job ..." -ForegroundColor Cyan
$listJson = & openclaw cron list --all --json 2>&1 | Out-String
$existingId = $null
try {
    # `cron list --json` returns an envelope: { jobs: [...], total, limit, ... }.
    # Filtering the envelope itself silently matches nothing, which used to make
    # every sync fall through to the create branch.
    $parsed = $listJson | ConvertFrom-Json
    $jobs = if ($null -ne $parsed.jobs) { $parsed.jobs } else { $parsed }
    $match = $jobs | Where-Object { $_.declarationKey -eq $declarationKey }
    if ($match) {
        $existingId = @($match)[0].id
        Write-Host "  found existing job $existingId" -ForegroundColor Green
    } else {
        Write-Host "  no existing job with declaration key $declarationKey" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  could not parse cron list as JSON; will create a new job" -ForegroundColor Yellow
}

# --- 3. Create or update -------------------------------------------------------------
Write-Host "`n[3/3] Writing the daily research job ($Schedule $TimeZone) ..." -ForegroundColor Cyan
if ($existingId) {
    Write-Host "  updating existing job $existingId"
    if ($PSCmdlet.ShouldProcess($existingId, "update tri-city cron job")) {
        # Two calls on purpose. The message contains escaped double quotes, and in
        # Windows PowerShell 5.1 that breaks the native argument boundary so every
        # flag AFTER --message is silently swallowed. A combined edit appeared to
        # succeed while leaving the schedule untouched. Keep --message alone.
        # Check $LASTEXITCODE, not $?. After piping a native command to Out-Null,
        # $? reflects the pipeline rather than the exe and reports false failures.
        & openclaw cron edit $existingId --message $messageArg | Out-Null
        if ($LASTEXITCODE -ne 0) { Write-Host "  message update FAILED (exit $LASTEXITCODE)" -ForegroundColor Red }

        # NOTE: --display-name is valid on `cron add` but NOT on `cron edit`.
        # Passing it makes the whole edit fail with exit 1 and no schedule change.
        & openclaw cron edit $existingId --cron $Schedule --tz $TimeZone --thinking high --timeout-seconds 3600 --no-deliver | Out-Null
        if ($LASTEXITCODE -ne 0) { Write-Host "  schedule update FAILED (exit $LASTEXITCODE)" -ForegroundColor Red }

        # Verify rather than trust: confirm the schedule actually changed.
        $check = & openclaw cron get $existingId 2>&1 | Out-String | ConvertFrom-Json
        $actual = $check.schedule.expr
        $actualTz = $check.schedule.tz
        if ($actual -eq $Schedule) {
            Write-Host ("  updated. schedule is '{0}' tz {1}" -f $actual, $actualTz) -ForegroundColor Green
        } else {
            Write-Host ("  WARNING: schedule is '{0}', expected '{1}'" -f $actual, $Schedule) -ForegroundColor Red
        }
    }
} else {
    Write-Host "  creating a new job"
    if ($PSCmdlet.ShouldProcess($jobName, "create tri-city cron job")) {
        # --name (not a positional) avoids the arg parser reading the schedule
        # slot; --timeout-seconds is the agent budget, --timeout is the RPC call.
        # --no-deliver matters: delivery otherwise defaults to "announce -> last",
        # which fail-closes on every run because no chat route is configured.
        & openclaw cron add `
            --name $jobName `
            --message $messageArg `
            --cron $Schedule `
            --tz $TimeZone `
            --agent main `
            --session isolated `
            --declaration-key $declarationKey `
            --display-name $displayName `
            --description "Daily public research only. Builds a validated 3/2/5/2 role pool for the Newark/Jersey City corridor, San Jose CA, Chicago IL, and Atlanta GA, then waits for one exact-destination authorization. Never submits." `
            --thinking high `
            --timeout-seconds 3600 `
            --no-deliver
        if ($?) { Write-Host "  created" -ForegroundColor Green }
    }
}

Write-Host "`n=== CURRENT CRON (including disabled) ===" -ForegroundColor Cyan
& openclaw cron list --all

Write-Host @"

Submission is intentionally NOT scheduled. After the user authorizes a batch:

  cd "%USERPROFILE%\OneDrive\Documents\job search\openclaw-campaign"
  node tools/authorize-pool.mjs --confirm-hash <poolHash> --by "<your-name>"

  openclaw agent --agent main ``
    --session-key "tri-city-submit-`$(Get-Date -Format yyyyMMdd-HHmmss)" ``
    --message-file "%USERPROFILE%\OneDrive\Documents\job search\openclaw-tri-city-submit.txt" ``
    --thinking high --json --timeout 3600
"@ -ForegroundColor DarkGray
