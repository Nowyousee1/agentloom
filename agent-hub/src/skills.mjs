import fs from 'node:fs';
import path from 'node:path';
import * as X from './fsx.mjs';
import { BUILD_DIR, SKILLS_SRC } from './config.mjs';

export const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

function oneLine(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

/** Split YAML frontmatter from a SKILL.md. Keeps the body verbatim. */
export function splitFrontmatter(text) {
  const src = String(text ?? '').replace(/^\uFEFF/, '');
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
  if (!m) return { data: {}, body: src };
  const data = {};
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
      if (key && value.includes('\\n')) value = value.replace(/\\n/g, '\n');
    }
    data[key] = value;
  }
  return { data, body: src.slice(m[0].length) };
}

export function listSkills() {
  if (!X.exists(SKILLS_SRC)) return [];
  const out = [];
  for (const name of X.listDirs(SKILLS_SRC)) {
    const dir = path.join(SKILLS_SRC, name);
    const metaPath = path.join(dir, 'skill.json');
    if (!X.isFile(metaPath)) continue;
    const meta = X.readJson(metaPath, null);
    if (!meta) continue;
    out.push({ name: meta.name || name, dir, meta });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function loadSkill(name) {
  const dir = path.join(SKILLS_SRC, name);
  const metaPath = path.join(dir, 'skill.json');
  if (!X.isFile(metaPath)) throw new Error(`技能不存在: ${name} (${dir})`);
  const meta = X.readJson(metaPath);
  const corePath = path.join(dir, 'core', 'SKILL.md');
  const core = X.isFile(corePath) ? X.readText(corePath) : '';
  return { name: meta.name || name, dir, meta, core };
}

function variantBody(dir, target) {
  const p = path.join(dir, 'variants', `${target}.md`);
  if (!X.isFile(p)) return '';
  const { body } = splitFrontmatter(X.readText(p));
  return body.trim();
}

/** Full source view of one skill: core body + every per-target overlay (used by the MCP server). */
export function readSkillSource(name) {
  if (!SKILL_NAME_RE.test(String(name ?? ''))) return null;
  const dir = path.join(SKILLS_SRC, name);
  if (!X.isFile(path.join(dir, 'skill.json'))) return null;
  const skill = loadSkill(name);
  const variants = {};
  for (const target of ['dsh', 'codex']) {
    const body = variantBody(dir, target);
    if (body) variants[target] = body;
  }
  return { name: skill.name, meta: skill.meta, core: splitFrontmatter(skill.core).body.trim(), variants };
}

export function targetsOf(meta) {
  const t = meta.targets;
  if (Array.isArray(t) && t.length) return t.filter((x) => x === 'dsh' || x === 'codex');
  return ['dsh', 'codex'];
}

/** Render the SKILL.md for one target: shared core + that target's overlay. */
export function renderSkillMarkdown(skill, target) {
  const description = oneLine(skill.meta.description);
  if (!description) throw new Error(`技能 ${skill.name} 缺少 description`);
  const core = splitFrontmatter(skill.core).body.trim();
  const variant = variantBody(skill.dir, target);
  const parts = [`---`, `name: ${skill.name}`, `description: ${JSON.stringify(description)}`, `---`, '', core];
  if (variant) {
    parts.push('', `<!-- agent-hub:variant target=${target} -->`, '', variant);
  }
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function copySkillAssets(skill, dst) {
  X.copyDir(path.join(skill.dir, 'resources'), path.join(dst, 'resources'));
  for (const f of X.listFiles(skill.dir, (n) => n.endsWith('.svg') || n.endsWith('.png'))) {
    X.copyDir(path.join(skill.dir, f), path.join(dst, f));
  }
}

export function renderAll(cfg) {
  const skills = listSkills();
  const written = [];
  const targets = new Set();
  for (const skill of skills) {
    const full = { ...skill, core: X.isFile(path.join(skill.dir, 'core', 'SKILL.md'))
      ? X.readText(path.join(skill.dir, 'core', 'SKILL.md'))
      : '' };
    for (const target of targetsOf(skill.meta)) {
      targets.add(target);
      const dst = path.join(BUILD_DIR, 'skills', target, skill.name);
      // Render in place: the DSH host may hold a handle on this directory (it is a junction
      // target), so delete-then-recreate can fail with EPERM. Overwriting files is safe.
      X.ensureDir(dst);
      const md = renderSkillMarkdown(full, target);
      X.writeText(path.join(dst, 'SKILL.md'), md);
      copySkillAssets(full, dst);
      pruneStale(dst);
      written.push({ target, name: skill.name, dir: dst });
    }
  }
  return { skills, written, targets: [...targets] };
}

/** Remove files a previous render produced that the current source no longer has. */
function pruneStale(dst) {
  const keep = new Set(['SKILL.md', 'resources']);
  for (const entry of fs.readdirSync(dst, { withFileTypes: true })) {
    if (keep.has(entry.name)) continue;
    if (entry.isFile() && (entry.name.endsWith('.svg') || entry.name.endsWith('.png'))) continue;
    try {
      fs.rmSync(path.join(dst, entry.name), { recursive: true, force: true });
    } catch {
      // Stale leftovers are harmless; the next render retries.
    }
  }
}

export function scaffoldSkill({ name, description, targets, tags }) {
  if (!SKILL_NAME_RE.test(name || '')) {
    throw new Error(`技能名必须是 kebab-case（a-z0-9-）: ${name}`);
  }
  const dir = path.join(SKILLS_SRC, name);
  if (X.exists(dir)) throw new Error(`技能已存在: ${dir}`);
  const meta = {
    name,
    description: oneLine(description) || `${name}（待补充描述）`,
    version: '0.1.0',
    targets: targets && targets.length ? targets : ['dsh', 'codex'],
    tags: tags ?? []
  };
  X.writeJson(path.join(dir, 'skill.json'), meta);
  X.writeText(
    path.join(dir, 'core', 'SKILL.md'),
    `# ${name}\n\n在这里写两端共用的内容：什么时候用、步骤、判定标准。\n\n` +
      `> 只写「两个 harness 都成立」的部分；与端相关的命令/工具名写进 variants/dsh.md 与 variants/codex.md。\n`
  );
  X.writeText(
    path.join(dir, 'variants', 'dsh.md'),
    `## DSH 侧注意\n\n- 可用工具：read / write / edit / pwsh / glob / grep / subagent……\n- 在这里写 DSH 专属的调用方式。\n`
  );
  X.writeText(
    path.join(dir, 'variants', 'codex.md'),
    `## Codex 侧注意\n\n- Codex 使用 shell / apply_patch 这组工具。\n- 在这里写 Codex 专属的调用方式。\n`
  );
  return { dir, meta };
}

/** Import an existing skill directory (from either side) into the hub as the shared core. */
export function adoptSkill(srcDir, opts = {}) {
  const abs = path.resolve(srcDir);
  const skillMd = path.join(abs, 'SKILL.md');
  if (!X.isFile(skillMd)) throw new Error(`不是技能目录（缺 SKILL.md）: ${abs}`);
  const { data, body } = splitFrontmatter(X.readText(skillMd));
  const name = opts.name || data.name || path.basename(abs);
  if (!SKILL_NAME_RE.test(name)) throw new Error(`技能名非法: ${name}`);
  const dir = path.join(SKILLS_SRC, name);
  if (X.exists(dir) && !opts.force) throw new Error(`技能已存在: ${dir}（加 --force 覆盖）`);
  X.rmrf(dir);
  X.writeJson(path.join(dir, 'skill.json'), {
    name,
    description: oneLine(opts.description || data.description || name),
    version: '0.1.0',
    targets: opts.targets && opts.targets.length ? opts.targets : ['dsh', 'codex'],
    tags: opts.tags ?? [],
    adoptedFrom: abs,
    adoptedAt: new Date().toISOString()
  });
  X.writeText(path.join(dir, 'core', 'SKILL.md'), body.trimEnd() + '\n');
  const variantDst = path.join(dir, 'variants');
  X.ensureDir(variantDst);
  X.writeText(path.join(variantDst, 'dsh.md'), `## DSH 侧注意\n\n（待补充 DSH 专属差异）\n`);
  X.writeText(path.join(variantDst, 'codex.md'), `## Codex 侧注意\n\n（待补充 Codex 专属差异）\n`);
  // Carry over everything else (scripts, references, assets) as resources.
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (['core', 'variants', 'resources'].includes(entry.name)) continue;
    X.copyDir(path.join(abs, entry.name), path.join(dir, 'resources', entry.name));
  }
  return { name, dir };
}

export function validateSkill(skill) {
  const problems = [];
  if (!SKILL_NAME_RE.test(skill.name)) problems.push(`name 非 kebab-case: ${skill.name}`);
  if (!oneLine(skill.meta.description)) problems.push('缺少 description');
  if (!String(skill.core ?? '').trim()) problems.push('core/SKILL.md 为空');
  return problems;
}
