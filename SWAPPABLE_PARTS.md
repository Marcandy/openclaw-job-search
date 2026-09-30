# Swappable / Improvable Parts — External Alternatives

**Written 2026-09-29.** Every part of the automation that could be replaced or
upgraded with an existing external tool, what it would cost, and what it would buy.
Ordered by replacement value.

---

## 1. Browser submission layer — HIGHEST swap value

**Current:** Kimi agent drives the in-app browser by hand per form (DOM fills,
`send_keys` for autocompletes, screenshots for receipts). Works, but serial and
session-bound.

| Alternative | Type | Notes |
|---|---|---|
| [browser-use](https://github.com/browser-use/browser-use) | Open source (Python/TS) | LLM-driven browser agent; give it the applicant brief + URL and it fills the form. Cloud option adds stealth + CAPTCHA solving (~$0.02/browser-hour). |
| [Skyvern](https://github.com/Skyvern-AI/skyvern) | Open source | Vision + LLM form filling; no per-site selectors; API-first, good for unattended runs. |
| Playwright / Puppeteer scripts | Open source | Deterministic per-ATS scripts (Ashby, Greenhouse, Lever are stable DOMs). Cheapest to run, most brittle to layout changes. |
| Playwright MCP / agent-browser | Open source | Keep the current agent-driven approach but through a standard MCP browser tool instead of the built-in one. |

**Keep regardless:** the applicant brief (`openclaw-applicant-brief.txt`), the
blocker rules (never invent education, decline AI-consent/arbitration), and the
receipt requirement. Any external filler must be constrained by these or it will
hallucinate answers — that is the main risk of swapping.

---

## 2. Job discovery — already borrowed, could be widened

**Current:** `discovery/discover.py` wraps [JobSpy](https://github.com/speedyapply/JobSpy)
(Indeed, LinkedIn, ZipRecruiter, Google Jobs).

| Alternative | Notes |
|---|---|
| ATS board APIs directly (Ashby/Greenhouse/Lever public JSON endpoints) | Higher precision: query company boards directly instead of aggregators. Would have caught FDE roles aggregators miss. |
| [their-stack](https://github.com/x/…), hiring-cafe, Workable/Recruitee public APIs | Additional niche/startup-heavy sources for the "small thriving company" directive. |
| Google Alerts / RSS per target company | Cheap signal for "just posted" freshness (< 4 days preferred). |

---

## 3. Company research & thriving signals — partially manual, improvable

**Current:** LLM web research per candidate (funding rounds, headcount, customers).

| Alternative | Notes |
|---|---|
| Crunchbase / PitchBook API | Structured funding + headcount; paid. |
| Clearbit / Apollo.io API | Headcount band + growth signals; freemium. |
| LinkedIn company pages via JobSpy | Already partially available; free. |

Would turn the "thriving signal with dated source URL" requirement from LLM research
into structured data — fewer invented-signal risks.

---

## 4. Scheduling / orchestration — adequate, improvable

**Current:** OpenClaw cron (`sync-cron.ps1`) + state machine in
`openclaw-tri-city-state.json`.

| Alternative | Notes |
|---|---|
| Kimi Work Blueprint Automation (this environment) | Native cron + widget dashboard; the dashboard on :4545 could become a Widget instead of a local server. |
| GitHub Actions / any cron runner | If the system ever moves off this machine. |

---

## 5. Dashboard — replaceable

**Current:** `dashboard/server.mjs` on :4545 (down repeatedly; needs manual restart).

| Alternative | Notes |
|---|---|
| Kimi Work Canvas + Widget | Durable, no server to babysit; ledger CSV → widget data slot via a scheduled task. |
| Streamlit / Grafana | Overkill but standard. |

---

## 6. End-to-end replacements (rejected for this use case)

| Tool | Why it doesn't fit |
|---|---|
| [Jobs_Applier_AI_Agent (AIHawk)](https://github.com/feder-cr/Jobs_Applier_AI_Agent_AIHawk) | LinkedIn Easy Apply only; LinkedIn banned its contributors. Zero coverage of Ashby/Greenhouse/Lever/Gem, where 6/6 of the 2026-09-29 applications went. No authorization/audit layer. |
| [Auto_job_applier_linkedIn](https://github.com/GodsScion/Auto_job_applier_linkedIn) | Same LinkedIn-only limitation. |
| Commercial auto-apply services (Simplify, LazyApply, AutoApplier) | Volume-over-fit; no executable policy gates, no per-company blocker memory, no receipt auditing. Would blast applications to household-name and blocked companies the config explicitly rejects. |

---

## What must NEVER be swapped

These are the custom moat — external tools have no equivalent:

1. `campaign.config.json` + `lib/role-filter.mjs` — the executable policy engine.
2. `openclaw-application-log.csv` + `check-ledger.mjs` — outcome memory and audit.
3. `authorize-pool.mjs` / `verify-authorization.mjs` — tamper-evident approval.
4. `openclaw-applicant-brief.txt` — the approved-facts boundary every
   submission tool must be constrained by.
