// Renders a self-contained HTML viewer for one run (no network, no model calls).

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { exists, readJson } from './fsutil.js';

const DATA_FILES = Object.freeze({
  brandAnalystData: '01_brand_analyst.json',
  growthStrategistData: '02_growth_strategist.json',
  contentIdeationData: '03_content_ideation.json',
  contentQaData: '04_content_qa.json',
  orchestratorFinalData: '05_orchestrator.json',
});

const DATA_MARKER = '/*__RUN_DATA__*/';

/**
 * JSON safe to embed inside a <script> element: `<` is escaped so model output such as
 * `</script>` cannot close the element.
 * @param {unknown} value
 */
export function serializeForScript(value) {
  return JSON.stringify(value, null, 2)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** @param {string} text */
export function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * @param {{ rootDir: string, runDir: string, clientDir: string }} options
 * @returns {Promise<{ outPath: string, sizeKB: number }>}
 */
export async function buildDashboard({ rootDir, runDir, clientDir }) {
  /** @type {Record<string, unknown>} */
  const data = {};
  for (const [constName, file] of Object.entries(DATA_FILES)) {
    const filePath = path.join(runDir, file);
    if (!(await exists(filePath))) {
      throw new Error(`missing ${file} in ${runDir}; did the run complete? (see ERROR.json)`);
    }
    data[constName] = await readJson(filePath);
  }

  let modeLabel = 'Run';
  if (await exists(path.join(runDir, 'state.json'))) {
    const state = /** @type {{ offline?: boolean }} */ (await readJson(path.join(runDir, 'state.json')));
    modeLabel = state.offline ? 'Offline demo · synthetic fixtures' : 'Live model run';
  }

  let brandName = path.basename(clientDir);
  let handle = '';
  let hypothesisGap = -1;
  let hypothesisNote = -1;
  const runContextPath = path.join(clientDir, 'run_context.json');
  if (await exists(runContextPath)) {
    const rc =
      /** @type {{ brand?: { name?: string, handle?: string }, hypothesis_gap_index?: number, hypothesis_note_index?: number }} */ (
        await readJson(runContextPath)
      );
    brandName = rc.brand?.name ?? brandName;
    handle = rc.brand?.handle ?? '';
    if (Number.isInteger(rc.hypothesis_gap_index)) hypothesisGap = Number(rc.hypothesis_gap_index);
    if (Number.isInteger(rc.hypothesis_note_index)) hypothesisNote = Number(rc.hypothesis_note_index);
  }

  const template = await readFile(path.join(rootDir, 'engine', 'dashboard', 'template.html'), 'utf8');
  // Placeholders are replaced before data is injected, so run data can never be
  // mistaken for a placeholder.
  let html = template
    .replaceAll('{{BRAND_NAME}}', escapeHtml(brandName))
    .replaceAll('{{HANDLE}}', escapeHtml(handle))
    .replaceAll('{{RUN_ID}}', escapeHtml(path.basename(runDir)))
    .replaceAll('{{RUN_MODE_LABEL}}', escapeHtml(modeLabel));
  if (html.includes('{{') || !html.includes(DATA_MARKER)) {
    throw new Error('dashboard template has unknown placeholders or no data marker');
  }

  const dataBlock = [
    ...Object.keys(DATA_FILES).map((name) => `const ${name} = ${serializeForScript(data[name])};`),
    `const HYPOTHESIS_GAP_INDEX = ${hypothesisGap};`,
    `const HYPOTHESIS_NOTE_INDEX = ${hypothesisNote};`,
  ].join('\n\n');
  html = html.replace(DATA_MARKER, () => dataBlock);

  const outPath = path.join(runDir, 'dashboard.html');
  await writeFile(outPath, html, 'utf8');
  return { outPath, sizeKB: Buffer.byteLength(html) / 1024 };
}
