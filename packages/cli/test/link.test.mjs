import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-link-'));
process.env.AGENT_LOOM_HOME = tmp;

const { linkDshSkills, linkStatus, isDanglingLink } = await import('../src/link.mjs');

const SKILLS_DIR = path.join(tmp, 'dsh-skills');
const BUILD_DSH = path.join(tmp, 'build', 'skills', 'dsh');
const cfg = { targets: { dsh: { skillsDir: SKILLS_DIR } } };

function render(name) {
  const dir = path.join(BUILD_DSH, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: test\n---\nbody\n`, 'utf8');
}

test('links a rendered skill into the DSH skills dir', () => {
  render('alpha');
  const results = linkDshSkills(cfg);
  assert.deepEqual(results.map((r) => r.action), ['linked']);
  const [status] = linkStatus(cfg);
  assert.equal(status.correct, true);
  assert.equal(status.managed, true);
});

test('a second run is a no-op', () => {
  const results = linkDshSkills(cfg);
  assert.deepEqual(results.map((r) => r.action), ['unchanged']);
});

test('a link whose target disappeared is reported as dangling', () => {
  const linkPath = path.join(SKILLS_DIR, 'alpha');
  fs.rmSync(path.join(BUILD_DSH, 'alpha'), { recursive: true, force: true });
  assert.equal(isDanglingLink(linkPath), true);
});

test('a full pass prunes links whose skill is gone', () => {
  const results = linkDshSkills(cfg);
  assert.ok((results.pruned ?? []).includes('alpha'));
  assert.equal(fs.existsSync(path.join(SKILLS_DIR, 'alpha')), false);
});

test('a real directory with the same name is never taken over', () => {
  render('beta');
  const real = path.join(SKILLS_DIR, 'beta');
  fs.mkdirSync(real, { recursive: true });
  fs.writeFileSync(path.join(real, 'SKILL.md'), 'hand written\n', 'utf8');
  const results = linkDshSkills(cfg);
  const beta = results.find((r) => r.name === 'beta');
  assert.equal(beta.action, 'skipped');
  assert.match(beta.reason, /真实目录/);
  assert.equal(fs.readFileSync(path.join(real, 'SKILL.md'), 'utf8'), 'hand written\n');
});
