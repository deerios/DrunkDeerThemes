// What a request about a theme that is already published has to settle before anything happens:
// which theme it means, and whether the person asking is the person who put it there.
//
// Both tools/update.mjs and tools/unpublish.mjs start here. Publishing needs none of it — a new
// theme belongs to whoever submits it, and there is nothing yet to own.

import { readThemes } from './catalogue.mjs';

/**
 * The theme a request is about, or the reasons it is about nothing: `{ errors, target }`.
 *
 * `login` is the GitHub account that opened the issue, and it must be
 * `github.event.issue.user.login` from the event payload — not anything read out of the issue body.
 * The body is the submitter's text and they may write whatever they like in it, including somebody
 * else's name. This is the only thing standing between the automation and one account rewriting or
 * deleting another's themes, so it is worth being exact about where the name comes from.
 *
 * `id` is the submitter's text too, and it stays that way: it is compared against the ids of the
 * themes actually on disk and the matching record's own id is what any file path is later built
 * from. So an id that is shaped like a path out of the themes folder is not something this
 * sanitises — it is an id that matches no theme, which is the same answer as any other typo.
 */
export async function resolveTarget({ id, login }, root = '.') {
  const errors = [];

  const wanted = (typeof id === 'string' ? id : '').trim().toLowerCase();
  if (!wanted) {
    errors.push('No theme id was given, so there is nothing to look up. The app fills this in for you.');
    return { errors, target: null };
  }

  const target = (await readThemes(root)).find((t) => t.id.toLowerCase() === wanted) ?? null;
  if (!target) {
    errors.push(
      `There is no theme with the id \`${wanted}\` in the gallery. If it was renamed or already ` +
        'removed, the id may have changed with it.',
    );
    return { errors, target: null };
  }

  if (!isOwnedBy(target, login)) {
    // Deliberately says who it belongs to rather than only that it is not yours: the theme, its
    // credit and the issue that published it are all public already, and "no" with no reason is how
    // you get a second issue asking why.
    errors.push(
      `**“${target.name}”** was published by @${target.submittedBy} (in #${target.issue}), so only ` +
        'they can change or remove it. If it is yours and you submitted it from another account, ' +
        'open an issue and a maintainer can sort it out.',
    );
    return { errors, target: null };
  }

  return { errors, target };
}

/**
 * Whether `login` is the account that published `theme`.
 *
 * Compared without case, because GitHub logins are: `Octocat` and `octocat` are one account, and
 * the payload's spelling of it is not something to bet a refusal on.
 */
export function isOwnedBy(theme, login) {
  const who = (typeof login === 'string' ? login : '').trim();
  return who !== '' && who.toLowerCase() === (theme.submittedBy ?? '').trim().toLowerCase();
}
