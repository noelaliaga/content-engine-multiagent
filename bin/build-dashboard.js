#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildDashboard } from '../src/dashboard.js';

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { root: { type: 'string' } },
  });
  const [clientSlug, runDirArg] = positionals;
  if (!clientSlug || !runDirArg) {
    console.error('Usage: node bin/build-dashboard.js <client> <run_dir> [--root <dir>]');
    console.error('Example: node bin/build-dashboard.js quillfern examples/example__mock');
    return 2;
  }
  const rootDir = path.resolve(values.root ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
  const { outPath, sizeKB } = await buildDashboard({
    rootDir,
    runDir: path.resolve(runDirArg),
    clientDir: path.join(rootDir, 'clients', clientSlug),
  });
  console.log(`dashboard: ${path.relative(process.cwd(), outPath)} (${sizeKB.toFixed(0)} KB)`);
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  },
);
