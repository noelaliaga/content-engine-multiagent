import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ProviderError } from '../src/errors.js';
import {
  buildRequestBody,
  createOpenRouterProvider,
  parseChatCompletion,
} from '../src/providers/openrouter.js';

// The live provider is tested against a fake `fetch`. No request leaves the machine.

/** @type {import('../src/types.js').LlmRequest} */
const REQUEST = {
  stepId: 'growth_strategist',
  model: 'vendor/model-x',
  maxTokens: 1234,
  reasoningEffort: 'high',
  system: 'system prompt',
  messages: [{ role: 'user', content: '{"hello":"world"}' }],
  schema: { type: 'object' },
};

/**
 * @param {number} status
 * @param {unknown} body
 */
function fakeFetch(status, body) {
  /** @type {{ url: string, init: RequestInit }[]} */
  const seen = [];
  /** @type {typeof fetch} */
  const impl = async (url, init) => {
    seen.push({ url: String(url), init: init ?? {} });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  };
  return { impl, seen };
}

/** @param {Record<string, unknown>} choice */
function completion(choice) {
  return { model: 'vendor/model-x', choices: [choice], usage: { prompt_tokens: 11, completion_tokens: 7 } };
}

describe('OpenRouter provider (mocked HTTP)', () => {
  test('builds a strict json_schema request', () => {
    const body = buildRequestBody(REQUEST);
    assert.equal(body.model, 'vendor/model-x');
    assert.equal(body.max_tokens, 1234);
    assert.deepEqual(body.reasoning, { effort: 'high' });
    assert.deepEqual(body.messages, [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: '{"hello":"world"}' },
    ]);
    assert.deepEqual(body.response_format, {
      type: 'json_schema',
      json_schema: { name: 'growth_strategist', strict: true, schema: { type: 'object' } },
    });
    assert.equal(buildRequestBody({ ...REQUEST, reasoningEffort: undefined }).reasoning, undefined);
  });

  test('posts to the configured base URL with the key from options and returns text + usage', async () => {
    const { impl, seen } = fakeFetch(
      200,
      completion({ finish_reason: 'stop', message: { content: '{"ok":true}' } }),
    );
    const provider = createOpenRouterProvider({
      apiKey: 'test-key-not-real',
      baseUrl: 'https://llm.example.com/v1/',
      fetchImpl: impl,
    });
    assert.equal(provider.offline, false);
    const response = await provider.complete(REQUEST);
    assert.equal(response.text, '{"ok":true}');
    assert.deepEqual(response.usage, { inputTokens: 11, outputTokens: 7 });
    assert.equal(seen[0]?.url, 'https://llm.example.com/v1/chat/completions');
    const headers = /** @type {Record<string, string>} */ (seen[0]?.init.headers);
    assert.equal(headers.authorization, 'Bearer test-key-not-real');
  });

  test('requires an API key', () => {
    assert.throws(() => createOpenRouterProvider({ apiKey: '' }), ProviderError);
  });

  test('HTTP errors become ProviderError with the status', async () => {
    const { impl } = fakeFetch(401, { error: { message: 'bad key' } });
    const provider = createOpenRouterProvider({ apiKey: 'k', fetchImpl: impl });
    await assert.rejects(provider.complete(REQUEST), (error) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.status, 401);
      assert.match(error.message, /HTTP 401/);
      return true;
    });
  });

  test('network failures become ProviderError', async () => {
    /** @type {typeof fetch} */
    const failing = async () => {
      throw new TypeError('fetch failed');
    };
    const provider = createOpenRouterProvider({ apiKey: 'k', fetchImpl: failing });
    await assert.rejects(provider.complete(REQUEST), /request failed: fetch failed/);
  });

  test('truncation, refusals, empty content and error bodies are surfaced, not parsed', () => {
    assert.throws(
      () =>
        parseChatCompletion(
          JSON.stringify(completion({ finish_reason: 'length', message: { content: '{"a":' } })),
          's',
        ),
      /truncated by max_tokens/,
    );
    assert.throws(
      () =>
        parseChatCompletion(JSON.stringify(completion({ message: { content: null, refusal: 'no' } })), 's'),
      /model refused/,
    );
    assert.throws(
      () => parseChatCompletion(JSON.stringify(completion({ message: { content: '' } })), 's'),
      /empty content/,
    );
    assert.throws(() => parseChatCompletion(JSON.stringify({ choices: [] }), 's'), /no choices/);
    assert.throws(() => parseChatCompletion(JSON.stringify({ error: { message: 'boom' } }), 's'), /boom/);
    assert.throws(() => parseChatCompletion('<html>', 's'), /not JSON/);
  });
});

describe('API key redaction', () => {
  test('a key echoed in an HTTP error body is redacted from the error', async () => {
    const key = 'sk-test-fake-1111-not-a-real-key';
    const { impl } = fakeFetch(400, { error: { message: `invalid header Authorization: Bearer ${key}` } });
    const provider = createOpenRouterProvider({ apiKey: key, fetchImpl: impl });
    await assert.rejects(provider.complete(REQUEST), (error) => {
      assert.ok(error instanceof ProviderError);
      assert.ok(!error.message.includes(key));
      assert.match(error.message, /Bearer \[REDACTED\]/);
      return true;
    });
  });

  test('a key echoed in a 200 error payload or a network error is redacted too', async () => {
    const key = 'sk-test-fake-2222-not-a-real-key';
    const { impl } = fakeFetch(200, { error: { message: `key ${key} is disabled` } });
    const provider = createOpenRouterProvider({ apiKey: key, fetchImpl: impl });
    await assert.rejects(provider.complete(REQUEST), (error) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.message, '[growth_strategist] provider error: key [REDACTED] is disabled');
      return true;
    });

    /** @type {typeof fetch} */
    const failing = async () => {
      throw new TypeError(`connect failed for token ${key}`);
    };
    const offline = createOpenRouterProvider({ apiKey: key, fetchImpl: failing });
    await assert.rejects(offline.complete(REQUEST), (error) => {
      assert.ok(error instanceof ProviderError);
      assert.ok(!error.message.includes(key));
      return true;
    });
  });
});
