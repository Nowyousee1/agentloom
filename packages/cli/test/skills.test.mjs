import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The CLI resolves its hub from AGENT_LOOM_HOME at import time, so point it at a scratch dir
// before importing anything that derives paths from it.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-skills-'));
process.env.AGENT_LOOM_HOME = tmp;

const { splitFrontmatter, renderSkillMarkdown, validateSkill, scaffoldSkill, SKILL_NAME_RE } = await import(
  '../src/skills.mjs'
);

test('splitFrontmatter separates YAML head from body', () => {
  const { data, body } = splitFrontmatter('---\nname: demo\ndescription: "a demo"\n---\n\n# Title\n\nbody\n');
  assert.equal(data.name, 'demo');
  assert.equal(data.description, 'a demo');
  assert.match(body, /# Title/);
  assert.doesNotMatch(body, /^---/);
});

test('splitFrontmatter tolerates a file with no frontmatter', () => {
  const { data, body } = splitFrontmatter('# Just markdown\n');
  assert.deepEqual(data, {});
  assert.match(body, /Just markdown/);
});

test('renderSkillMarkdown appends only the matching variant overlay', () => {
  const dir = path.join(tmp, 'skills', 'demo');
  fs.mkdirSync(path.join(dir, 'variants'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'variants', 'dsh.md'), 'DSH-ONLY-MARKER\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'variants', 'codex.md'), 'CODEX-ONLY-MARKER\n', 'utf8');
  const skill = {
    name: 'demo',
    dir,
    meta: { name: 'demo', description: 'demo skill' },
    core: '# demo\n\nshared core\n'
  };
  const dsh = renderSkillMarkdown(skill, 'dsh');
  assert.match(dsh, /^---\nname: demo\n/);
  assert.match(dsh, /shared core/);
  assert.match(dsh, /DSH-ONLY-MARKER/);
  assert.doesNotMatch(dsh, /CODEX-ONLY-MARKER/);
  assert.match(dsh, /agentloom:variant target=dsh/);

  const codex = renderSkillMarkdown(skill, 'codex');
  assert.match(codex, /CODEX-ONLY-MARKER/);
  assert.doesNotMatch(codex, /DSH-ONLY-MARKER/);
});

test('validateSkill reports a missing description and empty core', () => {
  const problems = validateSkill({ name: 'demo', meta: {}, core: '  ' });
  assert.ok(problems.some((p) => p.includes('description')));
  assert.ok(problems.some((p) => p.includes('core')));
  assert.deepEqual(validateSkill({ name: 'demo', meta: { description: 'x' }, core: 'body' }), []);
});

test('scaffoldSkill writes a skill and refuses a duplicate', () => {
  const { dir, meta } = scaffoldSkill({ name: 'scaffolded', description: 'from test' });
  assert.ok(fs.existsSync(path.join(dir, 'core', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(dir, 'variants', 'dsh.md')));
  assert.equal(meta.name, 'scaffolded');
  assert.throws(() => scaffoldSkill({ name: 'scaffolded', description: 'again' }), /已存在/);
});

test('skill names must be kebab-case', () => {
  assert.ok(SKILL_NAME_RE.test('demo-skill'));
  assert.ok(!SKILL_NAME_RE.test('Demo Skill'));
  assert.throws(() => scaffoldSkill({ name: 'Bad Name', description: 'x' }), /kebab-case/);
});
