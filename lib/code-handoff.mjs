import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, atomicJson } from './runtime.mjs';

// Greenhouse's emailed-code gate needs the applicant. The controller waits for
// them within a budget; a posting they miss goes on a manual-completion list.

/**
 * How long to wait for the applicant at each gate. A wait is capped per
 * posting, per run and by the run deadline. Once the applicant misses one
 * code, they are taken to be away and later gates go straight to the list.
 */
export function codeWaitBudget({
  maxWaitMs,
  totalWaitMs,
  deadline,
  minWaitMs = 60000,
  now = Date.now,
}) {
  let spent = 0,
    missed = false;
  return {
    waitMs() {
      if (missed) return 0;
      const ms = Math.min(maxWaitMs, totalWaitMs - spent, deadline() - now());
      return ms >= minWaitMs ? ms : 0;
    },
    waited({ waitedMs, entered }) {
      spent += waitedMs;
      if (!entered) missed = true;
    },
  };
}

const clean = (s) =>
  String(s ?? '')
    .replace(/[✱*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** One stopped application with the answers OpenClaw had filled, for the applicant to finish. */
export function manualCompletionEntry({ role, questions, filled, reason, now = new Date() }) {
  return {
    stoppedAt: now.toISOString(),
    company: role.company,
    title: role.title,
    location: role.location,
    url: role.url,
    resume: String(role.resumePath ?? '')
      .replaceAll('\\', '/')
      .split('/')
      .at(-1),
    reason,
    answers: questions
      .filter((q) => filled?.[q.key] != null)
      .map((q) => ({ question: clean(q.label), answer: String(filled[q.key]) })),
  };
}

/**
 * Add an entry to the private list (one per posting, newest kept) and
 * rewrite its readable copy. Returns the readable file's path.
 */
export function recordManualCompletion(root, entry) {
  const path = join(root, 'manual-completion.json'),
    list = existsSync(path) ? readJson(path) : [];
  const entries = [entry, ...list.filter((e) => e.url !== entry.url)];
  atomicJson(path, entries);
  const readable = join(root, 'manual-completion.md');
  writeFileSync(readable, renderManualCompletion(entries));
  return readable;
}

export function renderManualCompletion(entries) {
  const lines = [
    '# Applications to finish by hand',
    '',
    "Each one stopped at Greenhouse's emailed-code check and was NOT sent. Open the link, apply with the listed resume and answers, and enter the code Greenhouse emails you. OpenClaw never retries these. Newest first.",
  ];
  for (const e of entries) {
    lines.push(
      '',
      `## ${e.company}: ${e.title}`,
      '',
      `- Stopped: ${e.stoppedAt}`,
      `- Link: ${e.url}`,
      `- Location: ${e.location ?? ''}`,
      `- Resume: ${e.resume}`,
      `- Why: ${e.reason}`,
    );
    if (e.answers.length) {
      lines.push('', '| Question | Answer |', '|---|---|');
      for (const a of e.answers)
        lines.push(
          `| ${a.question.replaceAll('|', '\\|')} | ${a.answer.replaceAll('|', '\\|').replace(/\s+/g, ' ')} |`,
        );
    }
  }
  return lines.join('\n') + '\n';
}
