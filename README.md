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

This release installs rb and reuses verified binaries from the runner tool cache. Project synchronization and dependency caching are handled by your rb commands; this action does not yet manage Actions dependency caches. Normal rb settings and environment variables, including `RB_PACKAGE_BACKEND`, still apply.

See [TESTING.md](TESTING.md) for development checks and [PLAN.md](PLAN.md) for later sync/cache work. The action is MIT licensed; bundled dependency licenses are in [THIRD-PARTY-LICENSES.txt](THIRD-PARTY-LICENSES.txt).
