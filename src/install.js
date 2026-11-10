import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as toolCache from '@actions/tool-cache';

const execute = promisify(execFile);
const actionTokens = new Set(['INPUT_TOKEN', 'ACTIONS_RUNTIME_TOKEN', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN']);

export async function matches(file, release) {
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size !== release.size) return false;
    const hash = createHash('sha256');
    for await (const bytes of createReadStream(file)) hash.update(bytes);
    return hash.digest('hex') === release.digest;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

export function childEnvironment(environment = process.env) {
  return Object.fromEntries(Object.entries(environment).filter(([name]) => !actionTokens.has(name.toUpperCase())));
}

export async function checkVersion(file, version, { run = execute, environment = process.env } = {}) {
  let stdout;
  try {
    ({ stdout } = await run(file, ['version'], {
      env: childEnvironment(environment),
      cwd: process.env.RUNNER_TEMP || tmpdir(),
      timeout: 30_000,
      maxBuffer: 64 * 1024,
      windowsHide: true,
    }));
  } catch {
    throw new Error(`rb v${version} could not run on this runner`);
  }
  const match = /^Ruby Butler v(\d+\.\d+\.\d+)(?:\s|$)/m.exec(stdout);
  if (match?.[1] !== version) {
    throw new Error(`Downloaded rb does not report the requested version ${version}`);
  }
}

export async function install(release, platform, {
  cache = toolCache,
  probe = checkVersion,
  temporary = process.env.RUNNER_TEMP || tmpdir(),
} = {}) {
  const cached = cache.find(platform.tool, release.version, platform.arch);
  if (cached) {
    const path = join(cached, platform.executable);
    if (await matches(path, release)) {
      if (platform.executable !== 'rb.exe') await chmod(path, 0o755);
      await probe(path, release.version);
      return { path, cached: true };
    }
  }
  const staging = await mkdtemp(join(temporary, 'rb-setup-'));
  try {
    const path = join(staging, platform.executable);
    await cache.downloadTool(release.url, path);
    if (!await matches(path, release)) throw new Error(`SHA-256 or size verification failed for rb v${release.version}`);
    if (platform.executable !== 'rb.exe') await chmod(path, 0o755);
    await probe(path, release.version);
    const directory = await cache.cacheFile(path, platform.executable, platform.tool, release.version, platform.arch);
    const installed = join(directory, platform.executable);
    if (platform.executable !== 'rb.exe') await chmod(installed, 0o755);
    return { path: installed, cached: false };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
