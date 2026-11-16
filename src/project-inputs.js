import { resolve } from 'node:path';

function boolean(actions, name, fallback) {
  const value = actions.getInput(name);
  if (!value) return fallback;
  if (!['true', 'false'].includes(value)) throw new Error(`${name} must be true or false`);
  return value === 'true';
}

export function projectInputs(actions, cwd = process.cwd()) {
  const sync = boolean(actions, 'sync', false);
  const cache = boolean(actions, 'cache', sync);
  const rubyCache = boolean(actions, 'cache-ruby', false);
  if (!sync && (cache || rubyCache)) throw new Error('cache and cache-ruby require sync: true');
  const backend = actions.getInput('package-backend');
  if (backend && !['bundler', 'native'].includes(backend)) throw new Error('package-backend must be bundler or native');
  const globals = [];
  const working = actions.getInput('working-directory');
  if (working) globals.push('-C', resolve(cwd, working));
  for (const [name, flag] of [['project-file', '-P'], ['config-file', '-c']]) {
    const value = actions.getInput(name);
    if (value) globals.push(flag, value);
  }
  return {
    sync, cache, rubyCache, globals, cwd,
    locked: boolean(actions, 'locked', true),
    ruby: actions.getInput('ruby-version'), backend,
    salt: actions.getInput('cache-version'),
  };
}

export function exportProjectEnvironment(inputs, actions) {
  if (inputs.ruby) actions.exportVariable('RB_RUBY_VERSION', inputs.ruby);
  if (inputs.backend) actions.exportVariable('RB_PACKAGE_BACKEND', inputs.backend);
}
