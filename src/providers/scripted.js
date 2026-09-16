import { ProviderError } from '../errors.js';

/**
 * @typedef {import('../types.js').LlmRequest} LlmRequest
 * @typedef {import('../types.js').LlmProvider} LlmProvider
 * @typedef {string | Error | ((request: LlmRequest) => string)} ScriptedReply
 */

/**
 * Test double: replies are consumed in order per step. Records every request.
 * Token usage is a fixed synthetic value so aggregation can be asserted.
 * @param {Partial<Record<string, ScriptedReply[]>>} script
 * @param {{ offline?: boolean, name?: string }} [options]
 * @returns {{ provider: LlmProvider, calls: LlmRequest[] }}
 */
export function createScriptedProvider(script, options = {}) {
  /** @type {LlmRequest[]} */
  const calls = [];
  const queues = new Map(Object.entries(script).map(([stepId, replies]) => [stepId, [...(replies ?? [])]]));
  /** @type {LlmProvider} */
  const provider = {
    name: options.name ?? 'scripted',
    offline: options.offline ?? true,
    async complete(request) {
      calls.push(structuredClone(request));
      const reply = queues.get(request.stepId)?.shift();
      if (reply === undefined) {
        throw new ProviderError(`scripted provider has no reply left for step "${request.stepId}"`);
      }
      if (reply instanceof Error) throw reply;
      const text = typeof reply === 'function' ? reply(request) : reply;
      return { text, usage: { inputTokens: 100, outputTokens: 50 }, model: 'scripted' };
    },
  };
  return { provider, calls };
}
