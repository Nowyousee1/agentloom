import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'agentloom-config-'));
process.env.AGENT_LOOM_HOME = path.join(sandbox, 'hub');

const cfg = await import('../src/config.mjs');
const X = await import('../src/fsx.mjs');

test('default paths are portable, not tied to one user profile', () => {
  const defaults = cfg.defaultConfig();
  assert.equal(defaults.targets.dsh.skillsDir, '~/.dsh/skills');
  assert.equal(defaults.targets.codex.skillsDir, '~/.codex/skills');
  assert.equal(defaults.memory.sqlite.path, '~/.codex/memories_1.sqlite');
  assert.equal(defaults.memory.dshBudgetBytes, 'auto');
  assert.equal(JSON.stringify(defaults).includes('${USERPROFILE}'), false);
});

test('portablePaths rewrites an absolute profile path back to ~', () => {
  const out = cfg.portablePaths({
    a: '${USERPROFILE}\\.dsh\\skills',
    b: '${USERPROFILE}/.codex/AGENTS.md',
    c: 'relative/path',
    d: ['x', '${USERPROFILE}\\.codex\\skills'],
    e: { nested: '${USERPROFILE}/.agentloom' }
  });
  assert.equal(out.a, '~/.dsh/skills');
  assert.equal(out.b, '~/.codex/AGENTS.md');
  assert.equal(out.c, 'relative/path');
  assert.equal(out.d[1], '~/.codex/skills');
  assert.equal(out.e.nested, '~/.agentloom');
});

test('saving the config is a stable round trip', () => {
  cfg.saveConfig(cfg.defaultConfig());
  const hubJson = cfg.CONFIG_PATH;
  assert.ok(fs.existsSync(hubJson));
  const before = fs.readFileSync(hubJson, 'utf8');
  cfg.saveConfig(cfg.loadConfig());
  assert.equal(fs.readFileSync(hubJson, 'utf8'), before, 're-saving does not churn the file');
  assert.deepEqual(cfg.loadConfig().targets.codex.skillsDir, '~/.codex/skills');
});

test('a legacy hub is copied over, restamped, and then removed', () => {
  const legacy = path.join(sandbox, 'legacy', '.agent-hub');
  const target = path.join(sandbox, 'fresh', '.agentloom');
  X.ensureDir(path.join(legacy, 'skills', 'old'));
  X.writeText(path.join(legacy, 'skills', 'old', 'skill.json'), '{"name":"old"}');
  X.writeJson(path.join(legacy, 'hub.json'), {
    ...cfg.defaultConfig(),
    hub: { root: legacy, name: 'agent-hub' }
  });

  const moved = cfg.migrateLegacyHub(legacy, target);
  assert.equal(moved, legacy);
  assert.equal(fs.existsSync(legacy), false, 'legacy directory is removed');
  const migrated = X.readJson(path.join(target, 'hub.json'), null);
  assert.equal(migrated.hub.name, 'agentloom');
  assert.equal(migrated.hub.root, target);
  assert.ok(fs.existsSync(path.join(target, 'skills', 'old', 'skill.json')));

  assert.equal(cfg.migrateLegacyHub(legacy, target), null, 'second run is a no-op');
});

test('migration does nothing when the legacy hub is absent', () => {
  assert.equal(
    cfg.migrateLegacyHub(path.join(sandbox, 'nope'), path.join(sandbox, 'nope-target')),
    null
  );
});
