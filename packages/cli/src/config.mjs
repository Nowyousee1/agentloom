import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as X from './fsx.mjs';

export const HOME = os.homedir();

/** Expand ${VAR}, %VAR%, ~ and resolve to an absolute path. */
export function expand(p) {
  if (!p || typeof p !== 'string') return p;
  let s = p;
  s = s.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, k) => (process.env[k] ?? m));
  s = s.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (m, k) => (process.env[k] ?? m));
  if (s === '~') s = HOME;
  else if (s.startsWith('~/') || s.startsWith('~\\')) s = path.join(HOME, s.slice(2));
  return path.resolve(s);
}

export const HUB_ROOT = expand(process.env.AGENT_LOOM_HOME || '~/.agentloom');
// The project was called agent-hub before its 0.3.0 rename; migrate that directory once.
export const LEGACY_HUB_ROOT = expand('~/.agent-hub');
export const CONFIG_PATH = path.join(HUB_ROOT, 'hub.json');
export const STATE_PATH = path.join(HUB_ROOT, 'state.json');
export const SKILLS_SRC = path.join(HUB_ROOT, 'skills');
export const BUILD_DIR = path.join(HUB_ROOT, 'build');
export const MCP_DIR = path.join(HUB_ROOT, 'mcp');
export const MEMORY_DIR = path.join(HUB_ROOT, 'memory');

export function defaultConfig() {
  return {
    version: 1,
    hub: {
      name: 'agentloom',
      root: HUB_ROOT,
      createdAt: new Date().toISOString()
    },
    targets: {
      dsh: {
        // DSH host scans ~/.dsh/skills (and the skills-manager plugin aggregates it).
        skillsDir: '~/.dsh/skills',
        mode: 'junction',
        writable: true
      },
      codex: {
        // Codex reads skills from its own directory; loom only reads it unless `skill import` is used.
        skillsDir: '~/.codex/skills',
        mode: 'none',
        writable: false
      }
    },
    memory: {
      sources: [
        { id: 'codex-agents', kind: 'agents-md', path: '~/.codex/AGENTS.md' },
        { id: 'codex-raw', kind: 'markdown', path: '~/.codex/memories/raw_memories.md' },
        { id: 'codex-adhoc', kind: 'markdown', path: '~/.codex/memories/extensions/ad_hoc/instructions.md' }
      ],
      rolloutDir: '~/.codex/memories/rollout_summaries',
      sqlite: {
        enabled: true,
        path: '~/.codex/memories_1.sqlite',
        limit: 200,
        note: 'Codex 自己抽取的 stage1 记忆（每条 rollout 一行）。默认纳入索引；嫌吵就 enabled=false。'
      },
      maxSectionChars: 4000,
      // "auto" follows the host's own agent-instructions cap instead of a number baked in here;
      // loadConfig() already defaults a missing value to "auto", this keeps new files explicit.
      dshBudgetBytes: 'auto'
    },
    mcp: {
      codexConfigPath: '~/.codex/config.toml'
    }
  };
}

/**
 * Move a pre-0.3.0 `~/.agent-hub` directory to `~/.agentloom` the first time the new CLI runs.
 * Copy-then-remove is used instead of rename so it also works when the two paths are on
 * different volumes (a symlinked home, a container mount, ...).
 */
export function migrateLegacyHub(legacyRoot = LEGACY_HUB_ROOT, hubRoot = HUB_ROOT) {
  const configPath = path.join(hubRoot, 'hub.json');
  if (X.exists(configPath) || !X.exists(path.join(legacyRoot, 'hub.json'))) return null;
  X.ensureDir(hubRoot);
  fs.cpSync(legacyRoot, hubRoot, { recursive: true, force: false, errorOnExist: false });
  const cfg = X.readJson(configPath, null);
  if (cfg?.hub) {
    cfg.hub.root = hubRoot;
    cfg.hub.name = 'agentloom';
    X.writeJson(configPath, cfg);
  }
  fs.rmSync(legacyRoot, { recursive: true, force: true });
  return legacyRoot;
}

/**
 * Configs written before 0.3.0 spell the home directory as `${USERPROFILE}`. That variable only
 * exists on Windows; rewrite it to `~` (which `expand()` understands everywhere) so one hub.json
 * stays portable between machines.
 */
export function portablePaths(value) {
  if (typeof value === 'string') {
    // Strip the profile prefix, then normalise the separators: a hub.json written on Windows has to
    // stay readable on macOS/Linux, where `\` is an ordinary character rather than a separator.
    const stripped = value.replace(/^\$\{USERPROFILE\}[\\/]/, '');
    return stripped === value ? value : `~/${stripped.replace(/\\/g, '/')}`;
  }
  if (Array.isArray(value)) return value.map(portablePaths);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = portablePaths(v);
    return out;
  }
  return value;
}

export function loadConfig() {
  const raw = X.readJson(CONFIG_PATH, null);
  if (!raw) throw new Error(`hub not initialised: ${CONFIG_PATH} missing (run: agentloom init)`);
  const cfg = portablePaths(raw);
  // Older hubs pinned the injection budget to our own former default (65536). That was never a
  // user choice, and it silently disagreed with the profile's agent-instructions maxBytes, so
  // treat it as "auto" and let memory.mjs follow the harness.
  cfg.memory = cfg.memory ?? {};
  if (cfg.memory.dshBudgetBytes === 65536) cfg.memory.dshBudgetBytes = 'auto';
  if (cfg.memory.dshBudgetBytes === undefined) cfg.memory.dshBudgetBytes = 'auto';
  return cfg;
}

export function saveConfig(cfg) {
  X.writeJson(CONFIG_PATH, cfg);
  return cfg;
}

export function dshSkillsDir(cfg = loadConfig()) {
  return expand(cfg?.targets?.dsh?.skillsDir ?? '~/.dsh/skills');
}

export function codexSkillsDir(cfg = loadConfig()) {
  return expand(cfg?.targets?.codex?.skillsDir ?? '~/.codex/skills');
}

export function loadState() {
  return X.readJson(STATE_PATH, { links: {}, renders: {}, memory: {} });
}

export function saveState(state) {
  X.writeJson(STATE_PATH, state);
  return state;
}

/** Config + hub presence check used by every command. */
export function requireHub() {
  migrateLegacyHub();
  if (!X.exists(CONFIG_PATH)) {
    throw new Error('agentloom 尚未初始化：先运行 `node bin/agentloom.mjs init`');
  }
  return loadConfig();
}
