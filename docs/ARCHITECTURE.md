# Architecture

agentloom is deliberately small: a zero-dependency CLI that owns one directory, a stdio MCP server
that exposes that directory to Codex, and a DeepSeek Harness plugin that reads it. Everything else
is derived state that can be rebuilt with `agentloom sync`.

```
                    ~/.agentloom  (single source of truth, plain files)
                    ├── hub.json              config
                    ├── state.json            which links/renders this CLI created
                    ├── skills/<name>/        skill source (core + per-harness variants)
                    │   ├── skill.json
                    │   ├── core/SKILL.md
                    │   └── variants/{dsh,codex}.md
                    ├── memory/shared.md      both-sides-writable memory
                    ├── memory/index.json     built index (derived)
                    ├── mcp/servers.json      MCP server definitions
                    ├── build/skills/<target>/<name>/SKILL.md   rendered (derived)
                    ├── build/codex-marketplace/                Codex plugin (derived)
                    └── runtime/                                MCP server copy for Codex
```

## Why a directory instead of a database

Memories, skills and MCP definitions are read by agents, humans and `git diff`. Flat files keep the
data inspectable, diffable and recoverable without tooling. The only generated state is
`index.json`, which exists so `loom_memory_search` does not have to re-parse every source on each
call.

## Components

### `packages/cli` — the `agentloom` command

| Module | Responsibility |
| --- | --- |
| `src/config.mjs` | paths, `${VAR}`/`~` expansion, default config, legacy `~/.agent-hub` migration |
| `src/fsx.mjs` | small filesystem helpers, including link detection and target resolution for dangling links |
| `src/skills.mjs` | frontmatter parsing, rendering `core + variant`, scaffolding, adopting, validation |
| `src/link.mjs` | junction/symlink lifecycle for `~/.dsh/skills`, ownership checks, pruning |
| `src/memory.mjs` | shared-memory store, source parsing (AGENTS.md, markdown, rollouts, SQLite), index, search |
| `src/mcp.mjs` | `servers.json`, Codex TOML import, bridge registration, runtime copy |
| `src/codex.mjs` | Codex marketplace + plugin generation (`.codex-plugin/plugin.json`, `.mcp.json`, `skills/`) |
| `src/codex-agents.mjs` | the marked shared-memory block inside `~/.codex/AGENTS.md` |
| `mcp/server.mjs` | stdio JSON-RPC MCP server exposing the `loom_*` tools |
| `patches/settings-compat/` | shims + idempotent patcher for DSH plugins built against newer host APIs |

### `packages/dsh-plugin` — the DeepSeek Harness bridge

A Cordis plugin that injects a system-prompt section and registers four tools
(`loom_status`, `loom_sync`, `loom_memory_search`, `loom_skill_list`). Unlike the MCP server, this
plugin can add text **before** the model sees the conversation, which is what makes memory injection
possible at all: it fills the part of the context that the harness's own `AGENTS.md` budget
truncates away.

## The sync pipeline (order matters)

1. **Render** every skill source into `build/skills/<target>/<name>/SKILL.md`
   (`core/SKILL.md` + that target's variant). Directory-level prune drops renders of deleted skills.
2. **Link** each DSH render into `~/.dsh/skills/<name>` (junction on Windows, directory symlink
   elsewhere). A full pass prunes links whose skill no longer renders, and sweeps orphan links whose
   target lives under `build/skills/dsh` but is gone.
3. **MCP artifacts**: refresh `servers.json` (registering/removing the bridge), write the Codex and
   DSH MCP views.
4. **Codex marketplace**: regenerate `build/codex-marketplace` with the rendered Codex skills and a
   `.mcp.json` that contains *only* the bridge.
5. **AGENTS.md mirror**: rewrite the marked block in `~/.codex/AGENTS.md`.
6. **Memory index**: parse all sources and write `memory/index.json`, recording source mtimes.

Steps 5 and 6 are in that order for a reason: the index snapshots source mtimes, so writing
AGENTS.md after building the index would immediately make the fresh index look stale. The mirror
block is also stripped before parsing AGENTS.md, otherwise the generated block would be indexed as
yet another memory (a self-feeding loop).

## Memory model

Three kinds of entries end up in one searchable index:

| Origin | Read/write | Notes |
| --- | --- | --- |
| `hub-shared` (`memory/shared.md`) | both harnesses write | authoritative for "current decision" |
| Codex sources (`AGENTS.md`, `memories/`, `stage1_outputs` in SQLite) | Codex writes, agentloom reads | historical milestones |
| DSH `AGENTS.md` | DSH writes | used to compute what the host already injects |

Ranking is `hub` first, then entries the host cannot see, then entries it already shows. That order
is what makes `loom_memory_search` useful by default: it returns what the current context is
missing instead of what is already in front of the model.

The DSH injection budget is `"auto"`: agentloom reads `agent-instructions maxBytes` from the
profile's `cordis.patch.yml` so "visible / invisible" matches the host instead of a guessed constant.

## Authority and conflicts

- A skill is authored once and rendered per harness. Harness-specific commands belong in
  `variants/<target>.md`; the `core` must be true for both.
- `memory/shared.md` uses **title as the identity**: adding the same title updates the entry instead
  of creating a duplicate. There is no merge conflict resolution beyond that — the last writer wins,
  and the timestamp records it.
- Codex's own files are treated as inputs. The only writes into `~/.codex` are the marked AGENTS.md
  block, the plugin cache (via `codex plugin add`) and `config.toml` (only when a human asks for the
  model fix).

## Failure modes and how they are handled

| Failure | Handling |
| --- | --- |
| Hub directory renamed | dangling links detected by comparing the link *target*; re-created, orphans pruned |
| Third-party plugin built for a newer host | settings/typert shims, applied by an idempotent patcher with backups |
| Codex re-uses a stale plugin snapshot | `CODEX_PLUGIN_VERSION` bumped per layout change, plus `doctor` compares installed vs built |
| Generated block re-indexed as memory | `stripGeneratedBlock()` before parsing |
| Index older than its sources | `doctor` compares mtimes; the plugin shows a stale warning in the injected header |
| MCP tool rejected by Codex | `annotations.readOnlyHint` on read-only tools; the bridge copy under `runtime/` must be refreshed by `sync` |

## Extension points

- **New harness**: add a target in `src/skills.mjs` (`renderAll`), a link strategy, and a render dir
  under `build/skills/<target>`. Variants make the per-harness part explicit.
- **New memory source**: add a `kind` in `src/memory.mjs` and a parser that yields
  `{id, title, body, date, kind, scope}` entries; the index and search need no changes.
- **New MCP tool**: add it to `mcp/server.mjs` with a schema and `readOnlyHint` if it cannot mutate
  state; the DSH side can expose the same capability through `packages/dsh-plugin/index.js`.
