// Reading a submission back out of the issue GitHub wrote from the form.
//
// An issue form does not store the values anywhere structured: it renders them into the issue body
// as markdown, one `### <label>` heading per field followed by the value. So the labels in
// .github/ISSUE_TEMPLATE/*.yml are load-bearing — they are the only link between a field and the
// code that reads it. The names below must match those files, and tools/submission.test.mjs reads
// every template and fails if they ever drift apart.

/** .github/ISSUE_TEMPLATE/new-theme.yml — publishing a theme. */
export const FIELDS = {
  name: 'Theme name',
  author: 'Credit this theme to',
  json: 'Theme JSON',
  confirm: 'Confirmation',
};

/**
 * .github/ISSUE_TEMPLATE/update-theme.yml — replacing the lighting of a theme already published.
 *
 * There is no name and no credit: an update changes the picture and nothing else, so the two things
 * a person might want to argue about are the ones it cannot touch. Renaming is removing and
 * publishing again, which is the only way the id — and so the file — can move.
 */
export const UPDATE_FIELDS = {
  id: 'Theme id',
  json: 'Theme JSON',
  confirm: 'Confirmation',
};

/** .github/ISSUE_TEMPLATE/remove-theme.yml — taking a theme back out of the gallery. */
export const REMOVE_FIELDS = {
  id: 'Theme id',
  confirm: 'Confirmation',
};

// What GitHub puts in place of a field the user left empty.
const NO_RESPONSE = '_No response_';

/**
 * Splits an issue body into `{ '<heading>': '<value>' }`.
 *
 * Values are returned as written, minus surrounding blank lines. A field the user left empty comes
 * back as an empty string rather than GitHub's placeholder text, so callers can treat "empty" one
 * way instead of two.
 */
export function parseIssueBody(body) {
  const fields = {};
  if (typeof body !== 'string') return fields;

  // Normalised first: an issue body arrives with CRLF line endings, and every heading and fence
  // match below is written in terms of \n.
  const lines = body.replace(/\r\n?/g, '\n').split('\n');

  let heading = null;
  let value = [];
  const flush = () => {
    if (heading === null) return;
    const text = value.join('\n').trim();
    fields[heading] = text === NO_RESPONSE ? '' : text;
  };

  for (const line of lines) {
    const match = /^### +(.+?) *$/.exec(line);
    if (match) {
      flush();
      heading = match[1];
      value = [];
    } else if (heading !== null) {
      value.push(line);
    }
  }
  flush();

  return fields;
}

/**
 * The JSON out of a `render: json` textarea.
 *
 * That field arrives wrapped in a ```json fence, which GitHub adds itself — the user never typed
 * it. The fence is stripped here rather than in the validator so that a theme pasted into a plain
 * issue comment, with or without a fence of its own, reads the same way.
 */
export function unfence(text) {
  const fenced = /^```[a-zA-Z]*\n([\s\S]*?)\n?```$/.exec((text ?? '').trim());
  return (fenced ? fenced[1] : text ?? '').trim();
}

/**
 * `true` when the user ticked the confirmation checkbox.
 *
 * A checklist renders as `- [X] <label>` when ticked and `- [ ] <label>` when not, so the tick is
 * the only thing worth reading — the label is the template's, not the user's.
 */
export function isChecked(text) {
  return /^- \[[xX]\]/m.test(text ?? '');
}
