import { campaignToday } from './role-filter.mjs';

// Find the next local-date boundary rather than assuming every day is 24 hours.
export function campaignDeadline(policy, now = new Date()) {
  let deadline = policy.expiresAt == null ? Infinity : Date.parse(policy.expiresAt);
  if (Number.isNaN(deadline)) throw Error('Invalid authorization expiry');
  if (policy.campaignDate) {
    const day = campaignToday({ timezone: policy.timezone }, now);
    if (day !== policy.campaignDate) return now.getTime();
    let lo = now.getTime(),
      hi = lo + 36 * 3600000;
    while (hi - lo > 1) {
      const mid = Math.floor((hi + lo) / 2);
      if (campaignToday({ timezone: policy.timezone }, new Date(mid)) === day) lo = mid;
      else hi = mid;
    }
    deadline = Math.min(deadline, hi);
  }
  return deadline;
}

export function requireTime(deadline, minimumMs = 0, now = Date.now()) {
  if (deadline - now <= minimumMs) throw Error('Authorization has insufficient time remaining');
}

// Results belong to this run/batch, not to whichever local date it ends on.
export function batchProgress(results, requested) {
  const latest = new Map();
  for (const row of results) latest.set(row.url, row.status);
  const confirmed = [...latest.values()].filter((s) => s === 'submitted').length;
  const held = [...latest.values()].filter((s) =>
    ['uncertain', 'submit_started'].includes(s),
  ).length;
  return {
    requested,
    confirmed,
    held,
    remaining: Math.max(0, requested - confirmed),
    remainingCapacity: Math.max(0, requested - confirmed - held),
  };
}
