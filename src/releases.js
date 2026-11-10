import { versionInput } from './inputs.js';

const repository = 'RubyElders/ruby-butler';

export async function resolveRelease(requested, platform, {
  token = '',
  apiUrl = 'https://api.github.com',
  fetch = globalThis.fetch,
} = {}) {
  const version = versionInput(requested);
  const selector = version === 'latest' ? 'latest' : `tags/v${version}`;
  let response;
  try {
    response = await fetch(`${apiUrl}/repos/${repository}/releases/${selector}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'RubyElders/rb-setup',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error('Unable to reach the GitHub release API');
  }
  if (!response.ok) {
    throw new Error(`GitHub release API returned ${response.status} for rb ${version}; check the version, token and API rate limit`);
  }
  let release;
  try {
    release = await response.json();
  } catch {
    throw new Error('GitHub returned invalid release metadata');
  }
  if (!release || typeof release !== 'object' || Array.isArray(release)) {
    throw new Error('GitHub returned invalid release metadata');
  }
  if (release.draft !== false || release.prerelease !== false) {
    throw new Error('rb-setup requires a published stable release');
  }
  const resolved = versionInput(release.tag_name || 'invalid');
  if (resolved === 'latest' || release.tag_name !== `v${resolved}` || (version !== 'latest' && resolved !== version)) {
    throw new Error('GitHub returned a release tag that does not match the requested version');
  }
  const assets = (Array.isArray(release.assets) ? release.assets : []).filter(asset => asset?.name === platform.asset);
  if (assets.length !== 1 || assets[0].state !== 'uploaded') {
    throw new Error(`rb v${resolved} has no complete ${platform.asset} asset; check its release workflow`);
  }
  const asset = assets[0];
  if (!/^sha256:[a-f0-9]{64}$/i.test(asset.digest || '') || !Number.isSafeInteger(asset.size) || asset.size <= 0) {
    throw new Error(`rb v${resolved} ${platform.asset} has no valid SHA-256 digest or size`);
  }
  return {
    version: resolved,
    url: `https://github.com/${repository}/releases/download/v${resolved}/${platform.asset}`,
    digest: asset.digest.slice('sha256:'.length).toLowerCase(),
    size: asset.size,
  };
}
