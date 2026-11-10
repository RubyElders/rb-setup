# Set up Ruby Butler

Install a verified [Ruby Butler](https://github.com/RubyElders/ruby-butler) release and add `rb` to PATH.

```yaml
steps:
  - uses: actions/checkout@v6
  - uses: RubyElders/rb-setup@v0.4.1
  - run: rb run test
```

| Input | Default |
| --- | --- |
| `version` | The action's paired release (`0.4.1`). Accepts an exact version, optional `v` prefix, or explicit `latest`. |
| `token` | The GitHub job token on github.com, used only for release API requests. |

Outputs: `rb-version` and the absolute `rb-path`.

Supports Linux x64 with glibc 2.39+, macOS arm64 and Windows x64. No Ruby, Rust or Node setup step is needed to install rb. Ruby Butler manages missing Ruby installations on Linux/macOS and prepares dependencies when your commands need them.

Reuses verified rb binaries from the runner tool cache. With `sync: true`, the action prepares the project and caches installed gems across jobs. `cache-ruby: true` also caches the exact Ruby installation; it is off by default. Synchronization runs even on an exact hit.

Preparation requires an rb version providing `rb info setup`; v0.4.1 supports installation only.

`working-directory`, `ruby-version`, `package-backend`, `project-file` and `config-file` forward normal rb settings. `locked` defaults to `true`; `cache: false` disables gem caching and `cache-version` adds an invalidation salt. Explicit Ruby/backend overrides also apply to following steps. Directory/project/config selections apply to this action; repeat them in later commands.

Preparation outputs: `ruby-version`, `project-directory`, `dependency-cache-hit` and `ruby-cache-hit`. Caches contain installation payloads, not project configuration or prepared-state files. [GitHub cache access rules](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#restrictions-for-accessing-a-cache) apply.

MIT licensed; see [LICENSE.md](LICENSE.md). Bundled dependency licenses are in [THIRD-PARTY-LICENSES.txt](THIRD-PARTY-LICENSES.txt).
