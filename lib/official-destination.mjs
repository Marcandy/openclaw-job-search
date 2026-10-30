// Board identity is configured by the operator and the job ID comes from that
// board's API. Never infer an employer from an arbitrary redirect or URL query.
export function officialApplicationUrl(board, id, sourceUrl) {
  const slug = String(board.slug ?? '');
  const key = String(id ?? '');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_. -]{0,119}$/.test(slug) || slug.includes('..'))
    throw Error('Invalid official board identity');
  if (board.platform === 'greenhouse') {
    if (!/^\d+$/.test(key)) throw Error('Invalid Greenhouse requisition ID');
    const source = new URL(sourceUrl);
    if (source.protocol !== 'https:' || source.username || source.password || source.port)
      throw Error('Invalid official source URL');
    if (source.searchParams.has('gh_jid') && source.searchParams.get('gh_jid') !== key)
      throw Error('Greenhouse source requisition mismatch');
    if (['boards.greenhouse.io', 'job-boards.greenhouse.io'].includes(source.hostname)) {
      const match = source.pathname.match(/^\/([^/]+)\/jobs\/(\d+)\/?$/);
      if (!match || decodeURIComponent(match[1]) !== slug || match[2] !== key)
        throw Error('Greenhouse board/requisition mismatch');
    }
    return `https://job-boards.greenhouse.io/${encodeURIComponent(slug)}/jobs/${key}`;
  }
  return sourceUrl;
}
