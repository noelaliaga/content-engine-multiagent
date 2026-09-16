#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createClient } from '../src/clients.js';

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { root: { type: 'string' } },
  });
  const slug = positionals[0];
  if (!slug) {
    console.error('Usage: node bin/new-client.js <slug> [--root <dir>]');
    return 2;
  }
  const rootDir = path.resolve(values.root ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
  const { clientDir } = await createClient({ clientsDir: path.join(rootDir, 'clients'), slug });
  const rel = path.relative(process.cwd(), clientDir);
  console.log(`created ${rel}/`);
  console.log('Next: fill in context.md, run_context.json and competitor_context.json, then run:');
  console.log(`  node bin/run-pipeline.js ${slug}          # offline, no cost`);
  console.log(`  node bin/run-pipeline.js ${slug} --live   # real model, needs OPENROUTER_API_KEY`);
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
