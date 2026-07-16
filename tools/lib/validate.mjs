// Deciding whether a submitted theme is one this repository can carry.
//
// Everything a submission is checked against lives here, and nothing here talks to GitHub — the
// workflow supplies the fields and decides what to do with the verdict. That split is what makes
// the rules testable without a submission to test them on (see tools/submission.test.mjs).
//
// The theme itself is the DrunkDeer SDK's own `KeyboardTheme` JSON, the same shape the web app
// exports and the `deerkb` CLI reads. The rules below are a second statement of that format, in a
// language the SDK is not written in, and that is the price of validating without building the SDK
// on every submission. keys.json is the part most likely to drift; see its note in the README.

import { inflateRawSync } from 'node:zlib';
import keyNames from './keys.json' with { type: 'json' };

/** Every DDKey name, lower-cased, mapped to the SDK's own spelling of it. */
const CANONICAL_KEYS = new Map(keyNames.map((k) => [k.toLowerCase(), k]));

export const LIMITS = {
  /** Longest theme name. The gallery shows this on a card, where a long one is simply cut off. */
  name: 40,
  /** Longest author credit. Same reason. */
  author: 40,
  /**
   * Largest theme JSON, in characters. A whole-board theme is around 3 KB; this is generous. Also
   * the decompressed-size cap for a `z1.` submission, in bytes: the same "largest theme JSON" rule
   * either way a submission arrives, so it is expressed once and used for both.
   */
  json: 16 * 1024,
  /** Most per-key overrides. The biggest keyboard the SDK knows has fewer keys than this. */
  keys: 128,
  /** Longest theme id, which is also its file name. */
  id: 48,
};

/** Sections of a profile that are not lighting, and so are not the gallery's business. */
const NON_LIGHTING = ['actuation', 'downstroke', 'upstroke', 'rapidTrigger', 'rapidTriggerAutoMatch', 'turboMode'];

/** Properties a theme may carry. Anything else is a typo worth telling the submitter about. */
const THEME_PROPERTIES = ['brightness', 'baseColor', 'baseBrightness', 'keys'];

/**
 * Checks one submission.
 *
 * Returns `{ errors, warnings, theme, id }`. `errors` empty means the submission is publishable;
 * `theme` and `id` are only meaningful then. Every problem found is reported rather than only the
 * first, because the submitter reads the result as a comment on their issue and a second round trip
 * for a second typo is a poor way to spend their evening.
 */
export function validateSubmission({ name, author, json, confirmed }) {
  const errors = [];
  const warnings = [];

  const cleanName = collapse(name);
  const cleanAuthor = collapse(author);

  checkText(cleanName, 'Theme name', LIMITS.name, errors);
  checkText(cleanAuthor, 'Credit', LIMITS.author, errors);

  if (!confirmed) {
    errors.push('The confirmation box is not ticked. This repository can only publish themes their author is happy to share.');
  }

  const theme = readThemeInto(json, errors, warnings);

  // May be empty, and that is not an error: a name written in a script with no ASCII in it — 日本語
  // — is a perfectly good theme name that simply makes no file name. The caller supplies an id for
  // those; see tools/submit.mjs. The name itself is kept as its author wrote it either way.
  const id = toId(cleanName);

  return { errors, warnings, theme: errors.length ? null : theme, id, name: cleanName, author: cleanAuthor };
}

/**
 * Checks a theme on its own: `{ errors, warnings, theme }`, with `theme` meaningful only when
 * `errors` is empty.
 *
 * What an update submits, where there is no name to check, no credit to check and no box to tick —
 * the theme is replacing the picture in a file that already settled all three. The rules are the
 * same ones {@link validateSubmission} applies to the theme half of a new submission, because they
 * are literally the same code: an update that could carry a theme a submission could not would be a
 * way in through the side door.
 */
export function validateTheme(json) {
  const errors = [];
  const warnings = [];
  const theme = readThemeInto(json, errors, warnings);
  return { errors, warnings, theme: errors.length ? null : theme };
}

/**
 * The theme out of a submission's JSON, or null if it could not be read.
 *
 * Accepts either a bare theme or a whole exported profile with a `theme` section, because both are
 * things a user plausibly has to hand: the app's Publish button sends the first, and the app's
 * Export button writes the second.
 *
 * Also accepts the packed form the app's Publish link carries: `z1.<base64url(raw-deflate(JSON))>`.
 * That link is escaped into a GitHub URL, and a signed-out click bounces through `/login`, which
 * escapes the whole thing a second time — plain JSON there is long enough to trip GitHub's URL
 * length limit, so the app sends the packed form instead and this is the other half of that fix.
 * Pasting plain JSON by hand, which is how the clipboard fallback and every submission before this
 * still works, is untouched.
 */
function readThemeInto(json, errors, warnings) {
  if (!json || !json.trim()) {
    errors.push('No theme JSON was given.');
    return null;
  }

  const trimmed = json.trim();
  const packed = /^z(\d+)\./.exec(trimmed);
  if (packed) {
    if (packed[1] !== '1') {
      errors.push('This theme was submitted by a newer version of the app than this repository understands.');
      return null;
    }
    const unpacked = unpackTheme(trimmed.slice(packed[0].length));
    if (unpacked === TOO_BIG) {
      errors.push(`The theme JSON is over the ${LIMITS.json} limit.`);
      return null;
    }
    if (unpacked === null) {
      errors.push('The theme JSON could not be read: it did not decode.');
      return null;
    }
    json = unpacked;
  } else if (json.length > LIMITS.json) {
    errors.push(`The theme JSON is ${json.length} characters, over the ${LIMITS.json} limit.`);
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (ex) {
    errors.push(`The theme JSON could not be read: ${ex.message}`);
    return null;
  }

  if (!isPlainObject(parsed)) {
    errors.push('The theme JSON must be an object.');
    return null;
  }

  let theme = parsed;
  if ('theme' in parsed) {
    // A whole profile. The lighting is taken and the rest is dropped: a gallery theme that also
    // carried actuation depths would quietly change how someone's keyboard types when they applied
    // it, which is not what a person browsing lighting is agreeing to.
    const carried = NON_LIGHTING.filter((section) => parsed[section] != null);
    if (carried.length) {
      warnings.push(
        `Your submission is a full profile. Only its lighting was published — ${carried.join(', ')} ${carried.length === 1 ? 'was' : 'were'} left out, because gallery themes only set lighting.`,
      );
    }
    theme = parsed.theme;
    if (!isPlainObject(theme)) {
      errors.push('The profile\'s "theme" section must be an object.');
      return null;
    }
  }

  for (const property of Object.keys(theme)) {
    if (!THEME_PROPERTIES.includes(property)) {
      errors.push(`"${property}" is not part of a theme. A theme has: ${THEME_PROPERTIES.join(', ')}.`);
    }
  }

  const clean = {};
  clean.brightness = readLevel(theme.brightness, 'brightness', 9, errors);
  clean.baseColor = readColor(theme.baseColor ?? { r: 0, g: 0, b: 0 }, 'baseColor', errors);
  if (theme.baseBrightness != null) {
    clean.baseBrightness = readLevel(theme.baseBrightness, 'baseBrightness', undefined, errors);
  }
  clean.keys = readKeys(theme.keys, errors);

  if (errors.length) return null;

  // A theme is a picture of a keyboard, and this one has no light in it anywhere. Almost always a
  // submission sent before any colour was written, rather than a deliberate all-off theme — and an
  // all-off theme is what the backlight-off button is for.
  if (!hasAnyLight(clean)) {
    errors.push('Every key in this theme is black, so there would be nothing to see. Set some colours and publish again.');
  }

  if (errors.length) return null;
  if (clean.keys === undefined) delete clean.keys;
  return clean;
}

/** Returned by {@link unpackTheme} when a payload decompresses past {@link LIMITS.json}. */
const TOO_BIG = Symbol('too big');

/**
 * Decodes a `z1.` payload back into JSON text: null if it is not one — not valid base64url, not a
 * valid raw-deflate stream — or {@link TOO_BIG} if it is a stream that would decompress past
 * `LIMITS.json` bytes.
 *
 * That last case is the one that matters: this repository auto-merges with no human in the loop, so
 * a submission that decompresses without limit is a way to take the runner down with a few hundred
 * characters of base64. `maxOutputLength` stops the decompression itself, before anything is held in
 * memory to check — the size has to be capped *during* inflate, not after it.
 */
function unpackTheme(base64url) {
  try {
    const compressed = Buffer.from(base64url, 'base64url');
    const inflated = inflateRawSync(compressed, { maxOutputLength: LIMITS.json });
    return inflated.toString('utf8');
  } catch (ex) {
    return ex.code === 'ERR_BUFFER_TOO_LARGE' ? TOO_BIG : null;
  }
}

/** A 0-9 brightness level. */
function readLevel(value, what, fallback, errors) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || value < 0 || value > 9) {
    errors.push(`"${what}" must be a whole number from 0 to 9, but it is ${describe(value)}.`);
    return fallback;
  }
  return value;
}

/** An `{ r, g, b }` colour. */
function readColor(value, what, errors) {
  if (!isPlainObject(value)) {
    errors.push(`"${what}" must be a colour like {"r": 255, "g": 120, "b": 0}, but it is ${describe(value)}.`);
    return null;
  }
  const extra = Object.keys(value).filter((k) => !['r', 'g', 'b'].includes(k));
  if (extra.length) {
    errors.push(`"${what}" has ${extra.map((k) => `"${k}"`).join(', ')} in it, but a colour is only r, g and b.`);
  }
  const colour = {};
  for (const channel of ['r', 'g', 'b']) {
    const level = value[channel];
    if (!Number.isInteger(level) || level < 0 || level > 255) {
      errors.push(`"${what}.${channel}" must be a whole number from 0 to 255, but it is ${describe(level)}.`);
    } else {
      colour[channel] = level;
    }
  }
  return colour;
}

/** The per-key colour overrides, with every key name spelled the way the SDK spells it. */
function readKeys(value, errors) {
  if (value === undefined || value === null) return undefined;
  if (!isPlainObject(value)) {
    errors.push(`"keys" must be an object of key names to colours, but it is ${describe(value)}.`);
    return undefined;
  }

  const entries = Object.entries(value);
  if (entries.length > LIMITS.keys) {
    errors.push(`This theme sets ${entries.length} keys, over the ${LIMITS.keys} limit.`);
    return undefined;
  }

  const keys = {};
  for (const [name, colour] of entries) {
    const canonical = CANONICAL_KEYS.get(name.trim().toLowerCase());
    if (!canonical) {
      errors.push(`"${name}" is not a key this SDK knows. See the key list in the README.`);
      continue;
    }
    // Key names are matched without case, exactly as the SDK reads them, so "w" and "W" are the
    // same key — and would silently be two entries here if both were kept.
    if (canonical in keys) {
      errors.push(`"${canonical}" is set more than once.`);
      continue;
    }
    keys[canonical] = readColor(colour, name, errors);
  }
  // Sorted so that the same theme always produces the same file, whoever submitted it and whatever
  // order their editor happened to write the keys in.
  return Object.fromEntries(Object.entries(keys).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Whether anything in this theme would light up.
 *
 * The base colour is dimmed by `baseBrightness` before it is sent to the keyboard (the firmware has
 * one brightness for the whole board, so a dimmer background can only be done in software), and
 * dimming it far enough makes it black. That is the same arithmetic the SDK's `RgbColor.Scale`
 * does, so a background this says is invisible really would be.
 */
function hasAnyLight(theme) {
  const scale = theme.baseBrightness ?? 9;
  const base = ['r', 'g', 'b'].some((c) => Math.floor((theme.baseColor[c] * Math.min(scale, 9)) / 9) > 0);
  const keys = Object.values(theme.keys ?? {}).some((c) => c.r > 0 || c.g > 0 || c.b > 0);
  return (theme.brightness ?? 9) > 0 && (base || keys);
}

/** Checks a piece of free text a person typed. */
function checkText(text, what, limit, errors) {
  if (!text) {
    errors.push(`${what} is empty.`);
    return;
  }
  if (text.length > limit) {
    errors.push(`${what} is ${text.length} characters, over the ${limit} limit.`);
  }
  if (/[\p{Cc}\p{Cf}]/u.test(text)) {
    errors.push(`${what} contains control characters.`);
  }
  if (!/[\p{L}\p{N}]/u.test(text)) {
    errors.push(`${what} needs at least one letter or digit.`);
  }
}

/**
 * A theme's id, which is also its file name: the name, lower-cased, with runs of anything else
 * turned into a single dash.
 */
export function toId(name) {
  return collapse(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, LIMITS.id)
    .replace(/-+$/, '');
}

/** Trims and squeezes runs of whitespace, including the newlines a textarea can carry. */
function collapse(text) {
  return (typeof text === 'string' ? text : '').replace(/\s+/g, ' ').trim();
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** How to name a wrong value in a message aimed at whoever has to fix it. */
function describe(value) {
  if (value === undefined) return 'missing';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'object') return 'an object';
  return JSON.stringify(value);
}
