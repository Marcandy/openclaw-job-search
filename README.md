# OpenClaw Job Search — Campaign Engine

Executable rules, gates, and tooling for an agent-driven job-application
campaign. Built for [OpenClaw](https://github.com/openclaw/openclaw)-style
agents (or any agent runtime that can drive a browser and a shell), it turns
job hunting into a gated pipeline: **discover → validate → authorize → submit
→ log**, with hard rules that no single role can talk its way past.

**Fork it, add your facts and resumes, and your agent can start applying.
See [SETUP.md](SETUP.md) for the 10-minute path from fork to first
application.**

The runtime now requires Node 24.15+ and `npm ci --ignore-scripts`. Start with
[Operations](docs/OPERATIONS.md): one runtime root, explicit profiles, cached
official ATS discovery, executable resume routing, expiring payload manifests,
SQLite destination claims, and recruiter-outcome tracking. Personal runtime files
default to `~/.openclaw/job-search-runtime`, outside the repository.

[Autonomous daily applications](docs/AUTONOMOUS_DAILY.md) add a standing-policy
controller and native OpenClaw command schedule for ten applications per day,
with a shared daily cap, confirmed-fact answers, replacement candidates and ATS receipts.

> Nothing personal is in this repo — your applicant brief, resumes, and
> ledger are all gitignored by design. See `applicant-brief.example.txt`
> and `resumes/README.md`.

## What you get

- **Executable gates, not prose rules** — title, experience, compensation,
  location, company-profile, source, and blocker filters in
  `lib/role-filter.mjs`, enforced by `validate-pool.mjs` before any pool is
  shown to you
- **Authorization state machine** — nothing submits until you approve a
  hashed submission manifest (`prepare-submission.mjs` → `authorize-pool.mjs` → `verify-authorization.mjs`)
- **Discovery with real geography** — `discovery/discover.py` (JobSpy) sweeps
  Indeed/LinkedIn/ZipRecruiter/Google Jobs by city + radius
- **Battle-tested form filling** — `docs/FORM_FILL_PLAYBOOK.md`: Greenhouse
  react-select, typeahead, EEO, resume upload, reCAPTCHA policies, all
  learned from real submissions
- **Resume routing** — stack-matched resume variants per role, recorded in
  the ledger so you can tune on conversion data
- **Local dashboard** — `dashboard/server.mjs` on :4545
- **Regression and browser tests** covering gates, payload approval, crash recovery and synthetic forms
- **Agent skill included** — `skills/browser-automation/` for reliable
  multi-step browser work in OpenClaw
- **Public form inventory** — `tools/inspect-form.mjs` finds required questions
  and grouped choices before approval, without entering applicant data

See [the GitHub skills review](docs/AI_SKILLS_REVIEW_2026-10-15.md) for the
maintainers, projects, adoption choices and adversarial review behind the latest
workflow improvements.

## Why this exists

Before 2026-08-16 the campaign's hard filters were prose in a Markdown spec that a
language model read and applied. On 2026-08-15 the role pool contained
`Lead, Software Engineer - Full Stack`, `Senior Data Engineer`, and
`IT Engineer Principal II` despite an explicit hard-reject rule for those exact
words. A rule that only exists as prose is a suggestion.

Everything here is the executable version of those rules. `validate-pool.mjs` is a
gate the research run cannot present a pool without clearing.

## Campaign (example configuration)

The shipped `campaign.config.json` is a working example — edit cities, quotas,
and ceilings for your own search:

| Market | Daily quota | Min backups | Primary headcount ceiling |
|---|---:|---:|---:|
| Newark / Jersey City, NJ | 3 | 3 | 30,000 |
| San Jose, CA | 2 | 3 | 5,000 |
| Chicago, IL | 5 | 3 | 5,000 |
| Atlanta, GA | 2 | 3 | 5,000 |
| San Diego, CA | 1 | 2 | 5,000 |
| Sacramento, CA | 1 | 2 | 5,000 |
| Washington, DC | 1 | 2 | 5,000 |
| Houston, TX | 1 | 2 | 5,000 |
| Baltimore, MD | 1 | 2 | 5,000 |
| St. Louis, MO | 1 | 2 | 5,000 |

St. Louis was added in version 8 (2026-10-15), bringing the daily total to 18.
It accepts St. Louis/St Louis/Saint Louis with an explicit Missouri location.
The starting quota follows the newer markets; supply remains unmeasured.
East St. Louis, Illinois, and nearby municipalities do not satisfy this quota.

The Newark market is a **corridor**: Newark, East Newark, Jersey City, Harrison, and
Hoboken. New York City never counts — a 15-mile sweep from Newark returns 158
Manhattan roles.

Atlanta was added in campaign version 5 (2026-09-14), sized identically to San Jose.
Unlike Newark and Chicago, its in-city supply has not yet been measured with
`discovery/discover.py` — run it before assuming Atlanta behaves like San Jose.

**Top ranking directive:** prioritize medium-to-small companies that are not well
known but are thriving.

## Layout

```
campaign.config.json           single source of truth: cities, quotas, filters, ATS tiers
lib/role-filter.mjs            pure predicate logic; no network, no applicant data
validate-pool.mjs              CLI gate; dedupes vs the CSV ledger and assembles the pool
tools/authorize-pool.mjs       the only supported path to status "authorized"
tools/verify-authorization.mjs pre-submission destination-integrity check
tools/list-blockers.mjs        companies whose form asks an unanswerable question
tools/verify-candidates.mjs    cross-check recorded claims against the live posting
tools/fact-gaps.mjs            rank the missing facts by how many applications they block
tools/check-city-matching.mjs  diagnose location aliases and same-name-city false positives
dashboard/server.mjs           campaign dashboard on :4545 with a Search again button
tools/legacy-pool-to-candidates.mjs  diagnostic: replay an old pool through the gate
test/role-filter.test.mjs      77 tests: every gate, every banned title, every >5y phrasing
test/authorization-flow.test.mjs  11 tests: the authorize -> verify -> tamper lifecycle
sync-cron.ps1                  regenerate the OpenClaw cron job
```

## Discovery (`discovery/`)

Added 2026-08-17. Before this, discovery was the LLM issuing ad-hoc web searches —
fine for "find me some startups", poor recall for "every engineering role in one
specific city". Newark returned zero across five passes with no way to tell whether
that was a search failure or a market fact.

`discovery/discover.py` wraps [JobSpy](https://github.com/speedyapply/JobSpy) and
queries Indeed, LinkedIn, ZipRecruiter, and Google Jobs with a real
**location + radius**, which is the query shape that was missing.

```powershell
cd discovery
.\.venv\Scripts\python.exe discover.py --city newark --hours 720 --json ..\..\newark-leads.json
.\.venv\Scripts\python.exe discover.py --all-cities --hours 336
```

Then triage the leads through the cheap deterministic gates:

```powershell
node tools/leads-to-candidates.mjs newark-leads.json newark
```

### Discovery is not application

The campaign bans aggregators as **application destinations**, and that rule stands.
JobSpy is a **discovery instrument**: its output is a list of leads, and every lead
must be resolved to the employer's own careers page or official ATS posting before it
can enter the candidate pool. `discover.py` captures `job_url_direct` as
`employerUrl` for exactly that purpose. A lead with no employer URL needs the company
researched manually.

### What the first sweeps proved

Identical tool, radius, search terms, and 30-day window:

| Measure | Newark, NJ | Chicago, IL |
|---|---:|---:|
| Raw leads within 15 miles | 296 | 273 |
| After obvious title filter | 203 | 142 |
| **Actually located in the city** | **1** | **134** |
| **Survived the cheap gates** | **0** | **100** |

Of Newark's 203, **202 were dropped on location** — they are in Manhattan (158) or
Jersey City (14). The single genuine Newark posting was a staffing intermediary.

Chicago returning 134 in-city from the same sweep proves the tool works. Newark's
result is a **measured market fact, not a tooling gap**: the Newark metro's software
jobs are physically across the river. No amount of search tuning changes that.

## Verification and diagnostics

Two tools added 2026-08-20, both earned by real failures.

### `tools/verify-candidates.mjs` — check claims against the live posting

On 2026-08-19 two candidates reached primary slots on values that were not true:
Kai Cyber recorded a $140,000-$190,000 salary the posting never states, and Super
Micro recorded a headcount of exactly 5,000 — the San Jose ceiling — when the real
figure is 6,238. **The gates cannot catch a fabricated value that is plausible.**
Only comparing against the source can.

```powershell
node tools/verify-candidates.mjs candidates-2026-08-20.json
node tools/verify-candidates.mjs candidates-2026-08-20.json --fix   # nulls uncorroborated salaries
```

Checks liveness (404 / "no longer accepting"), that recorded salaries actually appear
on the page, that the title matches, and flags any headcount sitting exactly on a city
ceiling. Uses **Ashby's public job-board API** for Ashby postings, which render
client-side and are otherwise unreadable.

It is a **reporter, not a gate** — bot-walls and JS-only pages are common and must not
silently drop a good role. `--fix` only ever *nulls* a value; it never invents one.

On its first run it caught `bareinsights`, a score-157 primary whose entire Ashby
board returns 404. That role would have been applied to.

### `tools/fact-gaps.mjs` — rank what is actually blocking applications

```powershell
node tools/fact-gaps.mjs --days 14
```

Of 9 applications attempted on 2026-08-19, 7 blocked — and exactly **one** was a
CAPTCHA. The rest were questions. This counts blocked ledger rows against a taxonomy
of personal-fact gaps and ranks them, separating `[ASKABLE]` (one answer, reusable
everywhere) from `[policy]` (a deliberate rule such as address privacy).

Current reading: **5 askable questions would unblock roughly 14 applications.** More
research does not help when the pool already holds valid destinations and the form
stops on "what school did you attend".

## Workflow

```
research run  ->  candidates-<date>.json
              ->  node validate-pool.mjs candidates-<date>.json --write-state
              ->  MUST exit 0 before the pool may be shown to the user
              ->  status: awaiting_authorization, poolHash printed

prepare       ->  node tools/prepare-submission.mjs (prints exact payload and manifestHash)
user approves ->  node tools/authorize-pool.mjs --confirm-hash <manifestHash> --by "<your-name>"
              ->  status: authorized

submission    ->  node tools/verify-authorization.mjs
              ->  node tools/submit-worker.mjs --submit (Greenhouse pilot)
              ->  node tools/application-events.mjs export-ledger
```

## Commands

```powershell
# tests, including synthetic Chromium forms
npm test

# validate a candidate set
node validate-pool.mjs candidates-2026-08-16.json
node validate-pool.mjs candidates-2026-08-16.json --write-state
node validate-pool.mjs candidates-2026-08-16.json --json

# replay a legacy pool through the new gate
node tools/legacy-pool-to-candidates.mjs "..\openclaw-newark-san-jose-state.json" > legacy.json
node validate-pool.mjs legacy.json

# check authorization integrity
node tools/verify-authorization.mjs

# re-sync cron after changing the schedule
powershell -ExecutionPolicy Bypass -File .\sync-cron.ps1
powershell -ExecutionPolicy Bypass -File .\sync-cron.ps1 -WhatIf
```

## Candidate schema

```jsonc
{
  "cityId": "newark",              // newark | san-jose | chicago
  "company": "Acme Systems",
  "title": "Software Engineer II",  // banned tokens are hard-rejected
  "location": "Newark, NJ",         // must match an accepted alias for the city
  "url": "https://jobs.ashbyhq.com/acme/abc",  // official employer or ATS only
  "source": "Official Ashby ATS",
  "description": "…2+ years…",      // the posted text used for the experience check
  "salaryMin": 110000,
  "salaryMax": 145000,              // null is an uncertainty that caps at backup
  "postedDate": "2026-08-14",
  "fitScore": 62,                   // 0-100, resume-grounded judgment
  "companyProfile": {
    "headcount": 140,               // REQUIRED; missing is a rejection, not a guess
    "isHouseholdName": false,
    "thrivingSignals": [            // at least one, each needs detail + sourceUrl
      {
        "type": "recent_funding_round",
        "detail": "Series B, $28M, March 2026",
        "sourceUrl": "https://…"
      }
    ]
  },
  "overrideReason": "…"             // required only for >1000-headcount backups
}
```

## Exit codes

`validate-pool.mjs`: `0` clean and quota met · `1` rejected role placed, or quota
shortfall · `2` bad input.

`verify-authorization.mjs`: `0` authorized and intact · `1` mismatch or not
authorized · `2` bad input.

## Gates, in the order they run

| Gate | Rejects |
|---|---|
| `checkTitle` | Senior, Sr., Snr, Staff, Principal, Lead, Manager, Director, VP, Vice President, Chief, Architect, Head of, Distinguished, Fellow |
| `checkRoleRelevance` | titles with no engineering token — Analyst, Specialist, Coordinator, Technician, Administrator, Consultant |
| `checkExperience` | lowest stated minimum > 5 years |
| `checkEligibility` | requires current enrollment / student status; internships and co-ops |
| `checkCompensation` | posted maximum < $90,000 (missing salary caps at backup) |
| `checkCompanyProfile` | household names and >1000 headcount out of primary; no verified thriving signal |
| `checkLocation` | anything not matching the exact city's accepted aliases |
| `checkSource` | aggregators, staffing firms, contract-only, postings older than 30 days |
| `checkKnownBlocker` | companies whose form asks an unanswerable question (see below) |
| duplicate | canonical URL or company+title already in the CSV ledger |

### Company-level blockers

Some employers' forms ask something the applicant cannot truthfully answer —
export-control "U.S. Person", residential street address, background-check
attestation, exact degree major. That question lives on the **company's form**, not on
one posting, so every role there blocks identically. Role-level dedupe misses this
because the titles differ.

`buildBlockerIndex` derives the list from `blocked` ledger rows whose notes match a
structural pattern. A one-off blocker (an unusual essay prompt) does **not** disqualify
a company — only structural ones do.

```powershell
node tools/list-blockers.mjs          # currently 6 companies
node tools/list-blockers.mjs --json
```

To deliberately retry one, set `retryKnownBlocker: true` on that candidate.

### Undated postings

Rippling and many Lever boards never publish a posting date, so the freshness rule has
nothing to check. Demoting those roles would penalize the employer's ATS rather than
the role. An undated posting is capped at **backup** unless the researcher supplies:

```jsonc
"verifiedActiveOn": "2026-08-16"   // must equal the campaign date
```

That is an assertion the posting was opened and confirmed live today — which the spec
already requires — and it is the fact the posted-date rule is a proxy for. A stale
confirmation does not count, and an explicitly dated posting older than 30 days still
fails outright regardless of confirmation.

### Per-city overrides

A city may raise its own primary headcount ceiling:

```jsonc
"companyProfileOverride": { "primaryHeadcountMax": 20000 }
```

Newark carries one (user instruction, 2026-08-16) because its exact-city supply of
sub-1000-person employers is effectively empty. It raises **size only** — household
names are still barred from primary, a verified thriving signal is still required, and
`headcount` must be numeric. San Jose and Chicago remain at 1000.

## Rules for editing this

Do not edit the config, the filter, or the tests to make one specific role pass. If
a rule is genuinely wrong, change it as a rule, add a test, and say so in the change.
The whole point is that no single candidate can talk its way past the gate.
