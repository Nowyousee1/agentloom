import path from 'node:path';
import * as X from './fsx.mjs';
import { BUILD_DIR, MCP_DIR, SKILLS_SRC } from './config.mjs';
import { listSkills, targetsOf } from './skills.mjs';

export const CODEX_MARKET_DIR = path.join(BUILD_DIR, 'codex-marketplace');
export const CODEX_PLUGIN_NAME = 'agentloom';
/**
 * Bump this whenever the generated plugin layout changes meaningfully (e.g. a new .mcp.json), so
 * Codex's per-version cache under ~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/ misses and
 * re-copies. Reusing a version leaves Codex running the stale snapshot forever.
 */
export const CODEX_PLUGIN_VERSION = '0.3.1';

function readMcpServers() {
  const p = path.join(MCP_DIR, 'servers.json');
  const doc = X.readJson(p, { servers: {} });
  return doc.servers ?? {};
}

/** Build a Codex-format marketplace containing one plugin whose skills/ are the rendered codex variants. */
export function buildCodexMarketplace(cfg) {
  const pluginDir = path.join(CODEX_MARKET_DIR, 'plugins', CODEX_PLUGIN_NAME);
  X.rmrf(CODEX_MARKET_DIR);
  X.ensureDir(pluginDir);

  const codexSkills = listSkills().filter((s) => targetsOf(s.meta).includes('codex'));
  for (const skill of codexSkills) {
    const src = path.join(BUILD_DIR, 'skills', 'codex', skill.name);
    const dst = path.join(pluginDir, 'skills', skill.name);
    if (!X.exists(src)) continue;
    X.copyDir(src, dst);
  }

  const descriptions = codexSkills
    .map((s) => `${s.name}: ${String(s.meta.description || '').trim()}`)
    .slice(0, 8);

  const pluginJson = {
    name: CODEX_PLUGIN_NAME,
    version: CODEX_PLUGIN_VERSION,
    description:
      'Shared skills and MCP servers authored once in ~/.agentloom and rendered for Codex and DeepSeek Harness.',
    author: { name: 'agentloom' },
    license: 'MIT',
    keywords: ['shared', 'skills', 'memory', 'deepseek-harness', 'agentloom'],
    skills: './skills/',
    interface: {
      displayName: 'Agentloom',
      shortDescription: 'Shared skills from ~/.agentloom',
      longDescription: ['Skills authored in ~/.agentloom (single source of truth) and rendered for Codex.']
        .concat(descriptions)
        .join('\n'),
      developerName: 'agentloom',
      category: 'Productivity',
      capabilities: ['Read', 'Write']
    }
  };
  X.writeJson(path.join(pluginDir, '.codex-plugin', 'plugin.json'), pluginJson);

  // Only servers explicitly shared with Codex. `mcp import-codex` marks every server it copies out
  // of Codex's own config with codex.include=false — copying those back would duplicate them and
  // spread their credentials into a second file.
  const servers = Object.fromEntries(
    Object.entries(readMcpServers()).filter(([, def]) => def?.codex?.include !== false)
  );
  if (Object.keys(servers).length) {
    X.writeJson(path.join(pluginDir, '.mcp.json'), {
      mcpServers: Object.fromEntries(
        Object.entries(servers).map(([name, def]) => [name, codexServerShape(def)])
      )
    });
  }

  const marketplace = {
    name: 'agentloom',
    interface: { displayName: 'Agentloom (local)' },
    plugins: [
      {
        name: CODEX_PLUGIN_NAME,
        source: { source: 'local', path: `./plugins/${CODEX_PLUGIN_NAME}` },
        policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
        category: 'Productivity'
      }
    ]
  };
  X.writeJson(path.join(CODEX_MARKET_DIR, '.agents', 'plugins', 'marketplace.json'), marketplace);

  return {
    marketDir: CODEX_MARKET_DIR,
    pluginDir,
    skills: codexSkills.map((s) => s.name),
    commands: [
      `codex plugin marketplace add "${CODEX_MARKET_DIR}"`,
      `codex plugin add ${CODEX_PLUGIN_NAME}@agentloom`
    ]
  };
}

export function codexServerShape(def) {
  const out = {};
  if (def.command) {
    out.command = def.command;
    out.args = def.args ?? [];
    if (def.env && Object.keys(def.env).length) out.env = def.env;
    if (def.cwd) out.cwd = def.cwd;
    if (def.startup_timeout_sec) out.startup_timeout_sec = def.startup_timeout_sec;
    if (def.tool_timeout_sec) out.tool_timeout_sec = def.tool_timeout_sec;
  }
  if (def.url) {
    out.url = def.url;
    if (def.headers && Object.keys(def.headers).length) out.http_headers = def.headers;
    if (def.bearer_token_env_var) out.bearer_token_env_var = def.bearer_token_env_var;
    if (def.env_http_headers && Object.keys(def.env_http_headers).length) {
      out.env_http_headers = def.env_http_headers;
    }
  }
  if (def.enabled === false) out.enabled = false;
  else if (def.enabled === true) out.enabled = true;
  return out;
}

/** Project-scoped Codex consumption without touching ~/.codex: <project>/.codex/skills/<name>. */
export function projectCodexDir(projectRoot) {
  return path.join(path.resolve(projectRoot), '.codex', 'skills');
}

export function listHubSkillSources() {
  return listSkills().map((s) => path.join(SKILLS_SRC, s.name));
}
