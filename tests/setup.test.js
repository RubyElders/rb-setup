import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { setup } from '../src/setup.js';

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
  const release = { version: '0.4.1' };
  const path = join('tool cache', 'rb');
  await setup({
    actions: core,
    platform: () => ({ asset: 'rb-linux' }),
    resolve: async (version, target, options) => {
      assert.equal(version, '0.4.1');
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
  assert.deepEqual(core.calls.slice(0, 4), [['mask', 'input-secret'], ['path', dirname(path)], ['rb-version', '0.4.1'], ['rb-path', path]]);
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
