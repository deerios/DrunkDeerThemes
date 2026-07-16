// Checks everything already in the repository, rather than one submission on its way in.
//
// The submission workflow only ever writes files that passed tools/submit.mjs, so on that path this
// finds nothing — it is here for the other path. A theme can also arrive as an ordinary pull
// request, and index.json is generated and so can be committed stale. Both would otherwise reach
// the gallery unchecked.
//
//   node tools/check.mjs

import { readFile } from 'node:fs/promises';
import { INDEX_FILE, buildIndex, listThemeFiles, readThemes, serialise, themeFile } from './lib/catalogue.mjs';
import { toId, validateSubmission } from './lib/validate.mjs';

const problems = [];
const themes = await readThemes();
const seen = new Map();

for (const theme of themes) {
  const where = themeFile(theme.id ?? '?');

  for (const field of ['id', 'name', 'author', 'submittedBy', 'issue', 'theme']) {
    if (theme[field] == null) problems.push(`${where}: has no "${field}".`);
  }
  if (problems.length) continue;

  // The id is the file name, and the gallery uses it to tell themes apart. A file whose id says
  // something else would be fetched under one name and remembered under another. The second form is
  // the fallback for a name that makes no file name at all — see tools/submit.mjs.
  if (theme.id !== toId(theme.name) && theme.id !== `theme-${theme.issue}`) {
    problems.push(`${where}: id "${theme.id}" is neither what the name "${theme.name}" makes ` +
      `("${toId(theme.name)}") nor "theme-${theme.issue}".`);
  }
  if (seen.has(theme.name.toLowerCase())) {
    problems.push(`${where}: another theme is already called "${theme.name}" (${seen.get(theme.name.toLowerCase())}).`);
  }
  seen.set(theme.name.toLowerCase(), where);

  // Checked by the same rules a submission is, so a theme added by hand cannot be one the
  // submission form would have turned away.
  const { errors } = validateSubmission({
    name: theme.name,
    author: theme.author,
    json: JSON.stringify(theme.theme),
    confirmed: true, // The confirmation is the issue's business; the file is past that point.
  });
  for (const error of errors) problems.push(`${where}: ${error}`);
}

// The id above was checked against the theme's name; this checks it against the file it is actually
// stored in — a file renamed on disk without its id being changed to match, which nothing else here
// would notice.
const onDisk = new Set(await listThemeFiles());
for (const theme of themes) {
  if (theme.id && !onDisk.has(`${theme.id}.json`)) {
    problems.push(`themes/: has no ${theme.id}.json, but a theme in it says its id is "${theme.id}".`);
  }
}

const expected = serialise(buildIndex(themes));
const actual = await readFile(INDEX_FILE, 'utf8').catch(() => '');
if (actual !== expected) {
  problems.push(`${INDEX_FILE} is out of date. Run \`node tools/build-index.mjs\` and commit the result.`);
}

if (problems.length) {
  console.error(`${problems.length} problem${problems.length === 1 ? '' : 's'}:\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`${themes.length} theme${themes.length === 1 ? '' : 's'}, all good, and ${INDEX_FILE} is up to date.`);
