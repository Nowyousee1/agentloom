#!/usr/bin/env node
/**
 * Apply the settings-compat patch to plugins built against a newer @deepseek-ai/dsh-settings
 * than the installed host provides. Idempotent: re-running it is a no-op once patched.
 *
 * The plugin packages live in the DSH profile's node_modules (managed by pnpm). Reinstall or
 * upgrade of those packages reverts the patch, so re-run this script afterwards:
 *
 *   node agentloom/patches/settings-compat/apply.mjs [--check]
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { applyEdits } from './edits.mjs';

const PROFILE_DIR =
  process.env.DSH_PROFILE_DIR || path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'profiles', 'desktop');
const MODULES = path.join(PROFILE_DIR, 'node_modules');
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const CHECK = process.argv.includes('--check');

const TARGETS = [
  {
    label: 'dsh-at-file',
    lib: path.join(MODULES, 'dsh-at-file', 'lib'),
    file: 'index.js',
    shims: ['settings-compat.mjs', 'typert-compat.mjs'],
    edits: [
      {
        from: 'import { settingsNamespace } from "@deepseek-ai/dsh-settings";',
        to: 'import { settingsNamespace, registerSettingsNamespace } from "./settings-compat.mjs";'
      },
      {
        from: 'return ctx.settings.register(AT_FILE_NAMESPACE, AtFileSettingsSchema, { applies: "live" });',
        to: 'return registerSettingsNamespace(ctx, AT_FILE_NAMESPACE, AtFileSettingsSchema);'
      },
      {
        from: 'import { settingsNamespace, registerSettingsNamespace } from "./settings-compat.mjs";',
        to: 'import { settingsNamespace, registerSettingsNamespace } from "./settings-compat.mjs";\nimport { normalizeTypertContribution } from "./typert-compat.mjs";'
      },
      {
        from: 'const dispose = ctx.typert.register(TYPERT_MANIFEST);',
        to: 'const dispose = ctx.typert.register(normalizeTypertContribution(TYPERT_MANIFEST));'
      }
    ]
  },
  {
    label: '@harleendance/dsh-skill-evolution',
    lib: path.join(MODULES, '@harleendance', 'dsh-skill-evolution', 'lib'),
    file: 'index.js',
    shims: ['settings-compat.mjs'],
    edits: [
      {
        from: 'import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";',
        to: 'import { installSettingsSection, settingsNamespace } from "./settings-compat.mjs";'
      }
    ]
  }
];

const shimDir = HERE;
if (!fs.existsSync(path.join(shimDir, 'settings-compat.mjs'))) {
  console.error(`✖ shim missing: ${path.join(shimDir, 'settings-compat.mjs')}`);
  process.exit(1);
}

function copyShims(target) {
  let copied = 0;
  for (const name of target.shims ?? ['settings-compat.mjs']) {
    const source = path.join(shimDir, name);
    const dest = path.join(target.lib, name);
    if (!fs.existsSync(source)) {
      console.error(`✖ shim missing: ${source}`);
      continue;
    }
    const current = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : undefined;
    const wanted = fs.readFileSync(source, 'utf8');
    if (current === wanted) continue;
    if (!CHECK) fs.writeFileSync(dest, wanted, 'utf8');
    copied += 1;
  }
  return copied;
}

let changed = 0;
let failed = 0;

for (const target of TARGETS) {
  const file = path.join(target.lib, target.file);
  if (!fs.existsSync(file)) {
    console.log(`- ${target.label}: not installed (${file})`);
    continue;
  }
  const source = fs.readFileSync(file, 'utf8');
  const { text: patched, applied } = applyEdits(target.edits, source);
  const already = patched === source;

  if (already) {
    if (CHECK) {
      const stale = (target.shims ?? []).filter((name) => {
        const dest = path.join(target.lib, name);
        return !fs.existsSync(dest) || fs.readFileSync(dest, 'utf8') !== fs.readFileSync(path.join(shimDir, name), 'utf8');
      });
      if (stale.length > 0) {
        console.log(`! ${target.label}: patched but shim stale (${stale.join(', ')})`);
        failed += 1;
      } else {
        console.log(`= ${target.label}: already patched`);
      }
      continue;
    }
    const copied = copyShims(target);
    if (copied > 0) {
      changed += 1;
      console.log(`+ ${target.label}: shim refreshed`);
    } else {
      console.log(`= ${target.label}: already patched`);
    }
    continue;
  }
  if (CHECK) {
    console.log(`! ${target.label}: needs patch (${applied} edit(s))`);
    failed += 1;
    continue;
  }
  const backup = `${file}.bak-settings-compat`;
  if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
  fs.writeFileSync(file, patched, 'utf8');
  copyShims(target);
  changed += 1;
  console.log(`+ ${target.label}: patched (${applied} edit(s), backup ${path.basename(backup)})`);
}

if (CHECK && failed > 0) process.exitCode = 1;
console.log(changed ? `\n✓ ${changed} package(s) updated — reload the plugin row to take effect` : '\n✓ nothing to do');
