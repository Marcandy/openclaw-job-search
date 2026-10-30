#!/usr/bin/env node
import { loadRuntime, readJson } from '../lib/runtime.mjs';
import { qualifyRole, checkActualLocation, rankRole } from '../lib/role-qualification.mjs';
const path = process.argv[2];
if (!path) throw Error('Usage: review-role.mjs <role.json>; reads only, never uploads or submits');
const runtime = loadRuntime();
const role = readJson(path);
const city = runtime.config.cities.find((c) => c.id === role.cityId);
const result = {
  qualification: qualifyRole(role, runtime.config, readJson(runtime.config.paths.facts)),
  ranking: rankRole(role, runtime.config),
  location: city ? checkActualLocation(role, city) : { ok: false, reason: 'Unknown campaign city' },
};
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.qualification.ok && result.location.ok ? 0 : 2;
