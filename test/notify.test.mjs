import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { desktopNotify } from '../lib/notify.mjs';

function fakeSpawn(exitCode, calls) {
  return (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    child.kill = () => {};
    setImmediate(() => child.emit('exit', exitCode));
    return child;
  };
}

test('passes page-derived text only through the environment', async () => {
  const calls = [];
  const title = 'Hark: type $(Remove-Item x) now',
    body = 'Senior "Engineer" `x`';
  assert.equal(
    await desktopNotify(title, body, { spawnFn: fakeSpawn(0, calls), platform: 'win32' }),
    true,
  );
  const [{ command, args, options }] = calls;
  assert.equal(command, 'powershell.exe');
  const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
  assert.ok(!script.includes('Hark') && !script.includes('Engineer'));
  assert.equal(options.env.OPENCLAW_NOTIFY_TITLE, title);
  assert.equal(options.env.OPENCLAW_NOTIFY_BODY, body);
});

test('a failed or unsupported notifier resolves false instead of throwing', async () => {
  assert.equal(
    await desktopNotify('t', 'b', { spawnFn: fakeSpawn(1, []), platform: 'win32' }),
    false,
  );
  assert.equal(await desktopNotify('t', 'b', { platform: 'linux' }), false);
});
