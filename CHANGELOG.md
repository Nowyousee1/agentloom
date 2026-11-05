# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

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
