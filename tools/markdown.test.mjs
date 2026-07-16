// Defusing a stranger's text before the bot says it back.
//
//   node --test "tools/**/*.test.mjs"
//
// The point of all of this is the first group: a theme name is 40 characters of free text, which is
// plenty for a link, and the comment it lands in is signed by github-actions[bot].

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mdMessage, mdText } from './lib/markdown.mjs';

/** What GitHub renders `escaped` back to a reader as: a backslash before punctuation is the mark. */
const rendered = (escaped) => escaped.replace(/\\([\\`*_{}[\]<>()#+\-.!|~])/g, '$1');

describe('a name that is trying to be markdown', () => {
  test('cannot make a link', () => {
    const evil = '[Verify your theme](https://evil.example)';
    const safe = mdText(evil);
    assert.ok(!/\[.+\]\(.+\)/.test(safe), `still a link: ${safe}`);
    assert.equal(rendered(safe), evil, 'reads back as what the author typed');
  });

  test('cannot make an image', () => {
    assert.ok(!/!\[.*\]\(.*\)/.test(mdText('![](https://evil.example/track.png)')));
  });

  test('cannot break out of the bold it is put in', () => {
    assert.ok(!mdText('**shouty**').includes('**'));
  });

  test('cannot open a code fence', () => {
    assert.ok(!mdText('```\nnot a fence\n```').includes('```'));
  });

  test('cannot start a heading or a list', () => {
    assert.equal(mdText('# heading'), '\\# heading');
    assert.equal(mdText('- item'), '\\- item');
  });

  test('leaves text with no punctuation in it alone', () => {
    assert.equal(mdText('Ocean Sunrise'), 'Ocean Sunrise');
  });

  test('leaves a name in another script alone', () => {
    assert.equal(mdText('日本語'), '日本語');
  });

  test('says nothing at all for nothing at all', () => {
    assert.equal(mdText(''), '');
    assert.equal(mdText(null), '');
    assert.equal(mdText(undefined), '');
  });
});

describe('a message from the checks', () => {
  // The brackets around a reference stay escaped and only the hash is let back through: `\(#101\)`
  // renders as "(#101)" with the number linked, because escaping a bracket does not reach into the
  // text beside it.
  test('keeps the issue reference it points at', () => {
    const message = 'There is already a theme called "Ember" (#101). Please pick another name.';
    const safe = mdMessage(message);
    assert.ok(safe.includes('#101'), 'the reference is there');
    assert.ok(!safe.includes('\\#101'), `the hash is still a hash: ${safe}`);
    assert.equal(rendered(safe), message, 'and the sentence reads as it was written');
  });

  test('still defuses the name quoted inside it', () => {
    const message = 'There is already a theme called "[click](https://evil.example)" (#101).';
    const safe = mdMessage(message);
    assert.ok(!/\[click\]\(https/.test(safe), `still a link: ${safe}`);
    assert.ok(safe.includes('#101'));
  });

  test('does not turn a bare number into a reference that was not there', () => {
    assert.equal(mdMessage('over the 16384 limit'), 'over the 16384 limit');
  });
});
