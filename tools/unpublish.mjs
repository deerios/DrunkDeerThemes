// Turns a `remove-theme` issue into a theme leaving the gallery, or into the reason it cannot.
//
// Run by .github/workflows/remove-theme.yml. Like tools/submit.mjs, this only reads the issue and
// writes files, so it can be run by hand against a saved issue body:
//
//   ISSUE_NUMBER=12 ISSUE_AUTHOR=octocat ISSUE_BODY="$(cat body.md)" node tools/unpublish.mjs
//
// This is the one automated thing here that destroys something, and it is deliberately the simplest
// of the three: it takes no theme JSON and makes no judgement about the theme itself. Either the
// person asking published it and it goes, or they did not and nothing happens. What it removes stays
// in the repository's history, and the issue says which file it was, so an unpublish someone regrets
// is a revert rather than a loss.

import { appendFile, rm, writeFile } from 'node:fs/promises';
import { mdMessage, mdText } from './lib/markdown.mjs';
import { REMOVE_FIELDS as FIELDS, isChecked, parseIssueBody } from './lib/parse.mjs';
import { resolveTarget } from './lib/request.mjs';
import { themeFile, writeIndex } from './lib/catalogue.mjs';

const body = process.env.ISSUE_BODY ?? '';
const login = process.env.ISSUE_AUTHOR ?? '';

const fields = parseIssueBody(body);
const request = {
  id: fields[FIELDS.id] ?? '',
  confirmed: isChecked(fields[FIELDS.confirm] ?? ''),
};

const { errors, target } = await resolveTarget({ id: request.id, login });

if (target && !request.confirmed) {
  errors.push('The confirmation box is not ticked. Removing a theme takes it out of the gallery for everyone.');
}

const valid = errors.length === 0;

if (valid) {
  await rm(themeFile(target.id));
  await writeIndex();
}

await comment({ valid, errors, target });
await output({ valid, target });

/** The comment posted back on the issue. Escaped on its way in — see tools/submit.mjs. */
async function comment({ valid, errors, target }) {
  const lines = [];
  if (valid) {
    lines.push(
      `**“${mdText(target.name)}”** is yours, so it is being removed now — \`${themeFile(target.id)}\` is on its way out ` +
        'of the gallery.',
      '',
      'This issue closes itself once the removal is merged. Anyone who already copied the theme into a profile keeps ' +
        'their copy; this only takes it out of the gallery.',
    );
  } else {
    lines.push(
      `Thanks for the request${target ? ` about **“${mdText(target.name)}”**` : ''}. Nothing has been removed:`,
      '',
      ...errors.map((e) => `- ${mdMessage(e)}`),
      '',
      'Edit the issue to fix them and it will be checked again — there is no need to open a new one.',
    );
  }
  await writeFile('submission-comment.md', `${lines.join('\n')}\n`);
}

/** Tells the workflow what happened. See tools/submit.mjs for why the newlines go. */
async function output({ valid, target }) {
  const out = process.env.GITHUB_OUTPUT;
  const values = {
    valid: String(valid),
    id: target?.id ?? '',
    name: target?.name ?? '',
    nameMd: mdText(target?.name ?? ''),
  };
  if (!out) {
    console.log(values);
    return;
  }
  await appendFile(out, `${Object.entries(values).map(([k, v]) => line(k, v)).join('\n')}\n`);
}

function line(key, value) {
  return `${key}=${String(value).replace(/[\r\n]+/g, ' ')}`;
}
