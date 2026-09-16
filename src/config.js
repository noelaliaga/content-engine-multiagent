import path from 'node:path';
import { readJson } from './fsutil.js';

/**
 * @typedef {object} StepModelConfig
 * @property {string} model
 * @property {number} maxTokens
 * @property {string} [reasoningEffort]
 */

/**
 * @typedef {object} ModelConfig
 * @property {StepModelConfig} defaults
 * @property {Record<string, StepModelConfig>} steps
 */

/**
 * @param {unknown} raw
 * @param {string} where
 * @returns {StepModelConfig}
 */
function parseEntry(raw, where) {
  if (typeof raw !== 'object' || raw === null) throw new Error(`${where} must be an object`);
  const entry = /** @type {Record<string, unknown>} */ (raw);
  if (typeof entry.model !== 'string' || entry.model === '') {
    throw new Error(`${where}.model must be a non-empty string`);
  }
  if (typeof entry.max_tokens !== 'number' || !Number.isInteger(entry.max_tokens) || entry.max_tokens <= 0) {
    throw new Error(`${where}.max_tokens must be a positive integer`);
  }
  /** @type {StepModelConfig} */
  const parsed = { model: entry.model, maxTokens: entry.max_tokens };
  if (typeof entry.reasoning_effort === 'string') parsed.reasoningEffort = entry.reasoning_effort;
  return parsed;
}

/**
 * Loads engine/config/models.json. `CONTENT_ENGINE_MODEL` (if non-empty) overrides every model.
 * @param {string} rootDir
 * @param {Record<string, string | undefined>} [env]
 * @returns {Promise<ModelConfig>}
 */
export async function loadModelConfig(rootDir, env = process.env) {
  const raw = /** @type {Record<string, unknown>} */ (
    await readJson(path.join(rootDir, 'engine', 'config', 'models.json'))
  );
  const defaults = parseEntry(raw.default, 'default');
  /** @type {Record<string, StepModelConfig>} */
  const steps = {};
  const rawSteps = /** @type {Record<string, unknown>} */ (raw.steps ?? {});
  for (const [stepId, value] of Object.entries(rawSteps)) {
    steps[stepId] = parseEntry(value, `steps.${stepId}`);
  }
  const override = env.CONTENT_ENGINE_MODEL?.trim();
  if (override) {
    defaults.model = override;
    for (const entry of Object.values(steps)) entry.model = override;
  }
  return { defaults, steps };
}

/**
 * @param {ModelConfig} config
 * @param {string} stepId
 * @returns {StepModelConfig}
 */
export function modelFor(config, stepId) {
  return config.steps[stepId] ?? config.defaults;
}
