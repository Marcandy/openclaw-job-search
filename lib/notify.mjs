import { spawn } from 'node:child_process';

// A Windows toast through the built-in WinRT API; no module install needed.
// Title and body arrive through environment variables, never the script text,
// because employer names and titles come from web pages.
const TOAST = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$text = $xml.GetElementsByTagName('text')
$text.Item(0).AppendChild($xml.CreateTextNode($env:OPENCLAW_NOTIFY_TITLE)) > $null
$text.Item(1).AppendChild($xml.CreateTextNode($env:OPENCLAW_NOTIFY_BODY)) > $null
$xml.DocumentElement.SetAttribute('scenario', 'reminder')
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show($toast)
`;

/**
 * Show a desktop notification. Resolves true when shown, false when the
 * platform has none or the notifier failed; a missed alert never stops a run.
 */
export function desktopNotify(title, body, { spawnFn = spawn, platform = process.platform } = {}) {
  if (platform !== 'win32') return Promise.resolve(false);
  return new Promise((resolve) => {
    const child = spawnFn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(TOAST, 'utf16le').toString('base64'),
      ],
      {
        windowsHide: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          OPENCLAW_NOTIFY_TITLE: String(title).slice(0, 120),
          OPENCLAW_NOTIFY_BODY: String(body).slice(0, 400),
        },
      },
    );
    const timer = setTimeout(() => {
      child.kill();
      resolve(false);
    }, 15000);
    child.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}
