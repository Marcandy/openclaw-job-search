import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileDigest } from './runtime.mjs';
import { applicationId } from './event-store.mjs';
import { canonicalizeUrl, campaignToday } from './role-filter.mjs';

const integer = (value, min, max, label) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw Error(`Invalid ${label}`);
  return n;
};

/** A total target refers to this explicit receipt-backed batch, not all daily activity. */
export function remainingBatchCount({ count, targetTotal, completed = 0 }) {
  if ((count != null) === (targetTotal != null))
    throw Error('Specify exactly one of --count or --target-total');
  if (count != null) return integer(count, 1, 50, 'additional count');
  const target = integer(targetTotal, 1, 50, 'total target');
  const confirmed = integer(completed, 0, 50, 'completed receipt count');
  if (confirmed > target) throw Error('Completed receipts exceed the requested target');
  return target - confirmed;
}

/** The normalized effective profile is copied; the standing config is never edited. */
export function applyBatchOverrides(config, { maxPostingAgeDays, maxPerCompany, cities } = {}) {
  const out = structuredClone(config);
  // loadRuntime already merged the profile. Do not reapply stale profile overrides.
  delete out.profiles;
  if (maxPostingAgeDays != null) {
    out.sourceFilter ??= {};
    out.sourceFilter.maxPostingAgeDays = integer(maxPostingAgeDays, 0, 30, 'posting age');
    out.sourceFilter.allowVerifiedActiveOlderPostings = false;
  }
  if (maxPerCompany != null) {
    out.autonomous ??= {};
    out.autonomous.maxApplicationsPerCompanyPerDay = integer(maxPerCompany, 1, 10, 'company cap');
  }
  if (cities) {
    if (cities.some((id) => !out.cities.some((c) => c.id === id)))
      throw Error('Unknown configured batch city');
    out.cities = out.cities.filter((c) => cities.includes(c.id));
  }
  return out;
}

export function scopedBatchCities(standingCities, requested) {
  if (!requested) return [...standingCities];
  const cities = [
    ...new Set(
      String(requested)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
  if (!cities.length || cities.some((c) => !standingCities.includes(c)))
    throw Error('Batch cities must be a nonempty subset of standing authorized cities');
  return cities;
}

const official = (raw) => {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw Error('Receipt has an invalid ATS URL');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    ![
      'jobs.ashbyhq.com',
      'job-boards.greenhouse.io',
      'boards.greenhouse.io',
      'jobs.lever.co',
    ].includes(url.hostname)
  )
    throw Error('Receipt must use an official supported HTTPS ATS destination');
  const ashbyOrLever = ['jobs.ashbyhq.com', 'jobs.lever.co'].includes(url.hostname);
  const pattern = ashbyOrLever
    ? /^\/[^/]+\/[a-f0-9-]{36}(?:\/(?:application|apply|confirmation))?\/?$/i
    : /^\/[^/]+\/jobs\/\d+(?:\/(?:application|confirmation))?\/?$/;
  if (!pattern.test(url.pathname))
    throw Error('Receipt does not identify an exact supported requisition');
  url.pathname = url.pathname.replace(/\/(?:application|apply|confirmation)\/?$/, '');
  return canonicalizeUrl(url.href);
};

/** Validate every receipt before any database write. A receipt is not authorization to retry. */
export function readCompletedReceipts(path, { timezone, now = new Date() }) {
  const bytes = readFileSync(path);
  if (bytes.length > 1000000) throw Error('Receipt packet exceeds size limit');
  const packet = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
  if (packet.version !== 1 || !Array.isArray(packet.receipts) || packet.receipts.length > 50)
    throw Error('Receipt packet must be version 1 with at most 50 receipts');
  const seen = new Set();
  return packet.receipts.map((record) => {
    const r = record?.receipt;
    const url = official(record?.url);
    const receiptUrl = official(r?.url);
    const identity = (raw) => {
      const u = new URL(raw);
      return u.hostname === 'jobs.ashbyhq.com'
        ? 'ashby:' + u.pathname.toLowerCase()
        : applicationId(raw);
    };
    const id = identity(url);
    if (identity(receiptUrl) !== id || seen.has(id))
      throw Error('Receipt destination differs or appears twice');
    seen.add(id);
    const at = new Date(r?.observedAt);
    if (
      !Number.isFinite(at.getTime()) ||
      at.getTime() > now.getTime() + 300000 ||
      campaignToday({ timezone }, at) !== campaignToday({ timezone }, now)
    )
      throw Error('Receipt must be observed on this campaign date and not in the future');
    if (
      typeof r?.text !== 'string' ||
      r.text.length > 5000 ||
      !/application (?:was )?(?:successfully )?submitted|thank you for (?:applying|your application)|application (?:has been )?received/i.test(
        r.text,
      ) ||
      /application (?:was |has |has been |is )?(?:not |never )?(?:failed|rejected|not submitted|not received)|unable to submit|submission failed/i.test(
        r.text,
      )
    )
      throw Error('Receipt lacks an observed employer acceptance message');
    if (typeof r?.screenshot !== 'string' || !/^[a-f0-9]{64}$/i.test(r.screenshotSha256 ?? ''))
      throw Error('Receipt requires a saved confirmation screenshot and hash');
    const image = resolve(dirname(path), r.screenshot);
    const imageBytes = readFileSync(image);
    if (
      imageBytes.length < 100 ||
      !imageBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      fileDigest(image) !== r.screenshotSha256.toLowerCase()
    )
      throw Error('Confirmation screenshot is missing, changed or not PNG');
    if (
      typeof record.company !== 'string' ||
      !record.company.trim() ||
      typeof record.title !== 'string' ||
      !record.title.trim()
    )
      throw Error('Receipt requires exact employer and title');
    return {
      timestamp: at.toISOString(),
      company: record.company.trim(),
      title: record.title.trim(),
      location: String(record.location ?? ''),
      url,
      source: 'Official ATS; verified manual receipt',
      status: 'submitted',
      resume_used: String(record.resume ?? ''),
      notes: `Manual acceptance observed; receipt screenshot SHA-256 ${r.screenshotSha256.toLowerCase()}`,
      receipt: {
        url: r.url,
        text: r.text,
        observedAt: at.toISOString(),
        screenshot: image,
        screenshotSha256: r.screenshotSha256.toLowerCase(),
      },
    };
  });
}

/** Acquire the existing worker lock; never override a pending or uncertain destination. */
export function importCompletedReceipts(store, rows, packetHash) {
  if (!rows.length) return 0;
  const runId = store.startRun();
  let succeeded = false;
  try {
    const fresh = [];
    for (const row of rows) {
      const prior = store.get(applicationId(row.url));
      if (prior && prior.state !== 'submitted')
        throw Error(
          `Receipt conflicts with ${prior.state}; use explicit reconciliation, not an automatic retry`,
        );
      if (!prior) fresh.push(row);
    }
    const imported = store.recordManualReceipts(runId, fresh, packetHash);
    succeeded = true;
    return imported;
  } finally {
    store.finishRun(
      runId,
      succeeded ? 'manual_receipts_reconciled' : 'manual_receipt_import_refused',
    );
  }
}
