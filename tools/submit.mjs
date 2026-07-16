// Turns a `new-theme` issue into a theme file, or into a list of reasons it cannot be one.
//
// Run by .github/workflows/new-theme.yml, which reads the verdict off this script's outputs and
// does everything that touches GitHub — labels, comments, the pull request. This script only reads
// the issue and writes files, so it can be run by hand against a saved issue body when something
// looks wrong:
//
//   ISSUE_NUMBER=12 ISSUE_AUTHOR=octocat ISSUE_BODY="$(cat body.md)" node tools/submit.mjs
//
// It exits 0 for an invalid submission as well as a valid one. A submission that fails its checks
// is this workflow working, not the workflow breaking, and a red cross on the repository every time
// somebody mistypes a colour would train everyone to ignore red crosses.

import { appendFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { mdMessage, mdText } from './lib/markdown.mjs';
import { FIELDS, isChecked, parseIssueBody, unfence } from './lib/parse.mjs';
import { validateSubmission } from './lib/validate.mjs';
import { THEMES_DIR, readThemes, serialise, themeFile, themeRecord, writeIndex } from './lib/catalogue.mjs';

const body = process.env.ISSUE_BODY ?? '';
const issue = Number(process.env.ISSUE_NUMBER);
const submittedBy = process.env.ISSUE_AUTHOR ?? '';

const fields = parseIssueBody(body);
const submission = {
  name: fields[FIELDS.name] ?? '',
  author: fields[FIELDS.author] ?? '',
  json: unfence(fields[FIELDS.json] ?? ''),
  confirmed: isChecked(fields[FIELDS.confirm] ?? ''),
};

// An empty credit means "use my GitHub name". The field is optional because that is the answer most
// people want, and asking them to type their own username back is a strange way to say so.
if (!submission.author) submission.author = submittedBy;

const { errors, warnings, theme, id: slug, name, author } = validateSubmission(submission);

// A name in a script with no ASCII in it makes no file name, so the issue lends it its number. The
// name people see is unaffected — this is only what the file is called.
const id = slug || `theme-${issue}`;

const published = await readThemes();

// Two themes cannot share a name: the gallery shows names, and "which Ember did you mean" is not a
// question it can answer. Checked here rather than in the validator because it is a fact about this
// repository right now, not about the format. Matched on the id as well as the name, because that
// is what the file is called — "Ember" and "ember!" are different names and the same file.
const clash = published.find(
  (t) => t.issue !== issue && (t.id === id || t.name.toLowerCase() === name.toLowerCase()),
);
if (!errors.length && clash) {
  errors.push(
    `There is already a theme called "${clash.name}" (#${clash.issue}). Please pick another name — themes are ` +
      'published under their name, so two cannot share one.',
  );
}

const valid = errors.length === 0;

if (valid) {
  // An issue that was edited to rename its theme has already published one under the old name. The
  // rename has to take that file with it, or the old one stays in the gallery forever with nothing
  // pointing at it.
  for (const old of published) {
    if (old.issue === issue && old.id !== id) await rm(themeFile(old.id));
  }

  // Written straight into the checkout. The workflow commits whatever this leaves behind, so an
  // edited issue re-writes the same file and the pull request updates rather than duplicating.
  // The folder is made rather than assumed: git does not carry an empty one, so the very first
  // submission to a fresh repository would otherwise have nowhere to go.
  await mkdir(THEMES_DIR, { recursive: true });
  await writeFile(themeFile(id), serialise(themeRecord({ id, name, author, submittedBy, issue, theme })));
  await writeIndex();
}

await comment({ valid, errors, warnings, id, name, author });
await output({ valid, id, name });

/**
 * The comment posted back on the issue. It is the only thing most submitters will read.
 *
 * Every piece of the submitter's own text is escaped on its way in — the name and the credit, but
 * the messages too, because those quote back the part that was wrong: a key that is not a key, a
 * property that is not a property, whatever JSON.parse made of the text. All of it is the
 * submitter's, none of it is meant to be markdown, and this comment goes out signed by the bot.
 * Escaped here, at the one place a comment is written, rather than at each message that builds one:
 * a message added later cannot forget to do it.
 */
async function comment({ valid, errors, warnings, id, name, author }) {
  const lines = [];
  if (valid) {
    lines.push(`**“${mdText(name)}”** checks out. Publishing it now as \`${themeFile(id)}\`, credited to ${mdText(author)}.`);
    if (warnings.length) {
      lines.push('', 'Worth knowing:', ...warnings.map((w) => `- ${mdMessage(w)}`));
    }
    lines.push('', 'This issue closes itself once the theme is merged.');
  } else {
    lines.push(
      `Thanks for submitting **“${mdText(name) || 'this theme'}”**. It can't be published yet:`,
      '',
      ...errors.map((e) => `- ${mdMessage(e)}`),
      '',
      'Edit the issue to fix them and it will be checked again — there is no need to open a new one.',
    );
  }
  await writeFile('submission-comment.md', `${lines.join('\n')}\n`);
}

/**
 * Tells the workflow what happened.
 *
 * `nameMd` is the name with markdown defused, for the one comment the workflow writes itself rather
 * than taking from `submission-comment.md`.
 */
async function output({ valid, id, name }) {
  const out = process.env.GITHUB_OUTPUT;
  const values = { valid: String(valid), id, name, nameMd: mdText(name) };
  if (!out) {
    console.log(values);
    return;
  }
  await appendFile(out, `${Object.entries(values).map(([k, v]) => line(k, v)).join('\n')}\n`);
}

/**
 * One `key=value` for GITHUB_OUTPUT, with the newlines taken out of the value.
 *
 * This file is read back a line at a time, so a newline inside a value starts what looks like
 * another key — and the key a submitter would want to write is `valid=true`, over the top of this
 * script's verdict, which publishes a theme that failed its checks. The name is squeezed onto one
 * line long before it arrives here (`collapse` in validate.mjs, which is also what rejects the
 * control characters), so this is a second lock on the same door. It gets two because it is the
 * door where being wrong means the checks stop being a gate at all.
 */
function line(key, value) {
  return `${key}=${String(value).replace(/[\r\n]+/g, ' ')}`;
}
