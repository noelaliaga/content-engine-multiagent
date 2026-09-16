import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';

/** @typedef {import('./contracts.js').LearningLogEntry} LearningLogEntry */

const RUN_HEADING = /^## Run: /m;

/**
 * Returns the client's learning log, or null if it does not exist or has no run entries yet.
 * @param {string} clientDir
 * @returns {Promise<string | null>}
 */
export async function loadLearningLog(clientDir) {
  try {
    const text = await readFile(path.join(clientDir, 'learning_log.md'), 'utf8');
    return RUN_HEADING.test(text) ? text : null;
  } catch {
    return null;
  }
}

/**
 * Appends one entry. Only called for runs against a real model.
 * @param {string} clientDir
 * @param {string} runId
 * @param {LearningLogEntry} entry
 * @param {Date} at
 */
export async function appendLearningLog(clientDir, runId, entry, at) {
  const bullets = (/** @type {string[]} */ items) => items.map((item) => `- ${item}`);
  const block = [
    '',
    `## Run: ${runId} — ${at.toISOString()}`,
    '',
    '**What worked:**',
    ...bullets(entry.what_worked),
    '',
    '**What was rejected and why:**',
    ...bullets(entry.what_was_rejected_and_why),
    '',
    '**Recommendations for the next run:**',
    ...bullets(entry.next_run_recommendations),
    '',
  ].join('\n');
  await appendFile(path.join(clientDir, 'learning_log.md'), block, 'utf8');
}
