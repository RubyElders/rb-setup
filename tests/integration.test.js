import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, glob, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { prepareProject } from '../src/prepare.js';
import { commands } from '../src/command.js';
import { caches } from '../src/cache.js';
import { projectInputs } from '../src/project-inputs.js';
import { setup } from '../src/setup.js';
import { checkVersion } from '../src/install.js';
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
    const project = mode ? join(root, 'fixtures/cache-app') : join(root, 'application with spaces');
    if (!mode) await cp(resolve('fixtures/cache-app'), project, { recursive: true });
    await rm(join(project, '.rb'), { recursive: true, force: true });
    const config = join(root, '.rb-test-config.toml');
    await writeFile(config, '');
    const lock = await readFile(join(project, 'Gemfile.lock'));
    const values = { sync: 'true', 'working-directory': project, 'config-file': config, 'package-backend': backend, cache: mode === 'uncached' ? 'false' : 'true', 'cache-ruby': mode !== 'uncached' ? 'true' : 'false', 'cache-version': process.env.RB_SETUP_CACHE_TEST_SALT || '' };
    const output = {};
    const warnings = [];
    const actions = { getInput: name => values[name] || '', exportVariable: () => {}, warning: message => warnings.push(message), setOutput: (name, value) => { output[name] = value; } };
    const inputs = projectInputs(actions);
    const version = JSON.parse((await execute(resolve(binary), ['-F', 'json', 'version'])).stdout).data.version;
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
    const sharedCache = mode ? join(root, '.rb-test-shared-cache') : await temporary(t, 'rb-setup-cache-');
    const buildTools = mode ? root : await temporary(t, 'rb-setup-build-');
    const make = join(buildTools, '.rb-test-make');
    const counter = join(buildTools, '.rb-test-build-count');
    await writeFile(make, '#!/bin/sh\nprintf "build\\n" >> "$RB_SETUP_TEST_BUILD_COUNTER"\nexec make "$@"\n', { mode: 0o755 });
    const builds = async () => {
      try { return (await readFile(counter, 'utf8')).trim().split('\n').length; } catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
    };
    let environment = { ...process.env, XDG_CACHE_HOME: sharedCache, MAKE: make, RB_SETUP_TEST_BUILD_COUNTER: counter };
    let ruby;
    if (!mode) {
      const selection = (await commands(resolve(binary), inputs, environment).inspect()).ruby;
      assert.equal(selection.installed, true, 'Local integration tests need the fixture Ruby installed');
      const directory = await temporary(t, 'rb-setup-rubies-');
      ruby = join(directory, `ruby-${selection.version}`);
      await cp(selection.path, ruby, { recursive: true });
      environment = { ...environment, RB_RUBIES_DIR: directory };
    }
    const command = commands(resolve(binary), inputs, environment);
    for (const warm of mode ? [mode === 'warm'] : [false, true]) {
      if (warm) {
        await rm(join(project, '.rb'), { recursive: true, force: true });
        await rm(sharedCache, { recursive: true, force: true });
        if (ruby) await rm(ruby, { recursive: true, force: true });
      }
      const beforeBuilds = await builds();
      const started = performance.now();
      await setup({
        actions: {
          ...actions,
          getInput: name => name === 'version' ? version : actions.getInput(name),
          addPath: path => assert.equal(path, dirname(resolve(binary))),
          info: () => {},
        },
        resolve: async requested => { assert.equal(requested, version); return { version }; },
        prepare: async release => { await checkVersion(resolve(binary), release.version); return { path: resolve(binary) }; },
        prepareProject: (file, options, reporter) => prepareProject(file, options, reporter, { command, cache, environment }),
      });
      if (warm) assert.equal(await builds(), beforeBuilds, 'Restored native extensions must not compile again');
      else if (!mode || Number(process.env.GITHUB_RUN_ATTEMPT || '1') === 1) assert.ok(await builds() > beforeBuilds, 'Cold installation must exercise native compilation');
      t.diagnostic(`${warm ? 'warm' : 'cold'} preparation: ${Math.round(performance.now() - started)} ms`);
      if (warm || Number(process.env.GITHUB_RUN_ATTEMPT || '1') === 1 || !mode) {
        assert.equal(output['dependency-cache-hit'], warm);
        assert.equal(output['ruby-cache-hit'], warm);
      }
      t.diagnostic(`dependency hit: ${output['dependency-cache-hit']}, Ruby hit: ${output['ruby-cache-hit']}`);
      const result = await execute(resolve(binary), [...inputs.globals, '--package-backend', backend, 'x', 'ruby', 'verify.rb'], { env: environment });
      assert.match(result.stdout, /Ruby 4\.0\.9, Rake 13\.3\.1/);
      assert.deepEqual(await readFile(join(project, 'Gemfile.lock')), lock);
    }
    if (!mode || mode === 'warm') {
      const projectFile = join(project, 'project settings.toml');
      await writeFile(projectFile, '[project]\nname="optional settings"\n[scripts]\nverify="ruby verify.rb"\n');
      const optional = await execute(resolve(binary), [...inputs.globals, '-P', projectFile, '--package-backend', backend, 'run', 'verify'], { env: environment });
      assert.match(optional.stdout, /path loaded/);
      await rm(projectFile);
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
      await prepareProject(resolve(binary), inputs, actions, { command, cache, environment });
      assert.equal(output['dependency-cache-hit'], false);
      const result = await execute(resolve(binary), [...inputs.globals, '--package-backend', backend, 'x', 'ruby', 'verify.rb'], { env: { ...environment, EXPECTED_PATH: 'changed' } });
      assert.match(result.stdout, /path loaded/);
      assert.deepEqual(await readFile(join(project, 'Gemfile.lock')), lock);
    }
    if (!mode || mode === 'warm') {
      const specifications = [];
      for await (const file of glob('**/specifications/json-3.1.0.gemspec', { cwd: join(project, '.rb') })) specifications.push(join(project, '.rb', file));
      assert.equal(specifications.length, 1);
      await rm(specifications[0]);
      const repairInputs = { ...inputs, cache: false, rubyCache: false };
      await prepareProject(resolve(binary), repairInputs, actions, { command: commands(resolve(binary), repairInputs, environment), cache: {
        restore: () => assert.fail('Repair must work without cache restoration'),
        save: () => assert.fail('Cache-disabled repair must not save'),
      } });
      assert.ok((await readFile(specifications[0], 'utf8')).length > 0);
      const result = await execute(resolve(binary), [...inputs.globals, '--package-backend', backend, 'x', 'ruby', 'verify.rb'], { env: { ...environment, EXPECTED_PATH: 'changed' } });
      assert.match(result.stdout, /path loaded/);
      assert.deepEqual(await readFile(join(project, 'Gemfile.lock')), lock);
    }
    assert.deepEqual(warnings, []);
    if (!mode) assert.equal(records.size, 3);
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
      await writeFile(gemfile, original);
      if (mode) t.after(() => writeFile(join(project, 'Gemfile.lock'), lock));
      await rm(join(project, 'Gemfile.lock'));
      await assert.rejects(prepareProject(resolve(binary), inputs, actions, { command, cache: guarded }), /rb sync failed/);
      assert.equal(saves, 0);
      await assert.rejects(readFile(join(project, 'Gemfile.lock')), { code: 'ENOENT' });
      const unlockedInputs = { ...inputs, locked: false };
      const unlockedCommand = commands(resolve(binary), unlockedInputs, environment);
      const saved = [];
      const recording = { ...cache, save: async (entry, restored) => {
        if (entry) saved.push(entry);
        return cache.save(entry, restored);
      } };
      await prepareProject(resolve(binary), unlockedInputs, actions, { command: unlockedCommand, cache: recording });
      const final = await unlockedCommand.inspect({ probe: true });
      assert.equal(final.cache.complete, true);
      assert.ok(saved.some(entry => entry.key.endsWith(final.cache.fingerprint)));
      assert.equal(output['dependency-cache-hit'], false);
      assert.ok(warnings.length > 0);
      assert.ok(warnings.every(message => message === 'Dependency inputs are incomplete; exact dependency caching is disabled'));
      const generated = await readFile(join(project, 'Gemfile.lock'), 'utf8');
      assert.match(generated, /json \(3\.1\.0\)/);
      assert.match(generated, /rake \(13\.3\.1\)/);
      const result = await execute(resolve(binary), [...inputs.globals, '--package-backend', backend, 'x', 'ruby', 'verify.rb'], { env: { ...environment, EXPECTED_PATH: 'changed' } });
      assert.match(result.stdout, /path loaded/);
    }
  });
}
