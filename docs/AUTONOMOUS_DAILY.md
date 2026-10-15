# Autonomous daily applications

The daily controller runs inside OpenClaw's native command scheduler. It does not need a Codex chat, an agent to launch a browser script, or a new approval for each batch. A private standing policy records the user's instruction and pins the code, configuration, confirmed facts, resume bytes and discovery inputs. The existing exact-manifest workflow remains available for manually approved campaigns.

Run at 12:30 America/New_York every day, including weekends, with a 16:30 catch-up. Both runs share one SQLite worker lock and a ten-application daily limit. Manual applications and possible unconfirmed deliveries also consume the day's limit. A second run exits when the target is already met. Unknown personal facts, new legal consent, accounts and visible CAPTCHA cause a skip; the controller selects another eligible role. It never retries a submitted or uncertain destination.

Discovery reads fresh official employer boards. Existing location, title, experience, compensation, company and blocker gates still apply. Cached company evidence expires after 30 days. When the pool needs more evidence, the controller asks OpenClaw for public company research using an explicit supported model; it checks the returned source excerpts before caching them. Ordinary discovery and submission use no model tokens. Free-text application answers use a pinned resume-summary template, not unrestricted generated claims.

Before every submission, the controller writes an exact expiring manifest and records its standing-policy authorization. It checks live labels and required controls, including hidden Ashby Yes/No inputs, uploads the approved resume bytes, verifies entered values, then checks the policy again. It counts success only after an observed official ATS confirmation with the form gone and a saved screenshot. An ambiguous result is held and consumes a slot. A process crash is recovered only when the controller can identify its own dead process; possible deliveries remain held.

Private deployment files under the runtime root:

- `autonomous.config.json`: the selected search profile and runtime paths.
- `autonomous-policy.json`: revocable standing authorization, ten/day, pinned inputs, supported location choices and an approved application-summary template.
- `autonomous-company-profiles.json`: previously verified company evidence with verification dates.
- `daily-latest.json` and `daily/YYYY-MM-DD/report.json`: counts, receipts, skips, errors and shortfalls.

Run `node tools/daily-run.mjs --config <private-config> --runtime <runtime>` for the actual controller. `--preflight-only --max-preflight 2 --no-research` checks public forms without entering applicant data or submitting. The application controller never imports its exported CSV; SQLite remains authoritative.

Use `tools/install-daily-schedule.mjs --cli <installed-openclaw.mjs>` to preview replacing the legacy research schedule; add `--apply` to install and verify readback. Backups of the old schedule remain private. Disable the OpenClaw job or set the private policy's `enabled` to false to stop future submissions. Code, config, resume or confirmed-fact changes require deliberate policy renewal; a changed hash stops execution.

The Windows gateway must be available on this computer. A logon trigger and a wake/start check before each run can restore it after sleep or restart. A powered-off or signed-out computer cannot run an interactive browser. If eligible roles or supported forms run short, the report records the actual shortfall; it never invents applications to reach ten.
