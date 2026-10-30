# Software-job screening and recoverable batches

The effective runtime configuration controls targeting. Suitable Senior, Principal, Lead and software-architecture roles remain allowed; Staff, Manager and Director are excluded. Advertised years alone have no practical cutoff. Applicant experience and specialist qualifications remain separate facts.

`role-qualification.mjs` records role-family, duty, specialist-requirement and eligibility evidence before a candidate enters the daily pool. The controller repeats this screen against live page text before upload. Clear software titles are not a substitute for matching mandatory qualifications. Ambiguous generic engineering titles need software-building duties. This is a conservative deterministic screen, not a complete semantic understanding of every job description: unresolved cases need the role-review workflow.

`review-role.mjs` inspects one private role JSON using the effective configuration and confirmed facts. It outputs evidence excerpts, gaps, a posting digest and ranking reasons. Ranking is a heuristic, not an interview probability. Never put private role packets or applicant traces in the repository.

Greenhouse application destinations derive from the configured board and API requisition ID. Original employer links remain `sourceUrl`. A hosted board/ID mismatch is rejected instead of redirecting applicant data. Lever creation time is stored separately; it is not represented as original publication.

Idless accessible controls receive semantic keys from their question label and type. Filling requires exactly one live accessible target, and form/option changes invalidate the approval comparison. Duplicate labels are not resolved by positional guesses. Native selects and audited grouped choices are verified after filling. New legal consent stays blocked; a technical narrative discussing consent is not itself a consent grant.

Preflight failures are cached by canonical destination, posting text, confirmed-facts hash and executable-source hash. Network failures expire after thirty minutes; form/answer failures are probed again after six hours; other preflight failures expire after seven days. Form-only changes without changed posting data are detected on that next probe, not immediately. This cache is independent of destination claims and cannot release submitted or uncertain deliveries. Failed company research can be retried after six hours by default (`autonomous.researchRetryCooldownHours`), while successful evidence retains its existing validity rules.

Dated batches have a local-date deadline, with daylight-saving transitions respected. New attempts require at least ninety seconds of remaining validity. Applicant-code waits are clipped to the authorization/run deadline. Every submission click rechecks authorization and the current destination manifest. An already-clicked unconfirmed delivery remains held.

Reports expose `current` (phase, employer, role, deadline when waiting), `stopReason` and `batchProgress` separately from daily usage. Batch progress counts this run's distinct receipts and uncertainty, so ending on another local day does not erase those results. A new continuation still needs an explicit receipt-backed target or remaining-count scope; this change does not silently extend expired grants.

The project includes role-review and batch-operations skills. They explain the workflow; the native command controller enforces the code and does not automatically load a newly added skill. Stagehand, Crawlee and other browser agents remain optional experiments, not dependencies or live submission authorities.
