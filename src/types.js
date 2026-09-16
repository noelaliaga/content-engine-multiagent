// Shared JSDoc types. Type-checked with `tsc --checkJs --strict` (see tsconfig.json).

/**
 * @typedef {'user' | 'assistant'} ChatRole
 * @typedef {{ role: ChatRole, content: string }} ChatMessage
 * @typedef {{ inputTokens: number, outputTokens: number }} TokenUsage
 */

/**
 * One structured-output request for one pipeline step.
 * @typedef {object} LlmRequest
 * @property {string} stepId
 * @property {string} model
 * @property {number} maxTokens
 * @property {string} [reasoningEffort]
 * @property {string} system
 * @property {ChatMessage[]} messages
 * @property {Record<string, unknown>} schema JSON Schema the output must satisfy.
 */

/**
 * @typedef {object} LlmResponse
 * @property {string} text Raw text returned by the model; the pipeline parses and validates it.
 * @property {TokenUsage} [usage]
 * @property {string} [model]
 */

/**
 * Provider abstraction. `offline: true` means no real model is called; such runs are
 * written to `<run_id>__mock/` and never touch the client's learning log.
 * @typedef {object} LlmProvider
 * @property {string} name
 * @property {boolean} offline
 * @property {(request: LlmRequest) => Promise<LlmResponse>} complete
 */

export {};
