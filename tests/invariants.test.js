import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  checkGrowthStrategy,
  checkIdeation,
  checkOrchestrator,
  checkOrchestratorPrecondition,
  checkQa,
} from '../src/invariants.js';
import { decideVerdict, normalizeQa } from '../src/normalize.js';
import { fixture } from './helpers.js';

// Unit tests for every cross-step rule listed in the README table "Contracts between steps".
// Each test starts from the valid synthetic fixtures and breaks exactly one rule.

describe('growth strategy invariants', () => {
  test('the valid fixture passes', async () => {
    assert.deepEqual(checkGrowthStrategy(await fixture('growth_strategist')), []);
  });

  test('market_proven_patterns + original_experiments must add up to 100', async () => {
    const strategy = await fixture('growth_strategist');
    strategy.content_mix.original_experiments = 30;
    assert.deepEqual(checkGrowthStrategy(strategy), [
      'content_mix.market_proven_patterns + original_experiments must equal 100, got 110',
    ]);
  });

  test('pillars must be unique and non-empty', async () => {
    const duplicated = await fixture('growth_strategist');
    duplicated.content_pillars[1].pillar = duplicated.content_pillars[0].pillar;
    assert.deepEqual(checkGrowthStrategy(duplicated), [
      'content_pillars has duplicate pillar "Rescue with a bridge"',
    ]);

    const empty = await fixture('growth_strategist');
    empty.content_pillars = [];
    assert.deepEqual(checkGrowthStrategy(empty), ['content_pillars must contain at least one pillar']);
  });
});

describe('ideation invariants', () => {
  test('the valid fixture passes', async () => {
    assert.deepEqual(
      checkIdeation(await fixture('content_ideation'), await fixture('growth_strategist')),
      [],
    );
  });

  test('idea ids must be unique', async () => {
    const ideation = await fixture('content_ideation');
    ideation.ideas[1].id = 'idea_01';
    assert.deepEqual(checkIdeation(ideation, await fixture('growth_strategist')), [
      'ideas has duplicate id "idea_01"',
    ]);
  });

  test('every pillar needs at least one idea', async () => {
    const ideation = await fixture('content_ideation');
    for (const idea of ideation.ideas) {
      if (idea.pillar === 'Subscriber proof') idea.pillar = 'Rescue with a bridge';
    }
    assert.deepEqual(checkIdeation(ideation, await fixture('growth_strategist')), [
      'pillar "Subscriber proof" has no idea',
    ]);
  });
});

describe('QA invariants and verdict policy', () => {
  test('scores must be integers from 0 to 5', async () => {
    const qa = await fixture('content_qa');
    qa.reviewed[0].scores.hook_strength = 7;
    qa.reviewed[1].scores.originality = -1;
    // 3.5 is already refused by the JSON Schema ("integer"); the invariant is a second line.
    qa.reviewed[2].scores.feasibility = 3.5;
    assert.deepEqual(checkQa(qa, await fixture('content_ideation')), [
      'reviewed "idea_01" scores.hook_strength must be an integer 0-5, got 7',
      'reviewed "idea_02" scores.originality must be an integer 0-5, got -1',
      'reviewed "idea_03" scores.feasibility must be an integer 0-5, got 3.5',
    ]);
  });

  test('claim_safety of 0 or 1 rejects regardless of the average', () => {
    const perfect = {
      on_brand: 5,
      hook_strength: 5,
      pillar_fit: 5,
      offer_connection: 5,
      feasibility: 5,
      originality: 5,
      claim_safety: 5,
    };
    assert.deepEqual(decideVerdict(perfect), { average: 5, verdict: 'approved', claimRule: false });
    assert.deepEqual(decideVerdict({ ...perfect, claim_safety: 1 }), {
      average: 4.43,
      verdict: 'rejected',
      claimRule: true,
    });
    assert.deepEqual(decideVerdict({ ...perfect, claim_safety: 2 }), {
      average: 4.57,
      verdict: 'approved',
      claimRule: false,
    });
  });

  test('the claim rule is recorded as an adjustment', async () => {
    const qa = await fixture('content_qa');
    const { value, adjustments } = normalizeQa(qa);
    assert.equal(value.reviewed[7]?.verdict, 'rejected');
    assert.deepEqual(adjustments, [
      'idea_08: claim_safety 0 forces rejected (average 3 alone would be revise)',
    ]);
  });
});

describe('orchestrator invariants', () => {
  async function inputs() {
    const ideation = await fixture('content_ideation');
    const { value: qa } = normalizeQa(await fixture('content_qa'));
    return { ideation, qa, calendar: await fixture('orchestrator') };
  }

  test('the valid fixture passes', async () => {
    const { ideation, qa, calendar } = await inputs();
    assert.deepEqual(checkOrchestrator(calendar, ideation, qa), []);
  });

  test('exactly seven days', async () => {
    const { ideation, qa, calendar } = await inputs();
    calendar.calendar_7_days.pop();
    assert.deepEqual(checkOrchestrator(calendar, ideation, qa), [
      'calendar_7_days must have exactly 7 entries, got 6',
    ]);
  });

  test('revise ideas only when fewer than seven are approved', async () => {
    const { ideation, qa, calendar } = await inputs();
    // Approve idea_08 too (7 approved in total); idea_07 (revise) is then not allowed.
    const idea08 = qa.reviewed[7];
    assert.ok(idea08);
    idea08.verdict = 'approved';
    assert.deepEqual(checkOrchestrator(calendar, ideation, qa), [
      'calendar_7_days[6] schedules revise idea "idea_07" although 7 ideas are approved',
    ]);
  });

  test('the precondition fails only when nothing can be scheduled', async () => {
    const { qa } = await inputs();
    assert.deepEqual(checkOrchestratorPrecondition(qa), []);
    for (const review of qa.reviewed) review.verdict = 'rejected';
    assert.equal(checkOrchestratorPrecondition(qa).length, 1);
  });
});
