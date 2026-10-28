# Resume a receipt-backed autonomous application batch

The native OpenClaw controller already submits routine applications under the user's standing authorization. It does not ask for a new approval for every ordinary answer or submission. A separate manual agent or browser has its own confirmation rules; this feature does not disable those rules.

## One-off target and search settings

`--count` retains its original meaning: that many **additional possible deliveries**. To finish a previously started batch, use `--target-total` with an explicit private packet of its confirmed receipts. Seven distinct receipts plus a target of fifteen request eight additional applications, not fifteen additional applications. This target belongs to the listed batch receipts; unrelated autonomous daily submissions are still accounted for in the global occupied-slot limit but do not silently become receipts for this batch.

```powershell
node tools/start-application-batch.mjs `
  --target-total 15 `
  --completed-receipts C:\private\completed-receipts.json `
  --max-posting-age-days 7 `
  --max-per-company 3 `
  --cities chicago,philadelphia `
  --answer-context-file C:\private\approved-answer-context.json `
  --cli C:\installed\openclaw.mjs `
  --instruction-file C:\private\user-request.txt
```

This is a real launcher, not a preview. Run it only after the user has authorized this campaign and the operator has reviewed the private inputs. All selected cities must already be authorized. The batch gets its own dated config and policy; the standing twelve/day policy and ordinary search settings are not changed. A bounded posting-age override also disables the unlimited verified-active older-posting exception. Existing title, company, compensation, eligibility, unknown-answer and duplicate filters remain in force. A completed target creates no zero-cap policy or scheduler job. Over-completed or malformed totals fail validation.

Only confirmed receipts count toward `--target-total`. An uncertain delivery still consumes global capacity and must not be automatically retried or relabeled successful. The dated batch grant expires at the campaign timezone's midnight. A shortfall, time limit or exhausted pool is not proof that the total was completed.

## Private completed-receipt packet

```json
{
  "version": 1,
  "receipts": [
    {
      "company": "Example Employer",
      "title": "Software Engineer",
      "location": "Philadelphia",
      "url": "https://jobs.ashbyhq.com/example/00000000-0000-0000-0000-000000000001",
      "resume": "approved-resume.pdf",
      "receipt": {
        "url": "https://jobs.ashbyhq.com/example/00000000-0000-0000-0000-000000000001/application",
        "text": "Your application was successfully submitted.",
        "observedAt": "2026-10-28T01:00:00Z",
        "screenshot": "confirmation.png",
        "screenshotSha256": "REPLACE_WITH_ACTUAL_SHA256_OF_SAVED_CONFIRMATION"
      }
    }
  ]
}
```

The example is deliberately not executable as proof. Supply the actual employer acceptance URL/text/time, a saved success screenshot, its hash and the exact posting. Each receipt must be from the current New York campaign day, identify an official supported ATS requisition and have an unchanged PNG evidence file. Posting/application/confirmation suffixes are matched to the underlying job; unrelated origins or IDs are refused. Screenshots may be absolute paths or relative to the packet. A text label and file hash are corroborating audit evidence, not a substitute for the operator actually observing acceptance.

The intake acquires the existing worker lock and records native receipt-backed submission events idempotently. It refuses another active or crashed worker and any pending, blocked or uncertain destination collision. Resolve such collisions through an explicit reconciliation flow; do not erase the database, create a second campaign ledger or force a retry. Generic CSV imports can no longer overwrite pending/uncertain delivery states with an asserted `submitted` row. Database access failure is a hard stop, not something to bypass through another process, copied database or account.

## Prior answers and educated interpretation

The optional private context file contains **user-approved narrative examples**, not guesses at identity or legal facts:

```json
{
  "version": 1,
  "entries": [
    {
      "id": "project-delivery",
      "kind": "experience",
      "text": "A real project example approved by the applicant, with its actual contribution described.",
      "source": "Applicant interview-preparation guide",
      "approvedAt": "2026-10-27T18:00:00Z",
      "approvedBy": "user",
      "uses": ["application"]
    }
  ]
}
```

Kinds are `experience`, `motivation`, `preference` and `process`. An optional `company` limits an example to that employer. Employer-specific essays must not be recycled as another company's answer. The copied context is privately stored and hash-pinned; changing it stops authorization until deliberate renewal.

For a fillable question the controller first uses confirmed facts and standing choices. A bounded model pass can then propose a concise answer from the actual attached résumé and scoped prior examples. `prior` answers require a context ID and exact source quote. `inference` permits a grounded interpretation/paraphrase, not an invented fact, and requires source evidence plus confidence of at least 0.9. Unsupported numeric claims, unavailable options, legal/anti-bot prompts and synthetic controls are refused. The proposal's confidence alone does not prove correctness.

Drafted résumé, prior-context, inference and negative-experience answers also receive a separate bounded model evidence review. That review must support every factual claim, not merely find a genuine but unrelated quote. Missing, rejected, low-confidence or unavailable reviews leave the question blocked. Existing retry/fallback models are reused; the extra review can increase token use and runtime. No model call changes a global confirmed fact: accepted answers remain employer-scoped audited application text.

Unknown home addresses, qualifications, education, citizenship, authorization, clearance or salary history must not be fabricated. A supplied confirmed fact can answer a routine supported question; missing data cannot become an invented affirmative or negative personal history. Unknown consent, account walls, prohibited AI assistance and unsupported controls still cause skips. `unmapped_` is a control failure, not permission to guess a selector: the planner and fill adapter refuse it before upload or typing. The replacement queue then tries another eligible destination.

## Merge, deploy and validate separately

A PR and passing synthetic tests are not a live deployment or additional applications. Merge into the intended source, deliberately renew the standing policy's pinned source/config inputs, provide private context/receipts, restore authorized database access if needed, and validate scheduler readback before launching. Do not remove source, policy, résumé, receipt, daily cap, single-worker or uncertain-delivery checks to make the run continue. Receipt verification and truthful shortfall reporting remain mandatory. No software change can guarantee a fixed number of successful applications regardless of job supply or employer blockers.
