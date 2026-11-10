import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function temporary(t) {
  const path = await mkdtemp(join(tmpdir(), 'rb setup test '));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

export async function server(t, handler) {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ path: request.url, authorization: request.headers.authorization });
    handler(request, response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return { url: `http://127.0.0.1:${server.address().port}`, requests };
}

export function releaseMetadata(bytes = Buffer.from('binary'), overrides = {}) {
  return {
    tag_name: 'v0.4.1', draft: false, prerelease: false,
    assets: [{ name: 'rb-linux', state: 'uploaded', digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, size: bytes.length }],
    ...overrides,
  };
}
