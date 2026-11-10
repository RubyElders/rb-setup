# v0.4.1 release check

Release: https://github.com/RubyElders/ruby-butler/releases/tag/v0.4.1

Workflow: https://github.com/RubyElders/ruby-butler/actions/runs/42842081384

Tag source commit: `00cb47d312f1b6833ead7e47700f61801b6c938d` (release PR 33).

Published at 2026-11-10 15:16:52 UTC and selected by GitHub's latest-release lookup. All six assets are available and the release workflow's second attempt succeeded. The first macOS attempt was cancelled before receiving a runner because of hosted ARM64 capacity constraints. The user authorized a targeted retry, which built and uploaded both macOS binaries successfully.

| Asset | Size | GitHub digest | Local verification |
| --- | --- | --- | --- |
| `rb-linux` | 16.6 MiB | `sha256:a46f58790663c03981bb4f6f693171a0663b3ccea16cee86692c7e7b607d0c21` | SHA-256 and binary header verified locally |
| `rb-linux-debug` | 198.9 MiB | `sha256:45787627b91c3a82f2cbff78c8be78473c53b0c8383ec2506d2661216f855282` | Release metadata only |
| `rb-macos` | 13.7 MiB | `sha256:c7cd2e1c73881b19b9ae838548c7584a9094220a952d355c3191670e5709f56f` | SHA-256 and binary header verified locally |
| `rb-macos-debug` | 55.0 MiB | `sha256:c9fa7058a58d4ca14b0c8d406da0500c9a1741adab68cdb45523f1f1cd8a4692` | Release metadata only |
| `rb-windows-debug.exe` | 26.9 MiB | `sha256:97d84c8d30e7cc9c2978a20a560fca65a88288e4bb4dd006532f972cb4997c52` | Release metadata only |
| `rb-windows.exe` | 12.6 MiB | `sha256:f6a6d267d9daaaf0192473197bfa793f56b253559e9ed1eed43d0b02158a6477` | SHA-256 and binary header verified locally |

All three release binaries were downloaded and their bytes matched GitHub's SHA-256 metadata. ELF identifies Linux x86_64 with a GLIBC_2.39 requirement; PE identifies Windows AMD64; Mach-O identifies macOS ARM64. Debug assets were checked for presence and digest metadata, not downloaded.

The Linux release binary reports `Ruby Butler v0.4.1` with an empty tool PATH and fresh home/config directories. No Ruby or build tool was available on that PATH. macOS and Windows binaries were not executed locally.

This verifies the tool release, not the GitHub Action. Packaged-action execution and later cross-job cache gates are defined in TESTING.md. The tool-release prerequisite for implementing the installation-only action is satisfied; action publication is gated separately by its CI.
