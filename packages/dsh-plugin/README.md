# dsh-agentloom

[![npm](https://img.shields.io/npm/v/dsh-agentloom)](https://www.npmjs.com/package/dsh-agentloom)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

DeepSeek Harness plugin that connects the harness to the shared `~/.agentloom` layer.

## What it does

1. **Injects memory into the model context.** The system-prompt section carries the shared memories
   (`memory/shared.md`, writable from both harnesses) first, then the entries from the Codex-side
   `AGENTS.md` that the host's `agent-instructions.maxBytes` budget currently truncates away. Without
   this, those entries exist on disk but are invisible to the model.
2. **Exposes tools** so the agent can act on the hub without shelling out:
   `loom_status`, `loom_sync`, `loom_memory_search`, `loom_memory_list`, `loom_memory_add`,
   `loom_skill_list`.
3. **Surfaces a settings section** (`enabled`, `limit`, `chars`, `staleWarning`) through the exported
   `Config` schema, so injection behaviour is adjustable from the settings page.

The injection budget is `"auto"`: the plugin reads `agent-instructions.maxBytes` from the active
profile's `cordis.patch.yml`. "Invisible" therefore means invisible to this harness specifically,
not invisible according to a hard-coded constant.

## Requirements

- DeepSeek Harness with a Cordis host that supports `tools` and `systemPrompt` services.
- The `agentloom` CLI reachable from the workspace (default `../cli/bin/agentloom.mjs` relative to
  this package, overridable via `hub.json` → `cli.path`).
- `~/.agentloom` initialised — run `agentloom init` once.

## Install

```bash
# from the monorepo checkout
plugin_manager install_bundle target="link:<abs path to packages/dsh-plugin>"

# or from the registry, once published
pnpm add dsh-agentloom
```

Installing under a new package name (`dsh-agentloom`, formerly `@local/dsh-agent-hub`) requires a
harness restart; `plugin_manager` reports `restart-required` / `package-moved` and that is expected.

## Notes

- Six tools here versus seven in the MCP bridge: `loom_skill_show` only exists over MCP, because the
  harness can already read the skill files directly.
- Reads the index at `~/.agentloom/memory/index.json`; when a source file is newer than the index the
  injected block adds a staleness warning instead of silently serving old data.
- Links under `~/.dsh/skills` are created by the CLI, not by this plugin.
