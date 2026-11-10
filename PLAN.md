# rb-setup plan

## Baseline

The first action targets Ruby Butler v0.4.1, including the native input-tracking and lockfile fixes from PR 32. The release is published and selected as latest. All six release/debug assets are available, and the release workflow passed after the authorized macOS retry. SHA-256 digests were verified locally for all three release binaries; the Linux binary also passed its version probe with an empty tool PATH. See [RELEASE-CHECK.md](RELEASE-CHECK.md) for evidence and verification limits. The installation-only action is implemented; its publication waits for the packaged-action and immutable-ref gates below.

Ruby Butler owns Ruby selection, project discovery, package backends and dependency freshness. The action installs rb and, in later increments, coordinates preparation and Actions caches. It must not implement a second project resolver or Ruby manager.

## First release: install rb

Consumer workflow after the action tag is published:

```yaml
steps:
  - uses: actions/checkout@v6
  - uses: RubyElders/rb-setup@v0.4.1
  - run: rb run test
```

Installation also works without an application checkout. Ruby, Rust and Node setup steps are unnecessary for consumers. Subsequent rb commands use rb's existing automatic Ruby and package preparation; the installation-only action does not manage project caches.

| Input | Default | Contract |
| --- | --- | --- |
| `version` | `0.4.1` | Exact stable rb version, optionally prefixed with `v`; explicit `latest` resolves once. Reject version ranges. |
| `token` | Job token on github.com | GitHub release API access only. No implicit github.com token on GHES. |

Outputs are `rb-version` and the absolute `rb-path`. Report the exact installed version and selected platform. Do not expose preparation or cache inputs before they are implemented.

Use a small Node 24 JavaScript action with committed `dist/` output. Use `@actions/core`, `@actions/tool-cache` and Node's `execFile` for the fixed version probe; add `@actions/cache` only when dependency caching is implemented. Use Node's built-in test runner, Oxlint and esbuild. Suggested modules are `inputs.js`, `releases.js`, `install.js` and a short `main.js`.

Installation sequence:

1. Validate inputs and the actual OS/architecture before any download.
2. Resolve the non-draft stable release from RubyElders/ruby-butler, then select the exact platform asset and its SHA-256 digest.
3. Look for that exact tool version/architecture in the runner tool cache. Validate cached binary bytes against the expected digest; a version directory alone is not proof of validity.
4. On a miss, download the raw binary, verify its digest, name it `rb` or `rb.exe`, set Unix executable permissions and check `rb version`. Failed verification must not publish a complete tool-cache entry or change PATH.
5. Store the verified installation through tool-cache, append its directory to PATH and expose outputs. Do not run a remote installer script, sudo, a source build or another version selector.

Only public release metadata and assets are downloaded. Keep the release token out of logs and every rb/project child environment, including the automatically supplied `INPUT_TOKEN`. Explicit user credential variables, such as `GH_TOKEN`, remain available when later preparation needs them.

| Runner | Architecture | Release asset | Initial support |
| --- | --- | --- | --- |
| Linux glibc 2.39+ | x64 | `rb-linux` | Install rb and exercise managed Ruby preparation. |
| macOS | arm64 | `rb-macos` | Install rb and exercise managed Ruby preparation. |
| Windows | x64 | `rb-windows.exe` | Install rb; managed Ruby installation is not supported yet. |

The verified v0.4.1 Linux binary requires GLIBC_2.39. Test current hosted runners first; older glibc systems and musl containers are not supported by this asset. Reject unsupported architecture/libc combinations clearly. Do not select a binary merely from the runner label or silently use emulation. A published release can temporarily lack later platform uploads; fail clearly for a missing platform asset rather than falling back to an older version.

## Version policy

The action's checked-in default is paired with its immutable exact tag: action v0.4.1 installs tool v0.4.1. Use the action package.json version as the single source for the paired default, never the caller's GitHub ref. SHA-pinned consumers get the same default. `version: latest` is opt-in and reports the concrete selected version.

Do not move exact action tags. An action-only repair can be consumed by its commit SHA with the same tool default until the next paired release. Publish an action tag only after the tool release and required assets are available and the action's own release gates pass. Releasing the action must not trigger a tool release.

## Next upstream increment: structured inspection

rb v0.4.1 has human-readable info output but no stable JSON inspection/cache contract. This is the prerequisite for configuration-aware caching, not for installing rb.

Extend the existing info/invocation/backend interfaces rather than scrape output or parse internal prepared-state JSON in JavaScript. The contract should include a schema version, effective project and dependency locations, Ruby request/selection, package backend, effective cache/installation paths and explicit completeness indicators. Paths and fingerprints come from rb; the action does not scan the checkout or reinterpret Gemfiles.

There are two distinct stages:

- Before Ruby exists: discover configuration, project locations and the Ruby request without evaluating Ruby files or installing/resolving anything.
- After Ruby exists: an explicit input probe can evaluate dependency files through the backend's existing machinery to report loaded inputs and a complete dependency-cache descriptor, without resolving or installing packages.

Incomplete input discovery cannot produce an exact cache key. Credential values and credential stores must not be exposed or fingerprinted into cache keys. Allow only explicit installation paths in the cache descriptor. The contract must respect `-C`, `-P`, `-c`, `BUNDLE_GEMFILE` and the selected backend.

## Later increment: sync and cache

Keep normal setup in rb. The action forwards structured options as argument arrays and environment, with no shell-command input or arbitrary argument string.

| Future input | Default | Contract |
| --- | --- | --- |
| `sync` | `false` | Run rb sync for the selected project. |
| `working-directory` | Workspace | Action operations only; does not change later workflow steps. |
| `ruby-version` | Unset | Forward through `RB_RUBY_VERSION`, including subsequent rb commands. |
| `package-backend` | Unset | Forward `bundler` or `native` through `RB_PACKAGE_BACKEND`. |
| `project-file`, `config-file` | Unset | Forward `-P`/`-c`; later user commands must use the same explicit selection. |
| `locked` | `true` | Require an existing lockfile through frozen mode. Generating a lock requires explicit `false`. |
| `cache` | `true` with sync | Cache completed installed gems; no dependency cache operations without sync. |
| `cache-ruby` | `false` | Cache one exact selected Ruby installation, after benchmarking. |
| `cache-version` | Empty | User invalidation salt. |

Preserve rb's configured locations, including `RB_RUBIES_DIR`; do not invent an action-specific Ruby directory. Respect normal environment/group/credential configuration. Installation-only mode does not set a Ruby version or backend on the user's behalf.

Preparation sequence: inspect, install/restore the exact Ruby, obtain complete cache descriptors, restore compatible gem installations, run frozen sync even on an exact cache hit, then save only successfully prepared installations. Save immediately after sync so later application mutations are excluded and a failed test does not discard a useful installation. A post hook is unnecessary for this scope.

Use separate `dependency-cache-hit` and `ruby-cache-hit` outputs. Exact hit means exact key match, not permission to bypass rb validation. Export resolved Ruby/project outputs only after preparation completes.

| Data | Cache policy |
| --- | --- |
| rb binary | Runner tool cache; no extra Actions cache initially. |
| Prebuilt Ruby download | No extra Actions archive cache initially. |
| Installed Ruby | Opt-in, one exact runtime; never a loose version-prefix fallback. |
| Installed project gems | Enabled with sync; use paths supplied by rb. |
| Global registry/archive/Git caches | Deferred, bounded opt-in after measurements. |
| Config, credentials, locks, prepared-state envelopes | Exclude; do not cache all of `.rb`, `.bundle` or home. |

Dependency compatibility includes OS/distro/architecture, relevant runner image/system-library generation, exact Ruby engine/version/ABI and location, backend, rb compatibility version, canonical project/install location, build options and groups. The final key adds rb's dependency-input/lockfile digest and user salt. Source helpers and path gem inputs count; unrelated application files do not.

Fallback restoration stays within the full compatibility prefix. Always synchronize afterward. For explicitly unlocked runs, save under the final lockfile key. Cache service failures can warn and use a cold install; bad checksums and sync failures fail the action. Never publish failed installations to a cache. Private package contents require appropriate repository/fork cache visibility.

## Delivery order

1. Installation-only action for v0.4.1, with verified releases and packaged-action tests on all three supported binary targets.
2. Structured rb inspection/input descriptors, separately reviewed and released.
3. Sync and installed-gem caching on Linux/macOS with both package backends.
4. Cross-job cache evidence and timings; enable optional Ruby caching only after exact-runtime selection is available.
5. Scheduled published-ref checks; add a small external consumer after the action is published.

See [TESTING.md](TESTING.md) for concrete assertions and release gates. The installation tests are implemented; the structured-inspection and project-cache increments remain planned.

## References

- [GitHub JavaScript action guide](https://docs.github.com/en/actions/tutorials/create-actions/create-a-javascript-action): Node 24, packaged output and toolkit conventions.
- [tool-cache toolkit](https://github.com/actions/toolkit/tree/main/packages/tool-cache): tool downloads, caching and PATH registration.
- [ruby/setup-ruby inputs](https://github.com/ruby/setup-ruby/blob/master/action.yml) and [cache implementation](https://github.com/ruby/setup-ruby/blob/master/bundler.js): setup conventions, compatible restoration and synchronization.
- [GitHub dependency caching](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching): immutable keys, fallback matching and access scope.
- [Ruby Butler v0.4.1](https://github.com/RubyElders/ruby-butler/releases/tag/v0.4.1) and [PR 32](https://github.com/RubyElders/ruby-butler/pull/32): target implementation and lockfile parity regression.
