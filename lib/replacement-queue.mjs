// A failed role never satisfies the target. Replenish only after exhausting
// known candidates so cached evidence and ordinary browser work cost no AI tokens.
export async function runReplacementQueue({
  candidates,
  replenish,
  attempt,
  shouldStop,
  key = (role) => role.url,
}) {
  const attempted = new Set();
  while (true) {
    const stopReason = shouldStop(attempted.size);
    if (stopReason) return { stopReason, attempted: attempted.size };

    const role = (await candidates()).find((role) => !attempted.has(key(role)));
    if (!role) {
      if (await replenish()) continue;
      return { stopReason: 'eligible_pool_exhausted', attempted: attempted.size };
    }

    attempted.add(key(role));
    await attempt(role);
  }
}
