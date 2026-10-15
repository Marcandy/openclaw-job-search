const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const has = (text, word) =>
  new RegExp(`(^|[^a-z0-9])${escape(word)}(?=$|[^a-z0-9])`, 'i').test(text);
export function routeResume(role, config) {
  const title = String(role.title ?? '');
  const description = String(role.description ?? '');
  const scored = (config.resumeRouting?.rules ?? [])
    .map((rule) => {
      let score = 0;
      const matched = [];
      for (const keyword of rule.whenAnyKeyword) {
        if (has(title, keyword)) {
          score += 8;
          matched.push(keyword);
        }
        for (const clause of description.split(/[;\n.!]/)) {
          if (
            !has(clause, keyword) ||
            /preferred|nice to have|bonus|a plus|not required/i.test(clause)
          )
            continue;
          score += /required|must have|proficiency|build|develop|primary/i.test(clause) ? 3 : 1;
          matched.push(keyword);
        }
      }
      return { rule, score, matched: [...new Set(matched)] };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  const top = scored[0];
  const ambiguous = Boolean(top && scored[1]?.score === top.score);
  let resumePath =
    !top || ambiguous ? (config.resumeRouting?.default ?? config.paths.resume) : top.rule.resume;
  let ruleId = !top || ambiguous ? 'default' : top.rule.id;
  if (
    top?.rule.id === 'python' &&
    !ambiguous &&
    /backend|platform/i.test(title) &&
    !has(title, 'full stack') &&
    !/front.?end|react|next\.js/i.test(description) &&
    config.resumeRouting?.backendPython
  ) {
    resumePath = config.resumeRouting.backendPython;
    ruleId = 'python-backend';
  }
  return {
    resumePath,
    ruleId,
    ambiguous,
    reason: ambiguous
      ? 'Equal supported stack signals; review default variant'
      : top
        ? `Matched ${top.matched.join(', ')}`
        : 'No supported stack signal',
    scores: scored.map((x) => ({ rule: x.rule.id, score: x.score })),
  };
}
