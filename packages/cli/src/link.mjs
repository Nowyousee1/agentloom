import fs from 'node:fs';
import path from 'node:path';
import * as X from './fsx.mjs';
import { BUILD_DIR, codexSkillsDir, dshSkillsDir, loadState, saveState } from './config.mjs';

export function assertWritable(target, cfg) {
  const abs = path.resolve(target).toLowerCase();
  const codexHome = path.resolve(codexSkillsDir(cfg)).toLowerCase();
  const guard = path.dirname(codexHome); // ~/.codex
  if (abs === guard || abs.startsWith(guard + path.sep)) {
    throw new Error(`拒绝写入 Codex 目录（按你的要求 ~/.codex 保持只读）: ${target}`);
  }
}

export function removeJunction(linkPath) {
  // rmdirSync removes the reparse point itself and never recurses into the target.
  // It refuses a real non-empty directory, which is the safety net we want.
  if (process.platform === 'win32') {
    try {
      fs.rmdirSync(linkPath);
      return true;
    } catch (err) {
      throw new Error(`删除链接失败: ${err.message}`);
    }
  }
  fs.unlinkSync(linkPath);
  return true;
}

export function createJunction(linkPath, targetPath) {
  // 'junction' works without admin rights on Windows and behaves like a real directory.
  fs.symlinkSync(targetPath, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
  return true;
}

/**
 * True for a link whose target no longer exists (a renamed hub directory leaves those behind).
 * Windows reports a dangling junction as existing, so compare the link target instead of the
 * link itself: fs.exists() on the link is not enough.
 */
export function isDanglingLink(p) {
  if (!X.isLink(p)) return false;
  const target = X.linkTarget(p);
  return !target || !X.exists(target);
}

/**
 * Point ~/.dsh/skills/<name> at build/skills/dsh/<name>.
 * Never touches a real (non-link) directory it did not create, and never writes into ~/.codex.
 */
export function linkDshSkills(cfg, names, opts = {}) {
  const root = dshSkillsDir(cfg);
  assertWritable(root, cfg);
  X.ensureDir(root);
  const state = loadState();
  state.links = state.links || {};
  state.links.dsh = state.links.dsh || {};
  const managed = state.links.dsh;
  const results = [];
  const skillsRoot = path.join(BUILD_DIR, 'skills', 'dsh');
  const wanted = names && names.length
    ? names
    : X.listDirs(skillsRoot).filter((name) => X.isFile(path.join(skillsRoot, name, 'SKILL.md')));

  for (const name of wanted) {
    const target = path.join(skillsRoot, name);
    const linkPath = path.join(root, name);
    if (!X.exists(target)) {
      results.push({ name, action: 'skipped', reason: `渲染产物不存在: ${target}` });
      continue;
    }
    const owned = Boolean(managed[name]);
    if (X.exists(linkPath)) {
      const isLink = X.isLink(linkPath);
      if (isLink) {
        const current = X.linkTarget(linkPath);
        if (current && path.resolve(current).toLowerCase() === path.resolve(target).toLowerCase()) {
          results.push({ name, action: 'unchanged' });
          managed[name] = { ...(managed[name] || {}), target };
          continue;
        }
        if (!owned && opts.force !== true) {
          results.push({
            name,
            action: 'skipped',
            reason: '已存在指向别处的链接且不由 hub 管理（加 --force 覆盖）'
          });
          continue;
        }
        removeJunction(linkPath);
      } else {
        results.push({ name, action: 'skipped', reason: '同名真实目录已存在，不接管' });
        continue;
      }
    } else if (isDanglingLink(linkPath)) {
      // Left over from a moved/renamed hub directory: the link is ours but its target is gone.
      if (!owned && opts.force !== true) {
        results.push({
          name,
          action: 'skipped',
          reason: '存在失效链接且不由 hub 管理（加 --force 覆盖）'
        });
        continue;
      }
      removeJunction(linkPath);
    }
    createJunction(linkPath, target);
    managed[name] = { target, linkedAt: new Date().toISOString() };
    results.push({ name, action: 'linked' });
  }
  saveState(state);

  // A full pass also forgets links whose skill no longer renders (renamed or deleted). Only links we
  // created are touched, and only when they point into build/skills/dsh or are already dangling.
  if (!names || !names.length) {
    const pruned = [];
    for (const name of Object.keys(managed)) {
      if (wanted.includes(name)) continue;
      const linkPath = path.join(root, name);
      if (!X.exists(linkPath) && !X.isLink(linkPath)) {
        delete managed[name];
        continue;
      }
      if (!X.isLink(linkPath)) continue;
      if (X.exists(linkPath)) {
        const target = (X.linkTarget(linkPath) || '').toLowerCase();
        if (!target.startsWith(path.resolve(skillsRoot).toLowerCase())) continue;
      }
      removeJunction(linkPath);
      delete managed[name];
      pruned.push(name);
    }
    if (pruned.length) saveState(state);
    results.pruned = pruned;

    // Also sweep links nobody tracks any more (state lost, or an old skill name): a link is ours
    // when its target lives under build/skills/dsh, so it is safe to drop when that skill is gone.
    const swept = [];
    for (const name of X.listDirs(root)) {
      if (wanted.includes(name)) continue;
      const linkPath = path.join(root, name);
      if (!X.isLink(linkPath)) continue;
      const target = (X.linkTarget(linkPath) || '').toLowerCase();
      if (!target.startsWith(path.resolve(skillsRoot).toLowerCase())) continue;
      if (X.exists(linkPath) && X.exists(target)) continue; // still a live render, not ours to drop
      removeJunction(linkPath);
      delete managed[name];
      swept.push(name);
    }
    if (swept.length) {
      saveState(state);
      results.pruned = [...(results.pruned ?? []), ...swept];
    }
  }
  return results;
}

export function unlinkDshSkills(cfg, names) {
  const root = dshSkillsDir(cfg);
  const state = loadState();
  const managed = state.links?.dsh ?? {};
  const results = [];
  for (const name of names) {
    const linkPath = path.join(root, name);
    if (!managed[name]) {
      results.push({ name, action: 'skipped', reason: '不由 hub 管理' });
      continue;
    }
    if (!X.exists(linkPath)) {
      delete managed[name];
      results.push({ name, action: 'missing' });
      continue;
    }
    if (!X.isLink(linkPath)) {
      results.push({ name, action: 'skipped', reason: '已不是链接（可能被人改过），保留' });
      continue;
    }
    removeJunction(linkPath);
    delete managed[name];
    results.push({ name, action: 'unlinked' });
  }
  state.links = state.links || {};
  state.links.dsh = managed;
  saveState(state);
  return results;
}

export function linkStatus(cfg) {
  const root = dshSkillsDir(cfg);
  const state = loadState();
  const managed = state.links?.dsh ?? {};
  const skillsRoot = path.join(BUILD_DIR, 'skills', 'dsh');
  const rendered = X.listDirs(skillsRoot);
  return rendered.map((name) => {
    const linkPath = path.join(root, name);
    const target = path.join(skillsRoot, name);
    return {
      name,
      linkPath,
      target,
      exists: X.exists(linkPath),
      isLink: X.exists(linkPath) ? X.isLink(linkPath) : false,
      correct:
        X.exists(linkPath) &&
        X.isLink(linkPath) &&
        (X.linkTarget(linkPath) || '').toLowerCase() === path.resolve(target).toLowerCase(),
      managed: Boolean(managed[name])
    };
  });
}
