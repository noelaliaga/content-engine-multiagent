import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * @param {string} filePath
 * @returns {Promise<unknown>}
 */
export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

/** @param {string} filePath */
export async function readText(filePath) {
  return readFile(filePath, 'utf8');
}

/**
 * @param {string} filePath
 * @param {unknown} data
 */
export async function writeJson(filePath, data) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

/** @param {string} filePath */
export async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
