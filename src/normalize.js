// Deterministic post-processing. Anything that can be computed from validated data is
// computed by code, not trusted from the model. Every change is recorded as an adjustment.

import { SCORE_KEYS } from './invariants.js';

/**
 * @typedef {import('./contracts.js').QaScores} QaScores
 * @typedef {import('./contracts.js').Verdict} Verdict
 * @typedef {import('./contracts.js').ContentQa} ContentQa
 * @typedef {import('./contracts.js').ContentIdeation} ContentIdeation
 * @typedef {import('./contracts.js').OrchestratorOutput} OrchestratorOutput
 * @typedef {import('./contracts.js').CalendarEntry} CalendarEntry
 */

export const QA_THRESHOLDS = Object.freeze({ approved: 4, revise: 2.5 });

/**
 * Hard rule on top of the average: an idea whose `claim_safety` is at or below this value is
 * rejected whatever its other scores are, so a guaranteed-result promise can never be scheduled.
 */
export const CLAIM_SAFETY_REJECT_AT_OR_BELOW = 1;

/** @param {number} value */
function round2(value) {
  return Math.round(value * 100) / 100;
}

/**
 * @param {QaScores} scores
 * @returns {number} Mean of the seven scores, rounded to two decimals.
 */
export function averageScore(scores) {
  const total = SCORE_KEYS.reduce((sum, key) => sum + scores[key], 0);
  return round2(total / SCORE_KEYS.length);
}

/**
 * @param {number} average
 * @returns {Verdict}
 */
export function verdictFor(average) {
  if (average >= QA_THRESHOLDS.approved) return 'approved';
  if (average >= QA_THRESHOLDS.revise) return 'revise';
  return 'rejected';
}

/**
 * Verdict policy: the average decides, except that an unsafe claim always rejects.
 * @param {QaScores} scores
 * @returns {{ average: number, verdict: Verdict, claimRule: boolean }} `claimRule` is true when
 * the claim-safety rule overrode what the average alone would have decided.
 */
export function decideVerdict(scores) {
  const average = averageScore(scores);
  const byAverage = verdictFor(average);
  if (scores.claim_safety <= CLAIM_SAFETY_REJECT_AT_OR_BELOW) {
    return { average, verdict: 'rejected', claimRule: byAverage !== 'rejected' };
  }
  return { average, verdict: byAverage, claimRule: false };
}

/**
 * The model scores; the engine decides. Recomputes average, verdict (including the
 * claim-safety rule) and summary.
 * @param {ContentQa} qa
 * @returns {{ value: ContentQa, adjustments: string[] }}
 */
export function normalizeQa(qa) {
  /** @type {string[]} */
  const adjustments = [];
  const reviewed = qa.reviewed.map((review) => {
    const { average, verdict, claimRule } = decideVerdict(review.scores);
    if (claimRule) {
      adjustments.push(
        `${review.id}: claim_safety ${review.scores.claim_safety} forces rejected ` +
          `(average ${average} alone would be ${verdictFor(average)})`,
      );
    }
    if (Math.abs(average - review.average_score) > 0.005) {
      adjustments.push(`${review.id}: average_score ${review.average_score} -> ${average}`);
    }
    if (verdict !== review.verdict) {
      adjustments.push(`${review.id}: verdict ${review.verdict} -> ${verdict}`);
    }
    return { ...review, average_score: average, verdict };
  });
  const summary = {
    approved: reviewed.filter((r) => r.verdict === 'approved').length,
    revise: reviewed.filter((r) => r.verdict === 'revise').length,
    rejected: reviewed.filter((r) => r.verdict === 'rejected').length,
  };
  if (
    summary.approved !== qa.summary.approved ||
    summary.revise !== qa.summary.revise ||
    summary.rejected !== qa.summary.rejected
  ) {
    adjustments.push(`summary ${JSON.stringify(qa.summary)} -> ${JSON.stringify(summary)}`);
  }
  return { value: { reviewed, summary }, adjustments };
}

const CALENDAR_DERIVED_KEYS = /** @type {const} */ (['format', 'pillar', 'intended_action', 'status']);

/**
 * Calendar entries copy format/pillar/intent from the referenced idea and derive status from
 * the QA verdict; the learning-log run id comes from the CLI, not from the model.
 * @param {OrchestratorOutput} output
 * @param {ContentIdeation} ideation
 * @param {ContentQa} qa
 * @param {string} runId
 * @returns {{ value: OrchestratorOutput, adjustments: string[] }}
 */
export function normalizeOrchestrator(output, ideation, qa, runId) {
  /** @type {string[]} */
  const adjustments = [];
  const ideas = new Map(ideation.ideas.map((idea) => [idea.id, idea]));
  const verdicts = new Map(qa.reviewed.map((review) => [review.id, review.verdict]));
  const calendar = output.calendar_7_days.map((entry, index) => {
    const idea = ideas.get(entry.idea_id);
    if (!idea) {
      // checkOrchestrator rejects unknown ids before normalisation; reaching this is a bug.
      throw new Error(
        `invariant broken: calendar_7_days[${index}] references unknown idea "${entry.idea_id}"`,
      );
    }
    /** @type {CalendarEntry} */
    const next = {
      ...entry,
      format: idea.format,
      pillar: idea.pillar,
      intended_action: idea.intended_action,
      status: verdicts.get(entry.idea_id) === 'approved' ? 'approved' : 'revise_before_publish',
    };
    for (const key of CALENDAR_DERIVED_KEYS) {
      if (entry[key] !== next[key]) {
        adjustments.push(`calendar_7_days[${index}].${key} "${entry[key]}" -> "${next[key]}"`);
      }
    }
    return next;
  });
  if (output.learning_log_entry.run_id !== runId) {
    adjustments.push(`learning_log_entry.run_id "${output.learning_log_entry.run_id}" -> "${runId}"`);
  }
  return {
    value: {
      ...output,
      calendar_7_days: calendar,
      learning_log_entry: { ...output.learning_log_entry, run_id: runId },
    },
    adjustments,
  };
}
