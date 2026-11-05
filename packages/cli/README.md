# agentloom (CLI)

Dependency-free Node.js (>= 22.5) command line tool that owns the `~/.agentloom` source of truth and
renders skills, MCP definitions and memory into DeepSeek Harness and Codex.

```bash
node bin/agentloom.mjs init      # create the hub, seed skills, link, build the index
node bin/agentloom.mjs doctor    # check that everything is actually wired up
node bin/agentloom.mjs sync      # idempotent full pipeline
```

Full documentation: [repository README](../../README.md), architecture in
[docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md), version notes in
[docs/COMPATIBILITY.md](../../docs/COMPATIBILITY.md).

## What is in this package

| Path | Contents |
| --- | --- |
| `bin/agentloom.mjs` | command dispatch and every user-facing command |
| `src/config.mjs` | hub paths, default config, legacy `~/.agent-hub` migration |
| `src/skills.mjs` | skill frontmatter handling, rendering `core` + variants, pruning stale output |
| `src/link.mjs` | junction/symlink creation, ownership tracking, dangling-link repair, pruning |
| `src/memory.mjs` | memory index (Codex AGENTS.md, memories dir, stage-1 sqlite, shared store) |
| `src/mcp.mjs` | MCP server registry, Codex TOML import, the `agentloom` bridge |
| `src/codex.mjs` | Codex marketplace/plugin generation (the only place that writes plugin files) |
| `src/codex-agents.mjs` | the marked memory block inside `~/.codex/AGENTS.md` |
| `mcp/server.mjs` | stdio JSON-RPC MCP server exposing the `loom_*` tools |
| `patches/settings-compat/` | optional shims for DSH plugins built against a newer host API |

## Invariants worth preserving

- Every write is guarded so a second run reports `unchanged` instead of duplicating content.
- Text patches (`applyEdits`) check both the original anchor and the replacement before acting; the
  replacement usually contains the anchor, so guarding only one side breaks idempotence.
- Nothing is deleted unless agentloom can prove it created it (links) or that it is derived output
  (`build/`, `runtime/`, `memory/index.json`).
- `~/.codex` writes are additive, marked, and backed up once.

## Tests

```bash
node --test packages/cli/test/*.test.mjs
```

The suite covers patch idempotence, skill rendering overlays, the shared-memory store, and link
repair/pruning. It runs against a temporary `AGENT_LOOM_HOME`, never the real hub.
