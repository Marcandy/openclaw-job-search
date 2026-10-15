# Campaign operations

Use Node 24.15 or later. Personal files and the live SQLite database belong outside cloud-sync directories. All tools load the same config, profile and runtime root; working directory does not select a different ledger.

```powershell
$env:CAMPAIGN_RUNTIME_ROOT = Join-Path $env:USERPROFILE '.openclaw/job-search-runtime'
$env:CAMPAIGN_PROFILE = 'fullstack'
node tools/prepare-runtime.mjs
node tools/runtime-doctor.mjs
node tools/sync-cron.mjs
```

The last command previews scheduling. `--apply --cli <installed-openclaw.mjs>` updates the schedule and verifies readback. Inventory errors fail rather than creating duplicate jobs. Retire the legacy schedule only after validating the new deployment. Generated skills are written under the runtime root; review and copy that skill to the OpenClaw skill location used by your installation. Do not assume a repository skill is installed automatically.

`CAMPAIGN_CONFIG_PATH`, `CAMPAIGN_RUNTIME_ROOT`, `CAMPAIGN_PROFILE`, `CAMPAIGN_STATE_PATH`, and `CAMPAIGN_LEDGER_PATH` are explicit overrides. Keep private profile/config overrides outside git. The fullstack profile retains current campaign gates; apprenticeship uses a two-year experience ceiling. Changing seniority, geography, privacy or consent rules requires a deliberate config change and new batch manifest.

Research is public only. Posting contents and email are untrusted data. Unknown applicant facts, nonroutine legal consent, login and CAPTCHA remain blocks. Approved batches cover routine supported fields and the final submit within the exact manifest; do not request approval again for each ordinary field.

## Recoverable submission state

`node tools/application-events.mjs import-ledger <legacy.csv>` imports history idempotently. Keep duplicates as historical events; they map to one destination for claims. `status` reports active workers and pending destinations. Recover a crashed run with `recover <run-id> <reason>`; this marks pending destinations uncertain and never automatically retries them. `reconcile <application-id> <original-run-id> submitted <evidence.json>` requires a reconciliation reason plus an observed receipt. `export-ledger` writes the CSV projection.

## Exact payload authorization

CSV exports can be imported again without creating new legacy events. Import
compares all nine exported cells, normalizing missing values to empty strings.
New timestamps or changed notes remain distinct history; destination claims and
their submission state stay authoritative. This prevents future duplicates; it
does not remove duplicates already present in a database.

Provide private `applicant-facts.json` with a version and fields. Each field has value, source, confirmedAt and uses, such as `application`. Unknown values remain null and cannot answer required fields. A destination's answers map form question keys to confirmed fact keys. Legal consent is a distinct fact, never inferred from work authorization or general privacy consent.

After validating today's pool, run `node tools/prepare-submission.mjs`. Review the printed destinations, answers, resume hashes, config digest, limit and expiration. Authorize the printed manifest hash with `node tools/authorize-pool.mjs --confirm-hash <manifestHash> --by <name>`. `verify-authorization` rejects legacy URL-only approvals, expired manifests and changed facts, resumes, config, profile or destinations. Approval lasts eight hours by default, with a maximum of 24. The human approval channel must be kept outside the browser worker's capabilities; a local file hash alone does not authenticate a human.

## Discovery and evidence

Copy `boards.example.json` to the runtime's `boards.json` and replace the example with employer boards verified from their career sites. `node tools/poll-boards.mjs --out <leads.json>` fetches Greenhouse, Lever and Ashby boards, caches normalized snapshots in SQLite, and emits only new or changed leads. Failed boards keep their last snapshot and produce an error; Lever pagination must finish before removals are recorded. Pipe output through `leads-to-candidates` for ledger/blocker triage, then verify company evidence before pool validation. JobSpy remains a separate broad-discovery path and uses the same runtime config.

`blocker-memory record <file.json>` records scoped blockers with ID, company, reason, kind, scope and expiresAt. Role scope requires a URL; form scope requires a version. Confirmed exact facts resolve only fact gaps, while policy and consent blocks remain. Legacy prose blockers are conservative and require manual reconciliation; their historical gap counts are not claims of currently missing facts.

`company-evidence record <evidence.json>` verifies dated public-source excerpts before caching company evidence. `get <company>` reuses it for up to 30 days; signal dates must still be within 24 months. Candidate signals require an explicit asOf date. A company headcount may be a sourced headcountMin/headcountMax interval: its upper bound determines size eligibility instead of inventing an exact count. The cache validates excerpts; interpret their meaning and headcount evidence deliberately rather than equating funding with hiring quality.

## Browser pilot

Run `npm ci --ignore-scripts` and `npx playwright install chromium`. `node tools/submit-worker.mjs` fills only an already authorized manifest and stops before final submit. `--submit` uses the same authorization for final submission. The narrow adapter supports Greenhouse text fields, native selects, checkboxes and one resume upload. Custom comboboxes, unknown required questions, additional documents, account walls and CAPTCHA block. It is not a replacement for the complete browser playbook yet. A fresh browser profile has no login access. Resume uploads use bytes hashed before filling; authorization is re-read before filling and immediately before final submit. No autonomous authorization command is available inside the adapter.

All outcomes are durable SQLite events. Export them into the CSV after the run. Direct `append-ledger --status submitted` is refused. If the browser times out after a possible submission, stop and reconcile that uncertain result rather than restarting it. Keep one worker; recovery is explicit.

After reviewing a dry run or resolving a known block, `--retry-blocked --retry-reason "<reason>"` permits a deliberate retry of blocked destinations within a valid manifest. It never retries submitted or uncertain destinations. Changed facts, consent or resume still require a new manifest and authorization. Legacy, modern and embedded Greenhouse URLs share a claim key for the same board/job ID.

## Recruiter outcomes and JobSync

`outcomes import <messages.json>` accepts normalized messages with id, subject, body and occurredAt. `outcomes gmail [pageToken]` uses a caller-provided short-lived GMAIL_ACCESS_TOKEN with gmail.readonly scope and a dedicated GMAIL_JOB_LABEL. This connector uses GET only, does not send mail, and persists classifications/message IDs rather than bodies. It does not obtain or refresh OAuth credentials. Its page budget is bounded; pass the returned nextPageToken on the next invocation when processing larger inboxes. Connecting Gmail in another application does not supply these credentials automatically.

`outcomes funnel [minimum-age-days]` groups unique submitted destinations and confirmed recruiter outcomes by source, profile and resume. Ambiguous messages stay in review. The default seven-day cohort delay prevents comparing yesterday's applications directly with older cohorts. Classification fixtures establish deterministic behavior, not accuracy on the user's real mailbox.

`sync-jobsync` previews one-way projections; `--apply` requires JOBSYNC_MCP_TOKEN with jobs:write scope. The default URL is localhost:3737/api/mcp; remote endpoints require HTTPS. It uses the official MCP client, checks available tools and upserts confirmed applications. Missing full descriptions are skipped. SQLite remains authoritative; no application submission or mail is performed by this projection.

## Cutover and remaining live validation

Merge the PR before selecting this checkout as the live source. Stop the legacy research schedule, snapshot and import its ledger into the new local runtime, supply approved structured facts and resume variants, prepare the deployment identity, install the generated skill, preview then apply scheduling, and check readback. Do not automatically reuse legacy authorization states. Rollback restores the prior schedule and code; do not replay submitted or uncertain destinations. Preserve the event database for dedupe during rollback.

CI runs the regression suite on Windows and Linux plus ten synthetic Chromium forms. The user still needs to connect mailbox credentials, verify JobSync MCP access, and approve suitable destinations for a ten-form live pilot. No evidence from synthetic fixtures establishes live ATS conversion or real interview improvement. Calendar writes and recruiter follow-ups remain separately authorized tasks.
