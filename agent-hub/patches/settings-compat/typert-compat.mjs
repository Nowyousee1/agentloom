/**
 * Compatibility shim for the Typert invocation manifest shape.
 *
 * The host's registry validates every invocation codec with:
 *     validateCodec(codec) -> requires codec.typeSymbol and typeof codec.create === "function"
 * (see @deepseek-ai/dsh-typert-registry lib/index.js `validateCodec`).
 *
 * dsh-at-file 0.6.3 was generated with an older manifest dialect that carries the
 * Zod schema directly on the codec object (`{ mode, typeSymbol, schema }`) and has
 * no `create()` factory, so `ctx.typert.register()` throws:
 *     typert: dsh-at-file#atFile/search result strict codec has no create() factory
 *
 * `normalizeTypertContribution` deep-copies the contribution and adds the factory
 * (plus identity decode/encode when absent) to every codec position the registry
 * validates: invocation result, parameter codecs, uplink codecs and Context codecs.
 * Nothing else about the manifest is changed, so behaviour stays identical once the
 * registry materialises the Zod schema through create().
 */

const CODEC_KEYS = ['result', 'codec'];

function normalizeCodec(codec) {
  if (codec === null || typeof codec !== 'object') return codec;
  if (codec.mode === 'src-json') return codec;
  if (typeof codec.create === 'function') return codec;
  const schema = codec.schema;
  if (schema === undefined) return codec;
  return {
    ...codec,
    create: () => schema,
    ...(typeof codec.decode === 'function' ? {} : { decode: (value) => value }),
    ...(typeof codec.encode === 'function' ? {} : { encode: (value) => value })
  };
}

function normalizeInvocation(descriptor) {
  if (descriptor === null || typeof descriptor !== 'object') return descriptor;
  const next = { ...descriptor };
  if ('result' in next) next.result = normalizeCodec(next.result);
  if (Array.isArray(next.parameters)) {
    next.parameters = next.parameters.map((parameter) => (
      parameter && typeof parameter === 'object' && 'codec' in parameter
        ? { ...parameter, codec: normalizeCodec(parameter.codec) }
        : parameter
    ));
  }
  if (next.uplink && typeof next.uplink === 'object') {
    next.uplink = { ...next.uplink, codec: normalizeCodec(next.uplink.codec) };
  }
  if (next.invocation && typeof next.invocation === 'object' && 'codec' in next.invocation) {
    next.invocation = { ...next.invocation, codec: normalizeCodec(next.invocation.codec) };
  }
  return next;
}

/** Normalize one `ctx.typert.register(contribution)` argument. */
export function normalizeTypertContribution(contribution) {
  if (contribution === null || typeof contribution !== 'object') return contribution;
  const invocations = Array.isArray(contribution.invocations)
    ? contribution.invocations.map(normalizeInvocation)
    : contribution.invocations;
  return { ...contribution, invocations, ...('schemas' in contribution ? { schemas: contribution.schemas } : {}) };
}

export { CODEC_KEYS };
