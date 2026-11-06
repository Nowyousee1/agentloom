# agentloom (CLI)

[![release](https://img.shields.io/github/v/release/Nowyousee1/agentloom?label=release)](https://github.com/Nowyousee1/agentloom/releases)
[![npm](https://img.shields.io/npm/v/@nowyousee1/agentloom?label=npm)](https://www.npmjs.com/package/@nowyousee1/agentloom)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**English** | [简体中文](#简体中文)

Dependency-free Node.js (>= 22.5) command line tool that owns the `~/.agentloom` source of truth and
renders skills, MCP definitions and memory into DeepSeek Harness and Codex.

```bash
npm i -g @nowyousee1/agentloom
agentloom init      # create the hub, seed skills, link, build the index
agentloom doctor    # check that everything is actually wired up
agentloom sync      # idempotent full pipeline
```

If the npm registry is unavailable, install the GitHub release tarball instead:

```bash
npm i -g https://github.com/Nowyousee1/agentloom/releases/latest/download/agentloom-cli.tgz
```

Full documentation: [repository README](https://github.com/Nowyousee1/agentloom#readme), architecture in
[docs/ARCHITECTURE.md](https://github.com/Nowyousee1/agentloom/blob/main/docs/ARCHITECTURE.md), version notes in
[docs/COMPATIBILITY.md](https://github.com/Nowyousee1/agentloom/blob/main/docs/COMPATIBILITY.md).

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

---

## 简体中文

这是一个无运行时依赖的 Node.js 命令行工具，用 `~/.agentloom` 作为唯一真源，把技能、MCP 定义
和共享记忆渲染给 DeepSeek Harness 与 Codex。

```bash
npm i -g @nowyousee1/agentloom
agentloom init
agentloom doctor
agentloom sync
```

常用命令：

```text
agentloom skill new <name> --description="什么时候使用"
agentloom skill import --from=codex --dry-run
agentloom memory add --title=T --body=B
agentloom status
agentloom paths
```

完整中文说明、架构与兼容性文档见主仓库
[README.md](https://github.com/Nowyousee1/agentloom/blob/main/README.md#简体中文)。
