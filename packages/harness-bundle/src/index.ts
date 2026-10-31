/**
 * The harness bundle of Bowerloom 0.8: the one file a harness travels in (spec section 6.7), its encode, decode and inspection, the target of an import, and the
 * bounded reading and writing of the file. The command line (`bowerloom harness export` and `import`) and the app both call it.
 *
 * Stage 2 lane A built every function here to the contract of stage 1. The types, the constants, the codes and their words did not change. The functions that read or
 * hash a large input are async and take turns of the event loop, so the main process is never held (decision of the stage 1 security review). README.md states the
 * trust boundary, the callers' duties, and the code table.
 */
import type { Definition, DefinitionFile } from '../../harness-definition/src/index.js';
import { decodeBundle as decode, encodeBundle as encode } from './codec.js';
import * as io from './file-io.js';
import { definitionOf, isEmptyHarness as isEmpty, targetFromBundle as target } from './target.js';
import { summarize } from './summary.js';
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
export { UNREADABLE_ADDRESS, addressOf } from './address.js';
export type { AddressFlag, AddressRead } from './address.js';
export { BINARY_DATA_EXTENSIONS, CODE_EXTENSIONS, DATA_EXTENSIONS, TEXT_DATA_EXTENSIONS, codeWhy } from './code-files.js';
export type { CodeWhy } from './code-files.js';
export { importChoicesOf } from './choices.js';

/**
 * The bundle of a loaded definition: every file but `knowledge.json`, the source names, the summary, and the hash of the bytes. Deterministic. Async, so a large
 * definition does not hold the caller. Each record is `utf8` or, when that is smaller, `base64`. Refuses `BUNDLE_SECRET_FOUND` when a file holds a secret value,
 * `BUNDLE_INVALID` when the definition does not load again from its own files, and `BUNDLE_TOO_LARGE` when a limit passes or when the output passes
 * `BUNDLE_LIMITS.fileBytes`. It reads no disk.
 */
export function encodeBundle(def: Definition, options?: EncodeOptions): Promise<EncodedBundle> { return encode(def, options); }

/**
 * Reads the bytes of a bundle file once and checks everything before it returns: size, strict JSON with no duplicate key, depth, the closed shape, the format,
 * every path, every declared size and hash against the decoded bytes (the base64 length is checked before decoding), the revision, the secret scan, and that
 * the files load as a harness with a placeholder source for each notes name. Async, and it yields between files, so the main process is not held. Rejects with
 * `BundleRefusal`; no other error type for any input.
 */
export function decodeBundle(bytes: Uint8Array): Promise<DecodedBundle> { return decode(bytes); }

/** What the decoded bundle holds, for a person to read. The same summary `encodeBundle` returns. Pure. */
export function inspectBundle(bundle: DecodedBundle): BundleSummary {
  const def = definitionOf(bundle);
  return summarize(def, bundle.files, bundle.knowledge);
}

/**
 * The target file set of an import: the bundle's files, with each notes name linked or left out as `choices` says (a name in neither is left out), by
 * `editDefinition`'s `set-source` and `remove-source`. It loads once written. Pure. It takes only the Map and Set form that `importChoicesOf` builds, and reads no
 * property of a plain object. Throws `BundleRefusal` (`BUNDLE_USAGE`, `BUNDLE_INVALID`).
 */
export function targetFromBundle(bundle: DecodedBundle, choices: ImportChoices): readonly DefinitionFile[] { return target(bundle, choices); }

/** True when the definition holds no entry, no instructions, no source and no knowledge: only an empty harness, which an import may fill. Pure. */
export function isEmptyHarness(def: Definition): boolean { return isEmpty(def); }

/**
 * Reads a bundle file with bounds, async. It opens with `O_RDONLY | O_NOFOLLOW | O_NONBLOCK` (so a FIFO or a stalled device cannot hang the open; the flag
 * has no effect on a regular file), and calls `fstat` on the DESCRIPTOR before any read: a folder also opens with `O_RDONLY`, so this check is required. It must be a
 * regular file, owned by the user, at most `BUNDLE_LIMITS.fileBytes`. It reads at most one byte past the size; a read that ends before the size, or one that
 * returns a byte past it, refuses. It compares the identity and size after the read. A link, a device, a pipe, a folder, a file of another user, or a file that
 * changed while read is `BUNDLE_FILE_UNSAFE`; a file past the limit is `BUNDLE_TOO_LARGE`. `absPath` is absolute.
 */
export function readBundleFile(absPath: string): Promise<Uint8Array> { return io.readBundleFile(absPath); }

/**
 * The identity of the plain file at `absPath` (a link is not followed; `lstat` with `bigint: true`), or null when nothing is there. A link, a folder or another
 * kind of file is `BUNDLE_FILE_UNSAFE`. Main calls it when the save dialog returns, and passes the result as `replace` if the person agreed to replace that file.
 */
export function bundleTargetIdentity(absPath: string): Promise<BundleFileIdentity | null> { return io.bundleTargetIdentity(absPath); }

/**
 * Writes a new file, async.
 *  - The parent folder is resolved ONCE with `realpath`. If it is not the folder the caller gave (a link on the way), the write refuses `BUNDLE_FILE_UNSAFE`: the
 *    caller passes the real path of the folder, so a person who chose a linked folder sees the real one first.
 *  - The temporary file is in that resolved folder. Its name starts with a dot and ends in `.part` (so a sync folder skips it) and holds at least 64 random bits, and
 *    it is created with `O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW` and mode 0600 at creation (never by `chmod` afterwards). It is removed when anything fails.
 *  - Without `options.replace`: the file is put in place with `link(tmp, target)`, which fails with EEXIST when anything is there (`BUNDLE_EXISTS`, the file there
 *    untouched), and then the temporary name is unlinked. It is never "check, then rename", because a file made between the two would be replaced without a question.
 *  - Where `link` fails with EPERM, ENOTSUP, EOPNOTSUPP, ENOSYS, EXDEV or EMLINK (an exFAT or FAT stick, some network shares, FUSE mounts and sync folders have no hard
 *    links), the writer opens the TARGET itself with `O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW` at mode 0600 (EEXIST is `BUNDLE_EXISTS`), keeps the descriptor,
 *    `fstat`s it for the identity, writes the bytes, calls `fsync` and closes, then unlinks the temporary file. This path is NOT atomic: the file is visible under its
 *    final name while it is written, and a crash can leave a truncated file there (the importer refuses it, because the bundle's own revision does not match). If the
 *    write fails, the writer `lstat`s the target and unlinks it only while its dev and ino still equal the identity it took, so it never removes another process's
 *    file. `copyFile` is not used: it gives no descriptor and no identity to compare. It never falls back to `rename` without `replace`.
 *  - With `options.replace` (the identity from `bundleTargetIdentity`, taken when the save dialog returned and after the person agreed to replace that file): the
 *    identity is read again with `lstat` right before the `rename`, and a different file there refuses `BUNDLE_FILE_UNSAFE`. A short window remains between that read
 *    and the rename; the README names it.
 *  - A link or a folder at the path is `BUNDLE_FILE_UNSAFE`. `absPath` is absolute.
 */
export function writeBundleFile(absPath: string, bytes: Uint8Array, options?: { readonly replace?: BundleFileIdentity }): Promise<void> {
  return io.writeBundleFile(absPath, bytes, options);
}
