import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { setup } from '../src/setup.js';
import { defaultVersion } from '../src/inputs.js';

function actions(input = {}) {
  const calls = [];
  return {
    calls,
    getInput: name => input[name] || '',
    setSecret: value => calls.push(['mask', value]),
    addPath: value => calls.push(['path', value]),
    setOutput: (name, value) => calls.push([name, value]),
    info: value => calls.push(['info', value]),
    exportVariable: (name, value) => calls.push(['environment', name, value]),
  };
}

test('sets outputs and PATH only after successful verification', async () => {
  const core = actions({ token: 'input-secret' });
  const release = { version: defaultVersion };
  const path = join('tool cache', 'rb');
  await setup({
    actions: core,
    platform: () => ({ asset: 'rb-linux' }),
    resolve: async (version, target, options) => {
      assert.equal(version, defaultVersion);
      assert.equal(target.asset, 'rb-linux');
      assert.deepEqual(options, { token: 'input-secret' });
      return release;
    },
    prepare: async result => {
      assert.equal(result, release);
      assert.deepEqual(core.calls, [['mask', 'input-secret']]);
      return { path, cached: true };
    },
  });
  assert.deepEqual(core.calls.slice(0, 4), [['mask', 'input-secret'], ['path', dirname(path)], ['rb-version', defaultVersion], ['rb-path', path]]);
  assert.match(core.calls[4][1], /tool cache/);
});

test('invalid input and unsupported platform never trigger a download', async () => {
  let requests = 0;
  const resolve = async () => { requests++; };
  await assert.rejects(setup({ actions: actions({ version: '../bad' }), resolve }), /exact stable/);
  await assert.rejects(setup({ actions: actions(), platform: () => { throw new Error('unsupported'); }, resolve }), /unsupported/);
  assert.equal(requests, 0);
});

test('failed installation does not add PATH or expose successful outputs', async () => {
  const core = actions();
  await assert.rejects(setup({
    actions: core, platform: () => ({}), resolve: async () => ({ version: '0.4.1' }),
    prepare: async () => { throw new Error('checksum failed'); },
  }), /checksum failed/);
  assert.deepEqual(core.calls, []);
});

test('explicit Ruby and backend overrides persist even without synchronization', async () => {
  const core = actions({ 'ruby-version': '4.0.9', 'package-backend': 'native' });
  await setup({ actions: core, platform: () => ({ asset: 'rb-linux' }), resolve: async () => ({ version: '0.4.1' }), prepare: async () => ({ path: '/tools/rb' }) });
  assert.deepEqual(core.calls.filter(call => call[0] === 'environment'), [['environment', 'RB_RUBY_VERSION', '4.0.9'], ['environment', 'RB_PACKAGE_BACKEND', 'native']]);
});

test('sync runs after installation with the selected project inputs and exported overrides', async () => {
  const core = actions({ sync: 'true', 'ruby-version': '4.0.9', 'package-backend': 'native', 'working-directory': 'application', cache: 'false' });
  const file = join('tool cache', 'rb');
  await setup({
    actions: core,
    platform: () => ({ asset: 'rb-linux' }),
    resolve: async () => ({ version: '0.4.2' }),
    prepare: async () => ({ path: file }),
    prepareProject: async (binary, inputs, reporter) => {
      assert.equal(binary, file);
      assert.equal(reporter, core);
      assert.equal(inputs.sync, true);
      assert.equal(inputs.cache, false);
      assert.equal(inputs.backend, 'native');
      assert.equal(inputs.ruby, '4.0.9');
      assert.deepEqual(core.calls.slice(-2), [['environment', 'RB_RUBY_VERSION', '4.0.9'], ['environment', 'RB_PACKAGE_BACKEND', 'native']]);
      assert.ok(core.calls.some(call => call[0] === 'path'));
      assert.ok(!core.calls.some(call => call[0] === 'info'));
      core.calls.push(['synchronized']);
    },
  });
  assert.deepEqual(core.calls.slice(-2).map(call => call[0]), ['synchronized', 'info']);
});

test('unsupported preparation and invalid cache options fail before downloading rb', async () => {
  const resolve = async () => assert.fail('Invalid preparation must not download rb');
  await assert.rejects(setup({ actions: actions({ sync: 'true' }), platform: () => ({ asset: 'rb-windows.exe' }), resolve }), /Linux and macOS/);
  for (const input of [{ cache: 'true' }, { 'cache-ruby': 'true' }, { sync: 'true', cache: 'yes' }]) {
    await assert.rejects(setup({ actions: actions(input), resolve }), /require sync|true or false/);
  }
});

test('failed project preparation does not report successful setup', async () => {
  const core = actions({ sync: 'true' });
  await assert.rejects(setup({
    actions: core,
    platform: () => ({ asset: 'rb-linux' }),
    resolve: async () => ({ version: '0.4.2' }),
    prepare: async () => ({ path: '/tools/rb' }),
    prepareProject: async () => { throw new Error('Frozen lockfile mismatch'); },
  }), /Frozen lockfile mismatch/);
  assert.ok(!core.calls.some(call => call[0] === 'info'));
  assert.ok(!core.calls.some(call => call[0] === 'project-directory'));
});
