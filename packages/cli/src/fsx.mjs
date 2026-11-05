import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

export function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

export function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

export function readText(p) {
  return fs.readFileSync(p, 'utf8');
}

export function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    if (fallback !== undefined) return fallback;
    throw new Error(`cannot read JSON ${p}: ${err.message}`);
  }
}

export function writeText(p, text) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, text, 'utf8');
  return p;
}

export function writeJson(p, value) {
  return writeText(p, JSON.stringify(value, null, 2) + '\n');
}

export function listDirs(p) {
  if (!exists(p)) return [];
  return fs
    .readdirSync(p, { withFileTypes: true })
    .filter((d) => d.isDirectory() || d.isSymbolicLink())
    .map((d) => d.name)
    .sort();
}

export function listFiles(p, filter = () => true) {
  if (!exists(p)) return [];
  return fs
    .readdirSync(p, { withFileTypes: true })
    .filter((d) => d.isFile() && filter(d.name))
    .map((d) => d.name)
    .sort();
}

export function copyDir(src, dst) {
  if (!exists(src)) return;
  fs.cpSync(src, dst, { recursive: true, force: true });
}

export function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

export function sha1(text) {
  return createHash('sha1').update(text).digest('hex');
}

/** True when p is a symlink / Windows junction / any reparse point. */
export function isLink(p) {
  try {
    if (fs.lstatSync(p).isSymbolicLink()) return true;
    // Junction detection on Windows: lstat reports those as symlinks too, so this is only a
    // fallback for exotic reparse points. Never apply the realpath comparison on POSIX:
    // macOS resolves /var/... to /private/var/..., which would flag real directories as links.
    if (process.platform !== 'win32') return false;
    const real = fs.realpathSync(p);
    return path.resolve(real).toLowerCase() !== path.resolve(p).toLowerCase();
  } catch {
    return false;
  }
}

/** Real path when it exists, otherwise the lexically resolved path. */
export function realOrResolved(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/** Compare two paths the way the filesystem does (case-insensitive on Windows, symlink-aware). */
export function samePath(a, b) {
  if (!a || !b) return false;
  const norm = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
  return norm(realOrResolved(a)) === norm(realOrResolved(b));
}

/** True when child is inside parent (or equal to it), following symlinks when they resolve. */
export function isUnder(child, parent) {
  if (!child || !parent) return false;
  const norm = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
  const c = norm(realOrResolved(child));
  const p = norm(realOrResolved(parent));
  return c === p || c.startsWith(p + path.sep);
}

export function linkTarget(p) {
  try {
    return path.resolve(fs.realpathSync(p));
  } catch {
    // A dangling link cannot be realpath'd, but readlink still reports where it pointed.
    try {
      return path.resolve(path.dirname(p), fs.readlinkSync(p));
    } catch {
      return null;
    }
  }
}
