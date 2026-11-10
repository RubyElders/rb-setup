import * as core from '@actions/core';
import { dirname } from 'node:path';
import { versionInput, platformInput } from './inputs.js';
import { resolveRelease } from './releases.js';
import { install } from './install.js';

export async function setup({ actions = core, resolve = resolveRelease, prepare = install, platform = platformInput } = {}) {
  const token = actions.getInput('token');
  if (token) actions.setSecret(token);
  const version = versionInput(actions.getInput('version'));
  const target = platform();
  const release = await resolve(version, target, { token });
  const result = await prepare(release, target);
  actions.addPath(dirname(result.path));
  actions.setOutput('rb-version', release.version);
  actions.setOutput('rb-path', result.path);
  actions.info(`Ruby Butler ${release.version} is ready${result.cached ? ' (tool cache)' : ''}`);
}
