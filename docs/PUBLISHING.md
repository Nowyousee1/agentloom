# Publishing checklist

Everything below is for the maintainer cutting a release. A stranger should be able to redo it from
this file alone.

## Before the first public push

1. Repository URLs are already real (`Nowyousee1/agentloom`). If the project moves to another
   owner or org, run a global replace of `Nowyousee1/agentloom` in `package.json`,
   `packages/*/package.json`, `CONTRIBUTING.md`, and the badges in `README.md` / `README.zh-CN.md`.
2. Turn on GitHub: Issues, Discussions (optional), branch protection on `main` requiring the `test`
   status check, and "Require a pull request before merging".
3. Add the `NPM_TOKEN` repository secret (an npm automation token with publish rights on `agentloom`
   and `dsh-agentloom`).
4. Add repository topics so people can find it:
   `agent-skills`, `shared-memory`, `mcp`, `codex`, `deepseek-harness`, `developer-tools`,
   `claude-code`, `ai-agents`.
5. Reserve both npm names (`npm view agentloom`, `npm view dsh-agentloom`); a stub publish is fine.
6. Run the full gate once on a clean clone:

   ```bash
   npm test
   node scripts/verify.mjs
   ```

## Cutting a release

```bash
node scripts/version.mjs --set 0.4.0     # root + both packages + CODEX_PLUGIN_VERSION
# add the CHANGELOG entry for 0.4.0
npm test
node scripts/verify.mjs
git add -A && git commit -m "release 0.4.0"
git tag v0.4.0
git push origin main --tags              # triggers .github/workflows/release.yml
```

The `release` workflow re-checks the tag against `package.json`, runs the gate and the tests, then
publishes both packages with `--provenance` and creates the GitHub release from the matching
`CHANGELOG.md` section.

## After publishing

- `npm view agentloom version` and `npm view dsh-agentloom version` must show the new version.
- Install from the registry in a scratch container:
  `npm i -g agentloom@latest && agentloom --help`.
- Confirm the DSH plugin resolves: `plugin_manager` shows `dsh-agentloom` as installed, no warnings.
- Confirm the Codex side: `agentloom sync`, then `codex plugin add agentloom@agentloom`, then one
  real tool call.
- If the Codex plugin layout changed, `CODEX_PLUGIN_VERSION` must already be bumped — otherwise the
  per-version cache under `~/.codex/plugins/cache/` keeps the old snapshot.

## What must never be committed

- `~/.codex/config.toml` or anything containing `experimental_bearer_token`, API keys, or tokens.
- A generated `build/` tree, `runtime/` copy, or `memory/index.json` (they are outputs; `.gitignore`
  covers the in-repo ones).
- Backups created by `migrateLegacyHub()` or the AGENTS.md mirror (`*.bak-*`).
