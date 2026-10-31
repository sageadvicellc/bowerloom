/**
 * The harness bundle of Bowerloom 0.8: the one file a harness travels in (spec section 6.7), its encode, decode and inspection, the target of an import, and the
 * bounded reading and writing of the file. The command line (`bowerloom harness export` and `import`) and the app both call it.
 *
 * STAGE 1, THE CONTRACT. The types, the constants, the codes and their words are final. `importAcknowledgement`, `exportAcknowledgement` and `importChoicesOf` are
 * built. Every other function throws `not built` until stage 2 lane A (`packages/harness-bundle/**`) builds it. The ones that read or hash a large input are
 * async, so the main process is never held (decision of the stage 1 security review). README.md states the trust boundary, the callers' duties, and the code table.
 */
import type { Definition, DefinitionFile } from '../../harness-definition/src/index.js';
import type { BundleFileIdentity, BundleSummary, DecodedBundle, EncodedBundle, EncodeOptions, ImportChoices } from './types.js';

export type {
  BundleBorrowed, BundleCodeFile, BundleCounts, BundleEncoding, BundleEnvelope, BundleFileIdentity, BundleFileRecord, BundleForeignPath, BundleNote, BundleProblems,
  BundleSecret, BundleSink, BundleSinkField, BundleSource, BundleSummary, BundleTool, DecodedBundle, EncodedBundle, EncodeOptions, ExportPlan, ImportChoices, ImportPlan,
} from './types.js';
export { HIGH_RISK_SINK_FIELDS } from './types.js';
export { BUNDLE_CODES, BUNDLE_MESSAGES, BundleRefusal, PATH_SHOWN_CHARS, shownPath } from './codes.js';
export type { BundleCode } from './codes.js';
export { BUNDLE_FILE_SUFFIX, BUNDLE_FORMAT, BUNDLE_LIMITS, EXPORT_PLAN_FORMAT, IMPORT_PLAN_FORMAT } from './limits.js';
export { exportAcknowledgement, importAcknowledgement } from './ack.js';
export { importChoicesOf } from './choices.js';

const notBuilt = async (): Promise<never> => { throw new Error('not built'); };
const notBuiltSync = (): never => { throw new Error('not built'); };

/**
 * The bundle of a loaded definition: every file but `knowledge.json`, the source names, the summary, and the hash of the bytes. Deterministic. Async, so a large
 * definition does not hold the caller. Each record is `utf8` or, when that is smaller, `base64`. Refuses `BUNDLE_SECRET_FOUND` when a file holds a secret value,
 * `BUNDLE_INVALID` when the definition does not load again from its own files, and `BUNDLE_TOO_LARGE` when a limit passes or when the output passes
 * `BUNDLE_LIMITS.fileBytes`. It reads no disk.
 */
export function encodeBundle(def: Definition, options?: EncodeOptions): Promise<EncodedBundle> { void def; void options; return notBuilt(); }

/**
 * Reads the bytes of a bundle file once and checks everything before it returns: size, strict JSON with no duplicate key, depth, the closed shape, the format,
 * every path, every declared size and hash against the decoded bytes (the base64 length is checked before decoding), the revision, the secret scan, and that
 * the files load as a harness with a placeholder source for each notes name. Async, and it yields between files, so the main process is not held. Rejects with
 * `BundleRefusal`; no other error type for any input.
 */
export function decodeBundle(bytes: Uint8Array): Promise<DecodedBundle> { void bytes; return notBuilt(); }

/** What the decoded bundle holds, for a person to read. The same summary `encodeBundle` returns. Pure. */
export function inspectBundle(bundle: DecodedBundle): BundleSummary { void bundle; return notBuiltSync(); }

/**
 * The target file set of an import: the bundle's files, with each notes name linked or left out as `choices` says (a name in neither is left out), by
 * `editDefinition`'s `set-source` and `remove-source`. It loads once written. Pure. Rejects input that did not come from `importChoicesOf` by reading only own
 * properties of a Map and a Set. Throws `BundleRefusal` (`BUNDLE_USAGE`, `BUNDLE_INVALID`).
 */
export function targetFromBundle(bundle: DecodedBundle, choices: ImportChoices): readonly DefinitionFile[] { void bundle; void choices; return notBuiltSync(); }

/** True when the definition holds no entry, no instructions, no source and no knowledge: only an empty harness, which an import may fill. Pure. */
export function isEmptyHarness(def: Definition): boolean { void def; return notBuiltSync(); }

/**
 * Reads a bundle file with bounds, async. It opens with `O_RDONLY | O_NOFOLLOW | O_NONBLOCK` (so a FIFO or a stalled device cannot hang the open), calls
 * `fstat` on the DESCRIPTOR (a regular file, owned by the user, at most `BUNDLE_LIMITS.fileBytes`), reads at most one byte past that size and refuses when the
 * file grew, and compares the identity and size after the read. A link, a device, a pipe, a folder or a file of another user is `BUNDLE_FILE_UNSAFE`; a file
 * past the limit is `BUNDLE_TOO_LARGE`. `absPath` is absolute.
 */
export function readBundleFile(absPath: string): Promise<Uint8Array> { void absPath; return notBuilt(); }

/**
 * The identity of the plain file at `absPath` (a link is not followed), or null when nothing is there. A link, a folder or another kind of file is
 * `BUNDLE_FILE_UNSAFE`. Main calls it when the save dialog returns, and passes the result as `replace` if the person agreed to replace that file.
 */
export function bundleTargetIdentity(absPath: string): Promise<BundleFileIdentity | null> { void absPath; return notBuilt(); }

/**
 * Writes a new file, async: a temporary file in the same folder, its name random and created with exclusive create (`O_EXCL`), mode 0600, then a rename. The
 * temporary file is removed when anything fails. A link or a folder at the path is `BUNDLE_FILE_UNSAFE`. A plain file already at the path is `BUNDLE_EXISTS`,
 * unless `options.replace` names its identity (from `bundleTargetIdentity`, taken when the save dialog returned and after the person agreed to replace it):
 * the writer checks the identity again right before the rename and refuses `BUNDLE_FILE_UNSAFE` when the file there is another one. `absPath` is absolute.
 */
export function writeBundleFile(absPath: string, bytes: Uint8Array, options?: { readonly replace?: BundleFileIdentity }): Promise<void> {
  void absPath; void bytes; void options; return notBuilt();
}
