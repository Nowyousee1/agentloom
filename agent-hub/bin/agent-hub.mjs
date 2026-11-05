#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as X from '../src/fsx.mjs';
import {
  BUILD_DIR,
  CONFIG_PATH,
  HUB_ROOT,
  MCP_DIR,
  MEMORY_DIR,
  SKILLS_SRC,
  STATE_PATH,
  codexSkillsDir,
  defaultConfig,
  dshSkillsDir,
  expand,
  loadConfig,
  loadState,
  requireHub,
  saveConfig,
  saveState
} from '../src/config.mjs';
import {
  adoptSkill,
  listSkills,
  loadSkill,
  renderAll,
  scaffoldSkill,
  targetsOf,
  validateSkill
} from '../src/skills.mjs';
import { linkDshSkills, linkStatus, unlinkDshSkills } from '../src/link.mjs';
import { CODEX_MARKET_DIR, buildCodexMarketplace, projectCodexDir } from '../src/codex.mjs';
import { buildIndex, digest, loadIndex, search, addSharedMemory, readShared, removeSharedMemory, SHARED_PATH } from '../src/memory.mjs';
import { SERVERS_PATH, codexConfigPath, importFromCodex, loadServers, maskServer, removeServer, syncMcpArtifacts, upsertServer } from '../src/mcp.mjs';
import { syncCodexAgentsBlock } from '../src/codex-agents.mjs';

const CLI_PATH = fileURLToPath(import.meta.url);
const HERE = path.dirname(path.dirname(CLI_PATH));

const argv = process.argv.slice(2);
const flags = new Set();
const positional = [];
for (const a of argv) {
  if (a.startsWith('--')) flags.add(a);
  else positional.push(a);
}
const has = (f) => flags.has(f);
const flagValue = (name, fallback = null) => {
  const hit = [...flags].find((f) => f.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const log = (...a) => console.log(...a);
const die = (msg) => {
  console.error(`✖ ${msg}`);
  process.exit(1);
};

function seedSkills() {
  const seedsDir = path.join(HERE, 'seeds');
  if (!X.exists(seedsDir)) return [];
  const seeded = [];
  for (const name of X.listDirs(seedsDir)) {
    const src = path.join(seedsDir, name);
    const dst = path.join(SKILLS_SRC, name);
    if (X.exists(dst)) continue;
    X.copyDir(src, dst);
    seeded.push(name);
  }
  return seeded;
}

function cmdInit() {
  const cfgPath = CONFIG_PATH;
  X.ensureDir(HUB_ROOT);
  for (const d of [SKILLS_SRC, BUILD_DIR, MCP_DIR, MEMORY_DIR]) X.ensureDir(d);

  let cfg;
  if (X.exists(cfgPath) && !has('--force')) {
    cfg = loadConfig();
    log(`• 已存在配置，保留：${cfgPath}`);
  } else {
    if (X.exists(cfgPath) && has('--force')) {
      X.copyDir(cfgPath, `${cfgPath}.bak-${Date.now()}`);
    }
    cfg = defaultConfig();
    saveConfig(cfg);
    log(`• 写入配置：${cfgPath}`);
  }

  cfg.cli = { path: CLI_PATH, packageDir: HERE };
  cfg.memory = cfg.memory ?? {};
  cfg.memory.dshAgents = cfg.memory.dshAgents ?? '${USERPROFILE}/.dsh/AGENTS.md';
  // 'auto' = follow the harness (agent-instructions maxBytes in the profile patch); a number pins it.
  // 65536 was our own former default, not a user choice — migrate it to 'auto' once.
  if (cfg.memory.dshBudgetBytes === 65536) cfg.memory.dshBudgetBytes = 'auto';
  cfg.memory.dshBudgetBytes = cfg.memory.dshBudgetBytes ?? 'auto';
  saveConfig(cfg);

  if (!X.exists(STATE_PATH)) saveState({ links: {}, renders: {}, memory: {} });
  if (!X.exists(SERVERS_PATH)) X.writeJson(SERVERS_PATH, { version: 1, servers: {} });

  const seeded = seedSkills();
  if (seeded.length) log(`• 种子技能：${seeded.join(', ')}`);

  const result = runSync(cfg, { quiet: false });
  log('');
  log(`✓ hub 就绪：${HUB_ROOT}`);
  log(`  技能 ${result.skills} 个｜DSH 链接 ${result.linked} 个｜记忆 ${result.memoryEntries} 条（DSH 当前看不到 ${result.memoryHidden} 条）`);
  log('');
  log('Codex 侧（~/.codex 保持只读，需要你手动执行一次）：');
  for (const c of result.codexCommands) log(`  ${c}`);
  return result;
}

function runSync(cfg, opts = {}) {
  const state = loadState();
  const rendered = renderAll(cfg);
  if (!opts.quiet) {
    log(
      `• 渲染 ${rendered.skills.length} 个技能 → ${rendered.targets
        .map((t) => `${t}(${rendered.written.filter((w) => w.target === t).length})`)
        .join(' / ')}`
    );
  }
  state.renders = {
    at: new Date().toISOString(),
    targets: rendered.targets,
    skills: rendered.written.map((w) => `${w.target}/${w.name}`)
  };
  saveState(state);

  const links = linkDshSkills(
    cfg,
    [...new Set(rendered.written.filter((w) => w.target === 'dsh').map((w) => w.name))]
  );
  const linked = links.filter((l) => l.action === 'linked' || l.action === 'unchanged').length;
  if (!opts.quiet) {
    for (const l of links) {
      const icon = l.action === 'linked' ? '+' : l.action === 'unchanged' ? '=' : '!';
      log(`  ${icon} dsh/${l.name}: ${l.action}${l.reason ? ` — ${l.reason}` : ''}`);
    }
  }

  // MCP artifacts first: it registers/refreshes the `agent-hub` bridge server into servers.json,
  // and the Codex marketplace plugin copies that file as its .mcp.json.
  const mcp = syncMcpArtifacts();
  if (!opts.quiet) log(`• MCP 定义 ${mcp.count} 条（进 Codex 插件 ${mcp.codexCount} 条）→ build/mcp/{codex,dsh}`);

  const codex = buildCodexMarketplace(cfg);
  if (!opts.quiet) log(`• Codex marketplace：${codex.marketDir}（技能 ${codex.skills.length}）`);

  // Codex only auto-loads AGENTS.md, so mirror the shared memories into a marked block there.
  // Do it BEFORE rebuildIndex: the index snapshots source mtimes, and writing AGENTS.md afterwards
  // would immediately make the fresh index look stale.
  const agentsBlock = syncCodexAgentsBlock(cfg);
  if (!opts.quiet) {
    const label =
      agentsBlock.action === 'created' ? '新建共享记忆块'
        : agentsBlock.action === 'updated' ? '更新共享记忆块'
          : agentsBlock.action === 'unchanged' ? '共享记忆块已最新'
            : agentsBlock.action === 'skipped' ? '共享记忆块已关闭（injectIntoCodexAgents=false）'
              : 'AGENTS.md 不存在，跳过共享记忆块';
    log(`• ${label} → ${agentsBlock.path}`);
  }

  const index = buildIndex(cfg);
  if (!opts.quiet) {
    log(
      `• 记忆索引 ${index.stats.entries} 条（DSH 不可见 ${index.stats.invisibleInDsh}）→ ${path.join(MEMORY_DIR, 'index.json')}`
    );
  }

  return {
    skills: rendered.skills.length,
    linked,
    links,
    codexCommands: codex.commands,
    marketDir: codex.marketDir,
    agentsBlock,
    memoryEntries: index.stats.entries,
    memoryHidden: index.stats.invisibleInDsh
  };
}

function cmdSync() {
  const cfg = requireHub();
  const r = runSync(cfg);
  const cacheRoot = path.join(os.homedir(), '.codex', 'plugins', 'cache', 'agent-hub', 'agent-hub');
  let installed = [];
  try {
    installed = fs.readdirSync(cacheRoot).filter((v) => /^\d+\.\d+\.\d+$/.test(v));
  } catch {
    installed = [];
  }
  log('');
  if (installed.length === 0) {
    log('Codex 侧（尚未安装，执行这两条）：');
    for (const c of r.codexCommands) log(`  ${c}`);
  } else {
    log(`Codex 侧：已安装版本 ${installed.join(', ')}（缓存 ${cacheRoot}）`);
    log('  插件内容/布局有变化时才需要重跑（并先升 CODEX_PLUGIN_VERSION）：');
    for (const c of r.codexCommands) log(`  ${c}`);
  }
}

function cmdStatus() {
  const cfg = requireHub();
  const skills = listSkills();
  const links = linkStatus(cfg);
  const serverDoc = loadServers();
  let mem = null;
  try {
    mem = loadIndex();
  } catch {
    mem = null;
  }
  const okLinks = links.filter((l) => l.correct).length;

  log('agent-hub 状态');
  log(`  hub          ${HUB_ROOT}`);
  log(`  技能 (源)    ${skills.length}`);
  for (const s of skills) {
    log(`    - ${s.name} → ${targetsOf(s.meta).join('+')}  (${s.meta.description ?? ''})`);
  }
  log(`  DSH 技能目录 ${dshSkillsDir(cfg)}`);
  log(`  链接正确     ${okLinks}/${links.length}`);
  for (const l of links) {
    if (!l.correct) log(`    ! ${l.name}: exists=${l.exists} isLink=${l.isLink} managed=${l.managed}`);
  }
  log(`  Codex 技能   ${codexSkillsDir(cfg)}（只读，hub 不写入）`);
  log(`  Codex 产物   ${CODEX_MARKET_DIR}`);
  log(`  MCP 定义     ${Object.keys(serverDoc.servers ?? {}).length}`);
  if (mem) {
    const kb = Math.round((mem.dsh.budget ?? 0) / 1024);
    const src = mem.dsh.budgetFrom ? path.basename(path.dirname(path.dirname(mem.dsh.budgetFrom))) : 'default';
    log(
      `  记忆         ${mem.stats.entries} 条；DSH 可见 ${mem.dsh.visibleEntries}，不可见 ${mem.stats.invisibleInDsh}（索引 ${mem.builtAt}；预算 ${kb}KB ← ${src}）`
    );
  } else {
    log('  记忆         索引缺失（运行 memory index）');
  }
  const state = loadState();
  if (state.renders?.at) log(`  上次渲染     ${state.renders.at}`);
}

function cmdSkill() {
  const cfg = requireHub();
  const sub = positional[1];
  if (sub === 'list') {
    const skills = listSkills();
    if (has('--json')) return log(JSON.stringify(skills.map((s) => s.meta), null, 2));
    for (const s of skills) {
      log(`${s.name}\t${targetsOf(s.meta).join('+')}\t${s.meta.description ?? ''}`);
    }
    return;
  }
  if (sub === 'show') {
    const name = positional[2] ?? die('用法: agent-hub skill show <name>');
    const s = loadSkill(name);
    return log(JSON.stringify({ ...s.meta, coreChars: s.core.length }, null, 2));
  }
  if (sub === 'new') {
    const name = positional[2] ?? die('用法: agent-hub skill new <name> --description="..."');
    const r = scaffoldSkill({
      name,
      description: flagValue('description', ''),
      tags: flagValue('tags') ? flagValue('tags').split(',') : []
    });
    renderAll(cfg);
    linkDshSkills(cfg, [name]);
    buildCodexMarketplace(cfg);
    log(`✓ 新建技能：${r.dir}`);
    return;
  }
  if (sub === 'adopt') {
    const srcDir = positional[2] ?? die('用法: agent-hub skill adopt <dir> [--name=...]');
    const r = adoptSkill(srcDir, {
      name: flagValue('name') ?? undefined,
      description: flagValue('description') ?? undefined,
      force: has('--force')
    });
    renderAll(cfg);
    linkDshSkills(cfg, [r.name]);
    buildCodexMarketplace(cfg);
    log(`✓ 收编技能：${r.name} → ${r.dir}`);
    return;
  }
  if (sub === 'validate') {
    let bad = 0;
    for (const s of listSkills()) {
      const full = loadSkill(s.name);
      const problems = validateSkill(full);
      if (problems.length) {
        bad += 1;
        log(`✖ ${s.name}: ${problems.join('; ')}`);
      }
    }
    log(bad ? `✖ ${bad} 个技能有问题` : `✓ 全部 ${listSkills().length} 个技能通过校验`);
    if (bad) process.exitCode = 1;
    return;
  }
  die('用法: agent-hub skill <list|show|new|adopt|validate>');
}

function cmdLink() {
  const cfg = requireHub();
  const target = positional[1] ?? 'dsh';
  if (target !== 'dsh') die('目前只支持 dsh（Codex 侧按你的要求不写入）');
  const names = positional.slice(2);
  const results = linkDshSkills(cfg, names, { force: has('--force') });
  for (const r of results) log(`${r.action === 'linked' ? '+' : r.action === 'unchanged' ? '=' : '!'} ${r.name}: ${r.action}${r.reason ? ` — ${r.reason}` : ''}`);
}

function cmdUnlink() {
  const cfg = requireHub();
  const names = positional.slice(1);
  if (!names.length) die('用法: agent-hub unlink <name...>');
  for (const r of unlinkDshSkills(cfg, names)) log(`${r.action} ${r.name}${r.reason ? ` — ${r.reason}` : ''}`);
}

function cmdCodex() {
  const cfg = requireHub();
  const sub = positional[1] ?? 'build';
  if (sub === 'build') {
    const r = buildCodexMarketplace(cfg);
    log(`✓ marketplace: ${r.marketDir}`);
    for (const c of r.commands) log(`  ${c}`);
    return;
  }
  if (sub === 'project') {
    const projectRoot = positional[2] ?? die('用法: agent-hub codex project <项目根>');
    const dst = projectCodexDir(projectRoot);
    X.ensureDir(dst);
    const skills = listSkills().filter((s) => targetsOf(s.meta).includes('codex'));
    for (const s of skills) {
      const src = path.join(BUILD_DIR, 'skills', 'codex', s.name);
      X.copyDir(src, path.join(dst, s.name));
    }
    log(`✓ 写入项目级 Codex 技能：${dst}（${skills.length} 个）`);
    return;
  }
  if (sub === 'info') {
    const r = buildCodexMarketplace(cfg);
    log(JSON.stringify(r, null, 2));
    return;
  }
  die('用法: agent-hub codex <build|project|info>');
}

function cmdMemory() {
  const cfg = requireHub();
  const sub = positional[1] ?? 'index';
  if (sub === 'index') {
    const index = buildIndex(cfg);
    log(`✓ 索引 ${index.stats.entries} 条 → ${path.join(MEMORY_DIR, 'index.json')}`);
    log(`  源：${index.sources.map((s) => `${s.id}(${s.exists ? s.entries : '缺失'})`).join(' / ')}`);
    log(`  DSH 注入预算 ${Math.round((index.dsh.budget ?? 0) / 1024)}KB，已覆盖 ${index.dsh.visibleEntries} 条；当前不可见 ${index.stats.invisibleInDsh} 条`);
    return;
  }
  if (sub === 'search') {
    const q = positional.slice(2).join(' ');
    if (!q) die('用法: agent-hub memory search <关键词>');
    const index = loadIndex();
    const hits = search(index, q, { limit: Number(flagValue('limit', '8')), onlyInvisible: has('--invisible') });
    if (has('--json')) return log(JSON.stringify(hits, null, 2));
    if (!hits.length) return log('（无命中）');
    for (const h of hits) {
      log(`● ${h.date ?? '—'} · ${h.title}  [${h.kind}${h.visibleInDsh ? '' : ' · DSH 不可见'}] score=${h.score}`);
      log(`  ${h.body.replace(/\s+/g, ' ').slice(0, 220)}`);
    }
    return;
  }
  if (sub === 'digest') {
    const index = loadIndex();
    const d = digest(index, {
      limit: Number(flagValue('limit', '12')),
      maxChars: Number(flagValue('chars', '3000'))
    });
    if (has('--json')) return log(JSON.stringify(d, null, 2));
    return log(d.text);
  }
  if (sub === 'sources') {
    const index = loadIndex();
    return log(JSON.stringify(index.sources, null, 2));
  }
  if (sub === 'list' || sub === 'shared') {
    const list = readShared();
    if (has('--json')) return log(JSON.stringify(list, null, 2));
    if (!list.length) return log(`（共享记忆为空：${SHARED_PATH}）`);
    for (const s of list) {
      log(`● ${(s.updated ?? s.created ?? '').slice(0, 10) || '—'} · ${s.title}  [${s.kind}/${s.scope}${s.tags.length ? ' · ' + s.tags.join(',') : ''}]`);
      log(`  ${s.body.replace(/\s+/g, ' ').slice(0, 200)}`);
    }
    return;
  }
  if (sub === 'add') {
    const title = flagValue('title') ?? positional[2];
    if (!title) die('用法: agent-hub memory add --title="..." --body="..." [--kind=preference] [--scope=global] [--tags=a,b]');
    let body = flagValue('body');
    if (!body) die('缺 --body="..."');
    if (body === '-') body = fs.readFileSync(0, 'utf8');
    const r = addSharedMemory({
      title,
      body,
      kind: flagValue('kind', 'note'),
      scope: flagValue('scope', 'global'),
      tags: flagValue('tags', '')
    });
    const cfg = requireHub();
    // Mirror first, index second — the index records source mtimes, so writing AGENTS.md after it
    // would immediately mark the fresh index stale.
    const mirrored = syncCodexAgentsBlock(cfg);
    const index = buildIndex(cfg);
    log(
      `✓ 共享记忆已${r.action === 'created' ? '新增' : '更新'}：${r.title}（共 ${r.total} 条，索引 ${index.stats.entries} 条；AGENTS.md 镜像 ${mirrored.action}）`
    );
    return;
  }
  if (sub === 'remove' || sub === 'rm') {
    const title = flagValue('title') ?? positional[2] ?? die('用法: agent-hub memory remove --title="..."');
    const r = removeSharedMemory(title);
    if (!r.removed) return log(`（没有这条共享记忆：${title}）`);
    syncCodexAgentsBlock(requireHub());
    buildIndex(requireHub());
    return log(`✓ 已删除共享记忆：${title}（剩 ${r.total} 条）`);
  }
  die('用法: agent-hub memory <index|search|digest|sources|list|add|remove>');
}

function cmdMcp() {
  const cfg = requireHub();
  const sub = positional[1] ?? 'list';
  if (sub === 'list') {
    const doc = loadServers();
    const entries = Object.entries(doc.servers ?? {});
    if (!entries.length) return log('（没有 canonical MCP 定义；用 mcp add 或 mcp import-codex 添加）');
    for (const [name, def] of entries) {
      const intoCodex = def.codex?.include === false ? '仅 DSH' : '两端';
      log(`${name}\t${def.transport ?? (def.url ? 'http' : 'stdio')}\t${def.url ?? def.command ?? ''}\t${intoCodex}`);
    }
    return;
  }
  if (sub === 'import-codex') {
    const cfgPath = codexConfigPath(cfg);
    const imported = importFromCodex(cfgPath);
    syncMcpArtifacts();
    buildCodexMarketplace(cfg);
    if (!imported.length) return log(`（${cfgPath} 里没有 [mcp_servers.*]）`);
    log(`✓ 从 Codex 配置导入 ${imported.length} 个 MCP 服务器（它们标为「仅 DSH」，避免在 Codex 里重复）：`);
    for (const s of imported) log(`  ${s.name}\t${s.transport}\t${s.target ?? ''}`);
    return;
  }
  if (sub === 'add') {
    const name = positional[2] ?? die('用法: agent-hub mcp add <name> --json=\'{...}\'');
    const raw = flagValue('json') ?? die('需要 --json=\'{"command":"npx","args":[...]}\'');
    const def = JSON.parse(raw);
    upsertServer(name, def);
    syncMcpArtifacts();
    buildCodexMarketplace(requireHub());
    return log(`✓ 加入 ${name}，两端产物已更新`);
  }
  if (sub === 'remove') {
    const name = positional[2] ?? die('用法: agent-hub mcp remove <name>');
    removeServer(name);
    syncMcpArtifacts();
    buildCodexMarketplace(requireHub());
    return log(`✓ 移除 ${name}`);
  }
  if (sub === 'sync') {
    const r = syncMcpArtifacts();
    return log(`✓ 同步 ${r.count} 条 → build/mcp/{codex,dsh}`);
  }
  die('用法: agent-hub mcp <list|add|remove|sync>');
}

function cmdRender() {
  const cfg = requireHub();
  const rendered = renderAll(cfg);
  log(`✓ 渲染 ${rendered.skills.length} 个技能：${rendered.written.length} 份产物`);
}

function cmdPaths() {
  requireHub();
  log(
    JSON.stringify(
      {
        hub: HUB_ROOT,
        config: CONFIG_PATH,
        state: STATE_PATH,
        skills: SKILLS_SRC,
        build: BUILD_DIR,
        memory: MEMORY_DIR,
        mcp: SERVERS_PATH,
        dshSkills: dshSkillsDir(loadConfig()),
        codexSkills: codexSkillsDir(loadConfig()),
        codexMarket: CODEX_MARKET_DIR,
        cli: CLI_PATH
      },
      null,
      2
    )
  );
}

const COMMANDS = {
  init: cmdInit,
  sync: cmdSync,
  status: cmdStatus,
  render: cmdRender,
  link: cmdLink,
  unlink: cmdUnlink,
  skill: cmdSkill,
  codex: cmdCodex,
  memory: cmdMemory,
  mcp: cmdMcp,
  paths: cmdPaths
};

const cmd = positional[0];
if (!cmd || cmd === 'help' || has('--help')) {
  log(`agent-hub — DSH / Codex 共享技能·MCP·记忆 的单一真源
用法：
  agent-hub init [--force]            初始化 ~/.agent-hub、种子技能、渲染、接 DSH、建记忆索引
  agent-hub sync                      渲染 + 接 DSH + 生成 Codex marketplace + 记忆索引 + MCP
  agent-hub status                    总览状态
  agent-hub paths                     JSON 输出所有关键路径
  agent-hub skill list|show|new|adopt|validate
  agent-hub link dsh [name...] [--force]
  agent-hub unlink <name...>
  agent-hub codex build|project <dir>|info
  agent-hub memory index|search <q>|digest|sources
  agent-hub memory add --title=T --body=B [--kind=preference] [--scope=global] [--tags=a,b]
  agent-hub memory list|remove --title=T
  agent-hub mcp list|add <name> --json=...|remove <name>|sync
`);
  process.exit(0);
}

const fn = COMMANDS[cmd];
if (!fn) die(`未知命令: ${cmd}（agent-hub help）`);
try {
  fn();
} catch (err) {
  die(err?.stack ? `${err.message}\n${err.stack}` : String(err));
}
