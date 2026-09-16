import { Ajv } from 'ajv';

/** @typedef {import('ajv').ErrorObject} ErrorObject */

/** Strict Ajv instance: unknown keywords in a schema are an error, all violations are reported. */
export function createAjv() {
  return new Ajv({ allErrors: true, strict: true });
}

/**
 * Turns Ajv errors into short, model-readable strings (they are sent back on retry).
 * @param {ErrorObject[] | null | undefined} errors
 * @returns {string[]}
 */
export function formatSchemaErrors(errors) {
  if (!errors) return [];
  return errors.map((error) => {
    const where = error.instancePath === '' ? '(root)' : error.instancePath;
    if (error.keyword === 'enum') {
      const allowed = /** @type {unknown[]} */ (error.params.allowedValues);
      return `${where} must be one of: ${allowed.join(', ')}`;
    }
    if (error.keyword === 'additionalProperties') {
      return `${where} has unexpected property "${error.params.additionalProperty}"`;
    }
    return `${where} ${error.message ?? 'is invalid'}`;
  });
}

/**
 * Parses model output strictly: no markdown-fence stripping, no repair.
 * @param {string} text
 * @returns {{ ok: true, value: unknown } | { ok: false, errors: string[] }}
 */
export function parseJsonOutput(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, errors: [`output is not valid JSON (${reason})`] };
  }
}
