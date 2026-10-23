#!/usr/bin/env node
/**
 * Grow the board registry from a JobSpy discovery sweep (discovery/discover.py).
 *
 * Aggregator leads are never application destinations, but their direct
 * employer links reveal which employers post on Greenhouse, Lever or Ashby.
 * Each new board is fetched through its public API and kept only when it has
 * at least one software role in an approved city that passes the title and
 * household-name gates. Daily discovery then reads those boards like any other.
 *
 * Usage: node tools/harvest-boards.mjs <sweep.json> [--apply]
 */
import { readFileSync, copyFileSync } from 'node:fs';
import { loadRuntime, readJson, atomicJson } from '../lib/runtime.mjs';
import { fetchBoard } from '../lib/board-discovery.mjs';
import { usRemote } from '../lib/daily-discovery.mjs';
import { checkLocation, checkTitle, householdNameMatch } from '../lib/role-filter.mjs';

const ATS = [
  {
    platform: 'greenhouse',
    pattern: /^https:\/\/(?:job-)?boards\.greenhouse\.io\/(?!embed\b)([a-z0-9_-]+)\/jobs\//i,
  },
  {
    platform: 'greenhouse',
    pattern:
      /^https:\/\/(?:job-)?boards\.greenhouse\.io\/embed\/job_app\?(?:.*&)?for=([a-z0-9_-]+)/i,
  },
  { platform: 'lever', pattern: /^https:\/\/jobs\.lever\.co\/([a-z0-9_.-]+)\//i },
  { platform: 'ashby', pattern: /^https:\/\/jobs\.ashbyhq\.com\/([^/?#]+)\//i },
];

/** The ATS board a link belongs to, or null. */
export function boardFromUrl(url) {
  for (const { platform, pattern } of ATS) {
    const match = String(url ?? '').match(pattern);
    if (!match) continue;
    const slug = decodeURIComponent(match[1]);
    // Ashby board names keep their case; the others are lowercase identifiers.
    return { platform, slug: platform === 'ashby' ? slug : slug.toLowerCase() };
  }
  return null;
}

/** Every lead in a sweep report, whatever its nesting. */
export function sweepLeads(report) {
  const leads = [];
  const visit = (value) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') {
      if ('employerUrl' in value || 'jobUrl' in value) leads.push(value);
      else Object.values(value).forEach(visit);
    }
  };
  visit(report);
  return leads;
}

if (process.argv[1]?.endsWith('harvest-boards.mjs')) {
  const [sweepPath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const apply = process.argv.includes('--apply');
  if (!sweepPath) throw Error('Usage: node tools/harvest-boards.mjs <sweep.json> [--apply]');
  const { config } = loadRuntime();
  const registry = readJson(config.paths.boards);
  const known = new Set(
    registry.boards.map((b) => `${b.platform}:${String(b.slug).toLowerCase()}`),
  );
  const found = new Map();
  for (const lead of sweepLeads(JSON.parse(readFileSync(sweepPath, 'utf8')))) {
    const board = boardFromUrl(lead.employerUrl) ?? boardFromUrl(lead.jobUrl);
    const id = `${board?.platform}:${String(board?.slug).toLowerCase()}`;
    if (!board || known.has(id)) continue;
    if (householdNameMatch(lead.company ?? '', config)) continue;
    found.set(id, { ...board, company: lead.company ?? board.slug });
  }
  const added = [],
    rejected = [];
  for (const board of found.values()) {
    try {
      const jobs = await fetchBoard(board);
      const matching = jobs.filter(
        (job) =>
          checkTitle(job.title, config).ok &&
          (usRemote(job) ||
            config.cities.some(
              (c) =>
                c.id !== 'us-remote' &&
                job.locations.some((l) => checkLocation({ location: l }, c).ok),
            )),
      );
      if (!matching.length)
        rejected.push({ ...board, reason: `no matching roles of ${jobs.length}` });
      else
        added.push({
          ...board,
          company: jobs[0]?.company || board.company,
          matching: matching.length,
        });
    } catch (error) {
      rejected.push({ ...board, reason: error.message });
    }
  }
  console.log(JSON.stringify({ leadsWithNewBoards: found.size, added, rejected }, null, 1));
  if (apply && added.length) {
    copyFileSync(config.paths.boards, config.paths.boards + `.before-harvest-${Date.now()}.json`);
    registry.boards.push(
      ...added.map(({ platform, slug, company }) => ({
        platform,
        slug,
        company,
        disabled: false,
        source: 'jobspy-harvest ' + new Date().toISOString().slice(0, 10),
      })),
    );
    atomicJson(config.paths.boards, registry);
    console.log(`Added ${added.length} boards to ${config.paths.boards}`);
  }
}
