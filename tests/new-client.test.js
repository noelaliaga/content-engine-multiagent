import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { promisify } from 'node:util';
import { CLIENT_FILES, createClient } from '../src/clients.js';
import { InputError } from '../src/errors.js';
import { makeSandbox, REPO_ROOT } from './helpers.js';

const run = promisify(execFile);

/** @type {{ root: string, cleanup: () => Promise<void> }} */
let sandbox;
before(async () => {
  sandbox = await makeSandbox();
});
after(async () => {
  await sandbox.cleanup();
});

test('createClient scaffolds the expected structure from the template', async () => {
  const clientsDir = path.join(sandbox.root, 'clients');
  const { clientDir, files } = await createClient({ clientsDir, slug: 'acme-widgets' });

  assert.equal(clientDir, path.join(clientsDir, 'acme-widgets'));
  assert.deepEqual((await readdir(clientDir)).sort(), [...CLIENT_FILES, 'runs'].sort());
  assert.ok((await stat(path.join(clientDir, 'runs'))).isDirectory());
  assert.equal(files.length, CLIENT_FILES.length);

  const log = await readFile(path.join(clientDir, 'learning_log.md'), 'utf8');
  assert.match(log, /# Learning log — acme-widgets/);
  assert.doesNotMatch(log, /\{\{CLIENT_SLUG\}\}/);

  const runContext = JSON.parse(await readFile(path.join(clientDir, 'run_context.json'), 'utf8'));
  assert.ok(runContext.brand && runContext.goal && Array.isArray(runContext.constraints));
});

test('createClient refuses bad slugs and existing clients', async () => {
  const clientsDir = path.join(sandbox.root, 'clients');
  for (const slug of ['', 'Upper', '../x', 'with space', '-dash-first']) {
    await assert.rejects(createClient({ clientsDir, slug }), InputError, `slug "${slug}"`);
  }
  await assert.rejects(createClient({ clientsDir, slug: 'quillfern' }), /already exists/);
});

test('createClient fails clearly when the template is incomplete', async () => {
  const empty = path.join(sandbox.root, 'no-template');
  await assert.rejects(createClient({ clientsDir: empty, slug: 'x' }), /template file missing/);
});

test('bin/new-client.js creates a client and prints next steps', async () => {
  const { stdout } = await run(process.execPath, [
    path.join(REPO_ROOT, 'bin', 'new-client.js'),
    'cli-client',
    '--root',
    sandbox.root,
  ]);
  assert.match(stdout, /created .*cli-client/);
  assert.match(stdout, /--live/);
  await stat(path.join(sandbox.root, 'clients', 'cli-client', 'context.md'));
});

test('bin/new-client.js exits non-zero without a slug', async () => {
  await assert.rejects(run(process.execPath, [path.join(REPO_ROOT, 'bin', 'new-client.js')]), (error) => {
    assert.equal(/** @type {{ code?: number }} */ (error).code, 2);
    return true;
  });
});
