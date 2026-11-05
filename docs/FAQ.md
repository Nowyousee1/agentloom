# FAQ

### Do I need both harnesses installed?

No. agentloom degrades to what exists on the machine:

- Only DeepSeek Harness: skills render into `~/.dsh/skills` (junctions) and the plugin injects memory.
- Only Codex: the marketplace plugin under `~/.agentloom/build/codex-marketplace` is still generated;
  `agentloom` commands that touch Codex simply find no `~/.codex` and skip.
- Neither: the CLI still manages `~/.agentloom` as a directory of skills and a memory file.

`agentloom doctor` prints exactly which side is present and which is missing.

### Where does my data live?

Everything is a file under `~/.agentloom` (override with `AGENT_LOOM_HOME`):

```
hub.json                 config
skills/<name>/           source of truth (core + per-harness variants)
build/skills/<target>/   rendered output
memory/shared.md         shared memory, writable from both sides
memory/index.json        derived index
build/codex-marketplace/ generated Codex plugin
runtime/mcp/server.mjs   copy of the MCP bridge Codex actually runs
```

Nothing leaves the machine. There is no telemetry, no account, no network call.

### Why junctions on Windows and symlinks elsewhere?

Because editing a skill under `~/.dsh/skills/<name>` should edit the source of truth, not a copy.
On Windows, creating a directory symlink often requires elevation, while a junction does not — both
are links, so both give the same property.

If links are unavailable (some network shares), agentloom falls back to copying and records that in
`state.json`; `agentloom doctor` will tell you a link is a copy.

### I renamed or deleted a skill, but DSH still sees it

Run `agentloom sync`. A full sync prunes managed links that no longer have a skill behind them, plus
orphaned links whose target disappeared. If the link is not managed by agentloom, sync leaves it
alone unless you pass `--force`.

### The Codex side still shows the old plugin

Codex copies an installed plugin into `~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/` and
keeps using that snapshot. Changing the marketplace directory without bumping the version changes
nothing. Bump `CODEX_PLUGIN_VERSION` in `packages/cli/src/codex.mjs` (or run
`node scripts/version.mjs --set <version>`), run `agentloom sync`, then reinstall the plugin.

### Codex refuses to call the MCP tools

Codex only auto-approves MCP tools that declare `annotations.readOnlyHint`. The bridge declares it
for read-only tools; if you added a new tool, declare the same annotation or Codex will treat it as
requiring approval and fail when the approval policy is `never`.

### Why not a database for memories?

Because two harnesses and a human editor have to be able to read and write the same store, and a
Markdown file is the only format all three already agree on. The index is derived and disposable:
delete `memory/index.json`, run `agentloom sync`, and it comes back.

### My memory entries are not visible in DSH

The host caps how many bytes of `AGENTS.md`-style instructions it injects
(`agent-instructions.maxBytes`). agentloom reads that cap and reports how many entries fall outside
it (`agentloom status`, `loom_status`). The plugin's `loom_memory_search` is the escape hatch: it
searches the entries the injected block cannot fit.

### Can I use this with Claude Code / Gemini / Copilot?

The CLI has a per-target render pipeline (`renderAll`); adding a target means adding a directory under
`build/skills/<target>` and a renderer variant. Only `dsh` and `codex` are implemented and tested
today. See `docs/ARCHITECTURE.md` → "Extension points".

### How do I uninstall completely?

```
codex plugin remove agentloom@agentloom      # if installed
codex plugin marketplace remove agentloom
rm -rf ~/.agentloom                           # source of truth + generated output
```

Then remove `dsh-agentloom` from the DSH plugin manager and delete the `<!-- agentloom:shared:start -->`
block from `~/.codex/AGENTS.md` if you want the generated mirror gone too. The CLI leaves those two
alone on uninstall because it never edits files it does not own without a marker.
