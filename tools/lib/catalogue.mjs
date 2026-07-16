// The catalogue: what a theme file looks like, and how index.json is built from all of them.
//
// index.json carries every theme in full rather than a list of pointers, because the thing that
// reads it — the app's theme gallery — draws all of them at once and would otherwise fetch every
// file to draw anything. It is generated, never hand-edited; the CI check re-generates it and fails
// if the result differs from what is committed.

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const THEMES_DIR = 'themes';
export const INDEX_FILE = 'index.json';

/** The file a theme is stored in. */
export function themeFile(id) {
  return join(THEMES_DIR, `${id}.json`);
}

/**
 * A theme file's contents.
 *
 * `author` is what the submitter asked to be credited as and `submittedBy` is the GitHub account
 * that opened the issue. Both are kept: the first is what the gallery shows, and the second is the
 * only part of the pair that is evidence of anything, so it is what a later rename or removal
 * request is checked against.
 */
export function themeRecord({ id, name, author, submittedBy, issue, theme }) {
  return { id, name, author, submittedBy, issue, theme };
}

/** The name of every theme file in the repository, sorted. */
export async function listThemeFiles(root = '.') {
  try {
    return (await readdir(join(root, THEMES_DIR))).filter((f) => f.endsWith('.json')).sort();
  } catch (ex) {
    if (ex.code === 'ENOENT') return [];
    throw ex;
  }
}

/** Every theme in the repository, ordered by id. */
export async function readThemes(root = '.') {
  const themes = [];
  for (const file of await listThemeFiles(root)) {
    const text = await readFile(join(root, THEMES_DIR, file), 'utf8');
    themes.push(JSON.parse(text));
  }
  return themes.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The catalogue for a set of themes.
 *
 * No timestamp, deliberately: a generated file that changes whenever it is generated cannot be
 * checked against the sources it came from, which is the one job the CI check has.
 */
export function buildIndex(themes) {
  return {
    version: 1,
    themes: themes.map(({ id, name, author, theme }) => ({ id, name, author, theme })),
  };
}

/** How every JSON file here is written: two-space indent, one trailing newline. */
export function serialise(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Re-generates index.json from the theme files. Returns the text written. */
export async function writeIndex(root = '.') {
  const text = serialise(buildIndex(await readThemes(root)));
  await writeFile(join(root, INDEX_FILE), text);
  return text;
}
