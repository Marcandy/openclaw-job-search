# Resumes — drop yours here

This folder is intentionally empty in the repo (see `.gitignore`: `resumes/*.pdf` is
never committed — your resume is personal data).

The campaign routes each application to a resume variant based on the role's stack
(see `resumeRouting` in `campaign.config.json`). Put your own PDFs here using these
file names, or edit the paths in `campaign.config.json` to match your own:

| File name | Used for |
|---|---|
| `Resume_General.pdf` | Default / no clear stack signal |
| `Resume_Python_React.pdf` | Python-, React-, TypeScript-leaning roles |
| `Resume_Python_Backend.pdf` | Backend / platform roles with no front-end component |
| `Resume_Java_React.pdf` | Java / Spring-leaning roles |

Tips that earned their place here:

- One page per variant; lead with the stack the role asks for (the router exists
  because recruiter feedback said a generic resume underperforms).
- Keep every variant truthful — reorder and re-emphasize, never invent.
- The chosen variant is recorded in the ledger for every submission, so you can
  measure response rate per variant and adjust the routing rules with data.
