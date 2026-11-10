import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { commands } from '../src/command.js';
import { temporary } from './helpers.js';

test('inspection and sync use literal arguments, selected globals and clean child environment', { skip: process.platform === 'win32' }, async t => {
  const root = await temporary(t);
  const file = join(root, 'rb literal $ file');
  await writeFile(file, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (process.env.INPUT_TOKEN || process.env.ACTIONS_RUNTIME_TOKEN || process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) process.exit(10);
if (process.env.RB_RUBY_VERSION !== '4.0.9' || process.env.RB_PACKAGE_BACKEND !== 'native') process.exit(11);
if (process.env.BUNDLE_FROZEN !== 'false' || process.env.BUNDLE_DEPLOYMENT !== 'false') process.exit(12);
if (args[0] !== '-P' || args[1] !== "project ' file.toml") process.exit(13);
if (args.includes('info')) console.log(JSON.stringify({schema_version:1,rb_version:'0.4.2',working_directory:process.cwd(),backend:'native',ruby:{request:'4.0.9',installed:true},args}));
else if (args[2] !== 'sync') process.exit(14);
`);
  await chmod(file, 0o755);
  const command = commands(file, { cwd: root, ruby: '4.0.9', backend: 'native', locked: false, globals: ['-P', "project ' file.toml"] }, { PATH: process.env.PATH, INPUT_TOKEN: 'input-canary', ACTIONS_RUNTIME_TOKEN: 'cache-canary', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc-canary' });
  const result = await command.inspect({ probe: true });
  assert.deepEqual(result.args, ['-P', "project ' file.toml", 'info', 'setup', '--probe']);
  await command.run(['sync']);
});

test('invalid inspection output and unsuccessful sync fail', { skip: process.platform === 'win32' }, async t => {
  const root = await temporary(t);
  const file = join(root, 'rb');
  await writeFile(file, '#!/bin/sh\nprintf "not JSON\\n"\n');
  await chmod(file, 0o755);
  const command = commands(file, { cwd: root, globals: [], locked: true });
  await assert.rejects(command.inspect(), /invalid setup JSON/);
  await writeFile(file, '#!/bin/sh\nexit 7\n');
  await assert.rejects(command.run(['sync']), /failed \(7\)/);
  await assert.rejects(command.inspect(), /inspection failed/);
});
