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

export const HUB_ROOT = expand(process.env.AGENT_HUB_HOME || '~/.agent-hub');
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
      name: 'agent-hub',
      root: HUB_ROOT,
      createdAt: new Date().toISOString()
    },
    targets: {
      dsh: {
        // DSH host scans ~/.dsh/skills (and the skills-manager plugin aggregates it).
        skillsDir: '${USERPROFILE}/.dsh/skills',
        mode: 'junction',
        writable: true
      },
      codex: {
        // Read-only by project decision: never write inside ~/.codex.
        skillsDir: '${USERPROFILE}/.codex/skills',
        mode: 'none',
        writable: false
      }
    },
    memory: {
      sources: [
        { id: 'codex-agents', kind: 'agents-md', path: '${USERPROFILE}/.codex/AGENTS.md' },
        { id: 'codex-raw', kind: 'markdown', path: '${USERPROFILE}/.codex/memories/raw_memories.md' },
        { id: 'codex-adhoc', kind: 'markdown', path: '${USERPROFILE}/.codex/memories/extensions/ad_hoc/instructions.md' }
      ],
      rolloutDir: '${USERPROFILE}/.codex/memories/rollout_summaries',
      sqlite: {
        enabled: true,
        path: '${USERPROFILE}/.codex/memories_1.sqlite',
        limit: 200,
        note: 'Codex 自己抽取的 stage1 记忆（每条 rollout 一行）。默认纳入索引；嫌吵就 enabled=false。'
      },
      maxSectionChars: 4000
    },
    mcp: {
      codexConfigPath: '${USERPROFILE}/.codex/config.toml'
    }
  };
}

export function loadConfig() {
  const cfg = X.readJson(CONFIG_PATH, null);
  if (!cfg) throw new Error(`hub not initialised: ${CONFIG_PATH} missing (run: agent-hub init)`);
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
  return expand(cfg.targets.dsh.skillsDir);
}

export function codexSkillsDir(cfg = loadConfig()) {
  return expand(cfg.targets.codex.skillsDir);
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
  if (!X.exists(CONFIG_PATH)) {
    throw new Error('agent-hub 尚未初始化：先运行 `node bin/agent-hub.mjs init`');
  }
  return loadConfig();
}
