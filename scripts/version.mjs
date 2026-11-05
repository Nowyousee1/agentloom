#!/usr/bin/env node
/**
 * One version, four places.
 *
 *   node scripts/version.mjs            # check: fail if anything disagrees with the root version
 *   node scripts/version.mjs --set 0.4.0  # write 0.4.0 everywhere
 *   node scripts/version.mjs --sync     # propagate the root version everywhere
 *
 * The generated Codex plugin carries its own version constant (`CODEX_PLUGIN_VERSION`) because it is
 * also the cache key Codex uses under ~/.codex/plugins/cache. It must move together with the npm
 * version, otherwise users keep running a stale plugin snapshot.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const write = (p, value) => fs.writeFileSync(p, JSON.stringify(value, null, 2) + '\n');

const rootPkgPath = path.join(root, 'package.json');
const packagePaths = [
  rootPkgPath,
  path.join(root, 'packages', 'cli', 'package.json'),
  path.join(root, 'packages', 'dsh-plugin', 'package.json')
];
const codexSrcPath = path.join(root, 'packages', 'cli', 'src', 'codex.mjs');
const VERSION_RE = /export const CODEX_PLUGIN_VERSION = '([^']+)';/;

function readCodexVersion() {
  const match = VERSION_RE.exec(fs.readFileSync(codexSrcPath, 'utf8'));
  if (!match) throw new Error(`cannot find CODEX_PLUGIN_VERSION in ${codexSrcPath}`);
  return match[1];
}

function setCodexVersion(version) {
  const current = fs.readFileSync(codexSrcPath, 'utf8');
  if (!VERSION_RE.test(current)) throw new Error(`cannot find CODEX_PLUGIN_VERSION in ${codexSrcPath}`);
  fs.writeFileSync(codexSrcPath, current.replace(VERSION_RE, `export const CODEX_PLUGIN_VERSION = '${version}';`));
}

function currentVersions() {
  return {
    'package.json': read(rootPkgPath).version,
    'packages/cli/package.json': read(packagePaths[1]).version,
    'packages/dsh-plugin/package.json': read(packagePaths[2]).version,
    'packages/cli/src/codex.mjs': readCodexVersion()
  };
}

function setAll(version) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`not a semver version: ${version}`);
  }
  for (const p of packagePaths) {
    const pkg = read(p);
    pkg.version = version;
    write(p, pkg);
  }
  setCodexVersion(version);
  console.log(`set every version to ${version}`);
}

const args = process.argv.slice(2);
const setIndex = args.indexOf('--set');

if (setIndex !== -1) {
  const value = args[setIndex + 1];
  if (!value) throw new Error('--set needs a version, e.g. --set 0.4.0');
  setAll(value);
} else if (args.includes('--sync')) {
  setAll(read(rootPkgPath).version);
} else {
  const versions = currentVersions();
  const unique = new Set(Object.values(versions));
  for (const [file, version] of Object.entries(versions)) {
    console.log(`${unique.size === 1 ? '✓' : '✖'} ${file}: ${version}`);
  }
  if (unique.size !== 1) {
    console.error('\nVersions disagree. Fix with: node scripts/version.mjs --sync');
    process.exit(1);
  }
  console.log(`\nall versions are ${[...unique][0]}`);
}
