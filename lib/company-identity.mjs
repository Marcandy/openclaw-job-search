import { isIP } from 'node:net';
import { normalizeCompany } from './role-filter.mjs';

const domain = (raw) => {
  try {
    const u = new URL(raw.includes('://') ? raw : 'https://' + raw);
    if (
      u.protocol !== 'https:' ||
      u.username ||
      u.password ||
      u.port ||
      u.pathname !== '/' ||
      u.search ||
      u.hash
    )
      return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (
      isIP(host) ||
      !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host) ||
      /(?:^|\.)(?:linkedin\.com|ashbyhq\.com|greenhouse\.io|lever\.co)$/.test(host)
    )
      return null;
    return host;
  } catch {
    return null;
  }
};
export function employerDomains(registry) {
  const result = new Map(),
    ambiguous = new Set();
  for (const board of registry.boards ?? []) {
    if (board.disabled === true || !board.employerDomain) continue;
    const name = normalizeCompany(board.company),
      host = domain(board.employerDomain);
    let source;
    try {
      source = new URL(board.identitySourceUrl);
    } catch {
      continue;
    }
    if (
      !name ||
      !host ||
      source.protocol !== 'https:' ||
      source.username ||
      source.password ||
      source.port ||
      isIP(source.hostname) ||
      !Number.isFinite(Date.parse(board.identityVerifiedAt))
    )
      continue;
    if (result.has(name) && result.get(name) !== host) ambiguous.add(name);
    result.set(name, host);
  }
  for (const name of ambiguous) result.delete(name);
  return result;
}
// Newly researched evidence must refer to the operator-verified employer
// domain. A matching brand name alone cannot establish company identity.
export function companyIdentity(entry, expected) {
  const host = typeof expected === 'string' ? domain(expected) : null;
  if (!host) return { ok: false, reason: 'No verified employer domain in the board registry' };
  const primary = (raw) => {
    try {
      const u = new URL(raw);
      return (
        u.protocol === 'https:' &&
        !u.username &&
        !u.password &&
        !u.port &&
        (u.hostname === host || u.hostname.endsWith('.' + host))
      );
    } catch {
      return false;
    }
  };
  const profile = entry?.profile ?? entry ?? {};
  const growth = (profile.thrivingSignals ?? []).some((s) => primary(s.sourceUrl));
  let headcount = primary(profile.headcountSourceUrl);
  if (!headcount) {
    const proof = entry?.employerIdentity;
    headcount =
      proof?.domain === host &&
      proof.headcountSourceUrl === profile.headcountSourceUrl &&
      /^[a-f0-9]{64}$/i.test(proof.bodyHash ?? '') &&
      Number.isFinite(Date.parse(proof.verifiedAt)) &&
      identityExcerpt(proof.excerpt, profile.headcountExcerpt, host);
  }
  return {
    ok: Boolean(headcount && growth),
    reason: !headcount
      ? 'Headcount source is not bound to the verified employer'
      : !growth
        ? 'No primary growth source on the verified employer domain'
        : null,
    employerDomain: host,
  };
}

function identityExcerpt(text, headcount, host) {
  const clean = (s) =>
    String(s ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  const body = clean(text),
    quote = clean(headcount);
  if (quote.length < 20 || !body.includes(quote)) return false;
  const escaped = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    '(?<![a-z0-9.-])(?:https?:\\/\\/)?(?:www\\.)?' + escaped + '(?=[/:\\s,)]|$|\\.(?![a-z0-9-]))',
    'i',
  ).test(body);
}
export function bindCompanyIdentity(entry, expected, headcountDocument, now = new Date()) {
  const host = domain(expected);
  if (!host) throw Error('Verified employer domain is required');
  const p = entry.profile;
  const url = new URL(p.headcountSourceUrl);
  if (url.protocol === 'https:' && (url.hostname === host || url.hostname.endsWith('.' + host)))
    return { domain: host, method: 'primary_domain', verifiedAt: now.toISOString() };
  if (headcountDocument?.url !== p.headcountSourceUrl)
    throw Error('Headcount company identity is uncorroborated');
  const normalize = (s) =>
    String(s ?? '')
      .replace(/\s+/g, ' ')
      .trim();
  const text = normalize(headcountDocument.text),
    quote = normalize(p.headcountExcerpt);
  const at = text.toLowerCase().indexOf(quote.toLowerCase());
  const excerpt = at < 0 ? '' : text.slice(Math.max(0, at - 2000), at + quote.length + 2000);
  if (!identityExcerpt(excerpt, quote, host))
    throw Error('Headcount source does not corroborate the verified employer domain');
  return {
    domain: host,
    method: 'corroborated_domain',
    headcountSourceUrl: p.headcountSourceUrl,
    excerpt,
    bodyHash: headcountDocument.bodyHash,
    verifiedAt: now.toISOString(),
  };
}
