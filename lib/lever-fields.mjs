import { semanticLabel } from './form-binding.mjs';
const escape = (value) => String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
export const leverField = (page, key) =>
  semanticLabel(key)
    ? page.getByLabel(semanticLabel(key), { exact: true })
    : page.locator(`[name="${escape(key)}"]`);

export async function leverChoice(page, key, value, type) {
  const matches = [];
  for (const field of await leverField(page, key).all()) {
    if ((await field.getAttribute('type')) !== type || !(await field.isVisible())) continue;
    const label = await field.evaluate((el) => {
      const clean = (s) =>
        String(s ?? '')
          .replace(/\s+/g, ' ')
          .trim();
      return (
        clean(el.getAttribute('aria-label')) ||
        clean(
          (el.getAttribute('aria-labelledby') ?? '')
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent ?? '')
            .join(' '),
        ) ||
        clean([...(el.labels ?? [])].map((l) => l.textContent).join(' '))
      );
    });
    if (label === String(value).replace(/\s+/g, ' ').trim()) matches.push(field);
  }
  if (matches.length !== 1) throw Error('Ambiguous or missing Lever ' + type + ' label: ' + key);
  return matches[0];
}

export async function fillLever(page, answers, location) {
  const checks = [];
  for (const [key, raw] of Object.entries(answers)) {
    const value = String(raw),
      fields = leverField(page, key);
    const count = await fields.count();
    if (!count) throw Error('Lever approved field missing: ' + key);
    const field = fields.first();
    const tag = await field.evaluate((el) => el.tagName);
    const type = await field.getAttribute('type');
    if (count !== 1 && !['radio', 'checkbox'].includes(type))
      throw Error('Ambiguous Lever field: ' + key);
    if (tag === 'SELECT') {
      await field.selectOption({ label: value });
      checks.push({ key, value, type: 'nativeSelect' });
    } else if (type === 'radio' || type === 'checkbox') {
      const chosen = await leverChoice(page, key, value, type);
      if (type === 'checkbox')
        for (const option of await fields.all()) {
          if ((await option.getAttribute('type')) !== 'checkbox')
            throw Error('Mixed Lever choice controls');
          if (await option.isChecked()) await option.uncheck();
        }
      await chosen.check();
      if (!(await chosen.isChecked())) throw Error('Lever choice did not commit');
      checks.push({ key, value, type });
    } else if (key === 'location' && (await page.locator('#selected-location').count())) {
      // Lever's location lookup runs on key presses; a pasted value shows no suggestions.
      await field.click();
      await field.fill('');
      await field.pressSequentially(location.query, { delay: 60 });
      const container = field.locator(
        'xpath=ancestor::*[contains(@class,"application-question")][1]',
      );
      const option = container
        .locator('.dropdown-results')
        .getByText(location.lever, { exact: true });
      await option.click({ timeout: 15000 });
      if (!(await page.locator('#selected-location').inputValue()))
        throw Error('Lever location was not selected');
      checks.push({ key, value: location.lever, type: 'input' });
    } else {
      await field.fill(value);
      await field.press('Tab');
      checks.push({ key, value, type: 'input' });
    }
  }
  return checks;
}
