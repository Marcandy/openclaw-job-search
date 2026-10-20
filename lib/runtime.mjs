import { readFileSync, mkdirSync, writeFileSync, renameSync, readdirSync } from 'node:fs';
import { dirname, resolve, isAbsolute, join, normalize } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { validateData } from './schemas.mjs';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const readJson = (p) => JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
export function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, stable(value[k])]),
    );
  return value;
}
export const digest = (value) =>
  createHash('sha256')
    .update(JSON.stringify(stable(value)))
    .digest('hex');
export const fileDigest = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
export function pathAt(root, value) {
  if (value === '~' || value.startsWith('~/') || value.startsWith('~\\'))
    value = join(homedir(), value.slice(2));
  return resolve(root, normalize(value.replace(/[\\/]/g, '/')));
}
function merge(a, b) {
  for (const [k, v] of Object.entries(b))
    a[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(a[k] ?? {}, v) : v;
  return a;
}
export function loadRuntime(env = process.env) {
  const configPath = pathAt(repoRoot, env.CAMPAIGN_CONFIG_PATH ?? 'campaign.config.json');
  const raw = readJson(configPath);
  const profile = env.CAMPAIGN_PROFILE ?? raw.runtime?.defaultProfile ?? 'fullstack';
  if (raw.profiles && !Object.hasOwn(raw.profiles, profile))
    throw new Error(`Unknown campaign profile: ${profile}`);
  const config = merge(structuredClone(raw), raw.profiles?.[profile] ?? {});
  validateData('config', config);
  const root = pathAt(dirname(configPath), env.CAMPAIGN_RUNTIME_ROOT ?? raw.runtime?.root ?? '.');
  const pathKeys = [
    'resume',
    'ledgerCsv',
    'state',
    'poolReportDir',
    'openclawMediaInbound',
    'jobsyncStarter',
    'facts',
    'database',
    'boards',
    'receipts',
  ];
  for (const key of pathKeys)
    if (config.paths?.[key]) config.paths[key] = pathAt(root, config.paths[key]);
  if (env.CAMPAIGN_STATE_PATH) config.paths.state = pathAt(root, env.CAMPAIGN_STATE_PATH);
  if (env.CAMPAIGN_LEDGER_PATH) config.paths.ledgerCsv = pathAt(root, env.CAMPAIGN_LEDGER_PATH);
  for (const rule of config.resumeRouting?.rules ?? []) rule.resume = pathAt(root, rule.resume);
  if (config.resumeRouting?.default)
    config.resumeRouting.default = pathAt(root, config.resumeRouting.default);
  if (config.resumeRouting?.backendPython)
    config.resumeRouting.backendPython = pathAt(root, config.resumeRouting.backendPython);
  config.paths.database ??= join(root, 'campaign.sqlite');
  config.paths.facts ??= join(root, 'applicant-facts.json');
  config.paths.receipts ??= join(root, 'receipts');
  const sourceFiles = [
    'validate-pool.mjs',
    'package.json',
    'package-lock.json',
    ...['lib', 'tools'].flatMap((dir) =>
      readdirSync(join(repoRoot, dir))
        .filter((f) => f.endsWith('.mjs'))
        .map((f) => `${dir}/${f}`),
    ),
  ];
  const sourceDigest = digest(sourceFiles.sort().map((f) => [f, fileDigest(join(repoRoot, f))]));
  return {
    config,
    configPath,
    root,
    profile,
    configDigest: digest(config),
    sourceRoot: repoRoot,
    sourceDigest,
  };
}
// Windows refuses to replace a file another process has open, such as a status
// reader, indexer or antivirus scan. Those holds are brief, so retry the rename
// for about two seconds before failing the write.
const SHARING_ERRORS = new Set(['EPERM', 'EBUSY', 'EACCES']);
export function renameWithRetry(
  from,
  to,
  { rename = renameSync, attempts = 20, delayMs = 100 } = {},
) {
  for (let attempt = 1; ; attempt++) {
    try {
      return rename(from, to);
    } catch (error) {
      if (!SHARING_ERRORS.has(error.code) || attempt >= attempts) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
    }
  }
}

export function atomicJson(path, value, { rename } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  renameWithRetry(tmp, path, { rename });
}
export function assertLocalDatabase(path) {
  if (
    !isAbsolute(path) ||
    /(?:^|[\\/])(?:onedrive(?:[^\\/]*)?|dropbox|google drive)(?:[\\/]|$)/i.test(path)
  )
    throw new Error('Database must use an absolute local path outside cloud-sync folders');
}
