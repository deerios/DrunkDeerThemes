// The catalogue: what a theme file looks like, and how index.json is built from all of them.
//
// index.json carries what a theme *is called*, not what it looks like: the id, the name, the credit,
// who submitted it, and the issue it came from. The lighting stays in themes/<id>.json, which the
// app fetches when it has a card to draw with it — a gallery that pages through hundreds of themes
// downloads the handful it is showing rather than all of them to show the first six. That is also
// why there is no path in here: the file for a theme is themes/<id>.json, worked out from an id the
// reader has already checked, rather than a location the catalogue gets to name.
//
// It is generated, never hand-edited; the CI check re-generates it and fails if the result differs
// from what is committed.

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
 *
 * `issue` is 0 for the six themes the app shipped with, which were seeded here rather than
 * submitted. Nothing needs to special-case that — a real issue is never numbered 0, so the clash
 * check in tools/submit.mjs treats them as somebody else's themes and protects their names, which
 * is what they should be.
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
 * The version of index.json this builds.
 *
 * The app refuses a version it does not know rather than guessing at a file that has been
 * rearranged under it, so this number and the app's `ThemeGallery.IndexVersion` are one agreement
 * in two repositories. 2 is metadata only; 1 carried each theme's lighting inline.
 */
export const INDEX_VERSION = 2;

/**
 * The catalogue for a set of themes.
 *
 * `theme` is deliberately not in it — see the note at the top of this file. `submittedBy` is: it is
 * how the app knows which of these are yours to modify or unpublish, and it is already public, being
 * the account that opened the issue.
 *
 * No timestamp, deliberately: a generated file that changes whenever it is generated cannot be
 * checked against the sources it came from, which is the one job the CI check has.
 */
export function buildIndex(themes) {
  return {
    version: INDEX_VERSION,
    themes: themes.map(({ id, name, author, submittedBy, issue }) => ({ id, name, author, submittedBy, issue })),
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
