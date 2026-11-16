import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { childEnvironment } from './install.js';

const capture = promisify(execFile);

export function commands(file, inputs, environment = process.env) {
  const env = childEnvironment(environment);
  if (inputs.ruby) env.RB_RUBY_VERSION = inputs.ruby;
  if (inputs.backend) env.RB_PACKAGE_BACKEND = inputs.backend;
  env.BUNDLE_FROZEN = String(inputs.locked);
  if (!inputs.locked) env.BUNDLE_DEPLOYMENT = 'false';
  const options = { cwd: inputs.cwd, env, windowsHide: true };
  return {
    async inspect({ probe = false, resolveRuby = false } = {}) {
      let output;
      try {
        output = await capture(file, [...inputs.globals, '--format', 'json', 'info', 'env', probe ? '--probe' : '--discover', ...(resolveRuby ? ['--resolve-ruby'] : [])], { ...options, maxBuffer: 1024 * 1024, timeout: 120_000 });
      } catch (error) {
        const detail = typeof error.stderr === 'string' ? error.stderr.trim() : '';
        throw new Error(`rb environment inspection failed. Sync and caching require an rb release with structured environment reports.${detail ? `\n${detail}` : ''}`);
      }
      let report;
      try { report = JSON.parse(output.stdout); } catch { throw new Error('rb returned invalid environment JSON'); }
      const value = report?.data;
      if (report?.schema_version !== 1 || report.command !== 'info.env' || typeof value?.rb_version !== 'string' || typeof value.working_directory !== 'string'
          || typeof value.ruby?.request !== 'string' || typeof value.ruby.installed !== 'boolean'
          || !['bundler', 'native'].includes(value.backend)) {
        throw new Error('rb returned an unsupported environment schema');
      }
      return value;
    },
    async run(args) {
      await new Promise((resolve, reject) => {
        const child = spawn(file, [...inputs.globals, ...args], { ...options, stdio: 'inherit' });
        child.once('error', () => reject(new Error('Unable to start rb')));
        child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`rb ${args[0]} failed (${signal || code})`)));
      });
    },
  };
}
