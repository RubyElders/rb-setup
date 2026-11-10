import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRelease } from '../src/releases.js';
import { releaseMetadata, server } from './helpers.js';

const platform = { asset: 'rb-linux' };

test('resolves exact and latest versions through actual HTTP and does not return credentials', async t => {
  const fixture = await server(t, (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(releaseMetadata()));
  });
  for (const input of ['v0.4.1', 'latest']) {
    const release = await resolveRelease(input, platform, { apiUrl: fixture.url, token: 'test-api-token' });
    assert.equal(release.version, '0.4.1');
    assert.equal(release.url, 'https://github.com/RubyElders/ruby-butler/releases/download/v0.4.1/rb-linux');
    assert.match(release.digest, /^[a-f0-9]{64}$/);
    assert.equal(release.size, 6);
    assert.ok(!JSON.stringify(release).includes('test-api-token'));
  }
  assert.deepEqual(fixture.requests.map(r => r.path), ['/repos/RubyElders/ruby-butler/releases/tags/v0.4.1', '/repos/RubyElders/ruby-butler/releases/latest']);
  assert.ok(fixture.requests.every(r => r.authorization === 'Bearer test-api-token'));
});

for (const status of [401, 403, 404, 429, 500]) {
  test(`reports API status ${status} without leaking response bodies or falling back`, async t => {
    const fixture = await server(t, (request, response) => { response.writeHead(status); response.end('private-response-value'); });
    await assert.rejects(resolveRelease('0.4.1', platform, { apiUrl: fixture.url }), error => {
      assert.match(error.message, new RegExp(String(status)));
      assert.ok(!error.message.includes('private-response-value'));
      return true;
    });
    assert.equal(fixture.requests.length, 1);
  });
}

for (const [name, overrides, expected] of [
  ['draft', { draft: true }, /published stable/],
  ['prerelease', { prerelease: true }, /published stable/],
  ['mismatched tag', { tag_name: 'v0.4.0' }, /tag.*match/],
  ['invalid tag', { tag_name: 'main' }, /exact stable/],
  ['missing platform', { assets: [] }, /no complete rb-linux/],
  ['unfinished upload', { assets: [{ name: 'rb-linux', state: 'new' }] }, /no complete/],
  ['missing digest', { assets: [{ name: 'rb-linux', state: 'uploaded', size: 6 }] }, /SHA-256/],
  ['malformed digest', { assets: [{ name: 'rb-linux', state: 'uploaded', size: 6, digest: 'sha256:no' }] }, /SHA-256/],
  ['invalid size', { assets: [{ name: 'rb-linux', state: 'uploaded', size: 0, digest: `sha256:${'a'.repeat(64)}` }] }, /SHA-256/],
]) {
  test(`rejects ${name} release metadata`, async t => {
    const fixture = await server(t, (request, response) => response.end(JSON.stringify(releaseMetadata(undefined, overrides))));
    await assert.rejects(resolveRelease('0.4.1', platform, { apiUrl: fixture.url }), expected);
    assert.equal(fixture.requests.length, 1);
  });
}

test('rejects invalid JSON and network failures', async t => {
  const fixture = await server(t, (request, response) => response.end('not JSON'));
  await assert.rejects(resolveRelease('0.4.1', platform, { apiUrl: fixture.url }), /invalid release metadata/);
  await assert.rejects(resolveRelease('0.4.1', platform, { fetch: async () => { throw new Error('sensitive details'); } }), /Unable to reach/);
});

test('validates requested version before a request and never reads arbitrary asset URLs', async () => {
  let calls = 0;
  const fetch = async () => {
    calls++;
    const metadata = releaseMetadata();
    metadata.assets[0].browser_download_url = 'http://untrusted.test/private';
    return { ok: true, json: async () => metadata };
  };
  await assert.rejects(resolveRelease('../no', platform, { fetch }), /exact stable/);
  assert.equal(calls, 0);
  const release = await resolveRelease('0.4.1', platform, { fetch });
  assert.equal(calls, 1);
  assert.ok(release.url.startsWith('https://github.com/RubyElders/ruby-butler/releases/download/'));
});

for (const value of [null, [], 'invalid']) {
  test(`rejects malformed release ${JSON.stringify(value)}`, async t => {
    const fixture = await server(t, (request, response) => response.end(JSON.stringify(value)));
    await assert.rejects(resolveRelease('0.4.1', platform, { apiUrl: fixture.url }), /invalid release metadata/);
  });
}

test('rejects duplicate platform assets and invalid asset lists', async t => {
  for (const assets of [[null], {}, [...releaseMetadata().assets, ...releaseMetadata().assets]]) {
    const fixture = await server(t, (request, response) => response.end(JSON.stringify(releaseMetadata(undefined, { assets }))));
    await assert.rejects(resolveRelease('0.4.1', platform, { apiUrl: fixture.url }), /no complete/);
  }
});
