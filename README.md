# Set up Ruby Butler

Install a verified [Ruby Butler](https://github.com/RubyElders/ruby-butler) release and add `rb` to PATH.

```yaml
steps:
  - uses: actions/checkout@v6
  - uses: RubyElders/rb-setup@v0.4.3
    env:
      GH_TOKEN: ${{ github.token }}
    with:
      sync: true
  - run: rb run test
```

`token` needs no configuration on github.com. The optional `GH_TOKEN` in the example authenticates Ruby catalog requests; shared runner IPs can hit unauthenticated limits even with few requests.

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `version` | No | `0.4.3` (paired release) | Exact rb version, with optional `v` prefix, or `latest`. |
| `token` | No | `github.token` on github.com | GitHub release API access only; empty on other hosts. |
| `sync` | No | `false` | Prepare the project's Ruby and dependencies. |
| `working-directory` | No | Current directory | Working directory for action operations. |
| `ruby-version` | No | rb selection | Override the project's Ruby version request. |
| `package-backend` | No | rb configuration | Select `bundler` or `native`; rb defaults to `bundler`. |
| `project-file` | No | rb discovery | Project file passed through `rb -P`. |
| `config-file` | No | rb discovery | Configuration file passed through `rb -c`. |
| `locked` | No | `true` | Require an existing lockfile matching the dependencies during sync. |
| `cache` | No | Same as `sync` | Cache installed gems and package artifacts. |
| `cache-ruby` | No | `false` | Cache the exact Ruby installation. |
| `cache-version` | No | Empty | Extra cache invalidation salt, such as after changing system build dependencies. |

Caching requires `sync: true`.

Outputs: `rb-version` and the absolute `rb-path`.

Supports Linux x64 with glibc 2.39+, macOS arm64 and Windows x64. No Ruby, Rust or Node setup step is needed to install rb. Ruby Butler manages missing Ruby installations on Linux/macOS and prepares dependencies when your commands need them.

Reuses verified rb binaries from the runner tool cache. With `sync: true`, the action prepares the project and caches installed gems across jobs. `cache-ruby: true` also caches the exact Ruby installation; it is off by default. Synchronization runs even on an exact hit.

Project preparation and caching require Ruby Butler 0.4.3 or newer. Older releases support installation only.

Explicit Ruby/backend overrides also apply to following steps. Directory/project/config selections apply to this action; repeat them in later commands.

Preparation outputs: `ruby-version`, `project-directory`, `dependency-cache-hit` and `ruby-cache-hit`. Caches contain project installations and rb package artifacts, including Git sources and compiled extensions. Project configuration and prepared-state files stay outside the cache. Gemfile/Gemfile.lock projects need no rbproject.toml. [GitHub cache access rules](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#restrictions-for-accessing-a-cache) apply.

MIT licensed; see [LICENSE.md](LICENSE.md). Bundled dependency licenses are in [THIRD-PARTY-LICENSES.txt](THIRD-PARTY-LICENSES.txt).
