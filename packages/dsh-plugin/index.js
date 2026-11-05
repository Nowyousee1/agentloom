/**
 * dsh-agentloom —— 把 ~/.agentloom 这个「DSH ↔ Codex 共享层」接进 DeepSeek Harness。
 *
 * 做六件事：
 *  1. 注入一段共享记忆摘要：先放 ~/.agentloom/memory/shared.md（两端可写的真源），
 *     再放「AGENTS.md 预算截断后 DSH 看不到」的条目；
 *  2. 工具 loom_status：一眼看清 hub 技能 / 链接 / 记忆 / Codex 产物状态；
 *  3. 工具 loom_sync：调用 agentloom CLI 做一次完整渲染 + 接 DSH + 建记忆索引；
 *  4. 工具 loom_memory_search / loom_memory_add / loom_memory_list：检索与写入共享记忆；
 *  5. 工具 loom_skill_list：列共享技能；
 *  6. 导出 Config，让本插件出现在 Harness 设置页（可关注入、调条数与字数）。
 *
 * 不引入任何依赖：只用 node 内建模块；schemastery 只用于 Config，取不到就降级为无 schema。
 * 凭据与文件写入都留给 CLI 自己处理。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const name = 'agentloom';
export const inject = ['tools', 'systemPrompt'];

// Config schema 是「设置页可见」的前提。schemastery 由宿主提供；本插件目录是 junction，
// node 解析真实路径后可能看不到宿主的 node_modules，所以先试裸模块名，再试 DSH profile 里的
// 真实路径，全部失败就降级为无 schema（插件仍可正常用）。
async function loadSchema() {
  try {
    return (await import('@deepseek-ai/schemastery')).default;
  } catch {}
  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  let profiles = [];
  try {
    profiles = fs.readdirSync(path.join(dshHome, 'profiles'));
  } catch {}
  for (const profile of profiles) {
    const entry = path.join(dshHome, 'profiles', profile, 'node_modules', '@deepseek-ai', 'schemastery', 'lib', 'index.mjs');
    if (!exists(entry)) continue;
    try {
      return (await import(new URL(`file://${entry.replace(/\\/g, '/')}`).href)).default;
    } catch {}
  }
  return null;
}

const Schema = await loadSchema();

export const Config = Schema
  ? Schema.object({
      enabled: Schema.boolean()
        .description('是否注入共享记忆摘要（关闭后只保留 hub_* 工具）。')
        .default(true),
      limit: Schema.natural()
        .min(1)
        .max(50)
        .description('注入摘要最多包含几条记忆。')
        .default(10),
      chars: Schema.natural()
        .min(500)
        .max(20000)
        .description('注入摘要的总字符上限。')
        .default(2600),
      staleWarning: Schema.boolean()
        .description('源文件比索引新时，在注入块里提示先跑 loom_sync。')
        .default(true)
    })
  : undefined;

const HOME = process.env.HOME || process.env.USERPROFILE || os.homedir();
const HUB_ROOT = process.env.AGENT_LOOM_HOME || path.join(HOME, '.agentloom');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function listDirs(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() || d.isSymbolicLink())
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

function expandPath(p) {
  let s = String(p ?? '');
  s = s.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, k) => process.env[k] ?? m);
  s = s.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (m, k) => process.env[k] ?? m);
  if (s === '~') s = HOME;
  else if (s.startsWith('~/') || s.startsWith('~\\')) s = path.join(HOME, s.slice(2));
  return path.resolve(s);
}

function hubConfig() {
  return readJson(path.join(HUB_ROOT, 'hub.json'), null);
}

function injectSettings(cfg, pluginConfig) {
  const fromHub = (cfg && cfg.inject) || {};
  const fromPlugin = pluginConfig || {};
  return {
    enabled:
      process.env.AGENT_LOOM_INJECT === '0' ? false : fromPlugin.enabled !== false && fromHub.enabled !== false,
    limit: Number(process.env.AGENT_LOOM_INJECT_LIMIT ?? fromPlugin.limit ?? fromHub.limit ?? 10) || 10,
    chars: Number(process.env.AGENT_LOOM_INJECT_CHARS ?? fromPlugin.chars ?? fromHub.chars ?? 2600) || 2600,
    staleWarning: fromPlugin.staleWarning !== false
  };
}

function loadIndex() {
  return readJson(path.join(HUB_ROOT, 'memory', 'index.json'), null);
}

function hubSkills() {
  const dir = path.join(HUB_ROOT, 'skills');
  const out = [];
  for (const skillName of listDirs(dir)) {
    const meta = readJson(path.join(dir, skillName, 'skill.json'), null);
    if (!meta) continue;
    out.push({
      name: meta.name || skillName,
      description: String(meta.description || ''),
      targets: Array.isArray(meta.targets) && meta.targets.length ? meta.targets : ['dsh', 'codex'],
      dir: path.join(dir, skillName)
    });
  }
  return out;
}

function flat(body, max = 220) {
  const s = String(body || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** True when a memory source (Codex AGENTS.md, or the hub's own shared.md) changed after the index was built. */
function indexIsStale(cfg, index) {
  const idxPath = path.join(HUB_ROOT, 'memory', 'index.json');
  let built = 0;
  try {
    built = fs.statSync(idxPath).mtimeMs;
  } catch {
    return false;
  }
  let newest = 0;
  const paths = new Set();
  for (const src of cfg?.memory?.sources ?? []) paths.add(src.path);
  // shared.md is the two-way source; index.sources already carries it, cfg.memory.sources does not.
  for (const src of index?.sources ?? []) if (src?.path) paths.add(src.path);
  for (const p of paths) {
    try {
      const m = fs.statSync(expandPath(p)).mtimeMs;
      if (m > newest) newest = m;
    } catch {}
  }
  return newest > built;
}

/** 拼注入块：hub 真源排最前（两端都可写、最可信），其次是「DSH 当前看不到」的条目。 */
function buildDigest(index, settings, stale) {
  if (!index || !Array.isArray(index.entries) || index.entries.length === 0) return '';
  const pool = [...index.entries];
  const rank = (e) => (e.origin === 'hub' ? 0 : e.visibleInDsh ? 2 : 1);
  pool.sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    const da = a.date || '';
    const db = b.date || '';
    if (da !== db) return db.localeCompare(da);
    return (b.importance || 0) - (a.importance || 0);
  });
  const lines = [];
  let used = 0;
  for (const e of pool) {
    if (lines.length >= settings.limit) break;
    const head = e.date ? `[${e.date}] ${e.title}` : String(e.title);
    const tag = e.origin === 'hub' ? '（共享真源）' : '';
    const line = `- ${head}${tag}\n  ${flat(e.body)}`;
    if (used + line.length > settings.chars) break;
    lines.push(line);
    used += line.length;
  }
  if (!lines.length) return '';
  const hidden = index.stats?.invisibleInDsh ?? 0;
  const shared = index.stats?.shared ?? 0;
  return [
    `[agentloom 共享记忆] 真源 ${path.join(HUB_ROOT, 'memory', 'shared.md')}（DSH 与 Codex 共用，共 ${shared} 条）` +
      `，其余来自 Codex 侧 AGENTS.md 中「当前 DSH 上下文看不到」的条目。`,
    `它是背景信息；与本次会话可见内容或用户当前指令冲突时，以更近、更具体的一方为准。共 ${index.stats?.entries ?? 0} 条索引，其中 ${hidden} 条不在本会话可见范围内。`,
    stale && settings.staleWarning ? '⚠ 源文件比索引新（索引可能过期），需要最新结论时先调用 loom_sync。' : '',
    '',
    ...lines
  ]
    .filter((l) => l !== '')
    .join('\n');
}

function searchIndex(index, query, limit, includeVisible) {
  const tokens = String(query || '')
    .toLowerCase()
    .split(/[\s,，;；、]+/)
    .filter((t) => t.length >= 2);
  if (!tokens.length || !index) return [];
  const hits = [];
  for (const e of index.entries) {
    // hub 真源永远参与检索：它是两端共用、用户明确要求长期成立的那部分。
    if (!includeVisible && e.visibleInDsh && e.origin !== 'hub') continue;
    const title = String(e.title).toLowerCase();
    const body = String(e.body).toLowerCase();
    const tags = (e.tags || []).join(' ').toLowerCase();
    let score = 0;
    let matched = 0;
    for (const t of tokens) {
      let s = 0;
      if (title.includes(t)) s += 6;
      if (tags.includes(t)) s += 3;
      if (body.includes(t)) s += 1;
      if (s > 0) matched += 1;
      score += s;
    }
    if (!matched) continue;
    hits.push({ score: score + (e.importance || 1) * 0.5 + matched * 2, entry: e });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit).map((h) => ({ ...h.entry, score: Number(h.score.toFixed(2)) }));
}

function runCli(cfg, args, timeoutMs = 180000) {
  const cli = cfg?.cli?.path;
  if (!cli || !exists(cli)) {
    return Promise.resolve({ ok: false, exitCode: null, output: `agentloom CLI 未找到（hub.json → cli.path = ${cli ?? 'undefined'}）` });
  }
  return new Promise((resolve) => {
    let out = '';
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    let child;
    try {
      child = spawn(process.execPath, [cli, ...args], {
        cwd: path.dirname(path.dirname(cli)),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (err) {
      done({ ok: false, exitCode: null, output: `无法启动 CLI：${err?.message ?? err}` });
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      done({ ok: false, exitCode: null, output: `CLI 超时（${timeoutMs}ms），已中断。\n${out.trim().slice(-2000)}` });
    }, timeoutMs);
    child.stdout.on('data', (d) => {
      out += String(d);
    });
    child.stderr.on('data', (d) => {
      out += String(d);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      done({ ok: false, exitCode: null, output: `CLI 启动失败：${err?.message ?? err}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ ok: code === 0, exitCode: code, output: out.trim().slice(-6000) });
    });
  });
}

const textOutput = (schema, render) => ({
  schema,
  render: (args, value) => [{ type: 'text', text: render(args, value) }]
});

const ANY_OBJECT = { type: 'object', additionalProperties: true };

export function apply(ctx, config) {
  const pluginConfig = () => {
    // Config 字段若带 .volatile() 会出现 get()；这里两种形态都接受，避免换宿主版本就崩。
    const out = {};
    for (const key of ['enabled', 'limit', 'chars', 'staleWarning']) {
      const v = config?.[key];
      if (v === undefined) continue;
      out[key] = typeof v?.get === 'function' ? v.get() : v;
    }
    return out;
  };

  if (ctx.systemPrompt) {
    ctx.systemPrompt.context({
      name: 'agentloom-shared-memory',
      order: 96,
      interpolate: false,
      text: () => {
        try {
          if (!injectSettings(hubConfig(), pluginConfig()).enabled) return '';
          const cfg = hubConfig();
          if (!cfg) return '';
          const index = loadIndex();
          if (!index) return '';
          return buildDigest(index, injectSettings(cfg, pluginConfig()), indexIsStale(cfg, index));
        } catch {
          return '';
        }
      }
    });
  }

  const disposers = [];
  const register = (definition) => {
    try {
      disposers.push(ctx.tools.register(definition));
    } catch (err) {
      ctx.logger?.warn?.(`[agentloom] 注册工具 ${definition.name} 失败：${err?.message ?? err}`);
    }
  };

  register({
    name: 'loom_status',
    description:
      '查看跨 harness 共享层（~/.agentloom）的状态：共享技能清单、DSH 技能目录里的 junction 是否正确、共享记忆索引条数与其中「DSH 当前看不到」的条数、Codex 侧 marketplace 产物路径与安装命令。用户问「共享技能/记忆现在是什么状态」时先用它。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: textOutput(ANY_OBJECT, (_args, value) => {
      const v = value || {};
      const lines = ['agentloom 状态'];
      lines.push(`  真源 ${v.hub ?? HUB_ROOT}`);
      lines.push(`  共享技能 ${v.skills?.length ?? 0} 个`);
      for (const s of v.skills ?? []) lines.push(`    - ${s.name} → ${s.targets.join('+')}：${flat(s.description, 110)}`);
      lines.push(`  DSH 技能目录 ${v.dshSkillsDir ?? '?'}（junction 正确 ${v.links?.correct ?? 0}/${v.links?.total ?? 0}）`);
      for (const l of v.links?.broken ?? []) lines.push(`    ! ${l.name}：${l.reason}`);
      if (v.memory) {
        lines.push(
          `  共享记忆 ${v.memory.entries} 条（其中两端真源 ${v.memory.shared ?? 0} 条）；本会话可见 ${v.memory.visible}，**不可见 ${v.memory.hidden}**（索引 ${v.memory.builtAt}）`
        );
        lines.push(`    来源：${(v.memory.sources ?? []).map((s) => `${s.id}(${s.exists ? s.entries : '缺失'})`).join(' / ')}`);
      } else {
        lines.push('  共享记忆：索引缺失（跑一次 loom_sync 或 agentloom memory index）');
      }
      lines.push(`  Codex marketplace ${v.codexMarket ?? '?'}`);
      for (const c of v.codexCommands ?? []) lines.push(`    ${c}`);
      return lines.join('\n');
    }),
    execute: async () => {
      const cfg = hubConfig();
      if (!cfg) throw new Error(`共享层未初始化：${path.join(HUB_ROOT, 'hub.json')} 不存在。先在你的工作区运行 agentloom CLI 的 init。`);
      const dshSkillsDir = expandPath(cfg.targets?.dsh?.skillsDir ?? path.join(HOME, '.dsh', 'skills'));
      const skills = hubSkills();
      const links = [];
      for (const s of skills) {
        const linkPath = path.join(dshSkillsDir, s.name);
        const target = path.join(HUB_ROOT, 'build', 'skills', 'dsh', s.name);
        let correct = false;
        try {
          correct = fs.realpathSync(linkPath).toLowerCase() === path.resolve(target).toLowerCase();
        } catch {
          correct = false;
        }
        links.push({ name: s.name, correct });
      }
      const index = loadIndex();
      return {
        hub: HUB_ROOT,
        skills,
        dshSkillsDir,
        links: {
          total: links.length,
          correct: links.filter((l) => l.correct).length,
          broken: links.filter((l) => !l.correct).map((l) => ({ name: l.name, reason: 'junction 缺失或指向别处（跑 loom_sync 修复）' }))
        },
        memory: index
          ? {
              entries: index.stats?.entries ?? 0,
              shared: index.stats?.shared ?? 0,
              visible: index.dsh?.visibleEntries ?? 0,
              hidden: index.stats?.invisibleInDsh ?? 0,
              builtAt: index.builtAt,
              sources: index.sources ?? []
            }
          : null,
        codexMarket: path.join(HUB_ROOT, 'build', 'codex-marketplace'),
        codexCommands: [
          `codex plugin marketplace add "${path.join(HUB_ROOT, 'build', 'codex-marketplace')}"`,
          'codex plugin add agentloom@agentloom'
        ]
      };
    }
  });

  register({
    name: 'loom_sync',
    description:
      '对共享层做一次完整同步：重新渲染所有共享技能（core + 各端 variants）、重建 ~/.dsh/skills 里的 junction、重建 Codex marketplace、重建共享记忆索引、同步 MCP 产物。改了 ~/.agentloom/skills 下的内容后用它让两端生效。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: textOutput(ANY_OBJECT, (_args, value) => {
      const v = value || {};
      const head = v.ok ? '✓ 同步完成' : `✖ 同步失败（退出码 ${v.exitCode ?? '?'}）`;
      return [head, v.output || '（无输出）'].join('\n');
    }),
    execute: async () => {
      const cfg = hubConfig();
      if (!cfg) throw new Error('共享层未初始化（~/.agentloom/hub.json 缺失）。');
      return runCli(cfg, ['sync']);
    }
  });

  register({
    name: 'loom_memory_search',
    description:
      '在共享记忆索引里检索（来源是 Codex 侧 AGENTS.md 等）。默认只返回「DSH 当前上下文看不到」的条目——这正是本工具的价值所在；需要连可见条目一起搜时传 include_visible=true。用户提到以前的里程碑、踩过的坑、某个项目的结论时用它。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '关键词，空格分隔多个词（中文直接写）。' },
        limit: { type: 'number', description: '返回条数，默认 6，最大 20。' },
        include_visible: { type: 'boolean', description: '是否连同 DSH 已能看到的条目一起返回，默认 false。' }
      },
      required: ['query'],
      additionalProperties: false
    },
    output: textOutput(ANY_OBJECT, (_args, value) => {
      const v = value || {};
      if (!v.hits?.length) return `（没有命中：${v.query ?? ''}）`;
      const lines = [`共享记忆命中 ${v.hits.length} 条（检索：${v.query}，索引 ${v.builtAt}）：`];
      for (const h of v.hits) {
        lines.push('');
        lines.push(`● ${h.date || '—'} · ${h.title}${h.visibleInDsh ? '（本会话已可见）' : '（本会话原本不可见）'}`);
        lines.push(`  ${flat(h.body, 420)}`);
      }
      return lines.join('\n');
    }),
    execute: async (args) => {
      const query = String(args?.query ?? '').trim();
      if (!query) throw new Error('query 不能为空');
      const index = loadIndex();
      if (!index) throw new Error('共享记忆索引不存在：先调 loom_sync。');
      const limit = Math.min(Math.max(Number(args?.limit ?? 6) || 6, 1), 20);
      const hits = searchIndex(index, query, limit, args?.include_visible === true);
      return { query, builtAt: index.builtAt, hits };
    }
  });

  register({
    name: 'loom_memory_add',
    description:
      '往共享记忆真源（~/.agentloom/memory/shared.md）写入一条记忆。写进去的条目 DSH 与 Codex 都能读到，是两端共享的结论；同标题再写一次是更新而不是新增。用它记住用户明确要求长期成立的偏好、决定或踩坑结论——不要用它记任务进度、临时状态或能从代码里读出的东西。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '短而唯一的标题，≤120 字符，不能换行。' },
        body: { type: 'string', description: '正文，只写结论，≤4000 字符。' },
        kind: {
          type: 'string',
          description: '类别：preference / decision / lesson / fact / project / user / history，默认 fact。'
        },
        scope: { type: 'string', enum: ['global', 'project'], description: '作用域：跨项目成立用 global，只对当前工作区成立用 project。默认 global。' },
        tags: { type: 'array', items: { type: 'string' }, description: '可选标签，最多 12 个。' },
        index_only: {
          type: 'boolean',
          description: '只更新记忆索引、不动 shared.md（默认 false；改完 shared.md 会自动重建索引）'
        }
      },
      required: ['title', 'body'],
      additionalProperties: false
    },
    output: textOutput(ANY_OBJECT, (_args, value) => {
      const v = value || {};
      if (!v.ok) return `✖ 写入失败\n${v.output || ''}`.trim();
      // CLI 已经打了一行「✓ 共享记忆已新增/更新：…」，直接用它，避免重复两行。
      return v.output || `✓ ${v.title}`;
    }),
    execute: async (args) => {
      const cfg = hubConfig();
      if (!cfg) throw new Error('共享层未初始化（~/.agentloom/hub.json 缺失）。');
      const title = String(args?.title ?? '').trim();
      const body = String(args?.body ?? '').trim();
      if (!title) throw new Error('title 不能为空');
      if (!body) throw new Error('body 不能为空');
      const cliArgs = ['memory', 'add', `--title=${title}`, `--body=${body}`];
      if (args?.kind) cliArgs.push(`--kind=${String(args.kind)}`);
      if (args?.scope) cliArgs.push(`--scope=${String(args.scope)}`);
      if (Array.isArray(args?.tags) && args.tags.length) cliArgs.push(`--tags=${args.tags.join(',')}`);
      const res = await runCli(cfg, cliArgs, 30000);
      const action = /已更新|updated/i.test(res.output) ? 'updated' : 'created';
      return { ...res, title, action, total: loadIndex()?.stats?.shared ?? null };
    }
  });

  register({
    name: 'loom_memory_list',
    description:
      '列出共享记忆真源（~/.agentloom/memory/shared.md）里的全部条目——这是 DSH 与 Codex 共用、两端都能读写的部分，不含从 Codex AGENTS.md 只读索引来的条目。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: textOutput(ANY_OBJECT, (_args, value) => {
      const v = value || {};
      if (!v.entries?.length) return `（${v.path ?? '~/.agentloom/memory/shared.md'} 里还没有共享条目）`;
      const lines = [`共享记忆 ${v.entries.length} 条（真源 ${v.path}）：`];
      for (const e of v.entries) {
        lines.push('');
        lines.push(`● ${e.date || '—'} · ${e.title}  [${e.kind}/${e.scope}]`);
        lines.push(`  ${flat(e.body, 300)}`);
      }
      return lines.join('\n');
    }),
    execute: async () => {
      const index = loadIndex();
      const entries = (index?.entries ?? []).filter((e) => e.origin === 'hub');
      return { path: path.join(HUB_ROOT, 'memory', 'shared.md'), total: entries.length, entries };
    }
  });

  register({
    name: 'loom_skill_list',
    description:
      '列出 ~/.agentloom 里的共享技能（真源目录，不是渲染产物），含每个技能的目标端（dsh/codex）与描述。想知道「现在有哪些技能是两端共享的」时用它。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: textOutput(ANY_OBJECT, (_args, value) => {
      const v = value || {};
      if (!v.skills?.length) return `（${v.hub ?? HUB_ROOT} 下还没有共享技能）`;
      const lines = [`共享技能 ${v.skills.length} 个（真源 ${path.join(HUB_ROOT, 'skills')}）：`];
      for (const s of v.skills) lines.push(`- ${s.name} → ${s.targets.join('+')}：${flat(s.description, 160)}`);
      return lines.join('\n');
    }),
    execute: async () => ({ hub: HUB_ROOT, skills: hubSkills() })
  });

  if (typeof ctx.on === 'function') {
    ctx.on('dispose', () => {
      for (const d of disposers) {
        try {
          d();
        } catch {}
      }
    });
  }
}
