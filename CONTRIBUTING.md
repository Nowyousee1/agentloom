# Contributing to agentloom

Thanks for helping make agent state portable between harnesses. This document covers the
mechanics of changing the code; the design rationale lives in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Ground rules

- **The single source of truth is `~/.agentloom`.** Sync writes derived artifacts (rendered
  skills, the Codex marketplace, indexes). Never edit derived artifacts by hand — fix the source
  and re-run `agentloom sync`.
- **Never destroy user data.** Writes into `~/.codex` must be additive, idempotent and preceded by
  a one-time backup. The same applies to links under `~/.dsh/skills`: only links agentloom itself
  created may be replaced or pruned.
- **No new runtime dependencies.** Both packages are dependency-free ES modules that run on the
  Node.js standard library. This keeps installation trivial and the attack surface small.
- **No secrets in the repository, tests or logs.** MCP servers imported from Codex keep their
  tokens in `~/.agentloom/mcp/servers.json`; only servers explicitly marked `codex.include: true`
  are copied into the Codex plugin.
- **Idempotence is a feature.** Every command should be safe to run twice. Text patching goes
  through `applyEdits`, which guards both the `from` and the `to` anchor.

## Development setup

```bash
git clone https://github.com/Nowyousee1/agentloom.git
cd agentloom
node --version        # >= 22.5.0
node --test packages/cli/test/*.test.mjs
node packages/cli/bin/agentloom.mjs --help

# scratch hub so your real ~/.agentloom is untouched
AGENT_LOOM_HOME=$PWD/.scratch node packages/cli/bin/agentloom.mjs init
```

On Windows use PowerShell:

```powershell
$env:AGENT_LOOM_HOME = "$PWD\.scratch"; node packages/cli/bin/agentloom.mjs init
```

## What to test

| Change | Minimum evidence |
| --- | --- |
| Any pure function | a unit test in `packages/cli/test/` |
| Link lifecycle | unit test + `agentloom sync` twice, second run must be a no-op |
| Memory/index changes | `agentloom memory index` then `agentloom memory search <term>` |
| Codex artifact changes | bump `CODEX_PLUGIN_VERSION`, then `codex plugin add agentloom@agentloom` |
| DSH plugin changes | reload the plugin, confirm no warnings, call one tool |

## Commit messages

Conventional-commit style prefixes (`feat:`, `fix:`, `docs:`, `test:`, `chore:`) with an
imperative subject. Explain *why* in the body when the change is not obvious; a future reader
should be able to tell what breaks if your change is reverted.

## Reporting bugs

Open an issue with:

1. OS and Node version.
2. Output of `agentloom doctor` (it is designed to be pasted into issues).
3. Whether the problem is on the CLI, the DSH plugin, the MCP bridge, or the Codex plugin side.

Please redact tokens and personal paths from pasted output.
