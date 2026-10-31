/** The constants of the harness bundle: the format strings, the file suffix, and every bound. */
import { DEFINITION_LIMITS } from '../../harness-definition/src/index.js';

/** The format string of the bundle file. It was never written to disk before 0.8.0-beta.1, so it stays `v1beta1` (decision G-4). */
export const BUNDLE_FORMAT = 'bowerloom/harness-bundle/v1beta1' as const;
/** The format strings of the command line's plan output (`--json`). Each is also listed in `apps/docs/tools/after-beta3-formats.json`. */
export const EXPORT_PLAN_FORMAT = 'bowerloom/harness-export-plan/v1beta1' as const;
export const IMPORT_PLAN_FORMAT = 'bowerloom/harness-import-plan/v1beta1' as const;
/** The suggested file name is `<harness id>` plus this suffix. */
export const BUNDLE_FILE_SUFFIX = '.bowerloom.json' as const;

/**
 * Every bound. A bundle is checked against these before the loader runs.
 *  - `fileBytes`: the bundle file; the descriptor's `fstat` checks it before any read, and a read stops one byte past it. A definition at its own limits
 *    (32 MiB) can exceed it, because JSON escapes cost bytes; `encodeBundle` then picks base64 for a record when that is smaller, and refuses `BUNDLE_TOO_LARGE`
 *    when the whole output still passes this number, so export never writes a file that import refuses.
 *  - `files`, `entryBytes`, `totalBytes`, `depth`: the definition loader's own limits, on the decoded files (`entryBytes` is per file, `depth` is path segments).
 *  - `pathChars`, `segmentBytes`: the path grammar (1,024 characters; 255 bytes per segment).
 *  - `jsonDepth`: the deepest nesting of the bundle's JSON.
 *  - `notesNames`, `nameChars`: the notes names a bundle may list, and the length of a name.
 *  - `listRows`: the rows of one list in a preview; the rest are counted ("and N more").
 *  - `heldBundles`: the decoded bundles main holds in memory at once.
 *  - `displayChars`, `displayArgs`: the text of a command, host, hook or foreign-path hit that a summary carries (cut to this), and the arguments of a tool.
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
  displayChars: 200,
  displayArgs: 20,
});
