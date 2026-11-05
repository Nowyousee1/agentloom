# What changed

<!-- One or two sentences. Link the issue this closes, if any: "Closes #123". -->

## Why

<!-- The reason, not the diff. What was impossible or wrong before? -->

## How to verify

<!--
The commands a reviewer can run, e.g.:
  node --test packages/cli/test/*.test.mjs
  node packages/cli/bin/agentloom.mjs doctor
  npm run version:check
-->

## Checklist

- [ ] Tests pass locally (`npm test`)
- [ ] `npm run verify` passes (version sync, pack contents, docs links)
- [ ] I did not add a runtime dependency
- [ ] I did not add a network call to the CLI or the plugin
- [ ] If this changes behavior, I updated `CHANGELOG.md` under "Unreleased"
- [ ] If this changes the generated Codex plugin layout, I bumped `CODEX_PLUGIN_VERSION` in
      `packages/cli/src/codex.mjs`
- [ ] If this changes a documented command or config key, I updated both `README.md` and
      `README.zh-CN.md`
