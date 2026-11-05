import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as X from './fsx.mjs';
import { BUILD_DIR, HUB_ROOT, MCP_DIR, expand } from './config.mjs';
import { codexServerShape } from './codex.mjs';

export const SERVERS_PATH = path.join(MCP_DIR, 'servers.json');

/** Canonical name of the bridge server that gives Codex the same hub tools DSH has. */
export const BRIDGE_NAME = 'agentloom';
// 0.2.x called itself agent-hub; its servers.json entry must not survive the rename, otherwise the
// Codex plugin ships two bridges that both answer the same tool names.
const LEGACY_BRIDGE_NAMES = ['agent-hub'];
const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME_DIR = path.join(HUB_ROOT, 'runtime');

/**
 * Copy the bridge server + its `src/` dependencies into the hub, so Codex keeps working even if
 * this workspace is moved or cleaned. Re-copied on every sync (cheap: ~10 small files).
 */
export function installBridgeRuntime() {
  const dst = path.join(RUNTIME_DIR, 'mcp');
  X.ensureDir(dst);
  X.ensureDir(path.join(RUNTIME_DIR, 'src'));
  X.writeText(path.join(dst, 'server.mjs'), X.readText(path.join(SOURCE_ROOT, 'mcp', 'server.mjs')));
  for (const f of fs.readdirSync(path.join(SOURCE_ROOT, 'src'))) {
    if (!f.endsWith('.mjs')) continue;
    X.writeText(path.join(RUNTIME_DIR, 'src', f), X.readText(path.join(SOURCE_ROOT, 'src', f)));
  }
  return { runtimeDir: RUNTIME_DIR, entry: path.join(dst, 'server.mjs') };
}

/**
 * The bridge definition is generated, never hand-edited: its command must point at the runtime copy
 * and at a node binary that exists. `process.execPath` is whatever node ran this sync.
 */
export function bridgeDefinition() {
  const { entry } = installBridgeRuntime();
  return {
    command: process.execPath,
    args: [entry],
    enabled: true,
    managed_by: 'agentloom',
    description: 'agentloom 共享记忆 / 共享技能（DSH 与 Codex 共用同一份真源）',
    startup_timeout_sec: 30,
    tool_timeout_sec: 120,
    codex: { include: true }
  };
}

/** Register (or refresh) the bridge server in the canonical servers.json. */
export function ensureBridgeServer() {
  const doc = loadServers();
  const next = bridgeDefinition();
  const removed = [];
  for (const name of LEGACY_BRIDGE_NAMES) {
    if (doc.servers[name]) {
      delete doc.servers[name];
      removed.push(name);
    }
  }
  const prev = doc.servers[BRIDGE_NAME];
  doc.servers[BRIDGE_NAME] = { ...(prev ?? {}), ...next };
  saveServers(doc);
  if (removed.length) console.error(`[agentloom] 移除重命名前的旧 MCP 桥接: ${removed.join(', ')}`);
  return doc.servers[BRIDGE_NAME];
}

export function loadServers() {
  const doc = X.readJson(SERVERS_PATH, { version: 1, servers: {} });
  doc.servers = doc.servers ?? {};
  return doc;
}

export function saveServers(doc) {
  X.writeJson(SERVERS_PATH, doc);
  return doc;
}

export function upsertServer(name, def) {
  const doc = loadServers();
  doc.servers[name] = def;
  saveServers(doc);
  return doc;
}

export function removeServer(name) {
  const doc = loadServers();
  delete doc.servers[name];
  saveServers(doc);
  return doc;
}

/** Parse the quoted-string / string-array subset of TOML that Codex's config actually uses. */
function parseTomlValue(raw) {
  const s = raw.trim();
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) return s.slice(1, -1);
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    try {
      return JSON.parse(s);
    } catch {
      return s.slice(1, -1);
    }
  }
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    const out = [];
    let buf = '';
    let quote = null;
    for (let i = 0; i < inner.length; i += 1) {
      const ch = inner[i];
      if (quote) {
        if (ch === quote) quote = null;
        else buf += ch;
        continue;
      }
      if (ch === "'" || ch === '"') {
        quote = ch;
        continue;
      }
      if (ch === ',') {
        out.push(buf.trim());
        buf = '';
        continue;
      }
      buf += ch;
    }
    if (buf.trim()) out.push(buf.trim());
    return out;
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  const n = Number(s);
  return Number.isFinite(n) ? n : s;
}

/** Read `[mcp_servers.*]` blocks out of ~/.codex/config.toml without a TOML dependency. */
export function readCodexMcpServers(configPath) {
  if (!X.isFile(configPath)) return {};
  const lines = X.readText(configPath).split(/\r?\n/);
  const servers = {};
  let current = null; // { name, kind }
  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const section = /^\[([^\]]+)\]$/.exec(line);
    if (section) {
      const parts = section[1].split('.').map((p) => p.replace(/^["']|["']$/g, ''));
      if (parts[0] === 'mcp_servers' && parts[1]) {
        current = { name: parts[1], kind: parts[2] ?? 'server' };
        servers[current.name] = servers[current.name] ?? { name: current.name, env: {}, headers: {} };
      } else {
        current = null;
      }
      continue;
    }
    if (!current) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().replace(/^["']|["']$/g, '');
    const value = parseTomlValue(line.slice(eq + 1));
    const target = servers[current.name];
    if (current.kind === 'env') {
      target.env[key] = String(value);
    } else if (current.kind === 'http_headers' || current.kind === 'env_http_headers') {
      target.headers[key] = String(value);
    } else {
      target[key] = value;
    }
  }
  return servers;
}

/**
 * Import every MCP server declared in Codex's config as the canonical definition.
 * Imported servers are marked codex.include=false so the generated Codex plugin does not duplicate
 * a server Codex already has; they are the ones DSH still needs.
 */
export function importFromCodex(configPath) {
  const raw = readCodexMcpServers(configPath);
  const doc = loadServers();
  const imported = [];
  for (const [name, s] of Object.entries(raw)) {
    const def = { transport: s.url ? 'streamable-http' : 'stdio', codex: { include: false } };
    if (s.url) {
      def.url = String(s.url);
      if (Object.keys(s.headers ?? {}).length) def.headers = { ...s.headers };
    } else if (s.command) {
      def.command = String(s.command);
      def.args = Array.isArray(s.args) ? s.args.map(String) : [];
      if (Object.keys(s.env ?? {}).length) def.env = { ...s.env };
    } else {
      continue;
    }
    if (s.startup_timeout_sec !== undefined) def.startup_timeout_sec = s.startup_timeout_sec;
    if (s.tool_timeout_sec !== undefined) def.tool_timeout_sec = s.tool_timeout_sec;
    doc.servers[name] = def;
    imported.push({ name, transport: def.transport, target: def.url ?? def.command });
  }
  saveServers(doc);
  return imported;
}

/**
 * Emit both sides' artifacts from the single canonical definition.
 * - Codex: .mcp.json inside the generated marketplace plugin (applied by the user's one command)
 * - DSH: a connection list the mcp-connector plugin can import, plus a paste-ready note.
 */
export function syncMcpArtifacts() {
  ensureBridgeServer();
  const doc = loadServers();
  const entries = Object.entries(doc.servers ?? {});
  const codexEntries = entries.filter(([, d]) => d.codex?.include !== false);
  const codexShape = Object.fromEntries(codexEntries.map(([n, d]) => [n, codexServerShape(d)]));
  const dshShape = entries.map(([name, def]) => ({
    name,
    transport: def.transport ?? (def.url ? 'streamable-http' : 'stdio'),
    ...(def.url ? { url: def.url, headers: def.headers ?? {} } : {}),
    ...(def.command ? { command: def.command, args: def.args ?? [], env: def.env ?? {} } : {})
  }));

  X.writeJson(path.join(BUILD_DIR, 'mcp', 'codex', 'mcp.json'), { mcpServers: codexShape });
  X.writeJson(path.join(BUILD_DIR, 'mcp', 'dsh', 'connections.json'), { connections: dshShape });
  X.writeText(
    path.join(BUILD_DIR, 'mcp', 'dsh', 'README.md'),
    [
      '# DSH 侧 MCP 导入',
      '',
      'DSH 的 MCP 连接由 `dsh-mcp-connector` 管理（存储：`~/.dsh/storages/mcp_connector.json`，',
      '界面：设置 → MCP 连接）。canonical 定义在 `~/.agentloom/mcp/servers.json`。',
      '',
      '`connections.json` 是同一份定义的扁平导出，按条目在面板里添加即可。',
      'Codex 侧已经配置过的服务器标了 `codex.include=false`，不会重复写进 Codex 插件。',
      '',
      `条目数：${entries.length}（进 Codex 插件 ${codexEntries.length}）`
    ].join('\n') + '\n'
  );
  return { count: entries.length, codexCount: codexEntries.length, codexShape, dshShape };
}

export function codexConfigPath(cfg) {
  return expand(cfg?.mcp?.codexConfigPath ?? '${USERPROFILE}/.codex/config.toml');
}

export function maskServer(def) {
  const clone = structuredClone(def);
  for (const bag of ['headers', 'env']) {
    if (clone[bag]) {
      for (const k of Object.keys(clone[bag])) {
        if (/token|key|secret|authorization/i.test(k)) clone[bag][k] = '***';
      }
    }
  }
  return clone;
}
