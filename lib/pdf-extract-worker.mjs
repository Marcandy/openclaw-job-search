import { parentPort, workerData } from 'node:worker_threads';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const task = getDocument({
  data: new Uint8Array(workerData.bytes),
  isEvalSupported: false,
  disableFontFace: true,
  useSystemFonts: false,
  verbosity: 0,
});
try {
  const document = await task.promise;
  const pages = [];
  let characters = 0;
  for (let number = 1; number <= Math.min(document.numPages, 50); number++) {
    const page = await document.getPage(number);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => item.str ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    characters += text.length;
    if (characters > 500000) throw Error('PDF text exceeds extraction budget');
    pages.push({ page: number, text });
    page.cleanup();
  }
  parentPort.postMessage({ pages, truncated: document.numPages > 50 });
} finally {
  await task.destroy();
}
