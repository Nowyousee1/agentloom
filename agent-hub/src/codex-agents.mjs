import fs from 'node:fs';
import { SHARED_PATH, readShared } from './memory.mjs';
import { expand } from './config.mjs';
import * as X from './fsx.mjs';

/**
 * Codex only auto-loads `AGENTS.md`; it does not read `shared.md` on its own. So we regenerate a
 * small, clearly delimited block inside `~/.codex/AGENTS.md` on every sync: title + one-line gist
 * of each shared memory. The block is generated — never edit it by hand (edit shared.md instead).
 *
 * Only the region between the two markers is ever touched, so Codex's own memory consolidation
 * (which appends milestones to the same file) keeps working.
 */
const START = '<!-- agent-hub:shared:start -->';
const END = '<!-- agent-hub:shared:end -->';

function gist(body, max = 160) {
  const one = String(body ?? '').replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
}

export function renderCodexAgentsBlock(list, now = new Date()) {
  const stamp = now.toISOString().slice(0, 16).replace('T', ' ');
  const lines = [
    START,
    '## 跨 harness 共享记忆（agent-hub，DSH 与 Codex 共用）',
    '',
    `真源：\`${SHARED_PATH}\`（DeepSeek Harness 与 Codex 都可写）。本机 MCP 服务器 \`agent-hub\` 提供 \`hub_memory_search\` / \`hub_memory_add\` / \`hub_memory_list\` / \`hub_skill_list\` / \`hub_skill_show\` / \`hub_status\` / \`hub_sync\`；要读原文或写入新结论时直接调用工具，不要凭印象猜。`,
    '',
    `当前条目（${stamp} 自动生成，共 ${list.length} 条；要改请改 shared.md 后重跑 \`agent-hub sync\`）：`,
    ''
  ];
  for (const s of list) {
    lines.push(`- **${s.title}**（${s.kind}/${s.scope}）—— ${gist(s.body)}`);
  }
  lines.push(END);
  return lines.join('\n');
}

export function syncCodexAgentsBlock(cfg) {
  const file = expand(cfg.memory?.codexAgentsPath ?? '${USERPROFILE}/.codex/AGENTS.md');
  if (cfg.memory?.injectIntoCodexAgents === false) return { path: file, action: 'skipped' };
  if (!X.isFile(file)) return { path: file, action: 'missing' };

  const text = X.readText(file);
  const block = renderCodexAgentsBlock(readShared());
  const si = text.indexOf(START);
  const ei = text.indexOf(END);

  let next;
  if (si !== -1 && ei > si) {
    next = text.slice(0, si) + block + text.slice(ei + END.length);
  } else {
    // Insert right under the first heading line so it stays inside the injected prefix.
    const nl = text.indexOf('\n');
    const at = nl === -1 ? text.length : nl + 1;
    next = `${text.slice(0, at)}\n${block}\n\n${text.slice(at).replace(/^\n+/, '')}`;
  }
  if (next === text) return { path: file, action: 'unchanged' };

  const bak = `${file}.bak-agenthub`;
  if (!X.isFile(bak)) fs.copyFileSync(file, bak);
  fs.writeFileSync(file, next, 'utf8');
  return { path: file, action: si === -1 ? 'created' : 'updated' };
}
