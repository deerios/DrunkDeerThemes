// Turns an `update-theme` issue into a new picture for a theme already in the gallery, or into a
// list of reasons it cannot be one.
//
// Run by .github/workflows/update-theme.yml. Like tools/submit.mjs, this only reads the issue and
// writes files — everything that touches GitHub is the workflow's — so it can be run by hand
// against a saved issue body:
//
//   ISSUE_NUMBER=12 ISSUE_AUTHOR=octocat ISSUE_BODY="$(cat body.md)" node tools/update.mjs
//
// It exits 0 for a refused request as well as an accepted one, for the same reason submit.mjs does:
// a request that fails its checks is this working, not this breaking.

import { appendFile, writeFile } from 'node:fs/promises';
import { mdMessage, mdText } from './lib/markdown.mjs';
import { UPDATE_FIELDS as FIELDS, isChecked, parseIssueBody, unfence } from './lib/parse.mjs';
import { resolveTarget } from './lib/request.mjs';
import { validateTheme } from './lib/validate.mjs';
import { serialise, themeFile, themeRecord, writeIndex } from './lib/catalogue.mjs';

const body = process.env.ISSUE_BODY ?? '';
const login = process.env.ISSUE_AUTHOR ?? '';

const fields = parseIssueBody(body);
const request = {
  id: fields[FIELDS.id] ?? '',
  json: unfence(fields[FIELDS.json] ?? ''),
  confirmed: isChecked(fields[FIELDS.confirm] ?? ''),
};

// Which theme, and is it theirs. Everything else is pointless until this is settled, and it is the
// only check here that stops one account rewriting another's theme — see tools/lib/request.mjs.
const { errors, target } = await resolveTarget({ id: request.id, login });

const warnings = [];
let theme = null;

if (target) {
  if (!request.confirmed) {
    errors.push('The confirmation box is not ticked. This replaces the theme in the gallery for everyone.');
  }
  const read = validateTheme(request.json);
  errors.push(...read.errors);
  warnings.push(...read.warnings);
  theme = read.theme;
}

const valid = errors.length === 0;

if (valid) {
  // Only the theme. The id, the name, the credit and the issue that published it are the file's
  // already-settled answers and an update is not asking any of those questions again — writing the
  // whole record from this issue's fields would quietly re-point `issue` at this one, and
  // tools/submit.mjs's name-clash check keys off that: the original issue would then find its own
  // theme sitting in the way of its own name.
  await writeFile(themeFile(target.id), serialise(themeRecord({ ...target, theme })));
  await writeIndex();
}

await comment({ valid, errors, warnings, target });
await output({ valid, target });

/**
 * The comment posted back on the issue.
 *
 * Every piece of the submitter's own text is escaped on its way in, the messages included, for the
 * reasons tools/submit.mjs spells out: they quote back whatever was wrong with it, all of it is the
 * submitter's, and this comment goes out signed by the bot.
 */
async function comment({ valid, errors, warnings, target }) {
  const lines = [];
  if (valid) {
    lines.push(`**“${mdText(target.name)}”** checks out. Updating it now — the gallery will show the new lighting shortly.`);
    if (warnings.length) {
      lines.push('', 'Worth knowing:', ...warnings.map((w) => `- ${mdMessage(w)}`));
    }
    lines.push('', 'This issue closes itself once the change is merged.');
  } else {
    lines.push(
      `Thanks for the update${target ? ` to **“${mdText(target.name)}”**` : ''}. It can't be applied yet:`,
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
