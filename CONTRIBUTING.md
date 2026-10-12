# Contributing

Pull requests are welcome. Ground rules:

1. **Tests must stay green.** Install with `npm ci --ignore-scripts`, install Chromium with `npx playwright install chromium`, then run `npm test`. CI checks Windows and Linux.
2. **Rules are code, not prose.** If you change a filter's behavior, change
   `lib/role-filter.mjs` and add a test. Do not document a rule without
   implementing it.
3. **Never commit personal data.** The ledger CSV, state JSON, applicant brief,
   and resumes are gitignored for a reason — keep them out of PRs.
4. **Config changes need a `versionHistory` entry** in `campaign.config.json`
   explaining what changed, when, and why.
5. **Receipts or it didn't happen.** Claims about submission behavior should
   come with a visible confirmation, matching the ledger convention.
