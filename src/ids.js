/** Client slugs and run ids: lowercase letters, digits, `-` and `_`, starting with a letter or digit. */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * Default run id: `<slug>_<yyyymmdd>-<hhmmss>` (UTC), so repeated runs never overwrite each other.
 * @param {string} slug
 * @param {Date} date
 */
export function defaultRunId(slug, date) {
  const stamp = date
    .toISOString()
    .replace(/\.\d+Z$/, '')
    .replace(/[-:]/g, '')
    .replace('T', '-');
  return `${slug}_${stamp}`;
}
