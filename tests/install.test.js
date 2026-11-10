import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile, mkdir, access, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import * as toolkit from '@actions/tool-cache';
import { checkVersion, childEnvironment, install, matches } from '../src/install.js';
import { resolveRelease } from '../src/releases.js';
import { releaseMetadata, server, temporary } from './helpers.js';

const platform = { asset: 'rb-linux', executable: 'rb', tool: 'rb-linux', arch: 'x64' };

async function fixture(t) {
  const root = await temporary(t);
  const env = { RUNNER_TOOL_CACHE: process.env.RUNNER_TOOL_CACHE, RUNNER_TEMP: process.env.RUNNER_TEMP };
  process.env.RUNNER_TOOL_CACHE = join(root, 'tool cache');
  process.env.RUNNER_TEMP = root;
  t.after(() => {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const bytes = Buffer.from('#!/bin/sh\nprintf "Ruby Butler v0.4.1\\n"\n');
  const remote = await server(t, (request, response) => {
    if (request.url.startsWith('/repos/')) response.end(JSON.stringify(releaseMetadata(bytes)));
    else response.end(bytes);
  });
  let downloads = 0;
  const cache = {
    ...toolkit,
    async downloadTool(url, destination) {
      assert.equal(url, 'https://github.com/RubyElders/ruby-butler/releases/download/v0.4.1/rb-linux');
      downloads++;
      return toolkit.downloadTool(`${remote.url}/binary`, destination);
    },
  };
  const release = await resolveRelease('0.4.1', platform, { apiUrl: remote.url, token: 'api-only-secret' });
  const probe = async (file, version) => {
    assert.equal(version, '0.4.1');
    if (process.platform !== 'win32') await checkVersion(file, version);
    else assert.deepEqual(await readFile(file), bytes);
  };
  return { root, cache, release, probe, remote, bytes, downloads: () => downloads };
}

test('downloads over real HTTP, verifies, caches, executes and reuses without another download', async t => {
  const f = await fixture(t);
  const first = await install(f.release, platform, f);
  assert.equal(first.cached, false);
  assert.equal(first.path, join(f.root, 'tool cache', 'rb-linux', '0.4.1', 'x64', 'rb'));
  assert.ok(await matches(first.path, f.release));
  assert.equal(toolkit.find('rb-linux', '0.4.1', 'x64'), join(f.root, 'tool cache', 'rb-linux', '0.4.1', 'x64'));
  const second = await install(f.release, platform, f);
  assert.equal(second.cached, true);
  assert.equal(second.path, first.path);
  assert.equal(f.downloads(), 1);
  assert.deepEqual(f.remote.requests.map(r => r.authorization), ['Bearer api-only-secret', undefined]);
  assert.ok(!(await readdir(f.root)).some(name => name.startsWith('rb-setup-')));
});

test('repairs corrupt or missing cached bytes instead of executing them', async t => {
  const f = await fixture(t);
  const initial = await install(f.release, platform, f);
  await writeFile(initial.path, 'corrupt');
  const repaired = await install(f.release, platform, f);
  assert.equal(repaired.cached, false);
  assert.ok(await matches(repaired.path, f.release));
  assert.equal(f.downloads(), 2);
  const { rm } = await import('node:fs/promises');
  await rm(repaired.path);
  assert.equal((await install(f.release, platform, f)).cached, false);
  assert.equal(f.downloads(), 3);
});

for (const content of ['truncated', '#!/bin/sh\nprintf "Ruby Butler v0.4.1\\x"\n']) {
  test(`rejects wrong bytes before probing or completing the cache: ${content.length}`, async t => {
    const f = await fixture(t);
    let probes = 0;
    f.cache.downloadTool = async (url, destination) => { await writeFile(destination, content); return destination; };
    await assert.rejects(install(f.release, platform, { ...f, probe: async () => { probes++; } }), /verification failed/);
    assert.equal(probes, 0);
    assert.equal(toolkit.find('rb-linux', '0.4.1', 'x64'), '');
    assert.ok(!(await readdir(f.root)).some(name => name.startsWith('rb-setup-')));
  });
}

test('same-length corruption is rejected by SHA-256', async t => {
  const f = await fixture(t);
  f.cache.downloadTool = async (url, destination) => {
    const changed = Buffer.from(f.bytes); changed[changed.length - 2] ^= 1;
    await writeFile(destination, changed);
    return destination;
  };
  await assert.rejects(install(f.release, platform, f), /verification failed/);
  assert.equal(toolkit.find('rb-linux', '0.4.1', 'x64'), '');
});

test('failed execution never publishes a new complete cache entry', async t => {
  const f = await fixture(t);
  await assert.rejects(install(f.release, platform, { ...f, probe: async () => { throw new Error('wrong executable'); } }), /wrong executable/);
  assert.equal(toolkit.find('rb-linux', '0.4.1', 'x64'), '');
});

test('failed download is cleaned up without a cache entry', async t => {
  const f = await fixture(t);
  f.cache.downloadTool = async () => { throw new Error('download unavailable'); };
  await assert.rejects(install(f.release, platform, f), /download unavailable/);
  assert.equal(toolkit.find('rb-linux', '0.4.1', 'x64'), '');
  assert.ok(!(await readdir(f.root)).some(name => name.startsWith('rb-setup-')));
});

test('Windows uses an executable extension for the probe and cached file', async t => {
  const f = await fixture(t);
  const windows = { ...platform, executable: 'rb.exe', tool: 'rb-windows' };
  const result = await install(f.release, windows, { ...f, probe: async file => {
    assert.equal(file.endsWith('rb.exe'), true);
    await access(file);
  } });
  assert.equal(result.path, join(f.root, 'tool cache', 'rb-windows', '0.4.1', 'x64', 'rb.exe'));
  assert.ok(await matches(result.path, f.release));
});

test('child environments remove action service tokens, including Windows casing', () => {
  assert.deepEqual(childEnvironment({ INPUT_TOKEN: 'hidden', Input_Token: 'hidden', ACTIONS_RUNTIME_TOKEN: 'cache-secret', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc-secret', GH_TOKEN: 'user-token', PATH: 'tools' }), { GH_TOKEN: 'user-token', PATH: 'tools' });
});

test('version probing uses a literal executable path and argument array', async () => {
  let calls = 0;
  await checkVersion('path with spaces " and $ characters/rb', '0.4.1', {
    environment: { INPUT_TOKEN: 'hidden', GH_TOKEN: 'user-token' },
    run: async (file, args, options) => {
      calls++;
      assert.equal(file, 'path with spaces " and $ characters/rb');
      assert.deepEqual(args, ['version']);
      assert.deepEqual(options.env, { GH_TOKEN: 'user-token' });
      assert.equal(options.timeout, 30_000);
      return { stdout: 'Ruby Butler v0.4.1 \n\nOther output\n' };
    },
  });
  assert.equal(calls, 1);
  await assert.rejects(checkVersion('rb', '0.4.1', { run: async () => ({ stdout: 'Ruby Butler v0.4.0\n' }) }), /requested version/);
  await assert.rejects(checkVersion('rb', '0.4.1', { run: async () => { throw new Error('sensitive stdout'); } }), error => {
    assert.equal(error.message, 'rb v0.4.1 could not run on this runner');
    return true;
  });
});

test('exact versions use separate cache locations', async t => {
  const root = await temporary(t);
  const bytes = Buffer.from('cache-version-data');
  const release = { version: '0.4.1', url: 'https://example.test/rb', size: bytes.length, digest: createHash('sha256').update(bytes).digest('hex') };
  const saved = [];
  const cache = {
    find: () => '',
    downloadTool: async (url, destination) => writeFile(destination, bytes),
    cacheFile: async (source, name, tool, version, arch) => {
      saved.push([tool, version, arch]);
      const directory = join(root, version); await mkdir(directory); await writeFile(join(directory, name), bytes);
      return directory;
    },
  };
  const options = { cache, temporary: root, probe: async () => {} };
  const first = await install(release, platform, options);
  const second = await install({ ...release, version: '0.4.0' }, platform, options);
  assert.notEqual(first.path, second.path);
  assert.deepEqual(saved, [['rb-linux', '0.4.1', 'x64'], ['rb-linux', '0.4.0', 'x64']]);
});

test('Unix cached permissions are restored after content verification', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t);
  const result = await install(f.release, platform, f);
  await chmod(result.path, 0o644);
  const reused = await install(f.release, platform, f);
  assert.equal(reused.cached, true);
  await checkVersion(reused.path, '0.4.1');
});

test('actual process cannot read INPUT_TOKEN and preserves explicit user credentials', { skip: process.platform === 'win32' }, async t => {
  const root = await temporary(t);
  const file = join(root, 'rb "$ literal');
  await writeFile(file, '#!/bin/sh\n[ -z "$INPUT_TOKEN" ] || exit 1\n[ "$GH_TOKEN" = "user-owned" ] || exit 1\nprintf "Ruby Butler v0.4.1\\n"\n');
  await chmod(file, 0o755);
  await checkVersion(file, '0.4.1', { environment: { INPUT_TOKEN: 'private-input-canary', GH_TOKEN: 'user-owned' } });
});
