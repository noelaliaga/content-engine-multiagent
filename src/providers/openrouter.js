// Live provider over OpenRouter's OpenAI-compatible Chat Completions API, using
// `response_format: json_schema` (strict) for structured outputs. Uses global fetch; no SDK.
// Not exercised against the real API by the test suite (see README, "Status").

import { ProviderError } from '../errors.js';

/**
 * @typedef {import('../types.js').LlmRequest} LlmRequest
 * @typedef {import('../types.js').LlmResponse} LlmResponse
 * @typedef {import('../types.js').LlmProvider} LlmProvider
 */

export const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * @typedef {object} ChatCompletionResponse
 * @property {Array<{ finish_reason?: string | null, message?: { content?: string | null, refusal?: string | null } }>} [choices]
 * @property {{ prompt_tokens?: number, completion_tokens?: number }} [usage]
 * @property {string} [model]
 * @property {{ message?: string }} [error]
 */

/**
 * @param {LlmRequest} request
 * @returns {Record<string, unknown>}
 */
export function buildRequestBody(request) {
  /** @type {Record<string, unknown>} */
  const body = {
    model: request.model,
    max_tokens: request.maxTokens,
    messages: [{ role: 'system', content: request.system }, ...request.messages],
    response_format: {
      type: 'json_schema',
      json_schema: { name: request.stepId, strict: true, schema: request.schema },
    },
  };
  if (request.reasoningEffort) body.reasoning = { effort: request.reasoningEffort };
  return body;
}

/**
 * @param {string} raw
 * @param {string} stepId
 * @returns {LlmResponse}
 */
export function parseChatCompletion(raw, stepId) {
  /** @type {ChatCompletionResponse} */
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new ProviderError(`[${stepId}] provider response is not JSON`);
  }
  if (data.error) {
    throw new ProviderError(`[${stepId}] provider error: ${data.error.message ?? 'unknown'}`);
  }
  const choice = data.choices?.[0];
  if (!choice) throw new ProviderError(`[${stepId}] provider response has no choices`);
  if (choice.message?.refusal) {
    throw new ProviderError(`[${stepId}] model refused: ${choice.message.refusal.slice(0, 200)}`);
  }
  if (choice.finish_reason === 'length') {
    throw new ProviderError(
      `[${stepId}] output truncated by max_tokens; raise max_tokens for this step in engine/config/models.json`,
    );
  }
  const content = choice.message?.content;
  if (typeof content !== 'string' || content === '') {
    throw new ProviderError(`[${stepId}] provider response has empty content`);
  }
  return {
    text: content,
    usage: {
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    },
    model: data.model,
  };
}

/**
 * @typedef {object} OpenRouterOptions
 * @property {string} apiKey
 * @property {string} [baseUrl]
 * @property {typeof fetch} [fetchImpl]
 * @property {number} [timeoutMs]
 */

/**
 * @param {OpenRouterOptions} options
 * @returns {LlmProvider}
 */
export function createOpenRouterProvider(options) {
  if (!options.apiKey) throw new ProviderError('an API key is required for the live provider');
  const baseUrl = (options.baseUrl || DEFAULT_OPENROUTER_BASE_URL).replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 300_000;
  return {
    name: 'openrouter',
    offline: false,
    async complete(request) {
      /** @type {Response} */
      let response;
      try {
        response = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            'content-type': 'application/json',
            'x-title': 'content-engine-multiagent',
          },
          body: JSON.stringify(buildRequestBody(request)),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new ProviderError(`[${request.stepId}] request failed: ${reason}`, { cause: error });
      }
      const raw = await response.text();
      if (!response.ok) {
        throw new ProviderError(
          `[${request.stepId}] provider returned HTTP ${response.status}: ${raw.slice(0, 300)}`,
          { status: response.status },
        );
      }
      return parseChatCompletion(raw, request.stepId);
    },
  };
}
