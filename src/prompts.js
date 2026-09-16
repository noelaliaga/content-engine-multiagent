import path from 'node:path';
import { readText } from './fsutil.js';

export const KNOWLEDGE_BASE_FILES = Object.freeze([
  'hooks.md',
  'content_patterns.md',
  'diagnostic_protocols.md',
  'analysis_exemplar.md',
]);

/**
 * Concatenates engine/kb/*.md in a fixed order.
 * @param {string} engineDir
 */
export async function loadKnowledgeBase(engineDir) {
  const parts = [];
  for (const file of KNOWLEDGE_BASE_FILES) {
    parts.push(`## ${file}\n\n${await readText(path.join(engineDir, 'kb', file))}`);
  }
  return parts.join('\n\n---\n\n');
}

/**
 * System prompt = agent prompt + (optional) knowledge base + the output JSON Schema.
 * The schema is included in the prompt as well as sent as a structured-output constraint,
 * so providers without native structured outputs still see the contract.
 * @param {{ prompt: string, knowledgeBase: string | null, schema: unknown }} parts
 */
export function buildSystemPrompt({ prompt, knowledgeBase, schema }) {
  const sections = [prompt.trim()];
  if (knowledgeBase) sections.push(`# Knowledge base\n\n${knowledgeBase.trim()}`);
  sections.push(`# Output contract (JSON Schema)\n\n${JSON.stringify(schema)}`);
  return sections.join('\n\n---\n\n');
}

/**
 * Feedback sent to the model after a rejected attempt.
 * @param {string[]} errors
 */
export function buildRetryInstruction(errors) {
  const shown = errors.slice(0, 20).map((error) => `- ${error}`);
  if (errors.length > shown.length) shown.push(`- (${errors.length - shown.length} more)`);
  return [
    'Your previous output was rejected by the pipeline validator:',
    ...shown,
    'Return ONLY a corrected JSON object that satisfies the output contract. No markdown, no commentary.',
  ].join('\n');
}
