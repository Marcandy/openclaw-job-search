# Setup — from fork to first application

## 1. Install OpenClaw

```bash
npm install -g openclaw
openclaw gateway --port 18789   # or your platform's service/scheduled-task setup
```

Any agent runtime that can drive a browser and run shell commands works —
OpenClaw, Kimi Work, or a similar agent. The repo is the rules and tooling;
the agent is the engine.

## 2. Clone your fork

```bash
git clone https://github.com/<you>/openclaw-job-search.git
cd openclaw-job-search
```

## 3. Personalize (nothing personal is committed)

1. `cp applicant-brief.example.txt applicant-brief.txt` and fill it in.
   This file is gitignored. The agent may only use facts from this file.
2. Drop your resume PDFs into `resumes/` using the names in `resumes/README.md`
   (gitignored), or edit `resumeRouting` in `campaign.config.json` to point at
   your own paths.
3. Edit `campaign.config.json`: your cities, daily quotas, salary floor,
   title filters, and ATS preferences. Every rule is documented in `README.md`.

> If you want git to stop seeing your personal edits to `campaign.config.json`:
> `git update-index --skip-worktree campaign.config.json`

## 4. Verify the install

```bash
node --test test/
node validate-pool.mjs --help
```

All tests should pass on a clean clone.

## 5. Run a campaign

The loop, each run:

1. **Discover** — `discovery/discover.py` (JobSpy wrapper) or agent web search
   builds a lead list per city.
2. **Gate** — `node validate-pool.mjs candidates-<date>.json --write-state`
   must exit 0 before any pool is shown to you.
3. **Authorize** — you approve the pool:
   `node tools/authorize-pool.mjs --confirm-hash <poolHash> --by "<your-name>"`
4. **Submit** — the agent fills applications following
   `docs/FORM_FILL_PLAYBOOK.md`, logging every outcome to the CSV ledger.

## 6. Optional: schedule it

`sync-cron.ps1` regenerates the OpenClaw cron job after you change the
schedule in `campaign.config.json`:

```powershell
powershell -ExecutionPolicy Bypass -File .\sync-cron.ps1 -WhatIf   # preview
powershell -ExecutionPolicy Bypass -File .\sync-cron.ps1           # apply
```

## Hard rules (do not remove)

- No CAPTCHA or anti-bot workarounds. Ever.
- No invented facts. Unknown required field → log `blocked`, pick a substitute.
- Aggregators are discovery instruments, never application destinations.
- Tests must pass before any rule change is merged. Rules change as rules —
  never to let one specific role through.
