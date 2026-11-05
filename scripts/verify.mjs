#!/usr/bin/env node
/**
 * Release gate that runs locally and in CI: everything a stranger would check before trusting this
 * repository, minus the things that need a real DeepSeek Harness or Codex install.
 *
 *   node scripts/verify.mjs
 *
 * Checks:
 *   1. every version agrees (delegates to scripts/version.mjs)
 *   2. every .mjs / .js file parses (`node --check`)
 *   3. the npm tarballs contain the files the README promises, and no junk
 *   4. the repository ships the files a mature open-source project is expected to have
 *   5. relative links in README/docs point at files that exist
 *
 * Exit code 0 means "safe to tag". No dependencies, no network.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const checks = [];
const note = (ok, label, detail = '') => checks.push({ ok, label, detail });
const fail = (label, detail) => problems.push(`${label}${detail ? `: ${detail}` : ''}`);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'build') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// 1. versions --------------------------------------------------------------------------------------
try {
  const output = execFileSync(process.execPath, [path.join(root, 'scripts', 'version.mjs')], {
    cwd: root,
    encoding: 'utf8'
  });
  note(true, 'versions', output.trim().split('\n').pop());
} catch (err) {
  note(false, 'versions', 'disagree');
  fail('version', String(err.stdout || err.message).trim());
}

// 2. syntax ----------------------------------------------------------------------------------------
const sources = walk(root).filter((f) => f.endsWith('.mjs') || (f.endsWith('.js') && f.includes(`${path.sep}packages${path.sep}`)));
let syntaxBad = 0;
for (const file of sources) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    syntaxBad++;
    fail('syntax', `${path.relative(root, file)}: ${String(err.stderr || err.message).trim().split('\n')[0]}`);
  }
}
note(syntaxBad === 0, 'syntax', `${sources.length} files`);

// 3. package contents ------------------------------------------------------------------------------
const requiredInCli = ['bin/agentloom.mjs', 'src/config.mjs', 'mcp/server.mjs', 'patches/settings-compat/apply.mjs', 'seeds'];
const requiredInPlugin = ['index.js', 'cordis.patch.yml', 'locale/en.json', 'icon.svg'];

function packList(dir) {
  // npm is a .cmd shim on Windows, which Node only runs through a shell. Passing the whole command
  // as one string avoids DEP0190 (args + shell:true is ambiguous about escaping).
  const cmd = 'npm pack --dry-run --json --ignore-scripts';
  const raw =
    process.platform === 'win32'
      ? execSync(cmd, { cwd: dir, encoding: 'utf8' })
      : execFileSync('npm', cmd.split(' ').slice(1), { cwd: dir, encoding: 'utf8' });
  const parsed = JSON.parse(raw.slice(raw.indexOf('[')));
  return parsed[0]?.files?.map((f) => f.path.replace(/\\/g, '/')) ?? [];
}

for (const [dir, required] of [
  ['packages/cli', requiredInCli],
  ['packages/dsh-plugin', requiredInPlugin]
]) {
  const abs = path.join(root, dir);
  try {
    const files = packList(abs);
    const missing = required.filter((r) => !files.some((f) => f === r || f.startsWith(`${r}/`)));
    const junk = files.filter((f) => f.includes('node_modules/') || f.endsWith('.log'));
    if (missing.length) fail(`pack ${dir}`, `missing ${missing.join(', ')}`);
    if (junk.length) fail(`pack ${dir}`, `unexpected ${junk.slice(0, 3).join(', ')}`);
    if (!files.includes('LICENSE')) fail(`pack ${dir}`, 'LICENSE is not in the tarball');
    note(missing.length === 0 && junk.length === 0, `pack ${dir}`, `${files.length} files`);
  } catch (err) {
    note(false, `pack ${dir}`, 'npm pack failed');
    fail(`pack ${dir}`, String(err.stderr || err.message).trim().split('\n')[0]);
  }
}

// 4. repository files ------------------------------------------------------------------------------
const expected = [
  'README.md',
  'README.zh-CN.md',
  'LICENSE',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'SECURITY.md',
  'package.json',
  '.editorconfig',
  '.gitattributes',
  '.gitignore',
  '.nvmrc',
  '.github/workflows/ci.yml',
  '.github/workflows/release.yml',
  '.github/ISSUE_TEMPLATE/bug_report.yml',
  '.github/PULL_REQUEST_TEMPLATE.md',
  'docs/ARCHITECTURE.md',
  'docs/COMPATIBILITY.md',
  'docs/FAQ.md',
  'docs/PUBLISHING.md'
];
const missingRepo = expected.filter((f) => !fs.existsSync(path.join(root, f)));
for (const f of missingRepo) fail('repo file', f);
note(missingRepo.length === 0, 'repo files', `${expected.length} expected`);

// 5. documentation links ---------------------------------------------------------------------------
const docs = ['README.md', 'README.zh-CN.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md', 'CHANGELOG.md']
  .map((f) => path.join(root, f))
  .concat(fs.existsSync(path.join(root, 'docs')) ? walk(path.join(root, 'docs')).filter((f) => f.endsWith('.md')) : []);
const linkRe = /\[[^\]]*\]\(([^)]+)\)/g;
let brokenLinks = 0;
for (const file of docs) {
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(linkRe)) {
    const target = match[1].trim();
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const clean = target.split('#')[0];
    if (!clean) continue;
    const resolved = path.resolve(path.dirname(file), decodeURI(clean));
    if (!fs.existsSync(resolved)) {
      brokenLinks++;
      fail('doc link', `${path.relative(root, file)} → ${target}`);
    }
  }
}
note(brokenLinks === 0, 'doc links', `${docs.length} documents`);

// report -------------------------------------------------------------------------------------------
for (const c of checks) console.log(`${c.ok ? '✓' : '✖'} ${c.label}${c.detail ? `  ${c.detail}` : ''}`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('\n✓ repository is ready to release');
