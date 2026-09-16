import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { loadModelConfig, modelFor } from '../src/config.js';
import { makeSandbox, REPO_ROOT, STEP_ORDER } from './helpers.js';

/** @type {{ root: string, cleanup: () => Promise<void> }} */
let sandbox;
before(async () => {
  sandbox = await makeSandbox();
});
after(async () => {
  await sandbox.cleanup();
});

test('the bundled models.json configures every step', async () => {
  const config = await loadModelConfig(REPO_ROOT, {});
  for (const stepId of STEP_ORDER) {
    const entry = modelFor(config, stepId);
    assert.ok(entry.model.length > 0);
    assert.ok(Number.isInteger(entry.maxTokens) && entry.maxTokens > 0);
  }
  assert.equal(modelFor(config, 'unknown_step'), config.defaults);
});

test('CONTENT_ENGINE_MODEL overrides every model; blank values are ignored', async () => {
  const overridden = await loadModelConfig(REPO_ROOT, { CONTENT_ENGINE_MODEL: ' vendor/other-model ' });
  assert.equal(overridden.defaults.model, 'vendor/other-model');
  for (const stepId of STEP_ORDER) assert.equal(modelFor(overridden, stepId).model, 'vendor/other-model');

  const untouched = await loadModelConfig(REPO_ROOT, { CONTENT_ENGINE_MODEL: '   ' });
  assert.notEqual(untouched.defaults.model, '');
});

test('malformed config is rejected with a pointer to the field', async () => {
  const root = path.join(sandbox.root, 'bad-config');
  await mkdir(path.join(root, 'engine', 'config'), { recursive: true });
  await writeFile(
    path.join(root, 'engine', 'config', 'models.json'),
    JSON.stringify({
      default: { model: 'm', max_tokens: 10 },
      steps: { content_qa: { model: 'm', max_tokens: 0 } },
    }),
  );
  await assert.rejects(loadModelConfig(root, {}), /steps\.content_qa\.max_tokens must be a positive integer/);
});
