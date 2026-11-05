/**
 * Pure text-edit engine shared by `apply.mjs` and its tests.
 *
 * Apply edits in order, each one only when its anchor is present and its result is not.
 * The `to` guard is what makes this idempotent: one edit's `to` is another edit's `from`
 * (the rewritten import line), so without it a second run would duplicate the typert
 * import line and break the module with a duplicate ESM binding.
 */
export function applyEdits(edits, input) {
  let text = input;
  let applied = 0;
  for (const edit of edits) {
    if (edit.from === edit.to) continue;
    if (!text.includes(edit.from)) continue;
    if (text.includes(edit.to)) continue;
    text = text.replace(edit.from, edit.to);
    applied += 1;
  }
  return { text, applied };
}
