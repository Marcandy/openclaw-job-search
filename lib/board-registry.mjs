import { fetchBoard } from './board-discovery.mjs';

export async function auditRegistry(registry, { fetcher = fetch, now = new Date() } = {}) {
  const updated = structuredClone(registry);
  const results = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (cursor < updated.boards.length) {
        const board = updated.boards[cursor++];
        const result = {
          platform: board.platform,
          slug: board.slug,
          company: board.company,
          checkedAt: now.toISOString(),
        };
        try {
          const jobs = await fetchBoard(board, fetcher);
          board.disabled = false;
          result.status = 'healthy';
          result.postings = jobs.length;
        } catch (error) {
          result.status =
            [404, 410].includes(error.status) ||
            /Invalid employer board registry/.test(error.message)
              ? 'quarantined'
              : 'temporary_error';
          result.reason = error.message;
          // A timeout, rate limit or server outage never removes an employer.
          if (result.status === 'quarantined') board.disabled = true;
        }
        board.health = result;
        results.push(result);
      }
    }),
  );
  return { registry: updated, results };
}
