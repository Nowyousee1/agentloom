#!/usr/bin/env node
/**
 * agentloom MCP server（stdio，零依赖）
 *
 * 目的：让 Codex 也能读写「共享记忆 / 共享技能」。DSH 侧是 Cordis 插件直接调用同一批模块，
 * Codex 侧没有插件 API，只能走 MCP —— 于是把同一份能力暴露成 7 个工具。
 *
 * 传输：MCP stdio（每行一条 JSON-RPC 2.0 消息）。**stdout 只允许输出协议消息**，
 * 任何调试信息必须走 stderr，否则 Codex 侧解析会直接失败。
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { HUB_ROOT, expand, requireHub, loadConfig } from '../src/config.mjs';
import * as X from '../src/fsx.mjs';
import { addSharedMemory, buildIndex, loadIndex, readShared, search } from '../src/memory.mjs';
import { listSkills, readSkillSource } from '../src/skills.mjs';

const SERVER_VERSION = '0.2.0';
const PROTOCOL_VERSION = '2024-11-05';
const MAX_TEXT = 12000;

function logErr(...args) {
  try {
    process.stderr.write(`[agentloom-mcp] ${args.map(String).join(' ')}\n`);
  } catch {}
}

function clip(s, max = MAX_TEXT) {
  const text = String(s ?? '');
  return text.length > max ? `${text.slice(0, max - 20)}\n…（已截断 ${text.length - max} 字符）` : text;
}

function textResult(text, isError = false) {
  return { content: [{ type: 'text', text: clip(text) }], ...(isError ? { isError: true } : {}) };
}

function flat(body, max = 240) {
  const s = String(body ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/* ------------------------------------------------------------------ tools */

const TOOLS = [
  {
    name: 'loom_memory_search',
    description:
      '检索跨 harness 共享记忆（~/.agentloom/memory/shared.md 手写条目 + Codex AGENTS.md 等来源的索引）。想确认“以前是不是定过这个规矩 / 这个坑踩过没有”时用它。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '关键词，空格分隔；中文直接写。' },
        limit: { type: 'number', description: '返回条数，默认 6，最大 20。' },
        include_visible: { type: 'boolean', description: '是否连 Codex 侧 AGENTS.md 里的条目一起返回（默认返回全部）。' }
      },
      required: ['query'],
      additionalProperties: false
    }
  },
  {
    name: 'loom_memory_add',
    description:
      '把一条结论写进跨 harness 共享记忆。同为 DSH 与 Codex 可见：DSH 侧由插件注入，Codex 侧由本 MCP 读到。同标题 = 更新（不会重复）。适合记“偏好、约定、决定、教训”，不要记任务进度。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '短而唯一的标题（≤120 字符，不能换行）。' },
        body: { type: 'string', description: '结论正文（≤4000 字符）。' },
        kind: { type: 'string', description: 'preference | decision | fact | lesson | note（默认 note）。' },
        scope: { type: 'string', description: 'global | project（默认 global）。' },
        tags: { type: 'array', items: { type: 'string' }, description: '可选标签。' }
      },
      required: ['title', 'body'],
      additionalProperties: false
    }
  },
  {
    name: 'loom_memory_list',
    description: '列出共享记忆里“两端都可写”的条目（不含 Codex AGENTS.md 的历史里程碑，那些用 loom_memory_search 检索）。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'loom_skill_list',
    description: '列出 ~/.agentloom 里的共享技能（单一真源），含目标端与描述。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'loom_skill_show',
    description: '读一个共享技能的真源内容：core 正文 + 各端 variants（dsh / codex）。要看完整指令时用它。',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: '技能目录名。' } },
      required: ['name'],
      additionalProperties: false
    }
  },
  {
    name: 'loom_status',
    description: '共享层总览：技能数、DSH junction 是否指向渲染产物、记忆索引条数与共享条目数、Codex marketplace 路径。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'loom_sync',
    description: '重渲染共享技能、重建 DSH junction 与 Codex marketplace、重建记忆索引。改过 ~/.agentloom 里的内容后调用。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  }
];

// Codex (and other MCP clients) refuse to invoke a tool without approval unless it advertises
// `readOnlyHint: true`. Without annotations every hub_* call dies with
// "MCP tool call requires approval, but approval policy is never".
const READ_ONLY_TOOLS = new Set(['loom_memory_search', 'loom_memory_list', 'loom_skill_list', 'loom_skill_show', 'loom_status']);
for (const tool of TOOLS) {
  tool.annotations = {
    title: tool.name,
    readOnlyHint: READ_ONLY_TOOLS.has(tool.name),
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false
  };
}

function sharedMemoryText(list) {
  if (!list.length) return '（共享记忆为空；用 loom_memory_add 写入第一条）';
  return list
    .map((s) => {
      const when = (s.updated || s.created || '').slice(0, 10) || '—';
      return `● ${when} · ${s.title} [${s.kind}/${s.scope}]\n  ${flat(s.body)}`;
    })
    .join('\n\n');
}

function hubStatus() {
  const cfg = loadConfig();
  const dshSkillsDir = expand(cfg?.targets?.dsh?.skillsDir ?? path.join(HUB_ROOT, 'skills'));
  const skills = listSkills().map((s) => ({
    name: s.name,
    description: String(s.meta?.description ?? ''),
    targets: Array.isArray(s.meta?.targets) && s.meta.targets.length ? s.meta.targets : ['dsh', 'codex']
  }));
  const links = skills.map((s) => {
    const link = path.join(dshSkillsDir, s.name);
    const target = path.join(HUB_ROOT, 'build', 'skills', 'dsh', s.name);
    let ok = false;
    try {
      ok = fs.realpathSync(link).toLowerCase() === path.resolve(target).toLowerCase();
    } catch {
      ok = false;
    }
    return { name: s.name, ok };
  });
  const index = loadIndex();
  const shared = readShared();
  return [
    `agentloom ${HUB_ROOT}`,
    `  共享技能 ${skills.length} 个：${skills.map((s) => `${s.name}(${s.targets.join('+')})`).join('、') || '（空）'}`,
    `  DSH junction 正确 ${links.filter((l) => l.ok).length}/${links.length}${links.filter((l) => !l.ok).length ? '（跑 loom_sync 修复）' : ''}`,
    `  共享记忆（两端可写）${shared.length} 条`,
    index
      ? `  记忆索引 ${index.stats?.entries ?? 0} 条（索引时间 ${index.builtAt}；其中 DSH 上下文看不到 ${index.stats?.invisibleInDsh ?? 0} 条）`
      : '  记忆索引缺失（跑 loom_sync）',
    `  Codex marketplace ${path.join(HUB_ROOT, 'build', 'codex-marketplace')}`
  ].join('\n');
}

function runCli(args, timeoutMs = 180000) {
  const cfg = loadConfig();
  const cli = cfg?.cli?.path;
  if (!cli || !X.isFile(cli)) return Promise.resolve(textResult(`agentloom CLI 未找到（hub.json → cli.path = ${cli ?? 'undefined'}）`, true));
  return new Promise((resolve) => {
    let out = '';
    let settled = false;
    const done = (r) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    let child;
    try {
      child = spawn(process.execPath, [cli, ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      return done(textResult(`无法启动 CLI：${err?.message ?? err}`, true));
    }
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      done(textResult(`CLI 超时（${timeoutMs}ms）\n${out}`, true));
    }, timeoutMs);
    child.stdout.on('data', (d) => (out += String(d)));
    child.stderr.on('data', (d) => (out += String(d)));
    child.on('error', (err) => {
      clearTimeout(timer);
      done(textResult(`CLI 启动失败：${err?.message ?? err}`, true));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      done(textResult(`${code === 0 ? '✓ 同步完成' : `✖ 同步失败（退出码 ${code}）`}\n${out.trim()}`, code !== 0));
    });
  });
}

async function callTool(name, args) {
  requireHub();
  switch (name) {
    case 'loom_memory_search': {
      const query = String(args?.query ?? '').trim();
      if (!query) return textResult('query 不能为空', true);
      const index = loadIndex();
      const limit = Math.min(Math.max(Number(args?.limit ?? 6) || 6, 1), 20);
      const hits = search(index, query, { limit, onlyInvisible: args?.include_visible === false ? true : false });
      if (!hits.length) return textResult(`（共享记忆里没有命中：${query}）`);
      return textResult(
        hits
          .map(
            (h) =>
              `● ${h.date || '—'} · ${h.title} [${h.kind}${h.origin === 'hub' ? ' · 共享' : ''}]\n  ${flat(h.body, 420)}`
          )
          .join('\n\n')
      );
    }
    case 'loom_memory_add': {
      const r = addSharedMemory({ title: args?.title, body: args?.body, kind: args?.kind, scope: args?.scope, tags: args?.tags });
      const index = buildIndex(requireHub());
      return textResult(
        `✓ 共享记忆已${r.action === 'created' ? '新增' : '更新'}：${r.title}\n  文件 ${r.path}\n  共享条目 ${r.total}，索引 ${index.stats.entries} 条。DSH 与 Codex 下次读取即可见。`
      );
    }
    case 'loom_memory_list':
      return textResult(sharedMemoryText(readShared()));
    case 'loom_skill_list': {
      const skills = listSkills();
      if (!skills.length) return textResult('（还没有共享技能）');
      return textResult(
        skills
          .map((s) => `- ${s.name} → ${(s.meta?.targets ?? ['dsh', 'codex']).join('+')}：${flat(s.meta?.description, 160)}`)
          .join('\n')
      );
    }
    case 'loom_skill_show': {
      const n = String(args?.name ?? '').trim();
      if (!n) return textResult('name 不能为空', true);
      if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(n)) return textResult(`技能名非法：${n}`, true);
      const src = readSkillSource(n);
      if (!src) return textResult(`没有这个共享技能：${n}`, true);
      const parts = [`# ${n}`, '', '## core', src.core ?? '（空）'];
      for (const [variant, text] of Object.entries(src.variants ?? {})) parts.push('', `## variants/${variant}`, text);
      return textResult(parts.join('\n'));
    }
    case 'loom_status':
      return textResult(hubStatus());
    case 'loom_sync':
      return runCli(['sync']);
    default:
      return textResult(`未知工具：${name}`, true);
  }
}

/* ------------------------------------------------------------- transport */

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    handleMessage(line).catch((err) => logErr('handler failed:', err?.message ?? err));
  }
});
process.stdin.on('end', () => process.exit(0));

function send(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

async function handleMessage(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;

  try {
    switch (method) {
      case 'initialize':
        send({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: params?.protocolVersion ?? PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'agentloom', version: SERVER_VERSION }
          }
        });
        return;
      case 'notifications/initialized':
      case 'initialized':
        return;
      case 'ping':
        send({ jsonrpc: '2.0', id, result: {} });
        return;
      case 'tools/list':
        send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
        return;
      case 'tools/call': {
        const result = await callTool(params?.name, params?.arguments ?? {});
        send({ jsonrpc: '2.0', id, result });
        return;
      }
      case 'resources/list':
        send({ jsonrpc: '2.0', id, result: { resources: [] } });
        return;
      case 'prompts/list':
        send({ jsonrpc: '2.0', id, result: { prompts: [] } });
        return;
      default:
        if (isNotification) return;
        send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
    }
  } catch (err) {
    const message = err?.message ?? String(err);
    logErr(`tool ${method} failed:`, message);
    if (isNotification) return;
    send({ jsonrpc: '2.0', id, result: textResult(`出错：${message}`, true) });
  }
}

logErr(`ready (hub=${HUB_ROOT})`);
