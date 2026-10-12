# OpenClaw job search architecture

OpenClaw schedules public research and hosts the browser workflow. The repository owns deterministic policy, approved-payload integrity, durable outcome history and adapters. Personal data lives in a separate local runtime, and every tool uses lib/runtime.mjs rather than its working directory.

```text
OpenClaw research -> official ATS boards + JobSpy -> cheap triage
  -> posting/company evidence -> deterministic pool + resume routing
  -> human-reviewed submission manifest -> one claimed browser worker
  -> observed receipt or uncertain result -> SQLite events -> CSV and JobSync
  -> labelled mailbox outcomes -> source/profile/resume funnel
```

| Layer | Implementation | Boundary |
|---|---|---|
| Runtime | runtime.mjs, prepare-runtime, runtime-doctor, sync-cron | Explicit config/profile/root; deployment digest includes executable source. |
| Discovery | board-discovery.mjs, poll-boards, discover.py | Public GET requests; new and changed posting snapshots; bounded failures. |
| Policy | role-filter.mjs, validate-pool | Regression-tested title, skill, eligibility, location, compensation, company and blocker rules. Incomplete pools remain research. |
| Evidence | company-evidence.mjs | Dated corroborating excerpts and cache lifetime; headcount intervals avoid invented precision. |
| Applicant facts | schemas.mjs, facts-and-blockers.mjs | Confirmed values with provenance and allowed uses; employer and consent scopes. |
| Resume routing | resume-routing.mjs | Weighted required-stack matching, ambiguous ties and backend-specific variants. |
| Approval | prepare-submission, authorize-pool, verify-authorization | Hash binds destinations, facts, resume bytes, source, config, profile, limit and expiry. Browser worker cannot authorize itself. |
| Durable submission | event-store.mjs, submission-worker.mjs | Atomic destination claim, one active worker, explicit crash recovery and uncertain state. |
| Browser pilot | greenhouse-driver.mjs | Narrow native controls and one approved resume upload. Custom controls and anti-bot blocks require other audited handling. |
| Hiring feedback | outcomes.mjs, gmail-reader.mjs | Conservative classification, exact or unique matching, review queue and message dedupe. No email sending. |
| Projection | application-events, jobsync-projection, sync-jobsync | SQLite is authoritative; CSV export and one-way MCP upserts. |
| Verification | npm test, GitHub Actions | Windows/Linux regression checks, crash and payload cases, seven-day cache replay and ten synthetic Chromium forms. |

Research has no submission authority. Approval is a human action outside the browser adapter. A manifest hash detects accidental payload changes; it is not proof against an attacker able to rewrite the approval channel. Browser adapters are trusted code and require capability isolation in their host runtime.

Exactly-once external submission cannot be guaranteed without ATS cooperation. Persist submit_started before the action and record uncertain if confirmation cannot be established. Never automatically replay an uncertain destination. Historical ledger duplicates remain preserved but claim keys represent one destination.

The first browser adapter is a pilot, not coverage of every Greenhouse customization or other ATS. Mailbox and MCP credentials remain external deployment dependencies. [Operations](docs/OPERATIONS.md) describes installation, cutover, recovery and live validation.
