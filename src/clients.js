import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { InputError } from './errors.js';
import { exists } from './fsutil.js';
import { SLUG_PATTERN } from './ids.js';

/** Files every client directory must have; copied from clients/_template. */
export const CLIENT_FILES = Object.freeze([
  'context.md',
  'run_context.json',
  'competitor_context.json',
  'learning_log.md',
]);

/**
 * Scaffolds clients/<slug>/ from clients/_template. Never touches the engine.
 * @param {{ clientsDir: string, slug: string }} options
 * @returns {Promise<{ clientDir: string, files: string[] }>}
 */
export async function createClient({ clientsDir, slug }) {
  if (!SLUG_PATTERN.test(slug)) {
    throw new InputError(
      `invalid slug "${slug}": use lowercase letters, digits, "-" and "_", starting with a letter or digit`,
    );
  }
  const templateDir = path.join(clientsDir, '_template');
  for (const file of CLIENT_FILES) {
    if (!(await exists(path.join(templateDir, file)))) {
      throw new InputError(`template file missing: clients/_template/${file}`);
    }
  }
  const clientDir = path.join(clientsDir, slug);
  if (await exists(clientDir)) throw new InputError(`client "${slug}" already exists`);

  await mkdir(clientDir);
  const files = [];
  for (const file of CLIENT_FILES) {
    const text = await readFile(path.join(templateDir, file), 'utf8');
    const target = path.join(clientDir, file);
    await writeFile(target, text.replaceAll('{{CLIENT_SLUG}}', slug), 'utf8');
    files.push(target);
  }
  await mkdir(path.join(clientDir, 'runs'));
  return { clientDir, files };
}
