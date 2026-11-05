import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agentloom-agents-'));
process.env.AGENT_LOOM_HOME = home;

const { renderCodexAgentsBlock } = await import('../src/codex-agents.mjs');
const { SHARED_PATH } = await import('../src/memory.mjs');

test('the Codex block is delimited and lists every memory', () => {
  const block = renderCodexAgentsBlock([
    { title: 'A', kind: 'preference', scope: 'global', body: 'first body' },
    { title: 'B', kind: 'lesson', scope: 'project', body: 'second body' }
  ]);
  assert.ok(block.startsWith('<!-- agentloom:shared:start -->'));
  assert.ok(block.endsWith('<!-- agentloom:shared:end -->'));
  assert.match(block, /真源：`.*shared\.md`/);
  assert.match(block, /- \*\*A\*\*（preference\/global）/);
  assert.match(block, /- \*\*B\*\*（lesson\/project）/);
  assert.equal((block.match(/^- \*\*/gm) ?? []).length, 2);
});

test('rendering the same memories twice yields identical text', () => {
  const list = [{ title: 'A', kind: 'fact', scope: 'global', body: 'body' }];
  assert.equal(renderCodexAgentsBlock(list), renderCodexAgentsBlock(list));
});

test('long bodies are truncated into a gist', () => {
  const block = renderCodexAgentsBlock([
    { title: 'long', kind: 'fact', scope: 'global', body: 'x'.repeat(400) }
  ]);
  assert.ok(block.includes('…'));
  assert.ok(!block.includes('x'.repeat(200)), 'gist must be shorter than the source body');
});

test('the shared store path lives under the hub', () => {
  assert.equal(SHARED_PATH, path.join(home, 'memory', 'shared.md'));
});
