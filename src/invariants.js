// Cross-step checks that JSON Schema cannot express. A violation counts as a rejected
// attempt: the step is retried with the violations as feedback, then fails.

/**
 * @typedef {import('./contracts.js').GrowthStrategy} GrowthStrategy
 * @typedef {import('./contracts.js').ContentIdeation} ContentIdeation
 * @typedef {import('./contracts.js').ContentQa} ContentQa
 * @typedef {import('./contracts.js').OrchestratorOutput} OrchestratorOutput
 */

export const SCORE_KEYS = /** @type {const} */ ([
  'on_brand',
  'hook_strength',
  'pillar_fit',
  'offer_connection',
  'feasibility',
  'originality',
  'claim_safety',
]);

export const CALENDAR_DAYS = 7;

/**
 * Ideation must return at least this many ideas, so that a 7-day calendar usually survives
 * a rejection or two in QA without repeating ideas.
 */
export const MIN_IDEAS = CALENDAR_DAYS + 1;

/**
 * @param {string[]} values
 * @returns {string[]}
 */
function duplicates(values) {
  const seen = new Set();
  const repeated = new Set();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}

/**
 * @param {GrowthStrategy} strategy
 * @returns {string[]}
 */
export function checkGrowthStrategy(strategy) {
  /** @type {string[]} */
  const errors = [];
  const mix = strategy.content_mix;
  const patternTotal = mix.market_proven_patterns + mix.original_experiments;
  if (patternTotal !== 100) {
    errors.push(
      `content_mix.market_proven_patterns + original_experiments must equal 100, got ${patternTotal}`,
    );
  }
  const intentTotal = mix.reach + mix.nurture + mix.convert;
  if (intentTotal !== 100) {
    errors.push(`content_mix.reach + nurture + convert must equal 100, got ${intentTotal}`);
  }
  if (strategy.content_pillars.length === 0) {
    errors.push('content_pillars must contain at least one pillar');
  }
  for (const name of duplicates(strategy.content_pillars.map((p) => p.pillar))) {
    errors.push(`content_pillars has duplicate pillar "${name}"`);
  }
  return errors;
}

/**
 * @param {ContentIdeation} ideation
 * @param {GrowthStrategy} strategy
 * @returns {string[]}
 */
export function checkIdeation(ideation, strategy) {
  /** @type {string[]} */
  const errors = [];
  const pillars = new Set(strategy.content_pillars.map((p) => p.pillar));
  if (ideation.ideas.length < MIN_IDEAS) {
    errors.push(`ideas must contain at least ${MIN_IDEAS} ideas, got ${ideation.ideas.length}`);
  }
  for (const id of duplicates(ideation.ideas.map((idea) => idea.id))) {
    errors.push(`ideas has duplicate id "${id}"`);
  }
  for (const idea of ideation.ideas) {
    if (!pillars.has(idea.pillar)) {
      errors.push(
        `idea "${idea.id}" uses unknown pillar "${idea.pillar}"; copy a growth_strategy pillar verbatim`,
      );
    }
  }
  const covered = new Set(ideation.ideas.map((idea) => idea.pillar));
  for (const pillar of pillars) {
    if (!covered.has(pillar)) errors.push(`pillar "${pillar}" has no idea`);
  }
  return errors;
}

/**
 * @param {ContentQa} qa
 * @param {ContentIdeation} ideation
 * @returns {string[]}
 */
export function checkQa(qa, ideation) {
  /** @type {string[]} */
  const errors = [];
  const ideaIds = new Set(ideation.ideas.map((idea) => idea.id));
  const reviewedIds = qa.reviewed.map((review) => review.id);
  for (const id of duplicates(reviewedIds)) errors.push(`reviewed has duplicate id "${id}"`);
  for (const id of reviewedIds) {
    if (!ideaIds.has(id)) errors.push(`reviewed id "${id}" does not match any idea`);
  }
  const reviewedSet = new Set(reviewedIds);
  for (const id of ideaIds) {
    if (!reviewedSet.has(id)) errors.push(`idea "${id}" was not reviewed`);
  }
  for (const review of qa.reviewed) {
    for (const key of SCORE_KEYS) {
      const value = review.scores[key];
      if (!Number.isInteger(value) || value < 0 || value > 5) {
        errors.push(`reviewed "${review.id}" scores.${key} must be an integer 0-5, got ${value}`);
      }
    }
  }
  return errors;
}

/**
 * Ids the orchestrator may schedule: every idea whose (normalised) verdict is not `rejected`.
 * @param {ContentQa} qa
 * @returns {string[]}
 */
export function schedulableIdeaIds(qa) {
  return qa.reviewed.filter((review) => review.verdict !== 'rejected').map((review) => review.id);
}

/**
 * Checked before the orchestrator is called, so an impossible calendar costs no model call.
 * @param {ContentQa} qa
 * @returns {string[]}
 */
export function checkOrchestratorPrecondition(qa) {
  if (schedulableIdeaIds(qa).length === 0) {
    return ['no idea survived QA (all rejected), so no calendar can be built; revise the brief or the ideas'];
  }
  return [];
}

/**
 * Runs after QA normalisation, so `qa.reviewed[].verdict` is the engine's verdict.
 * Rules: exactly 7 entries; known ids only; never a rejected idea; `revise` ideas only when
 * fewer than 7 are approved; an idea may appear twice only when fewer than 7 ideas are schedulable.
 * @param {OrchestratorOutput} output
 * @param {ContentIdeation} ideation
 * @param {ContentQa} qa
 * @returns {string[]}
 */
export function checkOrchestrator(output, ideation, qa) {
  /** @type {string[]} */
  const errors = [];
  const ideaIds = new Set(ideation.ideas.map((idea) => idea.id));
  const verdicts = new Map(qa.reviewed.map((review) => [review.id, review.verdict]));
  const approvedCount = qa.reviewed.filter((review) => review.verdict === 'approved').length;
  const schedulableCount = schedulableIdeaIds(qa).length;
  if (output.calendar_7_days.length !== CALENDAR_DAYS) {
    errors.push(
      `calendar_7_days must have exactly ${CALENDAR_DAYS} entries, got ${output.calendar_7_days.length}`,
    );
  }
  output.calendar_7_days.forEach((entry, index) => {
    const label = `calendar_7_days[${index}]`;
    if (!ideaIds.has(entry.idea_id)) {
      errors.push(`${label} references unknown idea_id "${entry.idea_id}"`);
      return;
    }
    const verdict = verdicts.get(entry.idea_id);
    if (verdict === 'rejected') {
      errors.push(`${label} schedules rejected idea "${entry.idea_id}"`);
    }
    if (verdict === 'revise' && approvedCount >= CALENDAR_DAYS) {
      errors.push(
        `${label} schedules revise idea "${entry.idea_id}" although ${approvedCount} ideas are approved`,
      );
    }
  });
  if (schedulableCount >= CALENDAR_DAYS) {
    for (const id of duplicates(output.calendar_7_days.map((entry) => entry.idea_id))) {
      errors.push(`calendar_7_days repeats idea "${id}" although ${schedulableCount} ideas can be scheduled`);
    }
  }
  return errors;
}
