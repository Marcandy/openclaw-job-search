// Runs in the browser. CSS text-transform must not change filename identity.
export function hasAcceptedResume({ name, source }) {
  const visible = (e) =>
    e &&
    e.getClientRects().length &&
    getComputedStyle(e).visibility !== 'hidden' &&
    getComputedStyle(e).display !== 'none' &&
    getComputedStyle(e).opacity !== '0' &&
    !e.closest('[hidden],[aria-hidden="true"]');
  if (source !== 'lever')
    return (
      document.body.innerText.includes(name) &&
      !/uploading\.\.\.|upload in progress/i.test(document.body.innerText)
    );
  const input = document.querySelector('input[type=file][name=resume]');
  if (!input || input.files?.length !== 1 || input.files[0].name !== name) return false;
  const group = input.closest('.application-question') ?? input.parentElement;
  const labels = [...group.querySelectorAll('.filename')];
  const named = labels.length
    ? labels.some((e) => visible(e) && e.textContent.trim() === name)
    : group.innerText.includes(name);
  const pending = [...group.querySelectorAll('*')].some(
    (e) =>
      visible(e) &&
      /^(?:uploading|analyzing resume|upload in progress)[.\u2026\s]*$/i.test(
        e.innerText?.trim() ?? '',
      ),
  );
  return named && !pending;
}
