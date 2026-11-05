import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEdits } from '../patches/settings-compat/edits.mjs';

// Mirrors the real patch chain: edit 2's `to` is edit 3's `from`, which is exactly the case that
// used to duplicate an import line (and break the module with a duplicate ESM binding).
const EDITS = [
  { from: 'import { a } from "pkg";', to: 'import { a, b } from "./shim.mjs";' },
  { from: 'register(x)', to: 'registerCompat(x)' },
  { from: 'import { a, b } from "./shim.mjs";', to: 'import { a, b } from "./shim.mjs";\nimport { c } from "./typert.mjs";' }
];

test('applies every edit to pristine input', () => {
  const src = 'import { a } from "pkg";\nregister(x)\n';
  const { text, applied } = applyEdits(EDITS, src);
  assert.equal(applied, 3);
  assert.match(text, /from "\.\/shim\.mjs"/);
  assert.match(text, /registerCompat\(x\)/);
  assert.match(text, /typert\.mjs/);
});

test('is idempotent: a second pass changes nothing', () => {
  const src = 'import { a } from "pkg";\nregister(x)\n';
  const once = applyEdits(EDITS, src).text;
  const twice = applyEdits(EDITS, once);
  assert.equal(twice.applied, 0);
  assert.equal(twice.text, once);
});

test('does not duplicate the typert import when only that anchor exists', () => {
  const src = 'import { a, b } from "./shim.mjs";\nimport { c } from "./typert.mjs";\n';
  const { applied, text } = applyEdits(EDITS, src);
  assert.equal(applied, 0);
  assert.equal(text.match(/typert\.mjs/g).length, 1);
});

test('leaves unrelated text untouched', () => {
  const src = 'nothing to patch here\n';
  const { text, applied } = applyEdits(EDITS, src);
  assert.equal(applied, 0);
  assert.equal(text, src);
});
