// Shared test helpers. Every test runs against a temporary copy of engine/ and clients/,
// with a scripted or fixture provider: no network, no API key, no real model.

import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const STEP_ORDER = [
  'brand_analyst',
  'growth_strategist',
  'content_ideation',
  'content_qa',
  'orchestrator',
];

/**
 * Creates a throwaway project root with engine/ and clients/ copied from the repo.
 * @returns {Promise<{ root: string, cleanup: () => Promise<void> }>}
 */
export async function makeSandbox() {
  const root = await mkdtemp(path.join(tmpdir(), 'content-engine-test-'));
  await cp(path.join(REPO_ROOT, 'engine'), path.join(root, 'engine'), { recursive: true });
  await cp(path.join(REPO_ROOT, 'clients'), path.join(root, 'clients'), {
    recursive: true,
    filter: (source) => !source.split(path.sep).includes('runs'),
  });
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

/**
 * Raw text of the synthetic fixture for one step.
 * @param {string} stepId
 */
export async function fixtureText(stepId) {
  return readFile(path.join(REPO_ROOT, 'engine', 'fixtures', `${stepId}.json`), 'utf8');
}

/**
 * Parsed fixture, for tests that mutate it.
 * @param {string} stepId
 * @returns {Promise<any>}
 */
export async function fixture(stepId) {
  return JSON.parse(await fixtureText(stepId));
}

/**
 * A script where every step answers once with its valid fixture.
 * @returns {Promise<Record<string, import('../src/providers/scripted.js').ScriptedReply[]>>}
 */
export async function happyScript() {
  /** @type {Record<string, import('../src/providers/scripted.js').ScriptedReply[]>} */
  const script = {};
  for (const stepId of STEP_ORDER) script[stepId] = [await fixtureText(stepId)];
  return script;
}

/**
 * @param {string} filePath
 * @returns {Promise<any>}
 */
export async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

/** Fixed clock so run ids and timestamps are deterministic. */
export function fixedNow() {
  return new Date('2030-01-02T03:04:05.000Z');
}
