// The five pipeline steps as data: prompt, output contract, input builder, cross-step checks
// and deterministic normalisation. The pipeline runner is generic over this list.

import {
  checkGrowthStrategy,
  checkIdeation,
  checkOrchestrator,
  checkOrchestratorPrecondition,
  checkQa,
  MIN_IDEAS,
} from './invariants.js';
import { normalizeOrchestrator, normalizeQa } from './normalize.js';

/**
 * @typedef {import('./contracts.js').RunContext} RunContext
 * @typedef {import('./contracts.js').BrandAnalysis} BrandAnalysis
 * @typedef {import('./contracts.js').GrowthStrategy} GrowthStrategy
 * @typedef {import('./contracts.js').ContentIdeation} ContentIdeation
 * @typedef {import('./contracts.js').ContentQa} ContentQa
 * @typedef {import('./contracts.js').OrchestratorOutput} OrchestratorOutput
 * @typedef {import('./contracts.js').FinalOutput} FinalOutput
 */

/** @typedef {'brand_analyst' | 'growth_strategist' | 'content_ideation' | 'content_qa' | 'orchestrator'} StepId */

/**
 * What each step's model output looks like once it has passed its JSON Schema.
 * @typedef {object} RawOutputs
 * @property {BrandAnalysis} brand_analyst
 * @property {GrowthStrategy} growth_strategist
 * @property {ContentIdeation} content_ideation
 * @property {ContentQa} content_qa
 * @property {OrchestratorOutput} orchestrator
 */

/**
 * What each step hands to the next steps after normalisation (the orchestrator's honesty
 * notes are added by the runner).
 * @typedef {object} StepOutputs
 * @property {BrandAnalysis} [brand_analyst]
 * @property {GrowthStrategy} [growth_strategist]
 * @property {ContentIdeation} [content_ideation]
 * @property {ContentQa} [content_qa]
 * @property {FinalOutput} [orchestrator]
 */

/**
 * @typedef {object} StepContext
 * @property {string} runId
 * @property {RunContext} runContext
 * @property {unknown} competitorContext
 * @property {string} contextNotes
 * @property {string | null} learningLog
 * @property {StepOutputs} outputs Validated (and normalised) outputs of the steps run so far.
 */

/**
 * Per-step definition, typed by the step's output contract.
 * @template {StepId} K
 * @typedef {object} TypedStep
 * @property {K} id
 * @property {string} title
 * @property {string} promptFile File in engine/agents/.
 * @property {string} schemaFile File in engine/schemas/.
 * @property {string} outputFile File written to the run directory.
 * @property {boolean} usesKnowledgeBase
 * @property {(ctx: StepContext) => Record<string, unknown>} buildInput
 * @property {(ctx: StepContext) => string[]} [precondition] Checked before any model call; [] when the step can run.
 * @property {(value: RawOutputs[K], ctx: StepContext) => string[]} check Cross-step invariants; [] when valid.
 * @property {(value: RawOutputs[K], ctx: StepContext) => { value: RawOutputs[K], adjustments: string[] }} [normalize]
 */

/**
 * The type-erased form the generic runner iterates over. Values reach `check` and `normalize`
 * only after Ajv has validated them against the step's schema; `defineStep` is the single
 * place where that validated `unknown` is narrowed to the step's contract type.
 * @typedef {object} StepDefinition
 * @property {StepId} id
 * @property {string} title
 * @property {string} promptFile
 * @property {string} schemaFile
 * @property {string} outputFile
 * @property {boolean} usesKnowledgeBase
 * @property {(ctx: StepContext) => Record<string, unknown>} buildInput
 * @property {(ctx: StepContext) => string[]} precondition
 * @property {(value: unknown, ctx: StepContext) => string[]} check
 * @property {(value: unknown, ctx: StepContext) => { value: unknown, adjustments: string[] }} normalize
 */

/**
 * @template {StepId} K
 * @param {TypedStep<K>} step
 * @returns {StepDefinition}
 */
function defineStep(step) {
  /** @param {unknown} value */
  const narrow = (value) => /** @type {RawOutputs[K]} */ (value);
  const { precondition, check, normalize } = step;
  return {
    ...step,
    precondition: precondition ?? (() => []),
    check: (value, ctx) => check(narrow(value), ctx),
    normalize: normalize
      ? (value, ctx) => normalize(narrow(value), ctx)
      : (value) => ({ value, adjustments: [] }),
  };
}

/**
 * @template {keyof StepOutputs} K
 * @param {StepContext} ctx
 * @param {K} key
 * @returns {NonNullable<StepOutputs[K]>}
 */
function need(ctx, key) {
  const value = ctx.outputs[key];
  if (value === undefined || value === null) {
    throw new Error(`output of step "${key}" is not available yet`);
  }
  return /** @type {NonNullable<StepOutputs[K]>} */ (value);
}

/** @type {readonly StepDefinition[]} */
export const STEPS = Object.freeze([
  defineStep({
    id: 'brand_analyst',
    title: 'Brand Analyst',
    promptFile: '01_brand_analyst.md',
    schemaFile: 'brand_analyst.schema.json',
    outputFile: '01_brand_analyst.json',
    usesKnowledgeBase: true,
    buildInput: (ctx) => ({
      run_context: ctx.runContext,
      competitor_context: ctx.competitorContext,
      learning_log: ctx.learningLog,
      context_notes: ctx.contextNotes,
    }),
    check: () => [],
  }),
  defineStep({
    id: 'growth_strategist',
    title: 'Growth Strategist',
    promptFile: '02_growth_strategist.md',
    schemaFile: 'growth_strategist.schema.json',
    outputFile: '02_growth_strategist.json',
    usesKnowledgeBase: true,
    buildInput: (ctx) => ({
      run_context: ctx.runContext,
      brand_analysis: need(ctx, 'brand_analyst'),
    }),
    check: (value) => checkGrowthStrategy(value),
  }),
  defineStep({
    id: 'content_ideation',
    title: 'Content Ideation',
    promptFile: '03_content_ideation.md',
    schemaFile: 'content_ideation.schema.json',
    outputFile: '03_content_ideation.json',
    usesKnowledgeBase: true,
    buildInput: (ctx) => ({
      run_context: ctx.runContext,
      growth_strategy: need(ctx, 'growth_strategist'),
      brand_analysis: need(ctx, 'brand_analyst'),
      min_ideas: MIN_IDEAS,
    }),
    check: (value, ctx) => checkIdeation(value, need(ctx, 'growth_strategist')),
  }),
  defineStep({
    id: 'content_qa',
    title: 'Content QA',
    promptFile: '04_content_qa.md',
    schemaFile: 'content_qa.schema.json',
    outputFile: '04_content_qa.json',
    usesKnowledgeBase: true,
    buildInput: (ctx) => ({
      content_ideas: need(ctx, 'content_ideation').ideas,
      growth_strategy: need(ctx, 'growth_strategist'),
      run_context: ctx.runContext,
    }),
    check: (value, ctx) => checkQa(value, need(ctx, 'content_ideation')),
    normalize: (value) => normalizeQa(value),
  }),
  defineStep({
    id: 'orchestrator',
    title: 'Orchestrator',
    promptFile: '05_orchestrator.md',
    schemaFile: 'orchestrator.schema.json',
    outputFile: '05_orchestrator.json',
    usesKnowledgeBase: false,
    buildInput: (ctx) => ({
      run_context: ctx.runContext,
      growth_strategy: need(ctx, 'growth_strategist'),
      content_ideas: need(ctx, 'content_ideation').ideas,
      qa_review: need(ctx, 'content_qa'),
    }),
    precondition: (ctx) => checkOrchestratorPrecondition(need(ctx, 'content_qa')),
    check: (value, ctx) => checkOrchestrator(value, need(ctx, 'content_ideation'), need(ctx, 'content_qa')),
    normalize: (value, ctx) =>
      normalizeOrchestrator(value, need(ctx, 'content_ideation'), need(ctx, 'content_qa'), ctx.runId),
  }),
]);

export const STEP_IDS = STEPS.map((step) => step.id);
