# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

Nothing yet.

## [0.3.2] — 2026-11-06

### Changed

- The CLI is published as `@nowyousee1/agentloom`: the unscoped `agentloom` name on npm belongs to an
  unrelated package. The installed command is still `agentloom`, and `dsh-agentloom` stays unscoped.

### Added

- Every GitHub release now carries stable `agentloom-cli.tgz`, `dsh-agentloom.tgz` and
  `SHA256SUMS` assets. Installation no longer depends on npm registry availability or credentials.
- `scripts/verify.mjs` rejects a release workflow that stops attaching those installable artifacts.

## [0.3.1] — 2026-11-05

### Added

- Release engineering: `scripts/verify.mjs` (versions, syntax, packed contents, required files,
  documentation links) and `scripts/version.mjs` (bump every `package.json` plus
  `CODEX_PLUGIN_VERSION` in one step).
- `.github/workflows/release.yml`: tag `v*` → verify → test → `npm publish --provenance` for both
  packages → GitHub release notes taken from this file.
- Community files: `CODE_OF_CONDUCT.md`, issue forms, PR template, Dependabot, `.editorconfig`,
  `.gitattributes`, `.nvmrc`.
- Docs: `docs/FAQ.md` and `docs/PUBLISHING.md`; "Where to find it" tables in both READMEs.
- Tests for the Codex marketplace output and for config portability/migration (34 tests total).

### Changed

- `defaultConfig()` now writes `memory.dshBudgetBytes: "auto"` and `portablePaths()` normalises path
  separators, so one `hub.json` round-trips unchanged on every platform.
- `migrateLegacyHub(legacyRoot, hubRoot)` takes explicit roots, which is what makes the migration
  path testable; the CLI call site is unchanged.
- Marketplace and plugin display names are `Agentloom` (they still said `Agent Hub`).

### Fixed

- `scripts/verify.mjs` no longer triggers Node's `DEP0190` deprecation warning when invoking
  `npm pack` on Windows.
- `LICENSE` is shipped inside both published packages instead of only at the repository root.
- Link handling on macOS: `isLink()` compared `realpath()` with the lexical path, so every real
  directory under `/var/...` (which resolves to `/private/var/...`) looked like a link. The probe is
  now `lstat()`-first everywhere and the realpath fallback is Windows-only; ownership, pruning and
  `linkStatus()` compare paths through new `samePath()` / `isUnder()` helpers.

## [0.3.0] — 2026-11-05

First public release under the name **agentloom** (formerly `agent-hub`).

### Added

- Monorepo layout: `packages/cli` (the `agentloom` CLI) and `packages/dsh-plugin`
  (the DeepSeek Harness bridge plugin).
- Shared, **both-sides writable** memory store at `~/.agentloom/memory/shared.md`
  with metadata (`kind`, `scope`, `tags`, timestamps) and update-by-title semantics.
- `agentloom skill import --from=codex` to pull existing Codex skills into the single
  source of truth.
- `agentloom doctor`: checks Node version, hub config, DSH link state, Codex skill
  inventory, MCP bridge, Codex plugin version/cache, the AGENTS.md mirror block,
  index freshness, legacy directories and DSH compatibility patches.
- MCP server (`packages/cli/mcp/server.mjs`) exposing `loom_memory_search`,
  `loom_memory_add`, `loom_memory_list`, `loom_skill_list`, `loom_skill_show`,
  `loom_status` and `loom_sync`, with `readOnlyHint` annotations so Codex can call
  the read-only tools without an approval prompt.
- AGENTS.md mirror block (`<!-- agentloom:shared:start -->` … `end`) so Codex
  automatically sees shared memories instead of having to call a tool.
- Windows/Unix link handling: junctions on Windows, directory symlinks elsewhere;
  dangling links are detected through the link target, not through `fs.exists`.
- Pruning of managed DSH links whose skill was renamed or deleted.
- Unit tests for the edit engine, skill rendering, shared memory and link lifecycle.
- GitHub Actions CI on Linux, Windows and macOS with Node 22 and 24.
- English and Chinese documentation, architecture notes and a compatibility matrix.

### Changed

- Hub directory moved from `~/.agent-hub` to `~/.agentloom` (automatic one-time
  migration on first run, copy-then-remove so it also works across volumes).
- Default paths are platform-neutral (`~/.dsh/...`, `~/.codex/...`) instead of
  `${USERPROFILE}/...`.
- The DSH injection budget defaults to `"auto"` and follows the harness's
  `agent-instructions maxBytes` instead of a hard-coded 64 KiB.
- Codex plugin content is versioned (`CODEX_PLUGIN_VERSION`) so the per-version
  cache in `~/.codex/plugins/cache/...` actually misses after a layout change.
- The Codex plugin's `.mcp.json` now ships **only** the agentloom bridge, never the
  user's other MCP servers (their headers and tokens stay out of the plugin).

### Fixed

- `settings-compat` patch script was not idempotent: a second run could duplicate an
  import line and break the plugin with a duplicate ESM binding.
- `@deepseek-ai/dsh-settings` compatibility shims for plugins built against a newer
  host (`settingsNamespace`, `installSettingsSection`, typert `create()` codecs).
- Invalid skill names and empty shared-memory titles are rejected instead of written.

[Unreleased]: https://github.com/Nowyousee1/agentloom/compare/v0.3.2...HEAD
[0.3.2]: https://github.com/Nowyousee1/agentloom/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/Nowyousee1/agentloom/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/Nowyousee1/agentloom/releases/tag/v0.3.0
