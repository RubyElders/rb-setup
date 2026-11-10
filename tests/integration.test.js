import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { prepareProject } from '../src/prepare.js';
import { commands } from '../src/command.js';
import { caches } from '../src/cache.js';
import { projectInputs } from '../src/project-inputs.js';
import { temporary } from './helpers.js';

const execute = promisify(execFile);

async function copyIfPresent(from, to) {
  try { await cp(from, to, { recursive: true }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const binary = process.env.RB_SETUP_TEST_BINARY;
const mode = process.env.RB_SETUP_CACHE_TEST_MODE;
if (mode && !['cold', 'warm', 'uncached'].includes(mode)) throw new Error('Unknown cache test mode');
const backends = process.env.RB_SETUP_TEST_BACKEND ? [process.env.RB_SETUP_TEST_BACKEND] : ['bundler', 'native'];

for (const backend of backends) {
  test(`real rb ${backend} installs, restores gem payload and runs the application`, { skip: !binary }, async t => {
    const root = mode ? resolve(process.env.GITHUB_WORKSPACE) : await temporary(t);
    const project = mode ? join(root, 'fixtures/cache-app') : join(root, 'application');
    if (!mode) await cp(resolve('fixtures/cache-app'), project, { recursive: true });
    await rm(join(project, '.rb'), { recursive: true, force: true });
    const config = join(root, '.rb-test-config.toml');
    await writeFile(config, '');
    const lock = await readFile(join(project, 'Gemfile.lock'));
    const values = { sync: 'true', 'working-directory': project, 'config-file': config, 'package-backend': backend, cache: mode === 'uncached' ? 'false' : 'true', 'cache-ruby': mode && mode !== 'uncached' ? 'true' : 'false', 'cache-version': process.env.RB_SETUP_CACHE_TEST_SALT || '' };
    const output = {};
    const actions = { getInput: name => values[name] || '', exportVariable: () => {}, warning: message => assert.fail(message), setOutput: (name, value) => { output[name] = value; } };
    const inputs = projectInputs(actions);
    const records = new Map();
    const memory = {
      async restore(entry, fallback) {
        if (!entry) return undefined;
        const key = records.has(entry.key) ? entry.key : fallback ? [...records.keys()].find(key => key.startsWith(entry.prefix)) : undefined;
        if (!key) return undefined;
        for (const [index, path] of entry.paths.entries()) await copyIfPresent(join(records.get(key), String(index)), path);
        return key;
      },
      async save(entry, restored) {
        if (!entry || restored === entry.key) return;
        const directory = join(root, 'cache', String(records.size));
        await mkdir(directory, { recursive: true });
        for (const [index, path] of entry.paths.entries()) await copyIfPresent(path, join(directory, String(index)));
        records.set(entry.key, directory);
      },
    };
    const cache = mode ? caches(actions) : memory;
    const command = commands(resolve(binary), inputs);
    for (const warm of mode ? [mode === 'warm'] : [false, true]) {
      if (warm) await rm(join(project, '.rb'), { recursive: true, force: true });
      const started = performance.now();
      await prepareProject(resolve(binary), inputs, actions, { command, cache });
      t.diagnostic(`${warm ? 'warm' : 'cold'} preparation: ${Math.round(performance.now() - started)} ms`);
      if (warm || Number(process.env.GITHUB_RUN_ATTEMPT || '1') === 1 || !mode) {
        assert.equal(output['dependency-cache-hit'], warm);
        if (mode) assert.equal(output['ruby-cache-hit'], warm);
      }
      t.diagnostic(`dependency hit: ${output['dependency-cache-hit']}, Ruby hit: ${output['ruby-cache-hit']}`);
      const result = await execute(resolve(binary), [...inputs.globals, '--package-backend', backend, 'run', 'verify']);
      assert.match(result.stdout, /Ruby 4\.0\.9, Rake 13\.3\.1/);
      assert.deepEqual(await readFile(join(project, 'Gemfile.lock')), lock);
    }
    if (!mode || mode === 'warm') {
      const before = await command.inspect({ probe: true });
      const appOnly = join(project, 'application-only.rb');
      await writeFile(appOnly, 'APPLICATION_ONLY = true\n');
      assert.equal((await command.inspect({ probe: true })).cache.fingerprint, before.cache.fingerprint);
      const local = join(project, 'local/lib/cache_path.rb');
      const original = await readFile(local, 'utf8');
      if (mode) {
        t.after(() => writeFile(local, original));
        t.after(() => rm(appOnly, { force: true }));
      }
      await writeFile(local, original.replace("'path'", "'changed'"));
      const changed = await command.inspect({ probe: true });
      assert.notEqual(changed.cache.fingerprint, before.cache.fingerprint);
      assert.equal(changed.cache.compatibility, before.cache.compatibility);
      await prepareProject(resolve(binary), inputs, actions, { command, cache });
      assert.equal(output['dependency-cache-hit'], false);
      const result = await execute(resolve(binary), [...inputs.globals, '--package-backend', backend, 'run', 'verify'], { env: { ...process.env, EXPECTED_PATH: 'changed' } });
      assert.match(result.stdout, /path loaded/);
      assert.deepEqual(await readFile(join(project, 'Gemfile.lock')), lock);
    }
    if (!mode) assert.equal(records.size, 2);
    if (!mode || mode === 'warm') {
      const gemfile = join(project, 'Gemfile');
      const original = await readFile(gemfile, 'utf8');
      if (mode) t.after(() => writeFile(gemfile, original));
      await writeFile(gemfile, original.replace("gem 'json', '3.1.0'\n", ''));
      let saves = 0;
      const guarded = { ...cache, save: async () => { saves++; } };
      await assert.rejects(prepareProject(resolve(binary), inputs, actions, { command, cache: guarded }), /rb sync failed/);
      assert.equal(saves, 0);
      assert.deepEqual(await readFile(join(project, 'Gemfile.lock')), lock);
    }
  });
}
