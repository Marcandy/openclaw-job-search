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

Provide private `applicant-facts.json` with a version and fields. Each field has value, source, confirmedAt and uses, such as `application`. Unknown values remain null and cannot answer required fields. A destination's answers map form question keys to confirmed fact keys. Legal consent is a distinct fact, never inferred from work authorization or general privacy consent.

After validating today's pool, run `node tools/prepare-submission.mjs`. Review the printed destinations, answers, resume hashes, config digest, limit and expiration. Authorize the printed manifest hash with `node tools/authorize-pool.mjs --confirm-hash <manifestHash> --by <name>`. `verify-authorization` rejects legacy URL-only approvals, expired manifests and changed facts, resumes, config, profile or destinations. Approval lasts eight hours by default, with a maximum of 24. The human approval channel must be kept outside the browser worker's capabilities; a local file hash alone does not authenticate a human.
