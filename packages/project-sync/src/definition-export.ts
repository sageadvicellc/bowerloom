/**
 * The export bundle of one harness definition (0.8 spec, section 6.7). The bundle moved to `packages/harness-bundle`, which owns its format, its checks, and the bytes of
 * the file. These names stay here for the callers that already import them: the format string, the encoder (it answers the bundle file as bytes, with its summary), the
 * bundle after `decodeBundle`, and a notes source (a kind and a name, never a path: `knowledge.json` stays home).
 */
export { BUNDLE_FORMAT as DEFINITION_BUNDLE_FORMAT, encodeBundle as exportDefinitionBundle } from '../../harness-bundle/src/index.js';
export type { BundleSource as BundledSource, EncodedBundle as DefinitionBundle } from '../../harness-bundle/src/index.js';
