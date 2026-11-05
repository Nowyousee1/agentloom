/**
 * Compatibility shim for the newer @deepseek-ai/dsh-settings API.
 *
 * The host ships 0.2.1-rc.5, which exports only { SettingsForms, SettingsConflictError,
 * redactSecrets }. Two installed plugins were built against a later API that also exports
 * `settingsNamespace()` and `installSettingsSection()`, plus a `ctx.settings.register()`
 * namespace method. Without them the whole plugin fails to import.
 *
 * This shim provides the missing surface on top of plain files:
 *  - `settingsNamespace(name)` -> the namespace string (the host treats it as an id)
 *  - `ctx.settings.register(ns, schema)` -> a scope with get/update/subscribe
 *  - `installSettingsSection(ctx, ns, Config, config, handlers)` -> resolves the config,
 *    calls setSource/onChange, and persists future updates under ~/.dsh/settings/<ns>.json
 *
 * Degradation is deliberate: the host's settings page cannot list these namespaces
 * (its SettingsForms predates registration), but the plugins run and their persisted
 * values survive restarts.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const SETTINGS_DIR = path.join(DSH_HOME, 'settings');

function safeName(ns) {
  return String(ns).replace(/[^a-zA-Z0-9._-]/g, '_');
}

function load(ns) {
  try {
    return JSON.parse(fs.readFileSync(path.join(SETTINGS_DIR, `${safeName(ns)}.json`), 'utf8'));
  } catch {
    return {};
  }
}

function save(ns, value) {
  try {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    fs.writeFileSync(path.join(SETTINGS_DIR, `${safeName(ns)}.json`), JSON.stringify(value, null, 2) + '\n', 'utf8');
  } catch {
    // Persistence is best effort; the in-memory value still works.
  }
}

/** Resolve schemastery defaults for an empty value, tolerating plain objects. */
function defaultsOf(schema, seed) {
  try {
    const resolved = typeof schema === 'function' ? schema(seed ?? {}) : undefined;
    if (resolved && typeof resolved === 'object') return resolved;
  } catch {
    // fall through to the seed
  }
  return seed && typeof seed === 'object' ? seed : {};
}

/** Branded namespace name. The host only needs a stable id. */
export function settingsNamespace(name) {
  return String(name);
}

/** Minimal SettingsScope: get / update / subscribe. */
export function createSettingsScope(ns, schema) {
  const base = defaultsOf(schema);
  let value = { ...base, ...load(ns) };
  const listeners = new Set();
  return {
    get: () => ({ ...value }),
    async update(patch) {
      value = { ...value, ...(patch ?? {}) };
      save(ns, value);
      for (const listener of listeners) {
        try {
          listener({ ...value });
        } catch {}
      }
      return { ...value };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}

/** Replacement for ctx.settings.register(ns, schema, options). */
export function registerSettingsNamespace(ctx, ns, schema) {
  return createSettingsScope(ns, schema);
}

/**
 * Replacement for installSettingsSection(ctx, ns, Config, config, handlers).
 *
 * Two consumers exist in the wild:
 *  - getter style: `setSource((source) => { current = source })` then `current()`
 *    (what @harleendance/dsh-skill-evolution does)
 *  - value style: `setSource(source)` and read `source.enabled` directly
 * A callable object carrying the config fields satisfies both: `source()` returns the
 * resolved object and `source.field` reads the same value.
 */
export function installSettingsSection(ctx, ns, Config, config, handlers = {}) {
  const scope = createSettingsScope(ns, Config);
  const resolved = { ...defaultsOf(Config, config), ...(config ?? {}), ...scope.get() };
  const source = () => resolved;
  Object.assign(source, resolved);
  try {
    handlers.setSource?.(source);
  } catch (error) {
    ctx?.logger?.warn?.(`[settings-compat] setSource failed for ${ns}: ${error?.message ?? error}`);
  }
  try {
    handlers.onChange?.(resolved);
  } catch (error) {
    ctx?.logger?.warn?.(`[settings-compat] onChange failed for ${ns}: ${error?.message ?? error}`);
  }
  return () => {};
}
