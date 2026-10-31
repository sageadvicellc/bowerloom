/**
 * The harness bundle of Bowerloom 0.8: the one file a harness travels in (spec section 6.7), its encode, decode and inspection, the target of an import, and the
 * bounded reading and writing of the file. The command line (`bowerloom harness export` and `import`) and the app both call it.
 *
 * STAGE 1, THE CONTRACT. The types, the constants, the codes and their words are final. Every function below throws `not built` until stage 2 lane A
 * (`packages/harness-bundle/**`) builds it. README.md states the trust boundary and the code table.
 */
import type { Definition, DefinitionFile } from '../../harness-definition/src/index.js';
import { DEFINITION_LIMITS } from '../../harness-definition/src/index.js';
import type { BundleSummary, DecodedBundle, EncodedBundle, EncodeOptions, ImportChoices } from './types.js';

export type {
  BundleBorrowed, BundleCodeFile, BundleCounts, BundleEncoding, BundleEnvelope, BundleFileRecord, BundleForeignPath, BundleNote, BundleProblems, BundleSecret,
  BundleSource, BundleSummary, BundleTool, DecodedBundle, EncodedBundle, EncodeOptions, ExportPlan, ImportChoices, ImportPlan,
} from './types.js';
export { BUNDLE_CODES, BUNDLE_MESSAGES, BundleRefusal } from './codes.js';
export type { BundleCode } from './codes.js';

/** The format string of the bundle file. It was never written to disk before 0.8.0-beta.1, so it stays `v1beta1` (decision G-4). */
export const BUNDLE_FORMAT = 'bowerloom/harness-bundle/v1beta1' as const;
/** The format strings of the command line's plan output (`--json`). Each is also listed in `apps/docs/tools/after-beta3-formats.json`. */
export const EXPORT_PLAN_FORMAT = 'bowerloom/harness-export-plan/v1beta1' as const;
export const IMPORT_PLAN_FORMAT = 'bowerloom/harness-import-plan/v1beta1' as const;
/** The suggested file name is `<harness id>` plus this suffix. */
export const BUNDLE_FILE_SUFFIX = '.bowerloom.json' as const;

/**
 * Every bound. A bundle is checked against these before the loader runs.
 *  - `fileBytes`: the bundle file; `lstat` checks it before any read. 32 MiB of content in base64 plus the envelope fit.
 *  - `files`, `entryBytes`, `totalBytes`, `depth`: the definition loader's own limits, on the decoded files (`entryBytes` is per file, `depth` is path segments).
 *  - `pathChars`, `segmentBytes`: the path grammar (1,024 characters; 255 bytes per segment).
 *  - `jsonDepth`: the deepest nesting of the bundle's JSON.
 *  - `notesNames`, `nameChars`: the notes names a bundle may list, and the length of a name.
 *  - `listRows`: the rows of one list in a preview; the rest are counted ("and N more").
 *  - `heldBundles`: the decoded bundles main holds in memory at once.
 */
export const BUNDLE_LIMITS = Object.freeze({
  fileBytes: 48 * 1024 * 1024,
  files: DEFINITION_LIMITS.files,
  entryBytes: DEFINITION_LIMITS.fileBytes,
  totalBytes: DEFINITION_LIMITS.totalBytes,
  depth: DEFINITION_LIMITS.depth,
  pathChars: 1024,
  segmentBytes: 255,
  jsonDepth: 6,
  notesNames: 200,
  nameChars: 200,
  listRows: 200,
  heldBundles: 2,
});

const notBuilt = (): never => { throw new Error('not built'); };

/**
 * Pure. The bundle of a loaded definition: every file but `knowledge.json`, the source names, the summary, and the hash of the bytes. Deterministic.
 * Refuses `BUNDLE_SECRET_FOUND` when a file holds a secret value, `BUNDLE_INVALID` when the definition does not load again from its own files, and
 * `BUNDLE_TOO_LARGE` past a limit. It reads no disk.
 */
export function encodeBundle(def: Definition, options?: EncodeOptions): EncodedBundle { void def; void options; return notBuilt(); }

/**
 * Pure. Reads the bytes of a bundle file once and checks everything before it returns: size, strict JSON with no duplicate key, depth, the closed shape,
 * the format, every path, every declared size and hash against the decoded bytes (the base64 length is checked before decoding), the revision, the secret
 * scan, and that the files load as a harness with a placeholder source for each notes name. Throws `BundleRefusal`; no other error type for any input.
 */
export function decodeBundle(bytes: Uint8Array): DecodedBundle { void bytes; return notBuilt(); }

/** Pure. What the decoded bundle holds, for a person to read. The same summary `encodeBundle` returns. */
export function inspectBundle(bundle: DecodedBundle): BundleSummary { void bundle; return notBuilt(); }

/**
 * Pure. The target file set of an import: the bundle's files, with each notes name linked or left out as `choices` says (a name in neither list is left
 * out), by `editDefinition`'s `set-source` and `remove-source`. It loads once written. Throws `BundleRefusal` (`BUNDLE_USAGE`, `BUNDLE_INVALID`).
 */
export function targetFromBundle(bundle: DecodedBundle, choices: ImportChoices): readonly DefinitionFile[] { void bundle; void choices; return notBuilt(); }

/** Pure. True when the definition holds no entry, no instructions, no source and no knowledge: only an empty harness, which an import may fill. */
export function isEmptyHarness(def: Definition): boolean { void def; return notBuilt(); }

/**
 * Pure. The hash that an export acknowledgement names: of the foreign paths in the summary. Lowercase hex, 64 characters. Null when there are none, so
 * nothing needs a tick.
 */
export function exportAcknowledgement(summary: BundleSummary): string | null { void summary; return notBuilt(); }

/**
 * Pure. The hash that an import acknowledgement names: of the code files and the foreign paths in the summary, and of `executables`, the paths a save would
 * write with an execute bit. Lowercase hex, 64 characters. Null when all three are empty.
 */
export function importAcknowledgement(summary: BundleSummary, executables: readonly string[]): string | null { void summary; void executables; return notBuilt(); }

/**
 * Reads a bundle file with bounds: `lstat` first (no link, a regular file, owned by the user, at most `BUNDLE_LIMITS.fileBytes`), `O_NOFOLLOW`, one read, and
 * a check that the inode and size are the same after. Throws `BundleRefusal` (`BUNDLE_FILE_UNSAFE`, `BUNDLE_TOO_LARGE`). `absPath` is absolute.
 */
export function readBundleFile(absPath: string): Uint8Array { void absPath; return notBuilt(); }

/**
 * Writes a new file: a temporary file in the same folder with mode 0600, then a rename. Refuses a link or a folder at the path (`BUNDLE_FILE_UNSAFE`). It
 * replaces an existing plain file only when `replace` is true; otherwise it refuses `BUNDLE_EXISTS` (the app sets `replace` after the save dialog's own
 * overwrite question). `absPath` is absolute.
 */
export function writeBundleFile(absPath: string, bytes: Uint8Array, options?: { readonly replace?: boolean }): void { void absPath; void bytes; void options; return notBuilt(); }
