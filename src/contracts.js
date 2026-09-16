// JSDoc mirrors of engine/schemas/*.schema.json. The JSON Schemas are the source of truth
// at runtime (Ajv); these typedefs only give the type checker the same shapes.

/**
 * @typedef {'reach' | 'nurture' | 'convert'} Intent
 * @typedef {'approved' | 'revise' | 'rejected'} Verdict
 */

/**
 * @typedef {object} RunContext
 * @property {string} [run_id]
 * @property {boolean} [synthetic]
 * @property {{ handle: string, name: string, bio: string, offer: string, content_observed: string[], funnel_observed: string } & Record<string, unknown>} brand
 * @property {string} goal
 * @property {string[]} constraints
 * @property {string[]} [analysis_hypotheses]
 * @property {number} [hypothesis_gap_index]
 * @property {number} [hypothesis_note_index]
 */

/** @typedef {Record<string, unknown>} BrandAnalysis */

/**
 * @typedef {object} ContentPillar
 * @property {string} pillar
 * @property {Intent} purpose
 * @property {string} rationale
 * @property {string[]} patterns_to_use
 */

/**
 * @typedef {object} ContentMix
 * @property {number} market_proven_patterns
 * @property {number} original_experiments
 * @property {number} reach
 * @property {number} nurture
 * @property {number} convert
 */

/**
 * @typedef {object} GrowthStrategy
 * @property {string} positioning_statement
 * @property {string} target_audience
 * @property {ContentPillar[]} content_pillars
 * @property {ContentMix} content_mix
 * @property {string[]} strategic_notes
 */

/**
 * @typedef {object} ContentIdea
 * @property {string} id
 * @property {string} pillar
 * @property {string} format
 * @property {string} hook
 * @property {string} concept
 * @property {{ opening: string, body: string, turn: string, cta: string }} script_outline
 * @property {Intent} intended_action
 * @property {string} pattern_source
 * @property {string} why_this_could_work
 * @property {string} cta
 */

/** @typedef {{ ideas: ContentIdea[] }} ContentIdeation */

/**
 * @typedef {object} QaScores
 * @property {number} on_brand
 * @property {number} hook_strength
 * @property {number} pillar_fit
 * @property {number} offer_connection
 * @property {number} feasibility
 * @property {number} originality
 * @property {number} claim_safety
 */

/**
 * @typedef {object} QaReview
 * @property {string} id
 * @property {QaScores} scores
 * @property {number} average_score
 * @property {Verdict} verdict
 * @property {string} reason
 * @property {string} improvement_suggestion
 */

/** @typedef {{ approved: number, revise: number, rejected: number }} QaSummary */
/** @typedef {{ reviewed: QaReview[], summary: QaSummary }} ContentQa */

/**
 * @typedef {object} CalendarEntry
 * @property {string} day
 * @property {string} date_label
 * @property {string} idea_id
 * @property {string} format
 * @property {string} pillar
 * @property {Intent} intended_action
 * @property {'approved' | 'revise_before_publish'} status
 */

/**
 * @typedef {object} LearningLogEntry
 * @property {string} run_id
 * @property {string[]} what_worked
 * @property {string[]} what_was_rejected_and_why
 * @property {string[]} next_run_recommendations
 */

/**
 * @typedef {object} OrchestratorOutput
 * @property {CalendarEntry[]} calendar_7_days
 * @property {{ metric: string, why_it_matters: string, target_signal: string }[]} metrics_to_track
 * @property {LearningLogEntry} learning_log_entry
 */

/** @typedef {OrchestratorOutput & { honesty_notes: string[] }} FinalOutput */

export {};
