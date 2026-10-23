const escape = (value) => String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
export const leverField = (page, key) => page.locator(`[name="${escape(key)}"]`).first();

export async function fillLever(page, answers, location) {
  const checks = [];
  for (const [key, raw] of Object.entries(answers)) {
    const value = String(raw),
      field = leverField(page, key);
    if ((await field.count()) !== 1) throw Error('Lever approved field missing: ' + key);
    const tag = await field.evaluate((el) => el.tagName);
    const type = await field.getAttribute('type');
    if (tag === 'SELECT') {
      await field.selectOption({ label: value });
      checks.push({ key, value, type: 'nativeSelect' });
    } else if (type === 'radio') {
      const radios = page.locator(`input[type=radio][name="${escape(key)}"]`);
      let chosen = false;
      for (const radio of await radios.all()) {
        const label = radio.locator('xpath=ancestor::label[1]');
        if ((await label.count()) === 1 && (await label.innerText()).trim() === value) {
          await label.click();
          if (!(await radio.isChecked())) throw Error('Lever radio selection failed');
          chosen = true;
          break;
        }
      }
      if (!chosen) throw Error('Lever exact radio label unavailable: ' + key);
      checks.push({ key, value, type: 'radio' });
    } else if (type === 'checkbox') {
      const label = field.locator('xpath=ancestor::label[1]');
      if ((await label.innerText()).trim() !== value) throw Error('Lever checkbox label mismatch');
      await field.check();
      checks.push({ key, value, type: 'checkbox' });
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
