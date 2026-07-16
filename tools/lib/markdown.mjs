// Putting a stranger's text into a comment this repository's bot signs.
//
// A theme name is free text, and the comments below it go out as github-actions[bot]. Left alone, a
// name like `[Verify your theme](https://example.invalid)` is a link in a comment that looks like
// it came from the project — the name is only 40 characters, which is enough. GitHub strips scripts
// from a comment, so this is not about XSS; it is about a bot that can be made to say things.
//
// The validator already refuses control characters, so what is left to defuse is punctuation.

/** Every ASCII punctuation mark markdown gives a meaning to. */
const PUNCTUATION = /[\\`*_{}[\]<>()#+\-.!|~]/g;

/**
 * `text` as itself: markdown that renders back to the characters that went in.
 *
 * Backslash-escaping rather than a code span, because a name is allowed to contain backticks and a
 * code span made of them is a fence — and because the name should read in a comment the way its
 * author wrote it, not in a monospace box.
 */
export function mdText(text) {
  return String(text ?? '').replace(PUNCTUATION, '\\$&');
}

/** An issue reference, once escaping has put a backslash in front of its hash. */
const ISSUE_REF = /\\#(\d+)\b/g;

/**
 * A message from the checks, with the submitter's text in it defused but `#123` still a link.
 *
 * The messages quote back whatever was wrong, so they carry the submitter's text and are escaped
 * like anything else. The one thing escaping takes with it is worth putting back: the clash message
 * points at the issue that published the name already, and that reference is this repository's own
 * writing and the most useful thing in the sentence. A reference is allowed back because it cannot
 * be abused into anything — it links to an issue in this repository and nowhere else, so a
 * submitter who puts `#1` in a theme name has linked to `#1`, which is not an attack.
 */
export function mdMessage(text) {
  return mdText(text).replace(ISSUE_REF, '#$1');
}
