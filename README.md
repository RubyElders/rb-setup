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

Reuses verified rb binaries from the runner tool cache. Cross-run caching of Ruby and installed gems is not implemented. Normal rb settings, including `RB_PACKAGE_BACKEND`, apply.

MIT licensed; see [LICENSE.md](LICENSE.md). Bundled dependency licenses are in [THIRD-PARTY-LICENSES.txt](THIRD-PARTY-LICENSES.txt).
