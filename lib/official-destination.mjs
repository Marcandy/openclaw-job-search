// Board identity is configured by the operator and the job ID comes from that
// board's API. Never infer an employer from an arbitrary redirect or URL query.
export function officialApplicationUrl(board, id, sourceUrl) {
  let slug;
  try {
    slug = decodeURIComponent(String(board.slug ?? ''));
  } catch {
    throw Error('Invalid official board identity');
  }
  const key = String(id ?? '');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_. -]{0,119}$/.test(slug) || slug.includes('..'))
    throw Error('Invalid official board identity');
  if (board.platform === 'greenhouse') {
    if (!/^\d+$/.test(key)) throw Error('Invalid Greenhouse requisition ID');
    const source = new URL(sourceUrl);
    if (
      !['https:', 'http:'].includes(source.protocol) ||
      source.username ||
      source.password ||
      source.port
    )
      throw Error('Invalid official source URL');
    if (source.searchParams.has('gh_jid') && source.searchParams.get('gh_jid') !== key)
      throw Error('Greenhouse source requisition mismatch');
    if (['boards.greenhouse.io', 'job-boards.greenhouse.io'].includes(source.hostname)) {
      const match = source.pathname.match(/^\/([^/]+)\/jobs\/(\d+)\/?$/);
      const embed =
        source.pathname === '/embed/job_app' &&
        source.searchParams.get('for') === slug &&
        source.searchParams.get('token') === key;
      if (!embed && (!match || decodeURIComponent(match[1]) !== slug || match[2] !== key))
        throw Error('Greenhouse board/requisition mismatch');
    }
    const customSource = !['boards.greenhouse.io', 'job-boards.greenhouse.io'].includes(
      source.hostname,
    );
    return customSource || source.pathname === '/embed/job_app'
      ? `https://job-boards.greenhouse.io/embed/job_app?for=${encodeURIComponent(slug)}&token=${key}`
      : `https://job-boards.greenhouse.io/${encodeURIComponent(slug)}/jobs/${key}`;
  }
  return sourceUrl;
}

function checkedSlug(raw) {
  const slug = decodeURIComponent(raw);
  if (!/^[a-z0-9][a-z0-9_. -]{0,119}$/i.test(slug) || slug.includes('..'))
    throw Error('Invalid official board identity');
  return slug;
}

export function officialJobIdentity(raw) {
  const u = new URL(raw);
  if (u.protocol !== 'https:' || u.username || u.password || u.port)
    throw Error('Invalid official application URL');
  for (const key of ['for', 'token', 'gh_jid'])
    if (u.searchParams.getAll(key).length > 1) throw Error('Ambiguous official requisition');
  const parts = u.pathname.split('/').filter(Boolean);
  if (['boards.greenhouse.io', 'job-boards.greenhouse.io'].includes(u.hostname)) {
    if (parts[0] === 'embed' && parts[1] === 'job_app' && parts.length === 2) {
      const slug = u.searchParams.get('for'),
        id = u.searchParams.get('token');
      if (!/^[a-z0-9_. -]+$/i.test(slug ?? '') || slug.includes('..') || !/^\d+$/.test(id ?? ''))
        throw Error('Invalid embedded requisition');
      if (u.searchParams.has('gh_jid') && u.searchParams.get('gh_jid') !== id)
        throw Error('Official requisition mismatch');
      return { platform: 'greenhouse', slug, id };
    }
    if (parts.length === 3 && parts[1] === 'jobs' && /^\d+$/.test(parts[2])) {
      if (u.searchParams.has('gh_jid') && u.searchParams.get('gh_jid') !== parts[2])
        throw Error('Official requisition mismatch');
      return { platform: 'greenhouse', slug: checkedSlug(parts[0]), id: parts[2] };
    }
  }
  if (
    ['jobs.ashbyhq.com', 'jobs.lever.co'].includes(u.hostname) &&
    parts.length === 2 &&
    /^[a-f0-9-]{36}$/i.test(parts[1])
  )
    return {
      platform: u.hostname === 'jobs.ashbyhq.com' ? 'ashby' : 'lever',
      slug: checkedSlug(parts[0]),
      id: parts[1],
    };
  throw Error('Invalid official application URL');
}
