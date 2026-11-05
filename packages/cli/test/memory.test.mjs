import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-memory-'));
process.env.AGENT_LOOM_HOME = tmp;

const { addSharedMemory, readShared, removeSharedMemory, SHARED_PATH } = await import('../src/memory.mjs');

test('shared memory store starts empty', () => {
  assert.deepEqual(readShared(), []);
  assert.equal(SHARED_PATH, path.join(tmp, 'memory', 'shared.md'));
});

test('adding a memory persists title, body, kind and scope', () => {
  const r = addSharedMemory({ title: 'First note', body: 'do the thing', kind: 'lesson', scope: 'project', tags: ['a', 'b'] });
  assert.equal(r.action, 'created');
  const list = readShared();
  assert.equal(list.length, 1);
  assert.equal(list[0].title, 'First note');
  assert.equal(list[0].kind, 'lesson');
  assert.equal(list[0].scope, 'project');
  assert.deepEqual(list[0].tags, ['a', 'b']);
  assert.match(fs.readFileSync(SHARED_PATH, 'utf8'), /## First note/);
});

test('the same title updates instead of duplicating', () => {
  const r = addSharedMemory({ title: 'First note', body: 'updated body', kind: 'lesson', scope: 'project' });
  assert.equal(r.action, 'updated');
  const list = readShared();
  assert.equal(list.length, 1);
  assert.match(list[0].body, /updated body/);
});

test('a second memory is appended', () => {
  addSharedMemory({ title: 'Second note', body: 'another', kind: 'fact', scope: 'global' });
  const list = readShared();
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((s) => s.title).sort(), ['First note', 'Second note']);
});

test('removing by title deletes exactly one entry', () => {
  removeSharedMemory('First note');
  const list = readShared();
  assert.deepEqual(list.map((s) => s.title), ['Second note']);
});

test('invalid input is rejected rather than silently stored', () => {
  assert.throws(() => addSharedMemory({ title: '', body: 'x' }), /title/i);
  assert.throws(() => addSharedMemory({ title: 'x'.repeat(121), body: 'x' }), /120|title/i);
  assert.throws(() => addSharedMemory({ title: 'bad scope', body: 'x', scope: 'everywhere' }), /scope/i);
  assert.deepEqual(readShared().map((s) => s.title), ['Second note']);
});
