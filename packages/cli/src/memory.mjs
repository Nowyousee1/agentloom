import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as X from './fsx.mjs';
import { MEMORY_DIR, expand } from './config.mjs';

const require = createRequire(import.meta.url);
const DEFAULT_DSH_AGENTS = '${USERPROFILE}/.dsh/AGENTS.md';
const DEFAULT_DSH_BUDGET = 65536;

/** Harness-neutral store: memories authored by *either* harness, written once, read by both. */
export const SHARED_PATH = path.join(MEMORY_DIR, 'shared.md');
const SHARED_HEADER = [
  '# agentloom · 共享记忆（两端共用）',
  '',
  '由 `agentloom memory add`（DSH 侧）或 agentloom MCP 工具 `loom_memory_add`（Codex 侧）写入，',
  '记录格式：`## 标题` + 若干 `- key: value` 元数据行 + 空行 + 正文。不要手工改坏标题行。',
  ''
].join('\n');

const META_KEYS = new Set(['kind', 'scope', 'tags', 'created', 'updated', 'authority']);

function parseSharedFile(text) {
  const out = [];
  for (const section of splitSections(text)) {
    const lines = section.body.split('\n');
    const meta = {};
    let i = 0;
    for (; i < lines.length; i += 1) {
      const m = /^-\s*([a-z_]+)\s*:\s*(.*)$/i.exec(lines[i]);
      if (!m || !META_KEYS.has(m[1].toLowerCase())) break;
      meta[m[1].toLowerCase()] = m[2].trim();
    }
    const body = cleanText(lines.slice(i).join('\n'));
    out.push({
      title: section.title,
      body,
      kind: meta.kind || 'note',
      scope: meta.scope || 'global',
      tags: meta.tags ? meta.tags.split(/[,，;；\s]+/).filter(Boolean) : [],
      created: meta.created || null,
      updated: meta.updated || null,
      authority: meta.authority || null
    });
  }
  return out.filter((s) => s.body.length > 0);
}

export function readShared() {
  if (!X.isFile(SHARED_PATH)) return [];
  return parseSharedFile(X.readText(SHARED_PATH));
}

function renderShared(list) {
  const parts = [SHARED_HEADER.trimEnd()];
  for (const s of list) {
    parts.push('', `## ${s.title}`, `- kind: ${s.kind}`, `- scope: ${s.scope}`);
    if (s.tags?.length) parts.push(`- tags: ${s.tags.join(', ')}`);
    if (s.created) parts.push(`- created: ${s.created}`);
    if (s.updated) parts.push(`- updated: ${s.updated}`);
    parts.push('', s.body.trim(), '');
  }
  return parts.join('\n') + '\n';
}

function assertSharedInput(input) {
  const title = String(input?.title ?? '').trim();
  const body = String(input?.body ?? '').trim();
  if (!title) throw new Error('title 不能为空');
  if (title.length > 120) throw new Error(`title 过长（${title.length} > 120）`);
  if (/[\r\n]/.test(title)) throw new Error('title 不能换行');
  if (!body) throw new Error('body 不能为空');
  if (body.length > 4000) throw new Error(`body 过长（${body.length} > 4000）`);
  const kind = String(input?.kind ?? 'note').trim().toLowerCase() || 'note';
  if (!/^[a-z-]{2,24}$/.test(kind)) throw new Error(`kind 非法：${kind}`);
  const scope = String(input?.scope ?? 'global').trim().toLowerCase() || 'global';
  if (!['global', 'project'].includes(scope)) throw new Error(`scope 只能是 global/project：${scope}`);
  const tags = (Array.isArray(input?.tags) ? input.tags : String(input?.tags ?? '').split(/[,，;；\s]+/))
    .map((t) => String(t).trim())
    .filter(Boolean)
    .slice(0, 12);
  return { title, body, kind, scope, tags };
}

/**
 * Add or update one shared memory. Same title = update in place (never duplicates), which makes
 * re-running the same `memory add` idempotent — the failure mode that bit us in the patch script.
 */
export function addSharedMemory(input) {
  const clean = assertSharedInput(input);
  const list = readShared();
  const now = new Date().toISOString();
  const hit = list.find((s) => s.title === clean.title);
  let action;
  if (hit) {
    hit.body = clean.body;
    hit.kind = clean.kind;
    hit.scope = clean.scope;
    hit.tags = clean.tags;
    hit.updated = now;
    hit.created = hit.created || now;
    action = 'updated';
  } else {
    list.push({ ...clean, created: now, updated: now });
    action = 'created';
  }
  X.ensureDir(MEMORY_DIR);
  X.writeText(SHARED_PATH, renderShared(list));
  return { action, title: clean.title, total: list.length, path: SHARED_PATH };
}

export function removeSharedMemory(title) {
  const list = readShared();
  const i = list.findIndex((s) => s.title === title);
  if (i < 0) return { removed: false, title };
  list.splice(i, 1);
  X.writeText(SHARED_PATH, renderShared(list));
  return { removed: true, title, total: list.length };
}

function sharedEntry(s) {
  const body = s.body;
  const base = makeEntry({ source: 'loom-shared', title: s.title, body });
  return {
    ...base,
    kind: s.kind || base.kind,
    date: (s.updated || s.created || base.date || '').slice(0, 10) || base.date,
    tags: [...new Set([...(base.tags ?? []), ...(s.tags ?? []), 'hub'])],
    origin: 'hub',
    scope: s.scope ?? 'global',
    // Shared entries are authored here, so they are by definition not inside either AGENTS.md.
    alwaysInject: true
  };
}

function cleanText(s) {
  return String(s)
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

function firstMatch(re, text) {
  const m = re.exec(text);
  return m ? m[1] : null;
}

/** Split a markdown document into H2 sections. */
export function splitSections(text) {
  const lines = cleanText(text).split('\n');
  const sections = [];
  let current = null;
  for (const line of lines) {
    const h2 = /^##\s+(.+?)\s*$/.exec(line);
    if (h2) {
      if (current) sections.push(current);
      current = { title: h2[1].trim(), body: [] };
      continue;
    }
    if (current) current.body.push(line);
  }
  if (current) sections.push(current);
  return sections.map((s) => ({ title: s.title, body: cleanText(s.body.join('\n')) }));
}

function kindOf(title) {
  const t = title.toLowerCase();
  if (t.startsWith('milestone') || t.includes('里程碑')) return 'milestone';
  if (t.startsWith('lesson') || t.includes('教训')) return 'lesson';
  if (/rule|standard|规范|规则|约定/.test(t)) return 'rule';
  return 'note';
}

function importanceOf(kind, title, body) {
  let score = 1;
  if (kind === 'milestone') score += 2;
  if (kind === 'lesson') score += 3;
  if (kind === 'rule') score += 2;
  if (body.length > 900) score += 1;
  if (/\*\*why:?\*\*/i.test(body)) score += 1;
  if (/(不能|务必|禁止|必须|踩坑|根因|教训)/.test(body)) score += 1;
  return Math.max(1, Math.min(5, score));
}

function makeEntry({ source, title, body, date }) {
  const cleanBody = cleanText(body);
  const kind = kindOf(title);
  const d = date || firstMatch(/\b(\d{4}-\d{2}-\d{2})\b/, title) || firstMatch(/\b(\d{4}-\d{2}-\d{2})\b/, cleanBody);
  const project = firstMatch(/([A-Za-z]:\\[^\s，,;；。、]+)/, cleanBody);
  const tags = [];
  if (kind !== 'note') tags.push(kind);
  if (project) tags.push('project');
  for (const kw of ['STM32', 'ROS', 'PCB', 'Keil', 'CAN', 'FreeRTOS', 'PID', '网站', 'skill']) {
    if (title.includes(kw) || cleanBody.includes(kw)) tags.push(kw.toLowerCase());
  }
  return {
    id: X.sha1(`${source}\u0000${title}\u0000${cleanBody.slice(0, 200)}`).slice(0, 16),
    source,
    title,
    body: cleanBody,
    date: d || null,
    kind,
    project: project || null,
    importance: importanceOf(kind, title, cleanBody),
    chars: cleanBody.length,
    tags: [...new Set(tags)]
  };
}

/**
 * `codex-agents.mjs` writes a generated block into ~/.codex/AGENTS.md so Codex actually loads the
 * shared memories. That block must never be re-indexed as a Codex milestone — otherwise every sync
 * feeds our own generated text back into the index (and the digest re-injects it into DSH).
 */
const GENERATED_BLOCK_RE = /<!--\s*agentloom:shared:start\s*-->[\s\S]*?<!--\s*agentloom:shared:end\s*-->/g;

function stripGeneratedBlock(text) {
  return String(text ?? '').replace(GENERATED_BLOCK_RE, '');
}

function entryFromMarkdownFile(source, file, opts = {}) {  if (!X.isFile(file)) return [];
  const text = X.readText(file);
  const head = splitSections(text);
  if (head.length) {
    return head.map((s) => makeEntry({ source, title: s.title, body: s.body }));
  }
  const title = opts.fallbackTitle || path.basename(file, path.extname(file));
  return [makeEntry({ source, title, body: text })];
}

/**
 * The real injection budget is decided by the DSH `agent-instructions` plugin, not by us:
 * its `maxBytes` lives in `<DSH_HOME>/profiles/<profile>/cordis.patch.yml` (the file the
 * profile actually merges on top of bundles). Hard-coding 65536 made the index report
 * entries as invisible that the harness does inject — e.g. this profile raised it to 262144.
 */
function detectDshBudget(agentsPath) {
  const roots = [];
  const fromAgents = /^(.*)[\\/]\.dsh[\\/]AGENTS\.md$/i.exec(agentsPath ?? '');
  if (fromAgents) roots.push(path.join(fromAgents[1], '.dsh'));
  const envHome = process.env.DSH_HOME;
  if (envHome) roots.push(envHome);
  for (const root of [...new Set(roots)]) {
    const patches = [];
    const profilesDir = path.join(root, 'profiles');
    if (X.isDir(profilesDir)) {
      for (const name of fs.readdirSync(profilesDir)) {
        const p = path.join(profilesDir, name, 'cordis.patch.yml');
        if (X.isFile(p)) patches.push(p);
      }
    }
    const rootPatch = path.join(root, 'cordis.patch.yml');
    if (X.isFile(rootPatch)) patches.push(rootPatch);
    for (const file of patches) {
      const hit = /agent-instructions[\s\S]{0,400}?maxBytes:\s*(\d+)/.exec(X.readText(file));
      if (hit) return { budget: Number(hit[1]), from: file };
    }
  }
  return { budget: null, from: null };
}

function dshVisibleTitles(cfg) {
  const p = expand(cfg.memory?.dshAgents ?? DEFAULT_DSH_AGENTS);
  const configured = cfg.memory?.dshBudgetBytes;
  const explicit = Number.isFinite(Number(configured)) && configured !== 'auto' && configured !== null;
  const detected = explicit ? { budget: null, from: null } : detectDshBudget(p);
  const budget = explicit ? Number(configured) : detected.budget ?? DEFAULT_DSH_BUDGET;
  if (!X.isFile(p)) return { path: p, titles: new Set(), truncated: false, totalBytes: 0, budget, budgetFrom: detected.from ?? null };
  const buf = fs.readFileSync(p);
  const truncated = buf.length > budget;
  const head = buf.subarray(0, budget).toString('utf8');
  const titles = new Set(splitSections(head).map((s) => s.title));
  return { path: p, titles, truncated, totalBytes: buf.length, budget, budgetFrom: detected.from ?? null };
}

/**
 * Codex stores its own extracted memories in `memories_1.sqlite → stage1_outputs`
 * (one row per rollout). Reading it is optional and best-effort: `node:sqlite` is
 * still flagged experimental, so any failure just yields an empty list.
 */
function readCodexStage1(dbPath, limit = 200) {
  if (!dbPath || !X.isFile(dbPath)) return [];
  let db;
  try {
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db
      .prepare(
        `select thread_id, rollout_slug, rollout_summary, raw_memory, source_updated_at
           from stage1_outputs
          order by source_updated_at desc
          limit ?`
      )
      .all(limit);
    const out = [];
    for (const r of rows) {
      const body = String(r.rollout_summary || r.raw_memory || '').trim();
      if (!body) continue;
      const slug = r.rollout_slug || String(r.thread_id || '').slice(0, 8);
      const secs = Number(r.source_updated_at);
      const date = Number.isFinite(secs) && secs > 0 ? new Date(secs * 1000).toISOString().slice(0, 10) : undefined;
      out.push(makeEntry({ source: 'codex-stage1', title: `Codex 记忆 · ${slug}`, body: body.slice(0, 4000), date }));
    }
    return out;
  } catch {
    return [];
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
  }
}

/** Append unless an entry with the same title and leading body already exists. */
function addUnique(entries, seen, e) {
  const key = `${e.title}\u0000${e.body.slice(0, 160)}`;
  if (seen.has(key)) return false;
  seen.add(key);
  entries.push(e);
  return true;
}

function collectShared(entries, seen, sources) {
  const shared = readShared();
  for (const s of shared) addUnique(entries, seen, sharedEntry(s));
  sources.push({ id: 'loom-shared', path: SHARED_PATH, exists: true, entries: shared.length, writable: true });
}

function collectConfiguredSources(cfg, entries, seen, sources) {
  for (const src of cfg.memory?.sources ?? []) {
    const p = expand(src.path);
    if (!X.isFile(p)) {
      sources.push({ id: src.id, path: p, exists: false, entries: 0 });
      continue;
    }
    const list =
      src.kind === 'agents-md'
        ? splitSections(stripGeneratedBlock(X.readText(p))).map((s) =>
            makeEntry({ source: src.id, title: s.title, body: s.body })
          )
        : entryFromMarkdownFile(src.id, p);
    for (const e of list) addUnique(entries, seen, e);
    sources.push({ id: src.id, path: p, exists: true, entries: list.length });
  }
}

function collectRollouts(cfg, entries, seen, sources) {
  const rolloutDir = expand(cfg.memory?.rolloutDir ?? '');
  if (!rolloutDir || !X.exists(rolloutDir)) return;
  let n = 0;
  for (const f of X.listFiles(rolloutDir, (name) => name.endsWith('.md'))) {
    const parsed = entryFromMarkdownFile('codex-rollout', path.join(rolloutDir, f), {
      fallbackTitle: `Rollout ${f}`
    });
    for (const e of parsed) if (addUnique(entries, seen, e)) n += 1;
  }
  sources.push({ id: 'codex-rollout', path: rolloutDir, exists: true, entries: n });
}

// Codex's own memory pipeline output. Enabled unless explicitly turned off; the switch exists
// because these are per-rollout raw notes and can be noisy.
function collectCodexStage1(cfg, entries, seen, sources) {
  const sq = cfg.memory?.sqlite ?? {};
  if (sq.enabled === false) return;
  const dbPath = expand(sq.path ?? '${USERPROFILE}/.codex/memories_1.sqlite');
  let n = 0;
  for (const e of readCodexStage1(dbPath, sq.limit ?? 200)) if (addUnique(entries, seen, e)) n += 1;
  sources.push({ id: 'codex-stage1', path: dbPath, exists: X.isFile(dbPath), entries: n });
}

function markDshVisibility(cfg, entries) {
  const dsh = dshVisibleTitles(cfg);
  for (const e of entries) {
    e.visibleInDsh = dsh.titles.has(e.title);
    e.anchors = e.tags;
  }
  return dsh;
}

function orderEntries(entries) {
  entries.sort((a, b) => {
    const aHub = a.origin === 'hub';
    const bHub = b.origin === 'hub';
    if (aHub !== bHub) return aHub ? -1 : 1;
    const da = a.date ?? '';
    const db = b.date ?? '';
    if (da !== db) return db.localeCompare(da);
    return b.importance - a.importance;
  });
}

export function buildIndex(cfg) {
  const sources = [];
  const entries = [];
  const seen = new Set();

  // Hub-authored shared memories come first: they are the only entries that both harnesses can
  // *write*, so they are the ones that must never fall out of the index (or the digest).
  collectShared(entries, seen, sources);
  collectConfiguredSources(cfg, entries, seen, sources);
  collectRollouts(cfg, entries, seen, sources);
  collectCodexStage1(cfg, entries, seen, sources);

  const dsh = markDshVisibility(cfg, entries);
  orderEntries(entries);

  const index = {
    version: 1,
    builtAt: new Date().toISOString(),
    sources,
    dsh: {
      path: dsh.path,
      budget: dsh.budget ?? null,
      budgetFrom: dsh.budgetFrom ?? null,
      truncated: dsh.truncated ?? false,
      totalBytes: dsh.totalBytes ?? 0,
      visibleEntries: entries.filter((e) => e.visibleInDsh).length
    },
    stats: {
      entries: entries.length,
      byKind: entries.reduce((acc, e) => ((acc[e.kind] = (acc[e.kind] ?? 0) + 1), acc), {}),
      shared: entries.filter((e) => e.origin === 'hub').length,
      invisibleInDsh: entries.filter((e) => !e.visibleInDsh).length
    },
    entries
  };

  X.writeJson(path.join(MEMORY_DIR, 'index.json'), index);
  X.writeText(path.join(MEMORY_DIR, 'summary.md'), renderSummary(index));
  return index;
}

export function loadIndex() {
  const p = path.join(MEMORY_DIR, 'index.json');
  if (!X.isFile(p)) throw new Error('记忆索引不存在：先运行 `agentloom memory index`');
  return X.readJson(p);
}

export function search(index, query, opts = {}) {
  const limit = opts.limit ?? 8;
  const tokens = String(query ?? '')
    .toLowerCase()
    .split(/[\s,，;；、]+/)
    .filter((t) => t.length >= 2);
  if (!tokens.length) return [];
  const hits = [];
  for (const e of index.entries) {
    const title = e.title.toLowerCase();
    const body = e.body.toLowerCase();
    const tags = (e.tags ?? []).join(' ').toLowerCase();
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
    if (opts.onlyInvisible && e.visibleInDsh) continue;
    score += e.importance * 0.5 + matched * 2;
    hits.push({ score, entry: e });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit).map((h) => ({ ...h.entry, score: Number(h.score.toFixed(2)) }));
}

function snippet(body, max = 240) {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat;
}

/** Compact block for prompt injection: prefers entries DSH cannot currently see. */
export function digest(index, opts = {}) {
  const limit = opts.limit ?? 12;
  const maxChars = opts.maxChars ?? 3000;
  const preferInvisible = opts.preferInvisible !== false;
  const pool = [...index.entries];
  pool.sort((a, b) => {
    const ha = a.origin === 'hub';
    const hb = b.origin === 'hub';
    if (ha !== hb) return ha ? -1 : 1;
    if (preferInvisible && a.visibleInDsh !== b.visibleInDsh) return a.visibleInDsh ? 1 : -1;
    const da = a.date ?? '';
    const db = b.date ?? '';
    if (da !== db) return db.localeCompare(da);
    return b.importance - a.importance;
  });
  const lines = [];
  let used = 0;
  for (const e of pool) {
    if (lines.length >= limit) break;
    const head = e.date ? `[${e.date}] ${e.title}` : e.title;
    const line = `- ${head}\n  ${snippet(e.body, 200)}`;
    if (used + line.length > maxChars) break;
    lines.push(line);
    used += line.length;
  }
  return {
    text: lines.join('\n'),
    count: lines.length,
    chars: used,
    hiddenTotal: index.entries.filter((e) => !e.visibleInDsh).length
  };
}

function renderSummary(index) {
  const lines = [];
  lines.push('# agentloom · 共享记忆索引');
  lines.push('');
  lines.push(`- 生成时间：${index.builtAt}`);
  lines.push(`- 条目：${index.stats.entries}（${Object.entries(index.stats.byKind).map(([k, v]) => `${k} ${v}`).join(' / ')}）`);
  lines.push(
    `- DSH 可见（其 AGENTS.md 前 ${Math.round((index.dsh.budget ?? 0) / 1024)}KB 内）：${index.dsh.visibleEntries}；**当前不可见：${index.stats.invisibleInDsh}**`
  );
  lines.push('');
  for (const s of index.sources) {
    lines.push(`- 源 ${s.id}: ${s.path}${s.exists ? `（${s.entries} 条）` : '（缺失）'}`);
  }
  lines.push('');
  lines.push('## 最近的 20 条');
  lines.push('');
  for (const e of index.entries.slice(0, 20)) {
    lines.push(`- ${e.date ?? '—'} · ${e.title}`);
  }
  return lines.join('\n') + '\n';
}
