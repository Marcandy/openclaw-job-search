export function semanticLabel(key) {
  const match = String(key).match(/^semantic:[a-z]+:(.+)$/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    throw Error('Invalid semantic field key');
  }
}

export async function semanticField(page, key) {
  const label = semanticLabel(key);
  if (!label) throw Error('Not a semantic field');
  const field = page.getByLabel(label, { exact: true });
  if ((await field.count()) !== 1) throw Error('Ambiguous or missing semantic field: ' + label);
  const expected = key.split(':')[1];
  const actual = await field.evaluate(
    (e) =>
      e.getAttribute('role') ||
      (e.tagName === 'SELECT' ? 'select' : e.tagName === 'TEXTAREA' ? 'textarea' : e.type),
  );
  if (actual !== expected) throw Error('Semantic control type changed');
  return field;
}
