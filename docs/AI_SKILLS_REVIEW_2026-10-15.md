# GitHub AI skills review — October 15, 2026

Adopt small, tested patterns from established skill authors and browser tooling.
The immediate gains are earlier form-question discovery and accurate application
history. Neither needs another model service or a new runtime dependency.

There is no objective ranking of the “top AI engineer.” This review selected
prominent individual maintainers and relevant official projects by public
adoption, recent maintenance, license clarity, task fit and integration cost.
Stars below were read from GitHub's API on October 15; they show adoption, not
correctness. These are engineering judgments, not a benchmark of all GitHub AI
projects.

## Findings and decisions

| Maintainer / project | Evidence at review | Fit for this campaign | Decision |
|---|---|---|---|
| Jesse Vincent (`obra`), [Superpowers](https://github.com/obra/superpowers/tree/bb92a77741419a4ab5f06e711a283343f1ada0c3/skills) | 299,326 stars; latest default-branch commit October 10; MIT | Debugging and verification skills help turn repeated operational failures into reproducible regressions. They are coding skills, not an ATS application engine. | Adopt the investigate → reproduce → fix → verify pattern. The ledger defect was reproduced before the fix. Do not install the framework's full development workflow into the application worker. |
| Anthropic, [webapp-testing](https://github.com/anthropics/skills/blob/dbd4588f9e1033efb41dad4bef2f7947c8993d44/skills/webapp-testing/SKILL.md) | Repository: 181,246 stars; default-branch commit October 9; this skill's [license](https://github.com/anthropics/skills/blob/dbd4588f9e1033efb41dad4bef2f7947c8993d44/skills/webapp-testing/LICENSE.txt) is Apache-2.0 | Inspect rendered controls before acting; test browser behavior with local fixtures. Its Python helpers would duplicate this repository's existing JavaScript Playwright setup. | Implement the inspection pattern with the already pinned dependency. Do not add a Python browser stack. Wait for visible controls; do not copy the generic network-idle rule onto ATS pages with persistent traffic. |
| Microsoft Playwright maintainers, [playwright-cli skill](https://github.com/microsoft/playwright-cli/blob/b85c7a736bb473bf55b584e54a09ffa698d6d871/skills/playwright-cli/SKILL.md) | 14,196 stars; default-branch commit September 28; repository push activity October 14; Apache-2.0 | Fresh snapshots, roles, labels and scoped browser sessions fit dynamic ATS forms. | Extend the included OpenClaw browser skill with fresh inspection, unique visible targets and post-upload verification. Use the current Playwright library; a second browser controller would add session and permission complexity. |
| David Zhang (`dzhng`), [deep-research](https://github.com/dzhng/deep-research/tree/1f8f3e285bbc23e80b98a66a64effab9069f3ad4) | 19,789 stars; default-branch commit April 11; LICENSE says MIT, package metadata says ISC | Bounded research breadth/depth could help investigate employers when the evidence cache lacks a dated source. It is an agent application, not an installable OpenClaw skill. | Defer integration. The existing official-board discovery and company-evidence cache already cover the common path. Its Firecrawl/model setup and extra dependencies need a measured advantage before adoption; reconcile license metadata before copying code. |
| Andrej Karpathy (`karpathy`), [LLM Council](https://github.com/karpathy/llm-council/tree/92e1fccb1bdcf1bab7221aa9ed90f9dc72529131) | 25,471 stars; default-branch commit November 22, 2025; no top-level license found | Comparing independent answers could help review borderline role fit, but cannot establish an applicant fact or authorize a submission. The README explicitly disclaims ongoing support. | Do not integrate. It adds multiple model calls and OpenRouter data sharing without fixing the observed form or ledger failures. It is public source, not a verified reusable open-source skill package. |

OpenClaw supports `SKILL.md` instructions, but this does not make another
runtime's commands, permissions or plugins compatible. Its [skills documentation](https://docs.openclaw.ai/tools/skills)
calls for reviewing third-party skills before enabling them. No upstream code,
plugin, credential or installer was imported by this change. The integration is
original campaign code and targeted instructions informed by the linked sources.

## Changes implemented

1. **St. Louis, Missouri:** campaign version 8 adds one daily primary, two backups
   and the newer-market 5,000-person ceiling. Explicit Missouri spellings pass;
   Illinois, nearby municipalities and ambiguous metro-only locations do not.
   Daily quota rises from 17 to 18. These are starting defaults, not measured
   supply. JobSpy reads the same config, so no second city registry is needed.
2. **Ledger round trips:** compare the nine projected CSV cells before importing
   history. Repeated exports no longer become fresh legacy events. Preserve
   changed notes, distinct timestamps and existing destination state. Existing
   duplicate history is retained; this change does not rewrite the live database.
3. **Public form inventory:** inspect required labels, native requirements,
   radio/checkbox groups, option labels and resume inputs before manifest
   preparation. Normalize only Ashby's generated UUID prefix; warn on duplicate
   keys, missing labels, custom controls and embedded forms. Never return input
   values or grant submission authority.
4. **OpenClaw guidance:** generated job-search skills point to the inspector and
   included browser skill. Verify conditional fields and the same approved
   values after resume parsing. Keep receipts and explicit reconciliation as the
   evidence for outcomes.

## Adversarial architecture review

| Challenge | Protection and remaining limit |
|---|---|
| A popular skill runs an installer, changes facts, or follows hostile posting text. | No downloaded skill is enabled. Local instructions preserve the facts and manifest boundary. Public content is data, never approval. |
| A changed Ashby page ID maps an answer to the wrong question. | Normalize the known UUID-prefix shape only on Ashby's host. Preserve labels/options in the diagnostic schema; duplicate keys warn. No automatic suffix-based filling is added. |
| Required questions appear after an answer or resume parsing. | Inventory describes the current rendered form only. The authorized flow must inspect again after changes. Unknown mappings block; a diagnostic hash cannot extend a signed manifest. |
| Inspection accidentally submits or uses an existing logged-in browser. | A fresh anonymous browser blocks non-GET/HEAD requests and navigation to other origins. Tests exercise POST and external-frame navigation blocks. Nothing fills or uploads. This is not a general network sandbox; GET resources still load, and blocked rendering requires manual review. |
| Checkbox groups collapse distinct legal consents. | Individual native requirements produce a warning. Single checkboxes retain consent classification. The inventory is advisory; it does not feed a new automatic filling adapter or infer consent. |
| CSV dedupe discards a real historical change. | Compare all nine exported cells, including timestamp and notes. Normalize only the CSV representation of missing values. Tests retain changed rows and distinct attempt times. Extra nonstandard CSV columns are outside the exported format. |
| A timeout or missing email is treated as a failure safe to retry. | Existing uncertain-state and observed-receipt requirements remain. The new workflow reiterates no automatic retry. The prior unverified attempts are untouched. |
| Tests prove higher application or interview conversion. | They do not. Measure real runs before claiming gains: missing required fields discovered after approval, approval corrections per batch, ledger-row growth after a no-op round trip, and confirmed receipts per attempted application. |

## Verification and rollout

Browser fixtures cover grouped requirements, optional EEO, hidden resume upload,
changing Ashby prefixes, label changes, redaction, ambiguous keys and request
restrictions. Existing authorization, worker, recovery and outcome tests remain
part of `npm test`. A public Greenhouse smoke check on October 15 found 25 controls
and 14 required questions and reported custom-control warnings; it entered no
applicant data and submitted nothing. This checks inspection, not live filling.
The complete local Windows suite passed: 165 tests, zero failures.

After merging, update the canonical checkout and run `tools/prepare-runtime.mjs`
with the intended profile and runtime overrides. Inspect the resulting identity,
then replace the installed generated job-search skill as described in
[Operations](OPERATIONS.md). The source/config digest changes invalidate prior
payload approvals. Do not reset the event database, reuse expired manifests or
replay unverified applications during deployment. This PR does not change a live
schedule or install external skills globally.
