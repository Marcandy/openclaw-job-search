# Form-Fill Playbook (per-ATS, battle-tested)

Hard-won lessons from real automated submissions (2026-09 → 2026-10).
These rules exist because each one was learned from an actual failed or
near-failed submission. Follow them in order: **fill → verify → submit → verify**.

## Universal rules

1. **Never trust a blind click on a dropdown option.** After scrolling,
   re-read `getBoundingClientRect()` and only then dispatch `mouse_click`.
   Menus re-render between your scroll and your click; the element you
   measured 300 ms ago may have moved.
2. **Keyboard selection (`ArrowDown` + `Enter`) is unreliable** on
   react-select comboboxes. The highlight starts on an implicit option, so
   `ArrowDown`+`Enter` frequently selects the *adjacent* option
   (e.g. "New Rochelle, NY" instead of "New York, NY").
3. **Always re-read the rendered single-value chip after selecting** —
   `[class*=single-value]` / `[class*=singleValue]` inside the control.
4. **Verify file uploads over the network**, not the DOM: the S3
   `POST ... 201` is the only proof an upload registered.
5. **Decline every marketing/SMS opt-in.** Some are pre-checked or get
   checked by nearby clicks (Hireology). Verify unchecked before submit.
6. **Never invent facts.** Screening questions that require knowledge not
   in the resume facts (e.g. "years of HubSpot CRM experience") are a
   *block*, not an answer. Log `blocked` in the ledger and substitute the
   next authorized backup.
7. **Never-provide facts:** street address, ZIP, education history,
   arbitration agreements, CAPTCHA solving. A form that *requires* any of
   these is a block (Infor requires street+ZIP → blocked).
8. **Real mouse clicks for submits.** React-controlled submit buttons
   often ignore synthetic `.click()`. Use `mouse_click` on
   `button[type="submit"]`.

## CSS selector gotchas

- Ids that start with a digit must be escaped: `#56152` → `#\35 6152`.
- Attribute selectors with special chars need quotes:
  `[id*="56152-option"]`.

## Greenhouse (`job-boards.greenhouse.io`)

- **react-select routine:** `scrollIntoView` → `mouse_click` input →
  `send_keys ArrowDown` (opens menu) → read `[id*="<name>-option"]` →
  `scrollIntoView` the exact option → re-read rect → `mouse_click` →
  re-read single-value.
- **Location (`#candidate-location`):** type the city, wait for the
  geocode API response, click option-0 by verified coordinates. Do NOT
  use ArrowDown+Enter (picks the wrong city).
- **Phone country code (`#country`):** required on most boards; type
  "United States" and pick "United States +1". Easy to forget after a
  page reload — it silently resets and blocks submit with only a small
  "Select a country" error.
- **File uploads:** upload files *first* if a previous validation cycle
  failed; a stale error state can eat the upload registration. If
  "Cover Letter is required" persists while the chip is visible, remove
  the chip, re-upload, confirm S3 201, then submit.
- **Cover letters:** some boards (Adyen) REQUIRE a cover letter.
  Generate a short PDF from resume facts on the fly; never invent
  employers or titles.
- **Submit button:** there are decoy `Apply` buttons at the top. Find
  `button[type=submit]` whose text matches /Submit application/, scroll
  to it, real `mouse_click`.
- **EEO dropdowns** use digit-leading ids (`#56152` gender, `#56153`
  race) — escape them. Options may be "Man"/"Woman" (Adyen) or
  "Male"/"Female" (Scale AI) — read before choosing.
- **Success signal:** "Thank you" text appears without URL change.

## Lever (`jobs.lever.co`)

- **Location:** `#location-input` needs *real keystrokes*
  (`send_keys N e w Space Y o r k`) after activating the tab
  (`find_tab`). Background-throttled tabs fire the `searchLocations` API
  but never render the dropdown. Then `mouse_click` `#location-0`.
- **Text fields:** set `.value` + dispatch `input`/`change`/`blur`, then
  re-read to confirm.
- **EEO:** native `<select>` elements — `select_option` works directly.
- **Marketing consent:** `[name="consent[marketing]"]` checkbox — verify
  unchecked.
- **Submit:** `mouse_click` on `button.template-btn-submit`.
- **Success signal:** URL changes to `/thanks`, text "Application
  submitted!".

## Ashby (`jobs.ashbyhq.com`)

- **Text fields** sometimes ignore `fill` (mode `value`): use
  `mouse_click` → `Mod+A Delete` → `key_type` → `Tab` → wait 1.5 s.
- **Yes/No toggles** are `<button aria-pressed>` and may need TWO
  clicks (click, read attribute, click again if still `false`).
- **Email field quirk:** click → `Mod+A Delete` → `key_type` → `Tab` →
  wait → then submit, or the submit silently no-ops.
- **Success signal:** confirmation text on the same page.

## Rippling ATS (`ats.rippling.com`)

- **Labels are generic** ("Drop or select (.doc/.docx/.pdf)") — map
  every field by walking ancestors for real `innerText`.
- **Custom comboboxes** are `div[role=combobox]`; options are
  `[role=option]` `<p>` tags. Tag the option with a `data-pick`
  attribute, `scrollIntoView`, then `mouse_click` the attribute
  selector.
- **Required visa/relation/EEO comboboxes show errors only AFTER the
  first submit attempt.** Budget one validation round: submit, read
  `[aria-invalid=true]`, fix, resubmit.
- **Location is a combobox too** — raw typed text gets overwritten
  (e.g. by "Remote"); always pick from `[role=option]`.
- **Success signal:** URL `step=confirmation`, text "You have
  successfully applied".

## Hireology (`careers.hireology.com`)

- **State select uses numeric values** (NY=33) — list options first.
- **SMS opt-in** checkbox can end up checked — force-uncheck before
  submit.
- **"Legal right to work"** select is optional-labelled but should be
  answered Yes when true.
- **Success signal:** "Thank you" text.

## Block-and-substitute policy

| Trigger                              | Action                          |
|--------------------------------------|---------------------------------|
| Street address / ZIP **required**    | block, log, substitute backup   |
| Education history required           | block, log, substitute          |
| Arbitration / legal attestation      | block, log, substitute          |
| CAPTCHA challenge requiring solving  | block, log, substitute          |
| Screening Qs beyond resume facts     | block, log, substitute          |

Invisible reCAPTCHA that never challenges is fine (Beyond Finance,
Hark both submitted cleanly with one present).
