import { commands } from './command.js';
import { caches, cacheKeys } from './cache.js';

async function inspectPrepared(command, inputs, actions) {
  if (!inputs.cache) return command.inspect();
  try { return await command.inspect({ probe: true }); } catch {
    actions.warning('Dependency input inspection failed; synchronizing without a dependency cache');
    return { ...await command.inspect(), cache: null };
  }
}

export async function prepareProject(file, inputs, actions, { command = commands(file, inputs), cache = caches(actions), environment = process.env } = {}) {
  let setup = await command.inspect({ resolveRuby: true });
  if (!setup.project) throw new Error('No Ruby Butler project or Gemfile found');
  if (!setup.ruby.version || !setup.ruby.path) throw new Error('rb could not select an exact Ruby installation');
  const initial = cacheKeys(setup, inputs.salt, environment);
  const rubyRestored = inputs.rubyCache ? await cache.restore(initial.ruby) : undefined;
  await command.run(['install', 'ruby', setup.ruby.version]);
  setup = await inspectPrepared(command, inputs, actions);
  if (!setup.ruby.installed) throw new Error('Selected Ruby installation is missing');
  const before = cacheKeys(setup, inputs.salt, environment);
  if (inputs.cache && !before.dependencies) actions.warning('Dependency inputs are incomplete; exact dependency caching is disabled');
  const restored = inputs.cache ? await cache.restore(before.dependencies, true) : undefined;
  await command.run(['sync']);
  const final = await inspectPrepared(command, inputs, actions);
  const after = cacheKeys(final, inputs.salt, environment);
  if (inputs.cache) await cache.save(after.dependencies, restored);
  if (inputs.rubyCache) await cache.save(after.ruby, rubyRestored);
  actions.setOutput('dependency-cache-hit', Boolean(before.dependencies && restored === before.dependencies.key));
  actions.setOutput('ruby-cache-hit', Boolean(initial.ruby && rubyRestored === initial.ruby.key));
  actions.setOutput('ruby-version', final.ruby.version);
  actions.setOutput('project-directory', final.project.root);
}
