import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agentloom-codex-'));
process.env.AGENT_LOOM_HOME = home;

const X = await import('../src/fsx.mjs');
const { buildCodexMarketplace, CODEX_MARKET_DIR, CODEX_PLUGIN_NAME, CODEX_PLUGIN_VERSION } = await import(
  '../src/codex.mjs'
);

// The marketplace builder reads the rendered tree under <hub>/build/skills/codex, so seed one by hand.
const hub = { root: home, name: 'agentloom' };
const rendered = path.join(home, 'build', 'skills', 'codex');
X.ensureDir(path.join(home, 'skills', 'demo'));
X.writeJson(path.join(home, 'skills', 'demo', 'skill.json'), {
  name: 'demo',
  description: 'a demo skill',
  targets: ['dsh', 'codex']
});
X.ensureDir(path.join(rendered, 'demo'));
fs.writeFileSync(path.join(rendered, 'demo', 'SKILL.md'), '# demo\n');
X.ensureDir(path.join(home, 'mcp'));
X.writeJson(path.join(home, 'mcp', 'servers.json'), {
  servers: {
    agentloom: {
      managed_by: 'agentloom',
      command: 'node',
      args: ['server.mjs']
    },
    // Servers copied out of Codex's own config carry codex.include = false and must not be
    // copied back — that would duplicate them and spread their credentials.
    other: { command: 'other', args: [], codex: { include: false } }
  }
});

const cfg = { hub, targets: { dsh: { skillsDir: path.join(home, '.dsh', 'skills') }, codex: { skillsDir: path.join(home, '.codex', 'skills') } } };
buildCodexMarketplace(cfg);

test('the marketplace points at the plugin directory', () => {
  const manifest = X.readJson(path.join(CODEX_MARKET_DIR, '.agents', 'plugins', 'marketplace.json'), null);
  assert.ok(manifest, 'marketplace.json exists');
  const entry = JSON.stringify(manifest);
  assert.match(entry, /agentloom/);
});

test('the plugin manifest carries the shared version and a skills directory', () => {
  const pluginJson = X.readJson(path.join(CODEX_MARKET_DIR, 'plugins', CODEX_PLUGIN_NAME, '.codex-plugin', 'plugin.json'), null);
  assert.equal(pluginJson.version, CODEX_PLUGIN_VERSION);
  assert.equal(pluginJson.skills, './skills/');
  assert.equal(pluginJson.license, 'MIT');
  assert.ok(fs.existsSync(path.join(CODEX_MARKET_DIR, 'plugins', CODEX_PLUGIN_NAME, 'skills', 'demo', 'SKILL.md')));
});

test('only included MCP servers reach the plugin', () => {
  const mcpPath = path.join(CODEX_MARKET_DIR, 'plugins', CODEX_PLUGIN_NAME, '.mcp.json');
  const mcp = X.readJson(mcpPath, null);
  assert.ok(mcp, '.mcp.json exists');
  assert.deepEqual(Object.keys(mcp.mcpServers ?? {}), ['agentloom']);
});

test('rebuilding replaces the previous tree instead of merging into it', () => {
  const stale = path.join(CODEX_MARKET_DIR, 'plugins', CODEX_PLUGIN_NAME, 'skills', 'stale', 'SKILL.md');
  X.ensureDir(path.dirname(stale));
  fs.writeFileSync(stale, '# stale\n');
  buildCodexMarketplace(cfg);
  assert.equal(fs.existsSync(stale), false);
  assert.ok(fs.existsSync(path.join(CODEX_MARKET_DIR, 'plugins', CODEX_PLUGIN_NAME, 'skills', 'demo', 'SKILL.md')));
});
