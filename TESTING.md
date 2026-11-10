# rb-setup testing plan

The installation-only action and its unit/HTTP tests are implemented. CI exercises the committed bundle on Linux, macOS and Windows and runs a small application through both package backends. The structured-interface and sync/cache sections below describe later increments, not shipped action features. Tool release evidence is in [RELEASE-CHECK.md](RELEASE-CHECK.md).

Use ordinary Node tests and GitHub workflow jobs. Keep fixtures and smoke workflows in this repository first. Use a small external consumer only for the immutable remote-ref publication gate; keep development tests here.

## Installation unit and integration tests

Use Node's built-in test runner. A local HTTP server supplies realistic GitHub release metadata and binary bytes so tests exercise actual requests, digest handling and filesystem operations. Inject external execution/toolkit boundaries where necessary; do not mock the whole installer and assert only that our own functions were called.

| Case | Required assertion |
| --- | --- |
| Paired default | No input selects exactly 0.4.1, regardless of the workflow's GitHub ref. |
| Explicit version | Both `0.4.1` and `v0.4.1` identify the same stable tag; ranges and malformed/injection-like inputs fail before download. |
| Explicit latest | Resolve once and consistently use that concrete version, asset and digest. |
| Platform mapping | Correct release asset for Linux x64 GNU, macOS arm64 and Windows x64; unsupported targets and incompatible libc fail before download (v0.4.1 Linux requires glibc 2.39+). |
| Unavailable release | Draft/prerelease, missing tag, missing asset, malformed digest and API failure produce distinct actionable failures. No version fallback. |
| Download integrity | Correct bytes pass; corrupted, truncated or mismatched bytes fail without a complete cache entry or PATH change. |
| Tool cache | Valid exact cache is reused without a binary download; corrupt/missing cached files are detected and repaired or fail clearly. |
| Executable setup | Unix mode and Windows `.exe` naming are correct; version probe must succeed and match the requested release. |
| Workflow outputs | Outputs name the actual executable and concrete version; following-step PATH uses its containing directory. |
| Token handling | Only release API requests receive the action token; logs and rb/project child environments do not. Explicit user `GH_TOKEN` remains available. |
| Process boundaries | Paths with spaces work; arguments are separate values, never shell-expanded strings. |
| Repeated invocation | Different requested versions remain distinct; an existing valid entry is not overwritten with another version. |

Version-probe failure and checksum mismatch are test failures, not successful fallback cases. Negative tests assert the exit/failure result and absence of installation side effects.

## Packaged-action CI

Every PR runs `npm ci`, JavaScript lint and `npm test`. Build the distribution and fail on `git diff --exit-code -- dist` so committed executable code matches reviewed sources. Run YAML/action lint. Keep workflow steps simple; package scripts use standard tools.

Use the committed local action with a matrix matching real release assets:

| Runner | Smoke checks |
| --- | --- |
| Linux x64 | Exact release, PATH in a following step, repeated install and version output. |
| macOS arm64 | Same checks using the macOS binary. |
| Windows x64 | Same checks using rb.exe; no claim of managed Ruby installation. |

Assert the installed version and outputs, not just that the action step succeeded. Test without an application Gemfile or Ruby setup step. After publication, a workflow using the immutable remote action SHA can also prove installation without any checkout step.

For Linux/macOS, add a small application demonstration: checkout, local action, then `rb -C fixtures/app run verify`. Use an exact supported Ruby request and a locked dependency. The verifier prints the actual Ruby and loaded gem versions and exits nonzero on mismatch. Run with both package backends. Ruby download/preparation remains rb's behavior, not a hidden action implementation.

Do not use setup-ruby, Cargo or a source build to rescue these consumer smoke tests. Development jobs may install Node to lint/build the action; the packaged action itself must work using the runner-provided action runtime.

## Future structured-interface tests in Ruby Butler

Before caching ships, add upstream unit/CLI coverage for the versioned inspection contract:

- No Ruby installed: report paths and request without installing, resolving or executing dependency Ruby code.
- Exact Ruby available: report the selected runtime and effective backend paths through existing discovery.
- Explicit input probe: include loaded helpers, gemspecs and dependency data reads; distinguish complete from incomplete discovery.
- Respect `-C`, `-P`, `-c`, `BUNDLE_GEMFILE`, backend overrides, groups and configured installation directories.
- Never expose credentials or use credential stores in cache keys.
- Editing unrelated application files or adding `.git`/`.trees` content leaves dependency identity unchanged; changing a tracked source/helper changes it.

The action must consume the same public contract tested by the CLI, not a second JavaScript implementation of that logic.

## Future sync and cache tests

Run Linux/macOS with both package backends. Use a checked-in small fixture covering registry, Git, path and native-extension dependencies, a project script and nested project selection. Reuse the independent native/Bundler comparison pattern from rb-packages. For mocked sources, keep registry URLs and archive bytes deterministic across jobs; random ports and build timestamps must not invalidate every cache key.

| Scenario | Proof |
| --- | --- |
| Cold preparation | Install succeeds, lock stays frozen and app loads the intended dependency versions. |
| Exact warm hit | A separate dependent job restores the exact cache, runs sync and successfully runs the app. |
| Compatible fallback | Changed dependencies restore only within the compatibility prefix, reconcile changes and save under the final key. |
| App-only change | Dependency key stays unchanged and the updated application runs. |
| Local source change | Tracked path-gem/helper edits invalidate or refresh the cached snapshot; the app sees the new code/version. |
| Ruby/backend/group/build change | Appropriate cache miss or compatible restoration; no reuse across incompatible runtimes/backends. |
| Missing/incomplete installation | Sync repairs it before the app runs. Test installation metadata; do not assume payload scrubbing that rb does not promise. |
| Frozen mismatch | Both backends fail on a stale/missing lock; no successful cache save. |
| Explicit unlocked mode | A generated lock determines the final saved key, not the old/missing lock. |
| Cache outage | Warn and prepare cold; success still requires a real working installation. |
| Sync/checksum failure | Fail without saving the failed installation. |
| Concurrent save | Identical-key save conflict is harmless; it does not replace correct installation results. |
| Credentials | Cache paths exclude auth/config files and transient state; supplied test secrets are absent from logs and outputs. |

Two action calls in one job prove only local reuse, not Actions cache persistence. Cold and warm tests use separate jobs with an explicit dependency and isolated cache salt. Assert hit outputs as well as successful application execution. Use real Actions cache storage for this gate.

Exercise custom working/project/config paths, `.ruby-version` with and without `ruby-`, external Gemfiles, missing Ruby, failed sync and unsupported engines/platforms. Run cache-off preparation too, so success cannot depend on a warm cache.

Ruby caching remains opt-in. Compare cold and warm total job time, including Ruby download, extraction, validation and cache transfer. Measure installed-gem restoration separately from Ruby caching. Never promote a cache default based only on bytes downloaded or a single in-job invocation.

## Publication and maintenance gates

Before the first installation-only tag:

1. Paired tool release is published; all required platform assets and SHA-256 metadata exist and the release workflow has completed successfully.
2. Unit/lint/distribution checks and packaged-action smoke tests pass on all three targets.
3. Exact tag and checked-in tool default agree. No action tag is moved to repair a release.
4. A remote immutable action-ref smoke works before advertising the paired tag.

Cache-hit consumer evidence becomes mandatory when caching is shipped, not for the installation-only release.

Use minimal workflow permissions and ordinary pull_request/push triggers. Test fork behavior without secrets. After publication, run a daily install smoke for pinned and explicit latest versions plus manual dispatch. Keep heavier preparation/cache checks weekly. Use the small external consumer to test an immutable commit before tagging, then the published tag.

A release-published event alone is insufficient as an all-platform gate: the tool workflow may publish after the first platform uploads while other builds are running. Inspect the required assets and workflow completion. Do not silently skip a platform whose binary has not arrived yet.
