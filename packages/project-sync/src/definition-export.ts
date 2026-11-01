/**
 * The export bundle of one harness definition (0.8 spec, section 6.7). The bundle moved to `packages/harness-bundle`, which owns its format, its checks, and the bytes of
 * the file. These names stay here for the callers that already import them: the encoder (it answers the bundle file as bytes, with its summary and hash), the answer's
 * type, and a notes source (a kind and a name, never a path: `knowledge.json` stays home).
 */
import type { Definition } from '../../harness-definition/src/index.js';
import { encodeBundle } from '../../harness-bundle/src/index.js';
import type { EncodeOptions, EncodedBundle } from '../../harness-bundle/src/index.js';

export type { BundleSource as BundledSource, EncodedBundle as DefinitionBundle } from '../../harness-bundle/src/index.js';

/**
 * The bundle of a definition. `home` and `user` are required here: they make the foreign-path scan match the exporting computer's own home folder and user name
 * literally, and a caller that leaves them out would skip that scan. Pass both, even when the value is a placeholder you know is absent from the files.
 */
export function exportDefinitionBundle(def: Definition, options: EncodeOptions & { readonly home: string; readonly user: string }): Promise<EncodedBundle> {
  return encodeBundle(def, options);
}
