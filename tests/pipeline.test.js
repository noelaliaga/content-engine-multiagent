import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { InputError, ProviderError, StepBlockedError, StepFailedError } from '../src/errors.js';
import { HONESTY_NOTES, runPipeline } from '../src/pipeline.js';
import { createFixtureProvider } from '../src/providers/fixture.js';
import {
  fixedNow,
  fixture,
  fixtureText,
  happyScript,
  makeSandbox,
  readJsonFile,
  STEP_ORDER,
} from './helpers.js';
import { createScriptedProvider } from './support/scripted-provider.js';

/** @type {{ root: string, cleanup: () => Promise<void> }} */
let sandbox;

before(async () => {
  sandbox = await makeSandbox();
});
after(async () => {
  await sandbox.cleanup();
});

/**
 * @param {Partial<import('../src/pipeline.js').RunOptions> & { provider: import('../src/types.js').LlmProvider }} options
 */
function run(options) {
  return runPipeline({
    rootDir: sandbox.root,
    clientSlug: 'quillfern',
    now: fixedNow,
    runsDir: path.join(sandbox.root, 'test-runs'),
    overwrite: true,
    ...options,
  });
}

describe('orchestration of the five steps', () => {
  test('runs the steps in order and chains validated outputs between them', async () => {
    const { provider, calls } = createScriptedProvider(await happyScript());
    const result = await run({ provider, runId: 'happy' });

    assert.deepEqual(
      calls.map((call) => call.stepId),
      STEP_ORDER,
    );
    assert.equal(result.state.status, 'completed');
    assert.equal(result.state.steps.length, 5);
    assert.ok(result.state.steps.every((step) => step.status === 'completed' && step.attempts === 1));
    assert.deepEqual(result.state.usage_total, { calls: 5, input_tokens: 500, output_tokens: 250 });

    const inputs = calls.map((call) => JSON.parse(call.messages[0]?.content ?? '{}'));
    const brand = await fixture('brand_analyst');
    const strategy = await fixture('growth_strategist');
    const ideation = await fixture('content_ideation');
    assert.equal(inputs[0].run_context.brand.name, 'Quillfern Plant Co.');
    assert.equal(inputs[0].run_context.run_id, 'happy');
    assert.equal(inputs[0].learning_log, null, 'a log without run entries is sent as null');
    assert.deepEqual(inputs[1].brand_analysis, brand);
    assert.deepEqual(inputs[2].growth_strategy, strategy);
    assert.deepEqual(inputs[3].content_ideas, ideation.ideas);
    assert.equal(inputs[4].qa_review.summary.approved, 6);
  });

  test('sends each step its prompt, the JSON Schema and the configured model', async () => {
    const { provider, calls } = createScriptedProvider(await happyScript());
    await run({ provider, runId: 'prompts' });
    for (const call of calls) {
      assert.match(call.system, /# Output contract \(JSON Schema\)/);
      assert.equal(call.schema.type, 'object');
      assert.ok(call.model.length > 0);
      assert.ok(call.maxTokens > 0);
    }
    assert.match(calls[0]?.system ?? '', /Brand Analyst/);
    assert.match(calls[0]?.system ?? '', /# Knowledge base/);
    assert.doesNotMatch(calls[4]?.system ?? '', /# Knowledge base/, 'the orchestrator does not need the KB');
  });

  test('writes every output, state.json and adds honesty notes by code', async () => {
    const { provider } = createScriptedProvider(await happyScript());
    const result = await run({ provider, runId: 'files' });
    assert.equal(path.basename(result.runDir), 'files__mock', 'offline runs are kept apart');
    for (const file of [
      '01_brand_analyst.json',
      '02_growth_strategist.json',
      '03_content_ideation.json',
      '04_content_qa.json',
      '05_orchestrator.json',
    ]) {
      await readJsonFile(path.join(result.runDir, file));
    }
    const state = await readJsonFile(path.join(result.runDir, 'state.json'));
    assert.equal(state.status, 'completed');
    assert.equal(state.offline, true);
    const final = await readJsonFile(path.join(result.runDir, '05_orchestrator.json'));
    assert.deepEqual(final.honesty_notes, [...HONESTY_NOTES]);
    assert.equal(final.learning_log_entry.run_id, 'files', 'run id comes from the engine, not the model');
  });

  test('the bundled fixture provider completes the demo offline', async () => {
    const provider = createFixtureProvider(path.join(sandbox.root, 'engine', 'fixtures'));
    const result = await run({ provider, runId: 'fixtures' });
    assert.equal(result.state.status, 'completed');
    assert.equal(result.final.calendar_7_days.length, 7);
  });

  test('only non-offline runs append to the learning log', async () => {
    const logPath = path.join(sandbox.root, 'clients', 'quillfern', 'learning_log.md');
    const before = await readFile(logPath, 'utf8');

    const offline = createScriptedProvider(await happyScript());
    await run({ provider: offline.provider, runId: 'offline-log' });
    assert.equal(await readFile(logPath, 'utf8'), before);

    const live = createScriptedProvider(await happyScript(), { offline: false, name: 'fake-live' });
    const result = await run({ provider: live.provider, runId: 'live-log' });
    assert.equal(path.basename(result.runDir), 'live-log');
    const afterText = await readFile(logPath, 'utf8');
    assert.ok(afterText.startsWith(before));
    assert.match(afterText, /## Run: live-log/);
    assert.match(afterText, /idea_08 was rejected/);

    // The next run sees the log as context for the Brand Analyst.
    const next = createScriptedProvider(await happyScript());
    await run({ provider: next.provider, runId: 'after-log' });
    const input = JSON.parse(next.calls[0]?.messages[0]?.content ?? '{}');
    assert.match(input.learning_log, /## Run: live-log/);
  });
});

describe('JSON Schema validation and retries', () => {
  test('non-JSON output is rejected and retried with the validator feedback', async () => {
    const script = await happyScript();
    script.brand_analyst = ['Sure! Here is the analysis: {', await fixtureText('brand_analyst')];
    const { provider, calls } = createScriptedProvider(script);
    const result = await run({ provider, runId: 'retry-json' });

    const step = result.state.steps[0];
    assert.equal(step?.attempts, 2);
    assert.equal(step?.rejected_attempts.length, 1);
    assert.match(step?.rejected_attempts[0]?.[0] ?? '', /not valid JSON/);

    const retry = calls[1];
    assert.equal(retry?.stepId, 'brand_analyst');
    assert.equal(retry?.messages.length, 3);
    assert.equal(retry?.messages[1]?.role, 'assistant');
    assert.match(retry?.messages[2]?.content ?? '', /rejected by the pipeline validator/);
  });

  test('markdown-fenced JSON is not silently repaired', async () => {
    const script = await happyScript();
    const valid = await fixtureText('growth_strategist');
    script.growth_strategist = [`\`\`\`json\n${valid}\n\`\`\``, valid];
    const { provider } = createScriptedProvider(script);
    const result = await run({ provider, runId: 'retry-fence' });
    assert.equal(result.state.steps[1]?.attempts, 2);
  });

  test('well-formed JSON with the wrong shape is rejected with precise errors', async () => {
    const bad = await fixture('content_ideation');
    bad.ideas[0].format = 'podcast';
    delete bad.ideas[1].hook;
    bad.ideas[2].extra_field = true;
    const script = await happyScript();
    script.content_ideation = [JSON.stringify(bad), await fixtureText('content_ideation')];
    const { provider } = createScriptedProvider(script);
    const result = await run({ provider, runId: 'retry-schema' });

    const errors = result.state.steps[2]?.rejected_attempts[0] ?? [];
    assert.ok(errors.some((e) => e.includes('/ideas/0/format must be one of')));
    assert.ok(errors.some((e) => e.includes("must have required property 'hook'")));
    assert.ok(errors.some((e) => e.includes('unexpected property "extra_field"')));
  });

  test('a step that keeps failing validation stops the run without fabricating output', async () => {
    const bad = await fixture('growth_strategist');
    bad.content_mix.reach = 'a lot';
    const script = await happyScript();
    script.growth_strategist = [JSON.stringify(bad), JSON.stringify(bad)];
    const { provider, calls } = createScriptedProvider(script);

    await assert.rejects(
      run({ provider, runId: 'exhausted' }),
      (error) =>
        error instanceof StepFailedError &&
        error.stepId === 'growth_strategist' &&
        error.attemptErrors.length === 2,
    );
    assert.deepEqual(
      calls.map((call) => call.stepId),
      ['brand_analyst', 'growth_strategist', 'growth_strategist'],
      'later steps never run',
    );

    const runDir = path.join(sandbox.root, 'test-runs', 'exhausted__mock');
    const state = await readJsonFile(path.join(runDir, 'state.json'));
    assert.equal(state.status, 'failed');
    assert.equal(state.steps[1].status, 'failed');
    const errorFile = await readJsonFile(path.join(runDir, 'ERROR.json'));
    assert.equal(errorFile.step, 'growth_strategist');
    assert.equal(errorFile.type, 'StepFailedError');
    assert.equal(errorFile.rejected_attempts.length, 2);
    await assert.rejects(readFile(path.join(runDir, '02_growth_strategist.json')), { code: 'ENOENT' });
  });

  test('maxAttempts controls the retry budget', async () => {
    const script = await happyScript();
    script.brand_analyst = ['nope', 'still nope', await fixtureText('brand_analyst')];
    const one = createScriptedProvider(structuredClone(script));
    await assert.rejects(run({ provider: one.provider, runId: 'budget-1', maxAttempts: 1 }), StepFailedError);
    assert.equal(one.calls.length, 1);

    const three = createScriptedProvider(structuredClone(script));
    const result = await run({ provider: three.provider, runId: 'budget-3', maxAttempts: 3 });
    assert.equal(result.state.steps[0]?.attempts, 3);

    await assert.rejects(run({ provider: three.provider, maxAttempts: 0 }), InputError);
  });
});

describe('cross-step invariants (hallucination containment)', () => {
  test('an idea that invents a pillar is rejected and retried', async () => {
    const bad = await fixture('content_ideation');
    bad.ideas[0].pillar = 'A pillar nobody defined';
    const script = await happyScript();
    script.content_ideation = [JSON.stringify(bad), await fixtureText('content_ideation')];
    const { provider } = createScriptedProvider(script);
    const result = await run({ provider, runId: 'invented-pillar' });
    const errors = result.state.steps[2]?.rejected_attempts[0] ?? [];
    assert.ok(errors.some((e) => e.includes('unknown pillar "A pillar nobody defined"')));
  });

  test('content mix percentages must add up to 100', async () => {
    const bad = await fixture('growth_strategist');
    bad.content_mix.convert = 50;
    const script = await happyScript();
    script.growth_strategist = [JSON.stringify(bad), await fixtureText('growth_strategist')];
    const { provider } = createScriptedProvider(script);
    const result = await run({ provider, runId: 'mix' });
    assert.match(
      result.state.steps[1]?.rejected_attempts[0]?.[0] ?? '',
      /reach \+ nurture \+ convert must equal 100/,
    );
  });

  test('QA must review exactly the generated ideas', async () => {
    const bad = await fixture('content_qa');
    bad.reviewed.pop();
    bad.reviewed[0].id = 'idea_99';
    const script = await happyScript();
    script.content_qa = [JSON.stringify(bad), await fixtureText('content_qa')];
    const { provider } = createScriptedProvider(script);
    const result = await run({ provider, runId: 'qa-ids' });
    const errors = result.state.steps[3]?.rejected_attempts[0] ?? [];
    assert.ok(errors.includes('reviewed id "idea_99" does not match any idea'));
    assert.ok(errors.includes('idea "idea_08" was not reviewed'));
  });

  test('the orchestrator may not schedule a rejected or unknown idea', async () => {
    const bad = await fixture('orchestrator');
    bad.calendar_7_days[0].idea_id = 'idea_08';
    bad.calendar_7_days[1].idea_id = 'idea_42';
    const script = await happyScript();
    script.orchestrator = [JSON.stringify(bad), JSON.stringify(bad)];
    const { provider } = createScriptedProvider(script);
    await assert.rejects(run({ provider, runId: 'bad-calendar' }), (error) => {
      assert.ok(error instanceof StepFailedError);
      const errors = error.attemptErrors[0] ?? [];
      assert.ok(errors.includes('calendar_7_days[0] schedules rejected idea "idea_08"'));
      assert.ok(errors.includes('calendar_7_days[1] references unknown idea_id "idea_42"'));
      return true;
    });
  });
});

describe('calendar feasibility', () => {
  /**
   * QA where only the listed ideas survive; every other idea gets claim_safety 0.
   * @param {string[]} keep
   */
  async function qaKeeping(keep) {
    const qa = await fixture('content_qa');
    for (const review of qa.reviewed) {
      if (!keep.includes(review.id)) review.scores.claim_safety = 0;
    }
    return JSON.stringify(qa);
  }

  test('ideation with fewer ideas than the minimum is rejected', async () => {
    const short = await fixture('content_ideation');
    short.ideas = short.ideas.slice(0, 4);
    const script = await happyScript();
    script.content_ideation = [JSON.stringify(short), await fixtureText('content_ideation')];
    const { provider, calls } = createScriptedProvider(script);
    const result = await run({ provider, runId: 'few-ideas' });
    assert.ok(
      (result.state.steps[2]?.rejected_attempts[0] ?? []).includes(
        'ideas must contain at least 8 ideas, got 4',
      ),
    );
    const input = JSON.parse(calls[2]?.messages[0]?.content ?? '{}');
    assert.equal(input.min_ideas, 8, 'the minimum is sent to the model');
  });

  test('with fewer than 7 schedulable ideas the calendar may repeat them', async () => {
    const script = await happyScript();
    script.content_qa = [await qaKeeping(['idea_01', 'idea_02', 'idea_07'])];
    const calendar = await fixture('orchestrator');
    const ids = ['idea_01', 'idea_02', 'idea_07', 'idea_01', 'idea_02', 'idea_01', 'idea_02'];
    calendar.calendar_7_days.forEach((/** @type {{ idea_id: string }} */ entry, /** @type {number} */ i) => {
      entry.idea_id = ids[i] ?? '';
    });
    script.orchestrator = [JSON.stringify(calendar)];
    const { provider } = createScriptedProvider(script);
    const result = await run({ provider, runId: 'repeat-ok' });
    assert.equal(result.state.status, 'completed');
    assert.deepEqual(
      result.final.calendar_7_days.map((entry) => entry.idea_id),
      ids,
    );
    assert.equal(result.final.calendar_7_days[2]?.status, 'revise_before_publish');
  });

  test('repeating an idea is rejected when 7 or more ideas can be scheduled', async () => {
    const calendar = await fixture('orchestrator');
    calendar.calendar_7_days[1].idea_id = 'idea_01';
    const script = await happyScript();
    script.orchestrator = [JSON.stringify(calendar), await fixtureText('orchestrator')];
    const { provider } = createScriptedProvider(script);
    const result = await run({ provider, runId: 'repeat-bad' });
    assert.ok(
      (result.state.steps[4]?.rejected_attempts[0] ?? []).includes(
        'calendar_7_days repeats idea "idea_01" although 7 ideas can be scheduled',
      ),
    );
  });

  test('if QA rejects every idea the orchestrator is never called', async () => {
    const script = await happyScript();
    script.content_qa = [await qaKeeping([])];
    const { provider, calls } = createScriptedProvider(script);
    await assert.rejects(run({ provider, runId: 'nothing-left' }), (error) => {
      assert.ok(error instanceof StepBlockedError);
      assert.equal(error.stepId, 'orchestrator');
      assert.match(error.message, /no idea survived QA/);
      return true;
    });
    assert.equal(calls.filter((call) => call.stepId === 'orchestrator').length, 0);
    const errorFile = await readJsonFile(
      path.join(sandbox.root, 'test-runs', 'nothing-left__mock', 'ERROR.json'),
    );
    assert.equal(errorFile.type, 'StepBlockedError');
    assert.equal(errorFile.step, 'orchestrator');
  });
});

describe('deterministic normalisation', () => {
  test('QA average, verdict and summary are recomputed from the scores', async () => {
    const lying = await fixture('content_qa');
    lying.reviewed[7].verdict = 'approved'; // idea_08 averages 3.0 but claim_safety 0 -> rejected
    lying.reviewed[7].average_score = 4.9;
    lying.summary = { approved: 8, revise: 0, rejected: 0 };
    const script = await happyScript();
    script.content_qa = [JSON.stringify(lying)];
    const { provider } = createScriptedProvider(script);
    const result = await run({ provider, runId: 'normalize-qa' });

    const qa = await readJsonFile(path.join(result.runDir, '04_content_qa.json'));
    assert.equal(qa.reviewed[7].verdict, 'rejected');
    assert.equal(qa.reviewed[7].average_score, 3);
    assert.deepEqual(qa.summary, { approved: 6, revise: 1, rejected: 1 });
    const adjustments = result.state.steps[3]?.adjustments ?? [];
    assert.ok(adjustments.includes('idea_08: verdict approved -> rejected'));
    assert.ok(adjustments.some((a) => a.startsWith('summary ')));
    assert.ok(
      adjustments.includes('idea_08: claim_safety 0 forces rejected (average 3 alone would be revise)'),
    );
  });

  test('an unsafe claim is rejected whatever the other scores, and cannot be scheduled', async () => {
    const qa = await fixture('content_qa');
    const review = qa.reviewed[0]; // idea_01, scheduled on day 1 by the orchestrator fixture
    review.scores = {
      on_brand: 5,
      hook_strength: 5,
      pillar_fit: 5,
      offer_connection: 5,
      feasibility: 5,
      originality: 5,
      claim_safety: 0,
    };
    review.average_score = 4.29;
    review.verdict = 'approved';
    const script = await happyScript();
    script.content_qa = [JSON.stringify(qa)];
    const orchestrator = await fixtureText('orchestrator');
    script.orchestrator = [orchestrator, orchestrator];
    const { provider } = createScriptedProvider(script);

    await assert.rejects(run({ provider, runId: 'claim-rule' }), (error) => {
      assert.ok(error instanceof StepFailedError);
      assert.equal(error.stepId, 'orchestrator');
      assert.ok(error.attemptErrors[0]?.includes('calendar_7_days[0] schedules rejected idea "idea_01"'));
      return true;
    });
    const saved = await readJsonFile(
      path.join(sandbox.root, 'test-runs', 'claim-rule__mock', '04_content_qa.json'),
    );
    assert.equal(saved.reviewed[0].average_score, 4.29);
    assert.equal(saved.reviewed[0].verdict, 'rejected');
    const state = await readJsonFile(path.join(sandbox.root, 'test-runs', 'claim-rule__mock', 'state.json'));
    assert.ok(
      state.steps[3].adjustments.includes(
        'idea_01: claim_safety 0 forces rejected (average 4.29 alone would be approved)',
      ),
    );
  });

  test('calendar fields are copied from the referenced idea and its verdict', async () => {
    const drifted = await fixture('orchestrator');
    drifted.calendar_7_days[0].format = 'carousel';
    drifted.calendar_7_days[0].pillar = 'Something else';
    drifted.calendar_7_days[6].status = 'approved'; // idea_07 is "revise"
    const script = await happyScript();
    script.orchestrator = [JSON.stringify(drifted)];
    const { provider } = createScriptedProvider(script);
    const result = await run({ provider, runId: 'normalize-calendar' });

    const [first] = result.final.calendar_7_days;
    assert.equal(first?.format, 'reel');
    assert.equal(first?.pillar, 'Rescue with a bridge');
    assert.equal(result.final.calendar_7_days[6]?.status, 'revise_before_publish');
    const adjustments = result.state.steps[4]?.adjustments ?? [];
    assert.equal(adjustments.length, 4);
    assert.ok(adjustments.includes('learning_log_entry.run_id "set-by-engine" -> "normalize-calendar"'));
  });
});

describe('error handling', () => {
  test('provider errors are not retried and are recorded', async () => {
    const script = await happyScript();
    script.content_qa = [new ProviderError('HTTP 429 from provider', { status: 429 })];
    const { provider, calls } = createScriptedProvider(script);
    await assert.rejects(run({ provider, runId: 'provider-error' }), ProviderError);
    assert.equal(calls.filter((call) => call.stepId === 'content_qa').length, 1);
    const errorFile = await readJsonFile(
      path.join(sandbox.root, 'test-runs', 'provider-error__mock', 'ERROR.json'),
    );
    assert.equal(errorFile.type, 'ProviderError');
    assert.equal(errorFile.step, 'content_qa');
  });

  test('an API key echoed in a provider error never reaches state.json or ERROR.json', async () => {
    const { createOpenRouterProvider } = await import('../src/providers/openrouter.js');
    const key = 'sk-test-fake-0000-not-a-real-key';
    /** @type {typeof fetch} */
    const echoingProxy = async (_url, init) => {
      const headers = /** @type {Record<string, string>} */ (init?.headers ?? {});
      return new Response(`upstream rejected request with headers: ${headers.authorization}`, {
        status: 502,
      });
    };
    const provider = createOpenRouterProvider({
      apiKey: key,
      baseUrl: 'https://proxy.example.com/v1',
      fetchImpl: echoingProxy,
    });
    await assert.rejects(run({ provider, runId: 'leak-check' }), (error) => {
      assert.ok(error instanceof ProviderError);
      assert.ok(!error.message.includes(key));
      assert.match(error.message, /Bearer \[REDACTED\]/);
      return true;
    });
    const runDir = path.join(sandbox.root, 'test-runs', 'leak-check');
    for (const file of ['state.json', 'ERROR.json']) {
      const text = await readFile(path.join(runDir, file), 'utf8');
      assert.ok(!text.includes(key), `${file} must not contain the key`);
      assert.match(text, /\[REDACTED\]/);
    }
  });

  test('invalid client input fails before any model call', async () => {
    const { writeFile } = await import('node:fs/promises');
    const { createClient } = await import('../src/clients.js');
    await createClient({ clientsDir: path.join(sandbox.root, 'clients'), slug: 'broken' });
    await writeFile(
      path.join(sandbox.root, 'clients', 'broken', 'run_context.json'),
      JSON.stringify({ brand: { name: 'Nameless' }, goal: '', constraints: [] }),
    );
    const { provider, calls } = createScriptedProvider(await happyScript());
    await assert.rejects(
      run({ provider, clientSlug: 'broken', runId: 'x' }),
      (error) =>
        error instanceof InputError && /run_context\.json of client "broken" is invalid/.test(error.message),
    );
    assert.equal(calls.length, 0);
  });

  test('unknown clients, bad slugs and existing run directories are refused', async () => {
    const { provider, calls } = createScriptedProvider(await happyScript());
    await assert.rejects(run({ provider, clientSlug: 'nobody' }), /not found in clients/);
    await assert.rejects(run({ provider, clientSlug: '../escape' }), /invalid client slug/);
    await assert.rejects(run({ provider, runId: 'Bad Id' }), /invalid run id/);

    const ok = createScriptedProvider(await happyScript());
    await run({ provider: ok.provider, runId: 'twice' });
    await assert.rejects(run({ provider, runId: 'twice', overwrite: false }), /already exists/);
    assert.equal(calls.length, 0);
  });

  test('default run ids are timestamped so runs never collide', async () => {
    const { provider } = createScriptedProvider(await happyScript());
    const result = await run({ provider });
    assert.equal(result.runId, 'quillfern_20300102-030405');
  });
});
