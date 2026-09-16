#!/usr/bin/env node
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildDashboard } from '../src/dashboard.js';
import { runPipeline } from '../src/pipeline.js';
import { createFixtureProvider } from '../src/providers/fixture.js';
import { createOpenRouterProvider } from '../src/providers/openrouter.js';

const USAGE = `Usage: node bin/run-pipeline.js <client> [run_id] [options]

Default provider is OFFLINE: engine/fixtures, no network, no API key, no cost.

Options:
  --live            Call a real model through OpenRouter (needs OPENROUTER_API_KEY; costs money)
  --runs-dir <dir>  Write the run under <dir> instead of clients/<client>/runs
  --overwrite       Replace an existing run directory with the same id
  --no-dashboard    Skip dashboard.html generation
  --now <iso>       Freeze the clock at this ISO timestamp (reproducible run ids and timestamps)
  --root <dir>      Project root containing engine/ and clients/ (default: this repo)
  -h, --help        Show this help`;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      live: { type: 'boolean', default: false },
      'runs-dir': { type: 'string' },
      overwrite: { type: 'boolean', default: false },
      'no-dashboard': { type: 'boolean', default: false },
      root: { type: 'string' },
      now: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  const [clientSlug, runId] = positionals;
  if (!clientSlug) {
    console.error(USAGE);
    return 2;
  }

  /** @type {(() => Date) | undefined} */
  let now;
  if (values.now !== undefined) {
    const frozen = new Date(values.now);
    if (Number.isNaN(frozen.getTime())) {
      console.error(`--now must be an ISO timestamp, got "${values.now}"`);
      return 2;
    }
    now = () => new Date(frozen);
  }

  const rootDir = path.resolve(values.root ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
  const envFile = path.join(rootDir, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  let provider;
  if (values.live) {
    const apiKey = process.env.OPENROUTER_API_KEY?.trim();
    if (!apiKey) {
      console.error(
        'OPENROUTER_API_KEY is not set. Copy .env.example to .env and add your own key, or run without --live for the offline demo.',
      );
      return 1;
    }
    provider = createOpenRouterProvider({
      apiKey,
      baseUrl: process.env.OPENROUTER_BASE_URL?.trim() || undefined,
    });
  } else {
    provider = createFixtureProvider(path.join(rootDir, 'engine', 'fixtures'));
  }

  console.log(`client=${clientSlug} provider=${provider.name}${provider.offline ? ' (offline)' : ''}`);
  const result = await runPipeline({
    rootDir,
    clientSlug,
    runId,
    provider,
    runsDir: values['runs-dir'] ? path.resolve(values['runs-dir']) : undefined,
    overwrite: values.overwrite,
    now,
    log: (message) => console.log(message),
  });

  const { usage_total: usage, steps } = result.state;
  const retries = steps.reduce((sum, step) => sum + step.rejected_attempts.length, 0);
  const adjustments = steps.reduce((sum, step) => sum + step.adjustments.length, 0);
  console.log(
    `run ${result.runId} ${result.state.status}: ${steps.length} steps, ${usage.calls} model calls, ` +
      `${retries} rejected attempts, ${adjustments} adjustments, tokens in/out ${usage.input_tokens}/${usage.output_tokens}`,
  );
  console.log(`outputs: ${path.relative(process.cwd(), result.runDir) || '.'}`);

  if (!values['no-dashboard']) {
    const dashboard = await buildDashboard({
      rootDir,
      runDir: result.runDir,
      clientDir: path.join(rootDir, 'clients', clientSlug),
    });
    console.log(`dashboard: ${path.relative(process.cwd(), dashboard.outPath)}`);
  }
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
