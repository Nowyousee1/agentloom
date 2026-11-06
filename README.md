# agentloom

[![CI](https://github.com/Nowyousee1/agentloom/actions/workflows/ci.yml/badge.svg)](https://github.com/Nowyousee1/agentloom/actions/workflows/ci.yml)
[![release](https://img.shields.io/github/v/release/Nowyousee1/agentloom?label=release)](https://github.com/Nowyousee1/agentloom/releases)
[![npm](https://img.shields.io/npm/v/@nowyousee1/agentloom?label=%40nowyousee1%2Fagentloom)](https://www.npmjs.com/package/@nowyousee1/agentloom)
[![npm plugin](https://img.shields.io/npm/v/dsh-agentloom?label=dsh-agentloom)](https://www.npmjs.com/package/dsh-agentloom)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D22.5-339933.svg)](https://nodejs.org)

**One source of truth for skills, MCP servers and memory across AI coding agents.**

agentloom keeps the state you would otherwise duplicate per harness — reusable skills, MCP server
definitions, and the memories that make an agent useful — in a single local directory, and renders
it into whatever each harness expects. Today that means **DeepSeek Harness ⇄ Codex**, with the
per-harness differences kept in explicit overlay files rather than in divergent copies.

```
~/.agentloom/skills/<name>/{core, variants/dsh.md, variants/codex.md}
        │
        ├── ~/.dsh/skills/<name>        (junction / symlink)   → DeepSeek Harness
        └── build/codex-marketplace     (Codex plugin + MCP)   → Codex CLI

~/.agentloom/memory/shared.md  ⇄  DSH injected context
                               ⇄  ~/.codex/AGENTS.md (marked block)
                               ⇄  MCP tools `loom_memory_*`
```

## Where to find it

| What you are looking for | Where it is |
| --- | --- |
| This repository | `github.com/Nowyousee1/agentloom` — search GitHub for **`agentloom`** or the topics `agent-skills`, `shared-memory`, `mcp`, `codex`, `deepseek-harness` |
| CLI on npm | [`@nowyousee1/agentloom`](https://www.npmjs.com/package/@nowyousee1/agentloom) → `npm i -g @nowyousee1/agentloom` (or `npx @nowyousee1/agentloom`); the installed command is still `agentloom` |
| DSH plugin on npm | [`dsh-agentloom`](https://www.npmjs.com/package/dsh-agentloom) |
| Inside DeepSeek Harness | plugin manager → `dsh-agentloom`; plugin entry `include:dsh-agentloom`; MCP tools are the 7 `loom_*` tools |
| Inside Codex | `codex plugin list` → `agentloom@agentloom`; MCP server name `agentloom` |
| On this machine | source of truth `~/.agentloom`, config `~/.agentloom/hub.json`, generated Codex plugin `~/.agentloom/build/codex-marketplace` |
| Health check | `agentloom doctor` — one row per wire, `✖` exits non-zero |

## Why

- **Skills drift.** The same procedure gets copied into two harnesses and then fixed in only one.
  agentloom authors it once: shared `core`, plus a `variants/<target>.md` for the parts that really
  differ (tool names, shell idioms).
- **Memory does not cross.** A decision recorded in one harness is invisible to the other. agentloom
  keeps a writable shared store and mirrors it into the places each harness actually reads, so the
  knowledge shows up without the model having to remember to call a tool.
- **MCP definitions get retyped.** agentloom owns the definitions once and emits per-harness views,
  without copying credentials into artifacts that get committed.

## Quick start

```bash
# requires Node.js >= 22.5.0
node packages/cli/bin/agentloom.mjs init      # or: npx @nowyousee1/agentloom init
agentloom doctor                              # is everything actually wired up?
agentloom sync                                # idempotent: re-render, re-link, rebuild, re-index

# Codex side (one time; agentloom prints the exact lines for your machine)
codex plugin marketplace add ~/.agentloom/build/codex-marketplace
codex plugin add agentloom@agentloom
```

Add a skill:

```bash
agentloom skill new my-skill --description="When to use it"
$EDITOR ~/.agentloom/skills/my-skill/core/SKILL.md        # shared by both harnesses
$EDITOR ~/.agentloom/skills/my-skill/variants/codex.md    # Codex-only details
agentloom sync
```

Bring existing Codex skills under management:

```bash
agentloom skill import --from=codex --dry-run
agentloom skill import --from=codex --filter=stm32
```

Share a conclusion with both agents:

```bash
agentloom memory add --title="Prefer pnpm over npm here" \
  --body="pnpm is the only package manager installed on the build machine." \
  --kind=preference --scope=global --tags=tooling
agentloom sync
```

## What works, and how it was verified

| Capability | Mechanism | Evidence |
| --- | --- | --- |
| One skill source, two harnesses | `core` + `variants/<target>.md`, rendered per target | a DSH-only marker appears in the DSH render and is absent from the Codex render |
| DSH sees the skills | links in `~/.dsh/skills` | `agentloom doctor` reports `links 2/2`; links repair themselves after a hub rename |
| Codex sees the skills | Codex marketplace plugin | `codex plugin list` shows `agentloom@agentloom installed, enabled` |
| Both harnesses read the memory | `memory/shared.md` + AGENTS.md block + MCP | a memory written from DSH is listed by a `codex exec` call to `loom_memory_list` |
| Codex sees memory without calling a tool | marked block in `~/.codex/AGENTS.md` | a Codex run with *no tools allowed* quotes the preferences from that block |
| MCP definitions are shared | `mcp/servers.json` → per-harness `.mcp.json` | the Codex plugin ships only the agentloom bridge, never third-party tokens |
| Idempotent | every write is guarded | `agentloom sync` twice: second run reports `unchanged` for every link and block |

## Commands

```
agentloom init [--force]         create the hub, seed skills, link, build the index
agentloom sync                   the whole pipeline (render → link → MCP → Codex → memory → index)
agentloom status                 human-readable overview
agentloom doctor                 health checks with ✓ / ! / ✖ and a fix hint per failure
agentloom paths                  all key paths as JSON
agentloom skill list|show|new|adopt|validate
agentloom skill import --from=codex [--filter=s] [--limit=N] [--dry-run] [--force]
agentloom link dsh [name...] [--force]
agentloom unlink <name...>
agentloom codex build|project <dir>|info
agentloom memory index|search <q>|digest|sources
agentloom memory add --title=T --body=B [--kind=preference] [--scope=global] [--tags=a,b]
agentloom memory list|remove --title=T
agentloom mcp list|add <name> --json=...|remove <name>|sync
```

`agentloom doctor` is the first thing to run when something looks wrong; it checks the Node version,
hub config, DSH links, Codex skill inventory, the MCP bridge and its runtime copy, the Codex plugin
version versus its cache, the AGENTS.md mirror block, index freshness, leftover legacy directories
and any DSH compatibility patches.

## Repository layout

```
packages/cli            the agentloom CLI + MCP server + DSH compatibility patches
packages/dsh-plugin     DeepSeek Harness bridge: injection + loom_* tools + Config schema
docs/ARCHITECTURE.md    how the pieces fit, ordering constraints, failure modes
docs/COMPATIBILITY.md   verified versions, host-shim details, migration notes
```

## The DeepSeek Harness plugin

`packages/dsh-plugin` is a Cordis plugin. It injects a system-prompt section containing the shared
memories plus the memory entries the host's `AGENTS.md` budget currently truncates away, and
registers `loom_status`, `loom_sync`, `loom_memory_search`, `loom_memory_list`, `loom_memory_add`
and `loom_skill_list`. Its `Config` schema exposes `enabled`, `limit`, `chars` and `staleWarning`, so
injection behaviour is adjustable from the settings page instead of through environment variables.

The injection budget is `"auto"`: agentloom reads `agent-instructions.maxBytes` from the profile's
`cordis.patch.yml`. "Invisible" therefore means invisible to *this* harness, not to a hard-coded
guess.

## The MCP server

`packages/cli/mcp/server.mjs` is a dependency-free stdio JSON-RPC server. Codex (or any MCP client)
gets:

| Tool | Mutates | Purpose |
| --- | --- | --- |
| `loom_memory_search` | no | search the index, defaulting to entries the current context cannot see |
| `loom_memory_list` | no | list the shared (both-sides-writable) memories |
| `loom_memory_add` | yes | add or update a shared memory by title |
| `loom_skill_list` | no | list source skills with their targets |
| `loom_skill_show` | no | show one skill's core and variants |
| `loom_status` | no | hub, links, memory and marketplace state |
| `loom_sync` | yes | run the full sync pipeline |

Read-only tools carry `annotations.readOnlyHint`, which is what lets Codex call them without an
approval prompt. Codex runs the copy under `~/.agentloom/runtime/`, so re-run `agentloom sync` after
changing the server code.

## Design rules

1. **Files, not a database.** Everything under `~/.agentloom` is inspectable and diffable.
2. **Derived state is disposable.** `build/`, `runtime/` and `memory/index.json` can be deleted and
   rebuilt with `agentloom sync`.
3. **Never destroy what it does not own.** Links are pruned only when agentloom created them; writes
   into `~/.codex` are additive, marked and backed up once.
4. **Idempotent by construction.** Text patches guard both the source and the target anchor; sync
   reports `unchanged` instead of rewriting.
5. **Explain the difference.** Per-harness behaviour lives in named overlays, so a reader can see
   what differs without diffing two copies.

## Uninstall

```bash
agentloom unlink $(ls ~/.dsh/skills)      # remove the links it created (real dirs are kept)
codex plugin remove agentloom@agentloom   # Codex side
rm -rf ~/.agentloom
```

The marked block in `~/.codex/AGENTS.md` can be deleted by hand; the backup from the first write is
`AGENTS.md.bak-agenthub`.

## Documentation

| Document | Answers |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | how the pieces fit, the sync order, failure modes, extension points |
| [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) | exact harness versions, the two patched plugins, migration from 0.2.x |
| [docs/FAQ.md](docs/FAQ.md) | one harness only, data location, junctions, stale links, uninstall |
| [docs/PUBLISHING.md](docs/PUBLISHING.md) | maintainer release checklist and the secrets it needs |
| [CONTRIBUTING.md](CONTRIBUTING.md) | the five invariants, dev setup, test matrix |
| [SECURITY.md](SECURITY.md) | threat model, what is guaranteed and what is not |
| [CHANGELOG.md](CHANGELOG.md) | what changed in each version |

## Status

0.3.0 — the first public release under this name. Verified end-to-end on Windows 11 with DeepSeek
Harness (desktop) and Codex CLI 0.157.1. The design is intentionally conservative: no background
daemon, no network listener, no runtime dependencies.

## License

MIT. See [LICENSE](LICENSE). 中文说明见 [README.zh-CN.md](README.zh-CN.md).
