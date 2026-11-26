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


## Recovery after the first authorized live pass

The first October 30 batch confirmed zero submissions and created no new uncertain delivery. Its failures exposed three gaps beyond synthetic fixtures: SeatGeek redirects hosted links to a careers wrapper, Render nests an idless combobox outside its field-path container, and Ashby's application tab omits the job duties. The recovery routes custom Greenhouse links to the exact official embedded requisition, retains parent field identity, selects and verifies an exact offered Ashby option, and reads duties from the exact public ATS API job. Anonymous checks recognized SeatGeek's 16 questions and Render's 13 questions, including all 13 actual source options. No applicant data was entered during those checks.

Further adversarial cases refuse duplicate or conflicting requisition parameters and board traversal. An explicit lawful-permanent-resident alternative is allowed only from the approved applicant fact; a separate citizen-only clause still blocks it. Duties sections exclude unrelated company boilerplate, and RF/EMC/antenna/LTE validation role families remain excluded. Current U.S. residence uses the confirmed home country. Site search fields outside the actual application form are excluded.

The live batch is separate from test validation. Its receipts, blocks, private policies, and traces remain outside this repository. The recurring scheduler and standing grant have not been replaced. A one-off continuation must pin the tested recovery source, preserve the shared event database and uncertain holds, and count employer acceptance rather than attempts. Anonymous form recognition does not prove successful live delivery.

Recovery validation: **321 tests passed, zero failed, zero skipped** (about 84 seconds). Formatting and whitespace checks passed. Final log: `%TEMP%/openclaw-form-recovery-release.log`.


## Explicit follow-up answers and challenge wording

A direct user reply can now supply an employer-scoped `questionLabel` fact. Mapping requires the same employer, exact normalized question, one approved fact, and an offered value. Consent additionally requires `explicitQuestionConsentUse(label)` and creates only the specific live control's consent use. Regression cases reject a different employer, changed or expanded consent, missing approval, and ambiguous duplicate facts. Personal answers remain private; no answer values are committed.

The challenge detector distinguishes ordinary ?solve the world's most complex challenges? employer copy from an actual security challenge. Existing CAPTCHA and uncertain-delivery fixtures remain intact. Generic ?eligible to obtain a clearance? also blocks when approved clearance eligibility is absent, even when no clearance level is specified.

Follow-up validation: **325 tests passed, zero failures or skips** (about 88 seconds). Formatting and whitespace checks passed. Final log: `%TEMP%/openclaw-followup-release-tests.log`.

Role-selection follow-up: an exact current-position question may use the approved destination title. Offered choices must contain exactly one matching title; another position, duplicate choices, and employment-history wording remain blocked. **326 tests passed, zero failures or skips**, with formatting and whitespace checks passed. Final log: `%TEMP%/openclaw-role-selection-release-tests.log`.


The public posting reader now uses the exact Lever/Greenhouse requisition endpoint rather than fetching the entire employer board for each preflight. This reduces repeated network work without using cached duties or weakening identity checks. Tests refuse a mismatched API ID and another employer's hosted destination. All 13 focused recovery tests passed; anonymous reads returned the exact Shield AI and SeatGeek titles and descriptions. The preceding full suite had 326 passing tests; the new endpoint regression brings the CI corpus to 327. The active worker's source was not edited during this change.


## Second live role-family review

The instrumentation failure revealed a second way to borrow software evidence: the word ?test? in one physical-hardware bullet matched ?software? in the following bullet. Another GNC duty mentioned collaboration with flight-software developers. Neither establishes a match for the applicant's software background. Clause-bounded duties, additional physical wiring/test-rig objects, and specific instrumentation/GNC/propulsion/flight-test engineer title phrases close these cases. Observability instrumentation in an actual software-engineer title remains eligible. The controller also checks revoked or changed authorization before queue replenishment, avoiding further research after an intentional stop.

The affected live requisition was blocked before submission. The one-off grant was revoked; four observed deliveries remain recorded, and no new uncertainty was created. A full local run passed **328 tests**, followed by focused validation of the narrower title phrases. One preceding hosted Windows CI run timed out starting the PDF extraction worker; Linux passed. CI now runs test files serially per operating system to limit browser/PDF worker contention, retaining the production timeout and every assertion. Both OS jobs remain enabled.


## Company identity and reviewed Lever recovery

The live researcher attached Reply.io sales-automation headcount and product news to the unrelated Reply consulting ATS board. The required-field gate blocked every attempted form; the one-off grant was revoked before any Reply delivery. New dynamic research now needs an operator-verified employer domain and provenance in the private board registry. Third-party headcount evidence must corroborate that domain beside its size excerpt, and a primary growth source must share the domain. Model-reported size cannot waive this identity requirement. Cached unbound research is not admitted or allowed to replace pinned seed evidence. Tests reject Reply.io/Reply confusion, lookalike domains, missing/conflicting provenance and missing identity under relaxed size rules. This is an identity guard for the native autonomous path, not universal legal-entity verification or a retroactive audit of user-pinned seed profiles.

The Osmind failure selected the first checkbox sharing a group name instead of the approved full-stack label. Exact unique accessible labels now bind Lever radio and checkbox groups; final verification refuses extra or changed checked choices. Duplicate plain fields also refuse positional binding. A controlled retry seals the exact pre-submit block proof in the private batch grant. A submitted, attempted or uncertain history cannot use it. Tests cover the complete discovery duplicate gate and event-history proof; existing holds are not released.

Additional tests distinguish generic physical/domain test engineering from Software Test Engineer, and a routine differently phrased role-interest question uses the existing approved application draft. **338 tests passed with zero failures or skips** (about 82 seconds); formatting and whitespace checks passed. Final local log: `%TEMP%/openclaw-recovery-identity-release.log`. All submission fixtures remain synthetic. The live total at this checkpoint was four confirmed deliveries with no new uncertainty.

The final public role review found a mobile-focused Senior Software Engineer requisition requiring React Native. Documented React web experience does not establish React Native experience. A dedicated mandatory-specialty check and positive preferred-only case now cover that distinction. The local full run above remains 338 tests; the additional focused regression brings the final CI corpus to 339. Xsolla, Intercom and Greenlight were reviewed anonymously without sending applicant data in those checks.


## Reviewed scope and resume-upload recovery

A one-off batch can now seal exact official requisitions and their normalized title/description hashes. Changed content or an unreviewed destination blocks before resume upload. Reviewed Greenhouse and Lever reads use individual requisition endpoints; partial reads never mark the employer's remaining cached jobs inactive. These controls preserve the other qualification, company, location, permission and duplicate gates.

Lever renders uploaded filenames in uppercase through CSS. Checking rendered body text against the original filename caused false upload timeouts. Verification now checks the selected file, raw visible filename and completion of visible parsing progress. Hidden progress labels do not block a completed upload. Regression cases cover transformed text, nested progress labels and incomplete uploads.

Final validation: **344 tests passed, zero failures or skips**. Local log: `%TEMP%/openclaw-final-344-fixed-tests.log`. Live delivery remains separate: later Lever submission timeouts created conservative uncertainty holds. Neither an uploaded resume nor a submit click proves employer acceptance. Those destinations must remain held until independent receipt evidence resolves them. The recurring deployment remains unchanged.
