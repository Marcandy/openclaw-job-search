# Resume Guide — Recruiter-Event Feedback, Codified

Source: recruiter event attended 2026-10-07, notes codified 2026-10-08.
These rules govern every resume variant in `resumes/` and every future edit
practices. They exist so the advice survives as
executable practice, not as a note in a chat log.

## 1. Match the resume to the role's stack

Never submit one generic resume to every posting. `campaign.config.json` →
`resumeRouting` routes each application to the right variant:

| Role's primary stack | Resume |
|---|---|
| Java / Spring Boot | `Resume_Java_React.pdf` |
| Python / Django | `Resume_Python_React.pdf` (backend-only: `Resume_Python_Backend.pdf`) |
| React / TypeScript / front-end leaning | `Resume_Python_React.pdf` |
| No clear stack signal | `Resume_General.pdf` |

The matched rule is recorded in the application ledger so per-variant
response rates can be measured and the routing tuned on evidence.

`lib/resume-routing.mjs` implements weighted title and required-stack matching.
Preferred technologies do not outweigh required ones. Equal stack scores mark
the default selection as ambiguous for review. Backend-only Python roles use
the backend variant. The chosen PDF bytes are hashed into the submission
manifest; edits require fresh approval.

## 2. Bullets are clear, complete sentences with varied structure

- Every bullet is a full, readable sentence — verb, object, outcome.
- Vary the opening verb and sentence shape across a role's bullets; five
  bullets starting with "Built..." reads as padding to a recruiter.
- One idea per bullet. If a bullet needs a second "and", split it.

## 3. No colored titles

Section headings and role titles stay dark (`#111111` / near-black). No blue
or accent-colored headings. Color in a resume header reads as a template, and
some ATS parsers mishandle colored text runs.

## 4. Tooling appears at the job where it was used

Each role carries its own italic `Tools & technologies:` line (Jira,
Confluence, Git, the CI system, the test stack). A recruiter skimming one role
should see the day-to-day toolkit without jumping to a skills section.

## 5. Keywords live in the experience, not just the skills section

ATS ranking and recruiter skim both weight keywords that appear in context.
Every stack keyword in `LANGUAGES | FRAMEWORKS | TOOLS` must also appear in at
least one role's bullets or tools line. When adding a keyword to the skills
line, first add it to the role where it was actually used — never the reverse.

## Verification checklist (run after any resume edit)

1. Rebuild or re-export every variant without error.
2. Every variant is exactly 1 page (pdfplumber check).
3. Render a PNG preview of page 1 and read it — layout, no orphaned lines,
   tools lines present under each role.
4. Grep the extracted text for the role's target keywords; each must appear
   outside the skills section too.
