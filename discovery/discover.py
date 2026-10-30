#!/usr/bin/env python
"""
Location-based job discovery for the OpenClaw tri-city campaign.

WHY THIS EXISTS
---------------
Until now, discovery was an LLM issuing ad-hoc web searches. That is fine for
"find me some startups" but has poor recall for "every software engineering role
in one specific city". Newark returned ZERO across five research passes while
Jersey City roles were plentiful, which is a search-recall problem, not a market
problem alone.

JobSpy queries Indeed, LinkedIn, Glassdoor, ZipRecruiter and Google Jobs with a
real location + radius parameter, which is exactly the query shape that was
missing.

DISCOVERY IS NOT APPLICATION
----------------------------
The campaign bans aggregators as APPLICATION destinations, and that rule stands.
This tool is a DISCOVERY instrument only. Its output is a list of leads; every
lead must then be resolved to the employer's own careers page or official ATS
posting before it can enter the candidate pool. `job_url_direct` is captured for
exactly that purpose.

Nothing here transmits applicant data. It reads public listings only.

USAGE
-----
    python discover.py --city newark --hours 336
    python discover.py --city newark --titles "ai engineer" --json out.json
    python discover.py --all-cities
"""

from __future__ import annotations

import argparse
import re
import json
import sys
import subprocess
from datetime import datetime, timezone
from pathlib import Path

# 2026-09-16 fix: on Windows the console codec is cp1252, and a lead whose
# company or title contains an emoji (a real posting carried "\U0001f680")
# killed the whole sweep with UnicodeEncodeError AFTER the network work was
# done but BEFORE the JSON was written - four consecutive daily runs
# (09-12 through 09-14) produced no leads file at all. Reconfigure both
# streams to UTF-8 with replacement so a weird character can never again
# cost an entire discovery run.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

try:
    from jobspy import scrape_jobs
except ImportError:
    sys.exit("python-jobspy is not installed. Run:\n"
             "  .venv\\Scripts\\python.exe -m pip install python-jobspy")

HERE = Path(__file__).resolve().parent
CONFIG = json.loads(subprocess.check_output(["node", str(HERE.parent / "tools" / "runtime-config.mjs")], encoding="utf-8"))

# Search terms aimed at the campaign's target roles. Kept broad on purpose:
# the deterministic gates in lib/role-filter.mjs do the narrowing afterwards, so
# discovery should over-collect rather than pre-filter.
DEFAULT_TERMS = [
    "software engineer",
    "full stack engineer",
    "frontend engineer",
    "backend engineer",
    "ai engineer",
    "machine learning engineer",
    "software developer",
]

# Titles that the downstream gates will reject anyway. Dropping them here just
# keeps the report readable; it is not a substitute for the real filters.
OBVIOUS_REJECTS = tuple(CONFIG.get("titleFilter", {}).get("bannedTokens", []))


def city_by_id(city_id: str) -> dict:
    for c in CONFIG["cities"]:
        if c["id"] == city_id:
            return c
    sys.exit(f"unknown city id '{city_id}'. Known: {[c['id'] for c in CONFIG['cities']]}")


def looks_rejectable(title: str) -> bool:
    t = f" {title.lower()} "
    return any(re.search(r"(?<![a-z0-9])" + re.escape(bad) + r"(?![a-z0-9])", t) for bad in OBVIOUS_REJECTS)


def clean(value):
    """Normalize a pandas cell to a real value or None.

    WHY: pandas yields NaN/NaT for a missing cell, and str(NaN) is the string
    "nan", which is TRUTHY. The old `str(row.get(x) or "") or None` therefore
    stored the literal "nan" as if it were data. The 2026-08-24 sweep reported
    100% employer-URL coverage for San Jose (188/188) and Chicago (163/163)
    when the real figures were 61 and 54 - about a third. Downstream,
    leads-to-candidates.mjs had to special-case the string 'nan' to compensate.
    Fix it at the source so the summary counts are true.
    """
    if value is None:
        return None
    if value != value:  # NaN and NaT are the only values unequal to themselves
        return None
    text = str(value).strip()
    if text.lower() in ("", "nan", "nat", "none", "null", "<na>"):
        return None
    return text


def discover(city: dict, terms: list[str], hours_old: int, results_per_term: int,
             radius: int, sites: list[str], fetch_descriptions: bool = False) -> list[dict]:
    """Run one JobSpy sweep per search term and merge the results."""
    location = city["label"]
    seen: dict[str, dict] = {}

    for term in terms:
        print(f"  [{city['id']}] searching '{term}' ...", file=sys.stderr)
        try:
            df = scrape_jobs(
                site_name=sites,
                search_term=term,
                location=location,
                distance=radius,
                results_wanted=results_per_term,
                hours_old=hours_old,
                country_indeed="USA",
                linkedin_fetch_description=fetch_descriptions,
            )
        except Exception as exc:  # one flaky site must not kill the sweep
            print(f"      failed: {type(exc).__name__}: {exc}", file=sys.stderr)
            continue

        if df is None or df.empty:
            print("      0 results", file=sys.stderr)
            continue

        print(f"      {len(df)} raw", file=sys.stderr)
        for _, row in df.iterrows():
            url = str(row.get("job_url") or "").strip()
            if not url:
                continue
            title = str(row.get("title") or "")
            key = url
            if key in seen:
                seen[key].setdefault("matchedTerms", []).append(term)
                continue
            seen[key] = {
                "title": title,
                "company": clean(row.get("company")) or "",
                "location": clean(row.get("location")) or "",
                "site": clean(row.get("site")) or "",
                # job_url_direct is the employer/ATS link when the aggregator
                # exposes it. This is the value that matters: the pool needs an
                # official URL, never the aggregator page.
                "aggregatorUrl": url,
                "employerUrl": clean(row.get("job_url_direct")),
                "companyUrl": clean(row.get("company_url")),
                "datePosted": clean(row.get("date_posted")),
                "salaryMin": row.get("min_amount") if row.get("min_amount") == row.get("min_amount") else None,
                "salaryMax": row.get("max_amount") if row.get("max_amount") == row.get("max_amount") else None,
                "isRemote": bool(row.get("is_remote")) if row.get("is_remote") == row.get("is_remote") else None,
                "description": clean(row.get("description")),
                "matchedTerms": [term],
                "likelyRejectableTitle": looks_rejectable(title),
            }

    return list(seen.values())


def main() -> None:
    ap = argparse.ArgumentParser(description="Location-based discovery sweep (discovery only, never applies).")
    ap.add_argument("--city", help="city id: newark | san-jose | chicago")
    ap.add_argument("--all-cities", action="store_true")
    ap.add_argument("--titles", nargs="*", help="override search terms")
    ap.add_argument("--hours", type=int, default=336, help="max posting age in hours (default 336 = 14 days)")
    ap.add_argument("--results", type=int, default=40, help="results wanted per search term")
    ap.add_argument("--radius", type=int, default=15, help="search radius in miles")
    ap.add_argument("--sites", nargs="*", default=["indeed", "linkedin", "zip_recruiter", "google"])
    ap.add_argument("--fetch-descriptions", action="store_true",
                    help="Also pull each posting's description text. Four of the nine gates "
                         "(skillMatch, experience, eligibility, compensation) need description "
                         "text and cannot run without it, so leads collected WITHOUT this flag "
                         "reach the research agent carrying C++/.NET/master's-required/"
                         "student-only roles that a description-aware gate would drop for free. "
                         "Costs one extra fetch per posting, so a full sweep is materially "
                         "slower; prefer running it against a narrowed term or city list.")
    ap.add_argument("--json", help="write full results to this JSON path")
    args = ap.parse_args()

    if not args.city and not args.all_cities:
        ap.error("pass --city <id> or --all-cities")

    cities = CONFIG["cities"] if args.all_cities else [city_by_id(args.city)]
    terms = args.titles or DEFAULT_TERMS

    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "campaign": CONFIG["campaign"],
        "searchTerms": terms,
        "hoursOld": args.hours,
        "radiusMiles": args.radius,
        "sites": args.sites,
        "note": "DISCOVERY ONLY. Every lead must be resolved to an official employer or ATS URL before it can enter the candidate pool. Aggregator URLs are never valid application destinations.",
        "cities": {},
    }

    for city in cities:
        leads = discover(city, terms, args.hours, args.results, args.radius, args.sites,
                         fetch_descriptions=args.fetch_descriptions)
        keep = [l for l in leads if not l["likelyRejectableTitle"]]
        report["cities"][city["id"]] = {
            "label": city["label"],
            "quota": city["dailyQuota"],
            "totalLeads": len(leads),
            "afterObviousTitleFilter": len(keep),
            "withEmployerUrl": sum(1 for l in keep if l["employerUrl"]),
            "withDescription": sum(1 for l in keep if l.get("description")),
            "leads": keep,
        }

        print(f"\n=== {city['label']} — {len(keep)} leads "
              f"({len(leads)} before title filter, "
              f"{sum(1 for l in keep if l['employerUrl'])} with a direct employer URL) ===")
        for l in sorted(keep, key=lambda x: x["company"].lower()):
            direct = " [direct URL]" if l["employerUrl"] else ""
            print(f"  {l['company'][:34]:34}  {l['title'][:44]:44}  {l['location'][:22]:22}{direct}")

    if args.json:
        Path(args.json).write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
        print(f"\nwrote {args.json}")


if __name__ == "__main__":
    main()
