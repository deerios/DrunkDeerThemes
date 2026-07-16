// The rules a submission is judged by, tested against submissions.
//
//   node --test "tools/**/*.test.mjs"
//
// The interesting ones are the last two groups: reading a real issue body, which is the shape of
// input this repository actually gets, and the check that the issue form's labels still match the
// names the parser looks them up by — the one piece of drift that would break every submission at
// once while every other test here carried on passing.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FIELDS, isChecked, parseIssueBody, unfence } from './lib/parse.mjs';
import { LIMITS, toId, validateSubmission } from './lib/validate.mjs';
import { buildIndex, serialise } from './lib/catalogue.mjs';

/** A submission with nothing wrong with it, for tests that want to break exactly one thing. */
const good = () => ({
  name: 'Ocean Sunrise',
  author: 'octocat',
  json: JSON.stringify({ brightness: 9, baseColor: { r: 0, g: 40, b: 120 }, keys: { W: { r: 255, g: 120, b: 0 } } }),
  confirmed: true,
});

const errorsFor = (changes) => validateSubmission({ ...good(), ...changes }).errors;

describe('a theme that is fine', () => {
  test('is published, with the theme read back out of it', () => {
    const { errors, theme, id, name } = validateSubmission(good());
    assert.deepEqual(errors, []);
    assert.equal(id, 'ocean-sunrise');
    assert.equal(name, 'Ocean Sunrise');
    assert.deepEqual(theme, {
      brightness: 9,
      baseColor: { r: 0, g: 40, b: 120 },
      keys: { W: { r: 255, g: 120, b: 0 } },
    });
  });

  test('does not have to set any keys', () => {
    assert.deepEqual(errorsFor({ json: JSON.stringify({ baseColor: { r: 255, g: 244, b: 214 } }) }), []);
  });

  test('is given the default brightness when it does not say', () => {
    const { theme } = validateSubmission({ ...good(), json: JSON.stringify({ baseColor: { r: 10, g: 0, b: 0 } }) });
    assert.equal(theme.brightness, 9);
  });
});

describe('the theme JSON', () => {
  test('is rejected when it is not JSON at all', () => {
    assert.match(errorsFor({ json: 'not json' })[0], /could not be read/);
  });

  test('is rejected when it is empty', () => {
    assert.match(errorsFor({ json: '   ' })[0], /No theme JSON/);
  });

  test('is rejected when it is over the size limit', () => {
    const huge = JSON.stringify({ baseColor: { r: 1, g: 0, b: 0 }, note: 'x'.repeat(LIMITS.json) });
    assert.match(errorsFor({ json: huge })[0], /over the .* limit/);
  });

  test('is rejected when it is a list', () => {
    assert.match(errorsFor({ json: '[]' })[0], /must be an object/);
  });
});

describe('a whole exported profile', () => {
  const profile = (extra) =>
    JSON.stringify({ theme: { baseColor: { r: 0, g: 40, b: 120 } }, ...extra });

  test('is accepted, and only its lighting is taken', () => {
    const { errors, theme } = validateSubmission({ ...good(), json: profile() });
    assert.deepEqual(errors, []);
    assert.deepEqual(theme.baseColor, { r: 0, g: 40, b: 120 });
  });

  test('says so when it carried settings that were left out', () => {
    const { errors, warnings } = validateSubmission({
      ...good(),
      json: profile({ actuation: { default: 2.0 }, rapidTrigger: true }),
    });
    assert.deepEqual(errors, []);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /actuation, rapidTrigger were left out/);
  });

  test('says nothing when it carried only lighting', () => {
    assert.deepEqual(validateSubmission({ ...good(), json: profile() }).warnings, []);
  });
});

describe('key names', () => {
  const withKeys = (keys) => ({ json: JSON.stringify({ baseColor: { r: 0, g: 0, b: 0 }, keys }) });

  test('are matched without case, and spelled back the way the SDK spells them', () => {
    const { theme } = validateSubmission({ ...good(), ...withKeys({ w: { r: 255, g: 0, b: 0 } }) });
    assert.deepEqual(Object.keys(theme.keys), ['W']);
  });

  test('are rejected when the SDK has no such key', () => {
    assert.match(errorsFor(withKeys({ Sparkle: { r: 1, g: 1, b: 1 } }))[0], /not a key this SDK knows/);
  });

  test('are rejected when the same key is set twice under different casing', () => {
    assert.match(errorsFor(withKeys({ W: { r: 1, g: 1, b: 1 }, w: { r: 2, g: 2, b: 2 } }))[0], /set more than once/);
  });

  test('are rejected when there are more of them than any keyboard has', () => {
    const keys = Object.fromEntries(Array.from({ length: LIMITS.keys + 1 }, (_, i) => [`key${i}`, { r: 1, g: 1, b: 1 }]));
    assert.match(errorsFor(withKeys(keys))[0], /over the .* limit/);
  });

  test('come out in a fixed order, so the same theme always makes the same file', () => {
    const one = validateSubmission({ ...good(), ...withKeys({ W: { r: 1, g: 1, b: 1 }, A: { r: 2, g: 2, b: 2 } }) });
    const other = validateSubmission({ ...good(), ...withKeys({ A: { r: 2, g: 2, b: 2 }, W: { r: 1, g: 1, b: 1 } }) });
    assert.equal(JSON.stringify(one.theme), JSON.stringify(other.theme));
  });
});

describe('colours and levels', () => {
  test('reject a channel outside 0-255', () => {
    assert.match(errorsFor({ json: JSON.stringify({ baseColor: { r: 256, g: 0, b: 0 } }) })[0], /from 0 to 255/);
  });

  test('reject a channel that is not a whole number', () => {
    assert.match(errorsFor({ json: JSON.stringify({ baseColor: { r: 1.5, g: 0, b: 0 } }) })[0], /from 0 to 255/);
  });

  test('reject a colour that is not a colour', () => {
    assert.match(errorsFor({ json: JSON.stringify({ baseColor: '#ff0000' }) })[0], /must be a colour like/);
  });

  test('reject brightness outside 0-9', () => {
    const json = JSON.stringify({ brightness: 11, baseColor: { r: 1, g: 0, b: 0 } });
    assert.match(errorsFor({ json })[0], /from 0 to 9/);
  });

  test('reject anything that is not part of a theme', () => {
    const json = JSON.stringify({ baseColor: { r: 1, g: 0, b: 0 }, glow: true });
    assert.match(errorsFor({ json })[0], /"glow" is not part of a theme/);
  });
});

describe('a theme with no light in it', () => {
  test('is rejected when everything is black', () => {
    assert.match(errorsFor({ json: JSON.stringify({ baseColor: { r: 0, g: 0, b: 0 } }) })[0], /nothing to see/);
  });

  test('is rejected when the base is dimmed all the way to black', () => {
    // baseBrightness scales the base colour towards black in software before it is sent — 3 * 0/9
    // is 0 — so this theme really would light nothing, however bright the base colour reads.
    const json = JSON.stringify({ baseColor: { r: 3, g: 3, b: 3 }, baseBrightness: 0 });
    assert.match(errorsFor({ json })[0], /nothing to see/);
  });

  test('is accepted when a dim base still survives the dimming', () => {
    assert.deepEqual(errorsFor({ json: JSON.stringify({ baseColor: { r: 200, g: 0, b: 0 }, baseBrightness: 1 }) }), []);
  });

  test('is accepted when the base is black but a key is lit', () => {
    const json = JSON.stringify({ baseColor: { r: 0, g: 0, b: 0 }, keys: { W: { r: 255, g: 255, b: 255 } } });
    assert.deepEqual(errorsFor({ json }), []);
  });
});

describe('the name and the credit', () => {
  test('are rejected when empty', () => {
    assert.match(errorsFor({ name: '  ' })[0], /Theme name is empty/);
    assert.match(errorsFor({ author: '' })[0], /Credit is empty/);
  });

  test('are rejected when too long', () => {
    assert.match(errorsFor({ name: 'x'.repeat(LIMITS.name + 1) })[0], /over the .* limit/);
  });

  test('are rejected when they are punctuation with no letters in', () => {
    assert.match(errorsFor({ name: '---' })[0], /at least one letter or digit/);
  });

  test('are rejected when they hide control characters', () => {
    // Written as an escape on purpose: a literal control character in this file would look like
    // an ordinary name here, and the next person would delete the test as nonsense.
    assert.match(errorsFor({ name: 'Ember' })[0], /control characters/);
  });

  test('have their whitespace tidied rather than being rejected for it', () => {
    const { errors, name } = validateSubmission({ ...good(), name: '  Ocean   Sunrise  ' });
    assert.deepEqual(errors, []);
    assert.equal(name, 'Ocean Sunrise');
  });
});

describe('the confirmation', () => {
  test('is required', () => {
    assert.match(errorsFor({ confirmed: false })[0], /confirmation box is not ticked/);
  });
});

describe('a theme id', () => {
  test('is the name, lower-cased, with runs of anything else turned into one dash', () => {
    assert.equal(toId('Ocean Sunrise'), 'ocean-sunrise');
    assert.equal(toId('WASD!!! (v2)'), 'wasd-v2');
    assert.equal(toId('  Ember  '), 'ember');
  });

  test('never starts or ends with a dash, even after being cut to length', () => {
    const id = toId(`${'a'.repeat(LIMITS.id - 1)} tail`);
    assert.equal(id.length <= LIMITS.id, true);
    assert.doesNotMatch(id, /^-|-$/);
  });

  test('is nothing when the name has no ASCII in it to make one from', () => {
    assert.equal(toId('日本語'), '');
  });

  test('does not reject a name for making no id — the submitter is lent one', () => {
    // A theme called 日本語 is a perfectly good theme. It is only the file name that cannot be made
    // from it, and tools/submit.mjs answers that with the issue's number.
    assert.deepEqual(errorsFor({ name: '日本語' }), []);
  });
});

describe('reading an issue GitHub wrote from the form', () => {
  // What an issue body really looks like: CRLF line endings, one heading per field, the JSON field
  // fenced by GitHub because the form says `render: json`, and the checkbox rendered as a list.
  const body = [
    `### ${FIELDS.name}`,
    '',
    'Ocean Sunrise',
    '',
    `### ${FIELDS.author}`,
    '',
    '_No response_',
    '',
    `### ${FIELDS.json}`,
    '',
    '```json',
    '{"baseColor":{"r":0,"g":40,"b":120}}',
    '```',
    '',
    `### ${FIELDS.confirm}`,
    '',
    '- [X] This theme is my own work, and I am happy for it to be published in the gallery under the repository\'s licence.',
  ].join('\r\n');

  const fields = parseIssueBody(body);

  test('finds every field', () => {
    assert.equal(fields[FIELDS.name], 'Ocean Sunrise');
    assert.equal(unfence(fields[FIELDS.json]), '{"baseColor":{"r":0,"g":40,"b":120}}');
    assert.equal(isChecked(fields[FIELDS.confirm]), true);
  });

  test('reports a field left empty as empty, not as GitHub\'s placeholder for it', () => {
    assert.equal(fields[FIELDS.author], '');
  });

  test('reads an unticked box as unticked', () => {
    assert.equal(isChecked('- [ ] This theme is my own work.'), false);
  });

  test('takes JSON pasted without a fence just the same', () => {
    assert.equal(unfence('{"a":1}'), '{"a":1}');
  });

  test('keeps a value that has a "###" of its own inside it', () => {
    // Not far-fetched: a theme name is free text, and this is the one character sequence that would
    // end the field early if the parser were looser than "### at the start of a line".
    const withHash = parseIssueBody(`### ${FIELDS.name}\n\nA ### B\n`);
    assert.equal(withHash[FIELDS.name], 'A ### B');
  });
});

describe('the issue form', () => {
  test('still labels its fields the way the parser looks them up', async () => {
    // The one drift that would break every submission while every test above kept passing: the
    // labels in the form are the only link between a field and the code that reads it.
    const template = await readFile('.github/ISSUE_TEMPLATE/new-theme.yml', 'utf8');
    for (const label of Object.values(FIELDS)) {
      assert.equal(
        template.includes(`label: ${label}`),
        true,
        `The issue form has no field labelled "${label}", but parse.mjs reads one.`,
      );
    }
  });
});

describe('the catalogue', () => {
  const themes = [
    { id: 'b', name: 'B', author: 'x', submittedBy: 'x', issue: 2, theme: { brightness: 9 } },
    { id: 'a', name: 'A', author: 'y', submittedBy: 'y', issue: 1, theme: { brightness: 8 } },
  ];

  test('carries each theme in full, so the gallery can draw them all from one file', () => {
    const index = buildIndex(themes);
    assert.deepEqual(index.themes[0], { id: 'b', name: 'B', author: 'x', theme: { brightness: 9 } });
  });

  test('leaves out who submitted it and which issue it came from', () => {
    // Those are the repository's record, not the gallery's business, and every reader of index.json
    // would otherwise be handed a list of accounts it has no use for.
    const [first] = buildIndex(themes).themes;
    assert.equal('submittedBy' in first, false);
    assert.equal('issue' in first, false);
  });

  test('is written with a trailing newline, like every other file here', () => {
    assert.equal(serialise({ a: 1 }), '{\n  "a": 1\n}\n');
  });
});
