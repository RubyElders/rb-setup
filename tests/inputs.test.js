import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import metadata from '../package.json' with { type: 'json' };
import { defaultVersion, platformInput, versionInput } from '../src/inputs.js';

test('default version is paired with the action package, independent of caller refs', t => {
  const previous = process.env.GITHUB_REF;
  process.env.GITHUB_REF = 'refs/tags/v999.0.0';
  t.after(() => { if (previous === undefined) delete process.env.GITHUB_REF; else process.env.GITHUB_REF = previous; });
  assert.equal(defaultVersion, metadata.version);
  assert.equal(versionInput(), '0.4.1');
  for (const input of ['', '0.4.1', 'v0.4.1', ' v0.4.1 ']) assert.equal(versionInput(input), '0.4.1');
  assert.equal(versionInput('latest'), 'latest');
  assert.equal(versionInput('0.4.0'), '0.4.0');
});

for (const input of ['4.0', 'vlatest', '^0.4.1', '0.4.x', '0.4.1-beta', '00.4.1', '1.2.3+build', '../main', '0.4.1; echo no', '0.4.1\nno', `${'1'.repeat(60)}.0.0`]) {
  test(`rejects version ${JSON.stringify(input)}`, () => assert.throws(() => versionInput(input), /exact stable/));
}

test('maps all three supported binary targets explicitly', () => {
  assert.deepEqual(platformInput('linux', 'x64', '2.39'), { asset: 'rb-linux', executable: 'rb', tool: 'rb-linux', arch: 'x64' });
  assert.equal(platformInput('linux', 'x64', '2.40').asset, 'rb-linux');
  assert.equal(platformInput('darwin', 'arm64').asset, 'rb-macos');
  assert.equal(platformInput('win32', 'x64').executable, 'rb.exe');
});

for (const args of [['linux', 'arm64'], ['darwin', 'x64'], ['win32', 'arm64'], ['freebsd', 'x64']]) {
  test(`rejects unsupported ${args.join('/')}`, () => assert.throws(() => platformInput(...args), /Unsupported platform/));
}
for (const glibc of ['2.38', '2.9', '', 'musl', 'unknown']) {
  test(`rejects incompatible libc ${glibc}`, () => assert.throws(() => platformInput('linux', 'x64', glibc), /glibc 2.39/));
}

test('action metadata exposes only implemented inputs and outputs', async () => {
  const action = parse(await readFile(new URL('../action.yml', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(action.inputs).sort(), ['token', 'version']);
  assert.deepEqual(Object.keys(action.outputs).sort(), ['rb-path', 'rb-version']);
  assert.equal(action.inputs.version.default, undefined);
  assert.equal(action.runs.using, 'node24');
  assert.equal(action.runs.main, 'dist/index.cjs');
  assert.match(action.inputs.token.default, /github.server_url == 'https:\/\/github.com'/);
});

test('rejects a Linux runtime without glibc metadata', t => {
  t.mock.method(process.report, 'getReport', () => ({ header: {} }));
  assert.throws(() => platformInput('linux', 'x64'), /glibc 2.39/);
});
