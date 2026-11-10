import * as core from '@actions/core';
import { dirname } from 'node:path';
import { versionInput, platformInput } from './inputs.js';
import { resolveRelease } from './releases.js';
import { install } from './install.js';
import { exportProjectEnvironment, projectInputs } from './project-inputs.js';
import { prepareProject } from './prepare.js';

export async function setup({ actions = core, resolve = resolveRelease, prepare = install, platform = platformInput, prepareProject: synchronize = prepareProject } = {}) {
  const inputs = projectInputs(actions);
  const token = actions.getInput('token');
  if (token) actions.setSecret(token);
  const version = versionInput(actions.getInput('version'));
  const target = platform();
  if (inputs.sync && target.asset === 'rb-windows.exe') throw new Error('Project preparation and caching currently support Linux and macOS');
  const release = await resolve(version, target, { token });
  const result = await prepare(release, target);
  actions.addPath(dirname(result.path));
  actions.setOutput('rb-version', release.version);
  actions.setOutput('rb-path', result.path);
  exportProjectEnvironment(inputs, actions);
  if (inputs.sync) await synchronize(result.path, inputs, actions);
  actions.info(`Ruby Butler ${release.version} is ready (${target.asset}${result.cached ? ', tool cache' : ''})`);
}
