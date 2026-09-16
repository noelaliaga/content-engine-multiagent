import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { promisify } from 'node:util';
import { buildDashboard, escapeHtml, serializeForScript } from '../src/dashboard.js';
import { runPipeline } from '../src/pipeline.js';
import { fixedNow, fixture, happyScript, makeSandbox, REPO_ROOT } from './helpers.js';
import { createScriptedProvider } from './support/scripted-provider.js';

const exec = promisify(execFile);

/** @type {{ root: string, cleanup: () => Promise<void> }} */
let sandbox;
before(async () => {
  sandbox = await makeSandbox();
});
after(async () => {
  await sandbox.cleanup();
});

test('model output cannot break out of the embedded <script>', () => {
  const text = serializeForScript({ s: '</script><script>alert(1)</script>\u2028' });
  assert.doesNotMatch(text, /<\/script>/i);
  assert.doesNotMatch(text, /\u2028/);
  assert.deepEqual(JSON.parse(text), { s: '</script><script>alert(1)</script>\u2028' });
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
});

test('builds a self-contained dashboard for a completed run', async () => {
  const script = await happyScript();
  const ideas = await fixture('content_ideation');
  ideas.ideas[0].hook = 'Hostile </script> hook $& $1';
  script.content_ideation = [JSON.stringify(ideas)];
  const { provider } = createScriptedProvider(script);
  const result = await runPipeline({
    rootDir: sandbox.root,
    clientSlug: 'quillfern',
    runId: 'dash',
    provider,
    now: fixedNow,
    runsDir: path.join(sandbox.root, 'runs-out'),
  });

  const { outPath } = await buildDashboard({
    rootDir: sandbox.root,
    runDir: result.runDir,
    clientDir: path.join(sandbox.root, 'clients', 'quillfern'),
  });
  const html = await readFile(outPath, 'utf8');
  assert.match(html, /<title>Quillfern Plant Co\. · run dash__mock/);
  assert.match(html, /Offline demo · synthetic fixtures/);
  assert.doesNotMatch(html, /\{\{|\/\*__RUN_DATA__\*\//);
  assert.doesNotMatch(html, /https?:\/\/(?!quillfern\.example\.com)/, 'no external resources');
  assert.equal(html.match(/<\/script>/g)?.length, 1);
  assert.match(html, /Hostile \\u003c\/script> hook \$& \$1/);
});

test('refuses to render an incomplete run', async () => {
  await assert.rejects(
    buildDashboard({
      rootDir: REPO_ROOT,
      runDir: path.join(sandbox.root, 'nowhere'),
      clientDir: sandbox.root,
    }),
    /missing 01_brand_analyst\.json/,
  );
});

test('bin/run-pipeline.js runs the offline demo end to end and refuses --live without a key', async () => {
  const bin = path.join(REPO_ROOT, 'bin', 'run-pipeline.js');
  const { stdout } = await exec(process.execPath, [
    bin,
    'quillfern',
    'cli-demo',
    '--root',
    sandbox.root,
    '--runs-dir',
    path.join(sandbox.root, 'cli-runs'),
  ]);
  assert.match(stdout, /provider=mock-fixtures \(offline\)/);
  assert.match(stdout, /run cli-demo completed: 5 steps, 5 model calls, 0 rejected attempts/);
  await readFile(path.join(sandbox.root, 'cli-runs', 'cli-demo__mock', 'dashboard.html'), 'utf8');

  const env = { ...process.env, OPENROUTER_API_KEY: '' };
  await assert.rejects(
    exec(process.execPath, [bin, 'quillfern', '--live', '--root', sandbox.root], { env }),
    (error) => {
      const failure = /** @type {{ code?: number, stderr?: string }} */ (error);
      assert.equal(failure.code, 1);
      assert.match(failure.stderr ?? '', /OPENROUTER_API_KEY is not set/);
      return true;
    },
  );
});
