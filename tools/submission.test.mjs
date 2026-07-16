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
import { readdir, readFile } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';
import { FIELDS, REMOVE_FIELDS, UPDATE_FIELDS, isChecked, parseIssueBody, unfence } from './lib/parse.mjs';
import { LIMITS, toId, validateSubmission } from './lib/validate.mjs';
import { INDEX_VERSION, buildIndex, serialise } from './lib/catalogue.mjs';

/** Packs JSON the way the app's Publish link does, for tests on the receiving end of it. */
const pack = (json) => `z1.${deflateRawSync(Buffer.from(json, 'utf8')).toString('base64url')}`;

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

describe('the z1. packed form', () => {
  // The other half of the fix for a signed-out Publish click: see README.md's "The z1. format".

  test('unpacks to the identical theme a plain submission of the same JSON would produce', () => {
    const json = JSON.stringify({ brightness: 9, baseColor: { r: 0, g: 40, b: 120 }, keys: { W: { r: 255, g: 120, b: 0 } } });
    const plain = validateSubmission({ ...good(), json });
    const packed = validateSubmission({ ...good(), json: pack(json) });
    assert.deepEqual(packed.errors, []);
    assert.deepEqual(packed.theme, plain.theme);
  });

  test('a bomb is refused rather than inflated', () => {
    // A megabyte of zeroes deflates to a few hundred bytes — this is the shape of submission that
    // would take an auto-merging runner down if it were inflated without a cap.
    const bomb = `z1.${deflateRawSync(Buffer.alloc(1024 * 1024)).toString('base64url')}`;
    assert.match(errorsFor({ json: bomb })[0], /over the .* limit/);
  });

  test('junk after the prefix is refused, not thrown', () => {
    assert.match(errorsFor({ json: 'z1.not valid base64 at all $$$' })[0], /could not be read/);
  });

  test('an unknown prefix gets its own message rather than a JSON parse error', () => {
    assert.match(errorsFor({ json: 'z2.whatever-a-future-version-sends' })[0], /newer version of the app/);
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
    // Built rather than typed: a literal control character here would be invisible, and the next
    // person would read the name as an ordinary "Ember" and delete the test as nonsense. An
    // escape would say so, but anything that carries this file as JSON decodes it straight back
    // into the invisible byte it was avoiding — which is how this file reaches GitHub.
    const name = `Em${String.fromCharCode(7)}ber`;
    assert.match(errorsFor({ name })[0], /control characters/);
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

describe('the issue forms', () => {
  // The one drift that would break every submission while every test above kept passing: the
  // labels in a form are the only link between a field and the code that reads it. One case per
  // form, because there are three of them now and a loop that quietly checked none of them —
  // a renamed file, an empty map — would look exactly like a pass.
  const forms = [
    ['new-theme.yml', FIELDS],
    ['update-theme.yml', UPDATE_FIELDS],
    ['remove-theme.yml', REMOVE_FIELDS],
  ];

  for (const [file, fields] of forms) {
    test(`${file} still labels its fields the way the parser looks them up`, async () => {
      const template = await readFile(`.github/ISSUE_TEMPLATE/${file}`, 'utf8');
      const labels = Object.values(fields);
      assert.ok(labels.length > 0, 'parse.mjs reads no fields out of this form, which cannot be right.');
      for (const label of labels) {
        assert.equal(
          template.includes(`label: ${label}`),
          true,
          `${file} has no field labelled "${label}", but parse.mjs reads one.`,
        );
      }
    });
  }

  test('are the only forms there are, so a new one cannot go unparsed', async () => {
    const onDisk = (await readdir('.github/ISSUE_TEMPLATE')).filter((f) => f.endsWith('.yml')).sort();
    assert.deepEqual(onDisk, forms.map(([file]) => file).sort());
  });
});

describe('the catalogue', () => {
  const themes = [
    { id: 'b', name: 'B', author: 'x', submittedBy: 'x', issue: 2, theme: { brightness: 9 } },
    { id: 'a', name: 'A', author: 'y', submittedBy: 'y', issue: 1, theme: { brightness: 8 } },
  ];

  test('says what each theme is called and who by, and nothing about what it looks like', () => {
    const index = buildIndex(themes);
    assert.equal(index.version, INDEX_VERSION);
    assert.deepEqual(index.themes[0], { id: 'b', name: 'B', author: 'x', submittedBy: 'x', issue: 2 });
  });

  test('leaves the lighting out, so a gallery fetches the themes it is showing and no more', () => {
    // The point of the whole file: a page of six cards costs six theme files, not every theme in
    // the repository. The app fetches themes/<id>.json when it has a card to draw with it.
    for (const entry of buildIndex(themes).themes) assert.equal('theme' in entry, false);
  });

  test('names no path, so the reader works the file out from an id it has already checked', () => {
    // An id is checked against a pattern at both ends before anything is fetched with it. A path
    // the catalogue supplied would be a second, unchecked way to say where a theme lives.
    for (const entry of buildIndex(themes).themes) {
      assert.deepEqual(Object.keys(entry).filter((k) => /file|path|url/i.test(k)), []);
    }
  });

  test('is written with a trailing newline, like every other file here', () => {
    assert.equal(serialise({ a: 1 }), '{\n  "a": 1\n}\n');
  });
});
