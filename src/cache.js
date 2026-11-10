import * as toolkit from '@actions/cache';
import { createHash } from 'node:crypto';
import { platform, arch } from 'node:os';

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function cacheKeys(setup, salt, environment = process.env) {
  const runner = [platform(), arch(), environment.ImageOS || '', environment.ImageVersion || '', environment.RUNNER_ENVIRONMENT || ''];
  const ruby = setup.ruby;
  const rubyKey = ruby.version && ruby.path ? `rb-ruby-v1-${digest([runner, setup.rb_version, ruby.version, ruby.path, salt])}` : undefined;
  const descriptor = setup.cache;
  let dependencies;
  if (descriptor?.fingerprint) {
    if (descriptor.complete !== true) throw new Error('Incomplete dependency cache inputs');
    if (!/^[a-f0-9]{64}$/.test(descriptor.fingerprint) || !/^[a-f0-9]{64}$/.test(descriptor.compatibility)) throw new Error('Invalid dependency cache fingerprint');
    if (!Array.isArray(descriptor.paths) || !descriptor.paths.length || descriptor.paths.some(path => typeof path !== 'string' || !path)) throw new Error('Missing dependency cache paths');
    const prefix = `rb-gems-v1-${digest([runner, setup.rb_version, setup.backend, setup.project?.root, ruby.version, ruby.path, descriptor.compatibility, descriptor.paths, salt])}-`;
    dependencies = { key: `${prefix}${descriptor.fingerprint}`, prefix, paths: descriptor.paths };
  }
  return { ruby: rubyKey && { key: rubyKey, paths: [ruby.path] }, dependencies };
}

export function caches(actions, service = toolkit) {
  return {
    async restore(descriptor, fallback = false) {
      if (!descriptor) return undefined;
      try {
        return await service.restoreCache(descriptor.paths, descriptor.key, fallback ? [descriptor.prefix] : []);
      } catch {
        actions.warning('Actions cache restore is unavailable; preparing without it');
        return undefined;
      }
    },
    async save(descriptor, restored) {
      if (!descriptor || restored === descriptor.key) return;
      try {
        await service.saveCache(descriptor.paths, descriptor.key);
      } catch {
        actions.warning('Actions cache save was unavailable or another job saved the same key');
      }
    },
  };
}
