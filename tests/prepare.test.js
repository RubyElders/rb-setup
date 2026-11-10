import { test } from 'node:test';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { prepareProject } from '../src/prepare.js';
import { projectInputs } from '../src/project-inputs.js';
import { cacheKeys, caches } from '../src/cache.js';

const fingerprint = 'a'.repeat(64);
const compatibility = 'b'.repeat(64);
function descriptor(overrides = {}) {
  return {
    schema_version: 1, rb_version: '0.4.2', backend: 'native', working_directory: '/work',
    project: { root: '/work' }, ruby: { version: '4.0.9', path: '/rubies/ruby-4.0.9', installed: true },
    cache: { complete: true, paths: ['/work/.rb/bundle/ruby/4.0.0'], lockfile: '/work/Gemfile.lock', fingerprint, compatibility }, ...overrides,
  };
}
function inputs(values = {}) { return projectInputs({ getInput: name => values[name] || '' }, '/work'); }
function fixture() {
  const calls = [];
  const output = {};
  let inspections = 0;
  const actions = {
    exportVariable: (...args) => calls.push(['environment', ...args]),
    setOutput: (name, value) => { output[name] = value; },
    warning: value => calls.push(['warning', value]),
  };
  const command = {
    inspect: async options => { calls.push(['inspect', options]); inspections++; return descriptor(inspections === 1 ? { cache: null } : {}); },
    run: async args => calls.push(['run', args]),
  };
  const cache = {
    restore: async (entry, fallback) => { calls.push(['restore', entry, fallback]); },
    save: async (entry, restored) => calls.push(['save', entry, restored]),
  };
  return { actions, command, cache, calls, output, environment: {} };
}

test('project inputs respect globals as literal arguments and strict booleans', () => {
  const result = inputs({ sync: 'true', 'working-directory': 'folder with spaces', 'project-file': "custom ' file.toml", 'config-file': 'custom.toml', 'ruby-version': '4.0', 'package-backend': 'native' });
  assert.deepEqual(result.globals, ['-C', resolve('/work', 'folder with spaces'), '-P', "custom ' file.toml", '-c', 'custom.toml']);
  assert.equal(result.cache, true);
  assert.equal(result.locked, true);
  assert.equal(inputs().cache, false);
  assert.throws(() => inputs({ sync: 'yes' }), /true or false/);
  assert.throws(() => inputs({ cache: 'true' }), /require sync/);
  assert.throws(() => inputs({ 'package-backend': 'other' }), /bundler or native/);
});

test('cold preparation restores before sync and saves only after final inspection', async () => {
  const f = fixture();
  await prepareProject('rb', inputs({ sync: 'true', 'cache-ruby': 'true', 'ruby-version': '4.0.9', 'package-backend': 'native' }), f.actions, f);
  assert.deepEqual(f.calls.map(call => call[0]), ['inspect', 'restore', 'run', 'inspect', 'restore', 'run', 'inspect', 'save', 'save']);
  assert.deepEqual(f.calls.find(call => call[0] === 'run')[1], ['install', 'ruby', '4.0.9']);
  assert.equal(f.calls.filter(call => call[0] === 'restore')[1][2], true);
  assert.equal(f.calls.filter(call => call[0] === 'restore')[0][2], undefined);
  assert.deepEqual(f.output, { 'dependency-cache-hit': false, 'ruby-cache-hit': false, 'ruby-version': '4.0.9', 'project-directory': '/work' });
});

test('warm hits still synchronize and report exact hits', async () => {
  const f = fixture();
  f.cache.restore = async entry => entry.key;
  await prepareProject('rb', inputs({ sync: 'true', 'cache-ruby': 'true' }), f.actions, f);
  assert.ok(f.calls.some(call => call[0] === 'run' && call[1][0] === 'sync'));
  assert.equal(f.output['dependency-cache-hit'], true);
  assert.equal(f.output['ruby-cache-hit'], true);
});

test('failed sync does not save caches or expose prepared outputs', async () => {
  const f = fixture();
  f.command.run = async args => { if (args[0] === 'sync') throw new Error('checksum mismatch'); };
  await assert.rejects(prepareProject('rb', inputs({ sync: 'true', 'cache-ruby': 'true' }), f.actions, f), /checksum mismatch/);
  assert.ok(!f.calls.some(call => call[0] === 'save'));
  assert.deepEqual(f.output, {});
});

test('unlocked preparation saves the final lock fingerprint', async () => {
  const f = fixture();
  let inspections = 0;
  f.command.inspect = async () => { inspections++; return descriptor({ cache: inspections < 3 ? null : descriptor().cache }); };
  await prepareProject('rb', inputs({ sync: 'true', locked: 'false' }), f.actions, f);
  const saved = f.calls.find(call => call[0] === 'save');
  assert.ok(saved[1].key.endsWith(fingerprint));
  assert.equal(f.output['dependency-cache-hit'], false);
});

test('cache-disabled sync does not restore or save', async () => {
  const f = fixture();
  await prepareProject('rb', inputs({ sync: 'true', cache: 'false' }), f.actions, f);
  assert.ok(!f.calls.some(call => call[0] === 'restore' || call[0] === 'save'));
  assert.ok(f.calls.filter(call => call[0] === 'inspect').every(call => !call[1]?.probe));
  assert.ok(f.calls.some(call => call[0] === 'run' && call[1][0] === 'sync'));
});

test('cache keys isolate runtime, backend, paths, build configuration, runner image and salt', () => {
  const original = descriptor();
  const first = cacheKeys(original, '', {});
  for (const changed of [
    descriptor({ backend: 'bundler' }),
    descriptor({ ruby: { ...original.ruby, version: '4.0.10' } }),
    descriptor({ ruby: { ...original.ruby, path: '/different/ruby' } }),
    descriptor({ cache: { ...original.cache, compatibility: 'c'.repeat(64) } }),
    descriptor({ project: { root: '/other' } }),
    descriptor({ cache: { ...original.cache, paths: ['/other/bundle'] } }),
  ]) assert.notEqual(cacheKeys(changed, '', {}).dependencies.prefix, first.dependencies.prefix);
  assert.notEqual(cacheKeys(original, 'salt', {}).dependencies.prefix, first.dependencies.prefix);
  assert.notEqual(cacheKeys(original, '', { ImageVersion: 'new' }).dependencies.prefix, first.dependencies.prefix);
  const updated = descriptor({ cache: { ...original.cache, fingerprint: 'd'.repeat(64) } });
  assert.equal(cacheKeys(updated, '', {}).dependencies.prefix, first.dependencies.prefix);
  assert.notEqual(cacheKeys(updated, '', {}).dependencies.key, first.dependencies.key);
  assert.deepEqual(cacheKeys(descriptor({ cache: null }), '', {}).dependencies, undefined);
});

test('cache outages warn, save races are harmless and exact hits are never overwritten', async () => {
  const messages = [];
  let saves = 0;
  const service = {
    restoreCache: async () => { throw new Error('sensitive service failure'); },
    saveCache: async () => { saves++; throw new Error('sensitive race'); },
  };
  const cache = caches({ warning: message => messages.push(message) }, service);
  const entry = cacheKeys(descriptor(), '', {}).dependencies;
  assert.equal(await cache.restore(entry, true), undefined);
  await cache.save(entry, entry.key);
  assert.equal(saves, 0);
  await cache.save(entry);
  assert.equal(saves, 1);
  assert.equal(messages.length, 2);
  assert.ok(messages.every(message => !message.includes('sensitive')));
});

test('fallback restoration stays within the full compatibility prefix', async () => {
  const entry = cacheKeys(descriptor(), '', {}).dependencies;
  const cache = caches({}, { restoreCache: async (paths, key, prefixes) => {
    assert.deepEqual(paths, entry.paths); assert.equal(key, entry.key); assert.deepEqual(prefixes, [entry.prefix]); return `${entry.prefix}${'e'.repeat(64)}`;
  } });
  assert.notEqual(await cache.restore(entry, true), entry.key);
});

test('unsupported dependency probes prepare cold without claiming a cache hit', async () => {
  const f = fixture();
  f.command.inspect = async options => {
    if (options?.probe) throw new Error('unsupported Gemfile helper');
    return descriptor({ cache: null });
  };
  await prepareProject('rb', inputs({ sync: 'true' }), f.actions, f);
  assert.ok(f.calls.some(call => call[0] === 'run' && call[1][0] === 'sync'));
  assert.ok(f.calls.some(call => call[0] === 'warning'));
  assert.equal(f.output['dependency-cache-hit'], false);
});
