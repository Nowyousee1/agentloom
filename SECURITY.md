# Security policy

## Threat model in one paragraph

agentloom reads and writes files in three places: `~/.agentloom` (its own data), `~/.dsh/skills`
(symlinks/junctions it manages) and a small, marked block plus plugin cache under `~/.codex`. It
also starts a local MCP server over stdio and can spawn the CLI. It does **not** listen on a
network port, does not phone home, and has no runtime dependencies. The main risks are therefore
local: writing over data it does not own, leaking MCP credentials into a distributed artifact, and
executing untrusted skill content that an agent later follows.

## What the project guarantees

- Writes into `~/.codex` are additive and idempotent. The AGENTS.md mirror only rewrites the text
  between its own markers, and the first write leaves `AGENTS.md.bak-agenthub` behind.
- Links under `~/.dsh/skills` are only created, replaced or pruned when agentloom created them (or
  when the user passes `--force`). A real directory with the same name is never taken over.
- The generated Codex plugin `.mcp.json` contains only the agentloom bridge. Imported Codex MCP
  servers are stored in `~/.agentloom/mcp/servers.json` with `codex.include: false` by default, so
  their headers (which may hold bearer tokens) are not copied into a plugin directory.
- The MCP server writes protocol messages to stdout only; diagnostics go to stderr.
- Tool inputs are validated: skill names must match `^[a-z0-9][a-z0-9-]*$`, shared-memory titles
  are limited to 120 characters and bodies to 4000, `scope` is an enum, and paths that escape the
  expected roots are rejected.

## What it does not guarantee

- **Skill content is code you asked an agent to read.** Importing a skill copies its instructions
  into your source of truth; review imported skills before enabling them in an agent.
- **`~/.agentloom` is plain text.** It can contain memories that include project details. Treat it
  like your shell history: local, not encrypted, not for publishing.
- **Compatibility shims patch third-party packages** in the DSH profile. They are text patches with
  backups, re-applied idempotently, but they modify files outside this repository. Re-run
  `packages/cli/patches/settings-compat/apply.mjs --check` after upgrading those packages.

## Reporting a vulnerability

Please open a private security advisory on GitHub (Security → Advisories) rather than a public
issue. Include the affected version, a minimal reproduction and the impact you believe it has. We
aim to acknowledge reports within a week and to publish a fix plus an advisory for anything that
can corrupt user data or leak credentials.
