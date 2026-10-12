#!/usr/bin/env node
import { loadRuntime } from '../lib/runtime.mjs';
console.log(JSON.stringify(loadRuntime().config));
