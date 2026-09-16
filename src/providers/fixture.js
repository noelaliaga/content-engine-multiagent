import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ProviderError } from '../errors.js';

/**
 * Offline provider: returns engine/fixtures/<stepId>.json verbatim. No network, no key, no cost.
 * The output still goes through JSON parsing, schema validation, invariants and normalisation.
 * @param {string} fixturesDir
 * @returns {import('../types.js').LlmProvider}
 */
export function createFixtureProvider(fixturesDir) {
  return {
    name: 'mock-fixtures',
    offline: true,
    async complete(request) {
      const file = path.join(fixturesDir, `${request.stepId}.json`);
      try {
        const text = await readFile(file, 'utf8');
        return { text, usage: { inputTokens: 0, outputTokens: 0 }, model: 'mock' };
      } catch (error) {
        throw new ProviderError(`no fixture for step "${request.stepId}" (${path.basename(file)})`, {
          cause: error,
        });
      }
    },
  };
}
