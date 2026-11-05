# Compatibility

agentloom sits between two moving targets: the DeepSeek Harness plugin surface and the Codex CLI
plugin/MCP format. This page records what has been verified, what is expected to work, and what
breaks loudly instead of silently.

## Runtime requirements

| Requirement | Version | Why |
| --- | --- | --- |
| Node.js | >= 22.5.0 | `node:sqlite` (read-only Codex memory mirror), `fs.cpSync`, modern ESM |
| Operating system | Windows 10+, Linux, macOS | junctions on Windows, directory symlinks elsewhere |
| Filesystem | local disk | links do not survive exFAT/FAT32 or most network shares |

Node 24 is what the reference machine runs; CI covers Node 22 and 24 on Linux, Windows and macOS.

## DeepSeek Harness

| Area | Verified against | Notes |
| --- | --- | --- |
| Host plugin API (Cordis) | DSH desktop 0.2.x | `packages/dsh-plugin` injects `tools` + `systemPrompt`, exports `Config` via `schemastery` |
| Settings package | `@deepseek-ai/dsh-settings` 0.2.1-rc.5 | the host does **not** export `settingsNamespace` / `installSettingsSection` |
| Typert registry | `@deepseek-ai/dsh-typert-registry` 0.2.x | requires `codec.create()` for strict codecs |
| Skill discovery | `~/.dsh/skills` | scanned by the host and by the optional skills-manager plugin |
| Instruction budget | `agent-instructions.maxBytes` in the profile patch | read by `memory.mjs` when `dshBudgetBytes: "auto"` |

### Plugins built against a newer host API

Two third-party plugins in the reference profile (`dsh-at-file`, `@harleendance/dsh-skill-evolution`)
were built against a host that exports two settings helpers and a newer typert codec dialect. They
fail to import on the current host with:

```
The requested module '@deepseek-ai/dsh-settings' does not provide an export named 'settingsNamespace'
typert: dsh-at-file#atFile/search result strict codec has no create() factory
```

`packages/cli/patches/settings-compat/` provides:

- `settings-compat.mjs` — `settingsNamespace()`, `registerSettingsNamespace()`,
  `createSettingsScope()`, `installSettingsSection()` (the last one hands the plugin a callable that
  also has the resolved values attached, because plugins use both styles).
- `typert-compat.mjs` — `normalizeTypertContribution()` adds `create: () => schema` to every codec
  position and identity `encode`/`decode` when missing.
- `apply.mjs` — an idempotent patcher with `--check`, backups (`*.bak-settings-compat`) and an
  `DSH_PROFILE_DIR` override for self-tests.

Re-run `node packages/cli/patches/settings-compat/apply.mjs --check` after reinstalling or
upgrading those plugins: a package reinstall reverts the patch.

**When the host starts exporting these helpers**, delete the shims and the patched calls; the import
lines are the only thing that changed.

## Codex CLI

| Area | Verified against | Notes |
| --- | --- | --- |
| Plugin marketplace | Codex 0.157.1 | `<root>/.agents/plugins/marketplace.json` + `<plugin>/.codex-plugin/plugin.json` |
| Plugin cache | per `marketplace/plugin/version` | bump `CODEX_PLUGIN_VERSION` when the layout changes |
| MCP config | `codex mcp list` | bridge registered as `agentloom`, stdio, `D:\Node.js\node.exe` + runtime entry |
| MCP approvals | `codex exec` | read-only tools need `annotations.readOnlyHint` or calls fail with "requires approval" |
| Memory pipeline | `~/.codex/memories_1.sqlite` | `stage1_outputs` rows are indexed when present |
| Instruction file | `~/.codex/AGENTS.md` | the marked block is the only part agentloom writes |

### The `[memories]` model-name trap

Codex's memory extraction defaults to a model that a custom OpenAI-compatible endpoint may not
serve. On the reference machine every stage-1 job failed with:

```
invalid_request_error: The supported API model names are deepseek-flash, deepseek-v4-pro,
but you passed gpt-5.6-luna.
```

Fix (opt-in, agentloom never edits this without being asked):

```toml
[memories]
generate_memories = true
use_memories = true
extract_model = "deepseek-flash"
consolidation_model = "deepseek-flash"
```

Then reset stale jobs once:

```sql
update jobs set status='pending', retry_remaining=3, retry_at=null, lease_until=null,
  worker_id=null, ownership_token=null where status='error';
```

Memory jobs are consumed **inside a running Codex session**; a short-lived `codex exec` can claim
jobs and exit before finishing them, leaving `running` rows leased for an hour. Release orphans with
`update jobs set status='pending', lease_until=null where status='running'`.

## Migration from `agent-hub` (<= 0.2.0)

`agentloom` was previously named `agent-hub`. On first run of the new CLI:

1. `~/.agent-hub` is copied to `~/.agentloom` (copy-then-remove, so it works across volumes) and the
   old directory is removed.
2. DSH links that pointed into the old build directory are detected as dangling and re-created.
3. The MCP bridge entry named `agent-hub` is removed from `servers.json` and re-registered as
   `agentloom`.
4. The Codex marketplace name changes, so the old plugin must be re-added:
   `codex plugin marketplace remove agent-hub`, then
   `codex plugin marketplace add <hub>/build/codex-marketplace` and
   `codex plugin add agentloom@agentloom`.

## Known limitations

- A DSH bundle whose package name changed requires a harness restart; `plugin_manager` reports
  `restart-required` / `package-moved` and that is expected, not a failure.
- Cordis plugins cannot run inside Codex. The cross-harness surface is skills, MCP definitions and
  memory — not plugin code.
- Memory conflict resolution is last-writer-wins per title. There is no three-way merge.
- Deletions do not propagate automatically; remove the entry in `memory/shared.md` and re-run
  `agentloom sync`.
