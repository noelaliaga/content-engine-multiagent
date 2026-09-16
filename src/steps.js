// The five pipeline steps as data: prompt, output contract, input builder, cross-step checks
// and deterministic normalisation. The pipeline runner is generic over this list.

import { checkGrowthStrategy, checkIdeation, checkOrchestrator, checkQa } from './invariants.js';
import { normalizeOrchestrator, normalizeQa } from './normalize.js';

/**
 * @typedef {import('./contracts.js').RunContext} RunContext
 * @typedef {import('./contracts.js').BrandAnalysis} BrandAnalysis
 * @typedef {import('./contracts.js').GrowthStrategy} GrowthStrategy
 * @typedef {import('./contracts.js').ContentIdeation} ContentIdeation
 * @typedef {import('./contracts.js').ContentQa} ContentQa
 * @typedef {import('./contracts.js').FinalOutput} FinalOutput
 */

/** @typedef {'brand_analyst' | 'growth_strategist' | 'content_ideation' | 'content_qa' | 'orchestrator'} StepId */

/**
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
 * @typedef {object} StepDefinition
 * @property {StepId} id
 * @property {string} title
 * @property {string} promptFile File in engine/agents/.
 * @property {string} schemaFile File in engine/schemas/.
 * @property {string} outputFile File written to the run directory.
 * @property {boolean} usesKnowledgeBase
 * @property {(ctx: StepContext) => Record<string, unknown>} buildInput
 * @property {(value: any, ctx: StepContext) => string[]} check Cross-step invariants; [] when valid.
 * @property {(value: any, ctx: StepContext) => { value: unknown, adjustments: string[] }} [normalize]
 */

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
  {
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
  },
  {
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
  },
  {
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
    }),
    check: (value, ctx) => checkIdeation(value, need(ctx, 'growth_strategist')),
  },
  {
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
  },
  {
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
    check: (value, ctx) => checkOrchestrator(value, need(ctx, 'content_ideation'), need(ctx, 'content_qa')),
    normalize: (value, ctx) =>
      normalizeOrchestrator(value, need(ctx, 'content_ideation'), need(ctx, 'content_qa'), ctx.runId),
  },
]);

export const STEP_IDS = STEPS.map((step) => step.id);
