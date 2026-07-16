// Changing a theme that is already published: tools/update.mjs and tools/unpublish.mjs.
//
//   node --test "tools/**/*.test.mjs"
//
// Run as scripts, against a throwaway copy of a repository, because that is what they are: they read
// the issue out of the environment and write files into the working directory, and a test that
// imported their insides would not be testing the thing the workflow runs.
//
// The ones that matter most are the refusals. These two scripts are the only automated things here
// that can change or destroy somebody else's work, and the single check standing in the way is "did
// the account opening this issue publish this theme". Every test below that ends in "nothing
// happened" is a test of that check.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';

const run = promisify(execFile);
const HERE = import.meta.dirname;

/** Packs JSON the way the app's Modify link does. */
const pack = (theme) => `z1.${deflateRawSync(Buffer.from(JSON.stringify(theme), 'utf8')).toString('base64url')}`;

const OLD_LIGHTING = { brightness: 9, baseColor: { r: 0, g: 40, b: 120 }, keys: { W: { r: 255, g: 120, b: 0 } } };
const NEW_LIGHTING = { brightness: 4, baseColor: { r: 120, g: 0, b: 0 }, keys: { A: { r: 0, g: 255, b: 0 } } };

/** The theme every test here starts with: published by octocat, in issue 7. */
const PUBLISHED = {
  id: 'ocean-sunrise',
  name: 'Ocean Sunrise',
  author: 'A Person',
  submittedBy: 'octocat',
  issue: 7,
  theme: OLD_LIGHTING,
};

let repo;

/** A working directory with one theme published in it. */
async function makeRepo(theme = PUBLISHED) {
  const root = await mkdtemp(join(tmpdir(), 'ddt-change-'));
  await mkdir(join(root, 'themes'));
  await writeFile(join(root, 'themes', `${theme.id}.json`), `${JSON.stringify(theme, null, 2)}\n`);
  await run('node', [join(HERE, 'build-index.mjs')], { cwd: root });
  return root;
}

/**
 * Runs one of the scripts against `repo` as the workflow would, and reports what it decided.
 *
 * The verdict is read out of a GITHUB_OUTPUT file rather than stdout, because that is the channel
 * the workflow actually believes.
 */
async function ask(script, { id, json, confirmed = true, login = 'octocat', issue = 12 }) {
  const body = [
    '### Theme id',
    '',
    id,
    ...(json === undefined ? [] : ['', '### Theme JSON', '', '```json', json, '```']),
    '',
    '### Confirmation',
    '',
    `- [${confirmed ? 'X' : ' '}] Yes`,
    '',
  ].join('\n');

  const output = join(repo, 'verdict.txt');
  await run('node', [join(HERE, script)], {
    cwd: repo,
    env: {
      ...process.env,
      ISSUE_BODY: body,
      ISSUE_NUMBER: String(issue),
      ISSUE_AUTHOR: login,
      GITHUB_OUTPUT: output,
    },
  });

  const verdict = Object.fromEntries(
    (await readFile(output, 'utf8')).trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );
  return {
    valid: verdict.valid === 'true',
    verdict,
    comment: await readFile(join(repo, 'submission-comment.md'), 'utf8'),
  };
}

const readTheme = async (id = PUBLISHED.id) => JSON.parse(await readFile(join(repo, 'themes', `${id}.json`), 'utf8'));
const readIndex = async () => JSON.parse(await readFile(join(repo, 'index.json'), 'utf8'));
const themeFiles = async () => (await readdir(join(repo, 'themes'))).sort();

beforeEach(async () => {
  repo = await makeRepo();
});

describe('updating a theme', () => {
  test('replaces the lighting when its own author asks', async () => {
    const { valid, comment } = await ask('update.mjs', { id: 'ocean-sunrise', json: pack(NEW_LIGHTING) });

    assert.equal(valid, true);
    assert.deepEqual((await readTheme()).theme, NEW_LIGHTING);
    assert.match(comment, /Updating it now/);
  });

  test('changes nothing else about it', async () => {
    // The name, the credit and — the one that bites — the issue it was published in. submit.mjs
    // decides a name clash by "is this somebody else's issue", so re-pointing `issue` at the update
    // would leave the original issue colliding with its own theme.
    await ask('update.mjs', { id: 'ocean-sunrise', json: pack(NEW_LIGHTING), issue: 99 });

    const { theme, ...rest } = await readTheme();
    const { theme: _, ...before } = PUBLISHED;
    assert.deepEqual(rest, before);
  });

  test('rebuilds the catalogue, which still says nothing about the lighting', async () => {
    await ask('update.mjs', { id: 'ocean-sunrise', json: pack(NEW_LIGHTING) });

    const index = await readIndex();
    assert.deepEqual(index.themes, [
      { id: 'ocean-sunrise', name: 'Ocean Sunrise', author: 'A Person', submittedBy: 'octocat', issue: 7 },
    ]);
  });

  test('takes plain JSON as well as the packed form the app sends', async () => {
    const { valid } = await ask('update.mjs', { id: 'ocean-sunrise', json: JSON.stringify(NEW_LIGHTING) });

    assert.equal(valid, true);
    assert.deepEqual((await readTheme()).theme, NEW_LIGHTING);
  });

  test('refuses somebody else, and leaves the theme exactly as it was', async () => {
    const { valid, comment } = await ask('update.mjs', {
      id: 'ocean-sunrise',
      json: pack(NEW_LIGHTING),
      login: 'somebody-else',
    });

    assert.equal(valid, false);
    assert.deepEqual((await readTheme()).theme, OLD_LIGHTING);
    assert.match(comment, /published by @octocat/);
  });

  test('knows a login is a login whatever case it is written in', async () => {
    const { valid } = await ask('update.mjs', { id: 'ocean-sunrise', json: pack(NEW_LIGHTING), login: 'OctoCat' });

    assert.equal(valid, true);
  });

  test('refuses an id that is no theme', async () => {
    const { valid, comment } = await ask('update.mjs', { id: 'no-such-theme', json: pack(NEW_LIGHTING) });

    assert.equal(valid, false);
    assert.match(comment, /no theme with the id/);
  });

  test('refuses an id that is a path', async () => {
    // Not because it is sanitised — it is not. It matches no theme, which is the same answer a typo
    // gets, and the file path only ever comes from the matched theme's own id.
    const { valid } = await ask('update.mjs', { id: '../../elsewhere', json: pack(NEW_LIGHTING) });

    assert.equal(valid, false);
    assert.deepEqual(await themeFiles(), ['ocean-sunrise.json']);
  });

  test('refuses an unticked confirmation', async () => {
    const { valid, comment } = await ask('update.mjs', {
      id: 'ocean-sunrise',
      json: pack(NEW_LIGHTING),
      confirmed: false,
    });

    assert.equal(valid, false);
    assert.deepEqual((await readTheme()).theme, OLD_LIGHTING);
    assert.match(comment, /confirmation box is not ticked/);
  });

  test('holds the new lighting to the same rules a new submission is held to', async () => {
    const { valid, comment } = await ask('update.mjs', {
      id: 'ocean-sunrise',
      json: JSON.stringify({ brightness: 9, baseColor: { r: 0, g: 0, b: 0 }, keys: { Nonsense: { r: 1, g: 1, b: 1 } } }),
    });

    assert.equal(valid, false);
    assert.match(comment, /not a key this SDK knows/);
    assert.deepEqual((await readTheme()).theme, OLD_LIGHTING);
  });
});

describe('unpublishing a theme', () => {
  test('removes it when its own author asks', async () => {
    const { valid, comment } = await ask('unpublish.mjs', { id: 'ocean-sunrise' });

    assert.equal(valid, true);
    assert.deepEqual(await themeFiles(), []);
    assert.deepEqual((await readIndex()).themes, []);
    assert.match(comment, /being removed now/);
  });

  test('needs no theme JSON to do it', async () => {
    // The form has no such field. A removal that could be refused over the lighting would be a
    // removal you could be locked out of by the thing you are trying to remove.
    const { valid } = await ask('unpublish.mjs', { id: 'ocean-sunrise', json: undefined });

    assert.equal(valid, true);
  });

  test('refuses somebody else, and the theme stays', async () => {
    const { valid, comment } = await ask('unpublish.mjs', { id: 'ocean-sunrise', login: 'somebody-else' });

    assert.equal(valid, false);
    assert.deepEqual(await themeFiles(), ['ocean-sunrise.json']);
    assert.deepEqual((await readIndex()).themes.length, 1);
    assert.match(comment, /published by @octocat/);
  });

  test('refuses an id that is no theme', async () => {
    const { valid } = await ask('unpublish.mjs', { id: 'no-such-theme' });

    assert.equal(valid, false);
    assert.deepEqual(await themeFiles(), ['ocean-sunrise.json']);
  });

  test('refuses an unticked confirmation', async () => {
    const { valid, comment } = await ask('unpublish.mjs', { id: 'ocean-sunrise', confirmed: false });

    assert.equal(valid, false);
    assert.deepEqual(await themeFiles(), ['ocean-sunrise.json']);
    assert.match(comment, /confirmation box is not ticked/);
  });
});

describe('a theme nobody is recorded as having submitted', () => {
  // A file hand-added without a submittedBy, which tools/check.mjs would refuse but which is worth
  // being sure about anyway: "" must not be an account that owns it, or a request from an issue with
  // no author attached would walk straight in.
  beforeEach(async () => {
    repo = await makeRepo({ ...PUBLISHED, submittedBy: '' });
  });

  test('belongs to nobody, so nobody can update it', async () => {
    const { valid } = await ask('update.mjs', { id: 'ocean-sunrise', json: pack(NEW_LIGHTING), login: '' });
    assert.equal(valid, false);
  });

  test('belongs to nobody, so nobody can remove it', async () => {
    const { valid } = await ask('unpublish.mjs', { id: 'ocean-sunrise', login: '' });
    assert.equal(valid, false);
    assert.deepEqual(await themeFiles(), ['ocean-sunrise.json']);
  });
});
