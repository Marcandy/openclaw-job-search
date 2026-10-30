# Adversarial review — October 30, 2026

Scope: the reliability changes on `fix/job-search-reliability-2026-10-30`, based on deployed merge `2400cda`. This was a source review and adversarial fixture exercise by the implementing agent, not an independent security audit. All browser submissions in testing used intercepted synthetic pages and fictitious applicant data. No application was sent and no live policy or scheduler was changed.

## Findings resolved

| Attack or failure case | Change and evidence |
|---|---|
| An unrelated role includes engineer or developer | Qualification checks require software duties for ambiguous titles and reject physical harness duties. The original spacecraft-wiring example is rejected before upload. A real software developer at the same employer remains eligible. |
| Preferred React softens required Vue elsewhere in a sentence | Requirement checks bind softening to the mentioned specialty and examine repeated mentions. Tests cover mandatory Vue with unrelated preferred React and a repeated Vue mention. Preferred sections and supported framework alternatives remain distinct. |
| A blanket sales/harness keyword ban removes legitimate software jobs | Narrowed role-family matching. Backend Engineer, Sales Platform and Test Harness Engineer with actual Python software duties pass. |
| U.S. abbreviations split the citizenship requirement into separate sentences | Requirement segmentation preserves single-letter abbreviations. Must be a U.S. citizen is rejected without an approved citizenship fact; permanent residency is not substituted. |
| Secret is treated as satisfying TS/SCI | Clearance matching checks the required level/SCI rather than accepting a substring. The weaker clearance is refused. No-clearance-required wording remains permissible. |
| An exact city name overrides a conflicting state or a negated work site | Removed the bare-city fallback. Explicit onsite Denver, NC and not Denver, CO do not satisfy Denver, CO. The original Centennial/Long Beach clause fails against Denver. |
| North America is treated as proof of U.S. remote eligibility | Removed that country shortcut. Canada-only, ambiguous North America and explicit New York exclusions fail the remote screen. |
| A custom career URL changes the underlying requisition | Hosted Greenhouse destinations derive from the configured board and API job ID. Conflicting hosted board/ID and custom gh_jid values are refused. Source URLs remain available for provenance. |
| URL normalization reintroduces a previously submitted custom destination | Discovery also checks the original source URL's durable identity. A changed title does not allow the same custom destination through the new hosted route. |
| An idless field is filled by position or a stale selector | Semantic keys derive from accessible label and control type. The live target must be unique; duplicate labels warn, and a changed control type is refused. Reordering unrelated inputs does not change the binding. |
| A technical narrative mentioning consent is treated as a new permission | Narrative discussion and actual consent intent are separated. Explicit consent requests and lone consent checkboxes remain protected. Unsupported CDP experience is not invented. |
| A confirmed NY value fails an offered New York state option | Mapping accepts a unique equivalent from the existing U.S.-state table. Unsupported/ambiguous options remain blocked. Prior employment remains unknown. |
| Clearing a failure cache also releases an uncertain application | Preflight memory is separate from destination claims. The test invalidates cached failures and proves an uncertain claim still cannot be retried. |
| A code entered after approval expires triggers a final send | The controller supplies a fresh authorization/manifest/claim check before both initial and code-stage clicks. Waits and click timeouts are clipped to the authorization deadline. A revoked code-stage callback produces no final click. |
| Midnight changes a finished batch's apparent completion | Run-specific distinct receipts are reported separately from daily usage. One-off completion uses batch progress, while daily capacity remains enforced separately. Expired grants are not extended automatically. |

The email-code success fixture previously relied on a fixed delay before replacing the wrong code. Under concurrent browser load that raced the first submission. It now waits for the actual wrong-code response before typing the correction and retains assertions for an observed receipt and no code disclosure.

## Validation

The new regression corpus covers role duties, mandatory/preferred skills, clearance/citizenship, exact geography, URL identity, semantic controls, cache invalidation, held delivery, time-zone/DST expiry and code-stage revalidation. Existing manifest tampering, crash recovery, receipts and duplicate protections remain in the full suite.

The broad-discovery Python wrapper was exercised against the shared policy: Senior Software Engineer is retained, Staff Software Engineer is rejected, and Staffing Platform does not falsely match Staff. The read-only role-review CLI was exercised with isolated fixture configuration/facts and rejected the harness role. Both new project skills passed the skill-creator validator. JavaScript formatting and whitespace checks passed.

Final full-suite results are recorded in the completion note below. Test output remains in the local temporary directory; do not publish applicant browser traces with source code.

Completion: **311 tests passed, zero failed, zero skipped** in the final full run (about 88 seconds). `npm run format:check` and `git diff --check` passed. Both project skills validated, and the isolated CLI/discovery checks passed. The final test log is `%TEMP%/openclaw-reliability-release-tests.log`.

## Remaining limits and rollout

- Qualification is a deterministic screen for known failure families, not a complete semantic proof that every mandatory qualification is met. It preserves evidence and review decisions; unsupported or ambiguous requirements still need the role-review workflow. No interview probability is claimed.
- The adapters still refuse controls they cannot uniquely bind or verify. Synthetic success does not establish that every current Render, Workday or other live form is supported. No Workday adapter, account automation, CAPTCHA solver or mailbox-code reader was added.
- Posting/facts/source/config changes invalidate preflight memory immediately. A form-only change without changed posting data is found on the next bounded probe (six hours for form/answer failures). Account and other preflight failures retain a longer cooldown. This cache never overrides submitted or uncertain claims.
- Original publication is distinct from creation or refresh time. Lever createdAt is retained separately and cannot serve as proof of original publication.
- Failure traces can contain applicant data. They are saved only under the private receipt directory; keep them out of the repository and shared logs.
- Skills are packaged in this checkout and referenced by generated runtime guidance. They do not replace executable gates, grant new permissions or install themselves globally.
- Stagehand, Crawlee and a full browser-agent replacement remain optional experiments. These fixes use existing Playwright, SQLite and validation dependencies; no new production dependency was required.

This work is isolated from the scheduled checkout. To roll it out, select the reviewed code deliberately, preserve the private configuration/facts/resume bytes and event database, renew the pinned deployment/policy identity, and verify the existing scheduler's command readback. Do not start applications merely to test deployment or replay an uncertain destination. The current live scheduler continues to use the previous code until that rollout is performed.
