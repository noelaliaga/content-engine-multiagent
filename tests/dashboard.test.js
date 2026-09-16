import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { promisify } from 'node:util';
import vm from 'node:vm';
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

/**
 * Executes the dashboard's inline script against a minimal fake DOM and returns the HTML it
 * assigns to each view. This exercises the template's own esc(), not only the server helpers.
 * @param {string} html
 * @returns {Record<string, string>}
 */
function renderViews(html) {
  const script = html.slice(html.indexOf('<script>') + '<script>'.length, html.lastIndexOf('</script>'));
  /** @type {Record<string, { innerHTML: string }>} */
  const views = {};
  const document = {
    /** @param {string} id */
    getElementById: (id) => {
      views[id] ??= { innerHTML: '' };
      return views[id];
    },
    querySelectorAll: () => [],
  };
  vm.runInNewContext(script, { document });
  return Object.fromEntries(Object.entries(views).map(([id, view]) => [id, view.innerHTML]));
}

test('model text is escaped by the template before it reaches innerHTML', async () => {
  const payload = '<img src=x onerror="alert(1)">';
  const script = await happyScript();
  const ideas = await fixture('content_ideation');
  ideas.ideas[0].hook = payload;
  ideas.ideas[0].script_outline.cta = payload;
  script.content_ideation = [JSON.stringify(ideas)];
  const qa = await fixture('content_qa');
  qa.reviewed[0].reason = payload;
  script.content_qa = [JSON.stringify(qa)];
  const strategy = await fixture('growth_strategist');
  strategy.content_pillars[0].rationale = payload;
  script.growth_strategist = [JSON.stringify(strategy)];
  const brand = await fixture('brand_analyst');
  brand.current_positioning = payload;
  script.brand_analyst = [JSON.stringify(brand)];
  const orchestrator = await fixture('orchestrator');
  orchestrator.metrics_to_track[0].metric = payload;
  orchestrator.calendar_7_days[0].date_label = payload;
  script.orchestrator = [JSON.stringify(orchestrator)];
  const { provider } = createScriptedProvider(script);
  const result = await runPipeline({
    rootDir: sandbox.root,
    clientSlug: 'quillfern',
    runId: 'dash-xss',
    provider,
    now: fixedNow,
    runsDir: path.join(sandbox.root, 'runs-out'),
  });
  const { outPath } = await buildDashboard({
    rootDir: sandbox.root,
    runDir: result.runDir,
    clientDir: path.join(sandbox.root, 'clients', 'quillfern'),
  });
  const views = renderViews(await readFile(outPath, 'utf8'));
  const escaped = '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;';
  for (const id of ['view-brand', 'view-growth', 'view-ideation', 'view-qa', 'view-orchestrator']) {
    const rendered = views[id] ?? '';
    assert.ok(rendered.length > 0, `${id} was rendered`);
    assert.doesNotMatch(rendered, /<img/i, `${id} contains no raw tag from model text`);
    assert.ok(rendered.includes(escaped), `${id} shows the payload as text`);
  }
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
