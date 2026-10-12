# Set up a campaign

Install Node 24.15+ and OpenClaw, clone the repository, then run:

```powershell
npm ci --ignore-scripts
npx playwright install chromium
npm test
$env:CAMPAIGN_RUNTIME_ROOT = Join-Path $env:USERPROFILE '.openclaw/job-search-runtime'
$env:CAMPAIGN_PROFILE = 'fullstack'
node tools/prepare-runtime.mjs
node tools/runtime-doctor.mjs
```

Put personal files under the runtime root, outside OneDrive or another cloud-sync directory. Copy `applicant-facts.example.json` to `applicant-facts.json`, confirm each known value and record its source and confirmation date. Unknown values stay null. Copy the approved PDF variants into `resumes/` with the names in config. Copy and personalize `boards.example.json` as `boards.json`. Keep private config overrides outside git and select them with CAMPAIGN_CONFIG_PATH. Re-run prepare-runtime after source or config changes.

For existing deployments, follow the cutover section in [Operations](docs/OPERATIONS.md). Import the old ledger before any submission. Do not copy an old authorized state into the new workflow.

1. Discover with `tools/poll-boards.mjs --out <leads.json>` and periodically use JobSpy for broader recall.
2. Triage, verify employer postings and dated company evidence, and create candidates.
3. Run `node validate-pool.mjs <candidates.json> --write-state`. Incomplete pools stay in research; only an explicit instructed city waiver can accept a shortfall.
4. Supply each destination's answers map using confirmed fact keys, then run `node tools/prepare-submission.mjs`.
5. Review the exact payload and approve its manifestHash with `node tools/authorize-pool.mjs --confirm-hash <manifestHash> --by <name>`.
6. Run `node tools/verify-authorization.mjs`, then the narrow Greenhouse pilot with `node tools/submit-worker.mjs --submit`. Without --submit it fills an authorized batch but stops before final submission.
7. Export the event ledger and track outcomes using the commands in Operations.

Scheduling previews with `node tools/sync-cron.mjs`. Applying requires `--apply --cli <installed-openclaw.mjs>`. Verify readback and retire the previous schedule deliberately. Install the generated runtime skill in the skill directory used by your OpenClaw installation.

No CAPTCHA bypass, invented facts, unapproved destinations or guessed legal consent. Real mailbox access, JobSync credentials and live form validation are separate deployment checks; synthetic tests do not establish live hiring conversion.
