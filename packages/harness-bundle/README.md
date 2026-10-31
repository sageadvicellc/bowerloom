# harness-bundle

The harness bundle of Bowerloom 0.8: the one file a harness travels in (spec section 6.7). This package encodes a loaded definition into a bundle, decodes and checks a bundle, says what it holds, builds the target files of an import, and reads and writes the bundle file with bounds. `bowerloom harness export` and `bowerloom harness import` and the app's Export and Import sheets all call it.

Status: stage 1, the contract. The types, constants, codes and words here are final. The functions in `src/index.ts` throw `not built` until stage 2 lane A builds them.

## The file

- Format `bowerloom/harness-bundle/v1beta1`. UTF-8 JSON, one object, no compression, no archive. 2-space indent and one final line feed, so it reads and diffs as text.
- Keys in this order: `format`, `harness`, `generator`, `revision`, `files`, `knowledge`. The shapes are in `src/types.ts` (`BundleEnvelope`, `BundleFileRecord`).
- A file record has `path`, `size`, `sha256`, `encoding` (`utf8` or `base64`), `data`, and `executable: true` only when the file has an execute bit. Files sort by path in byte order.
- The file never holds `knowledge.json` (paths stay on the computer they belong to), a secret value, the home path of the exporter, or a path the exporter added. A notes source travels as a kind and a name.
- Unknown keys anywhere are refused. A key such as `type`, `link`, `target`, `mode` or `owner` fails.
- `revision` is `sha256:` plus the definition revision of the decoded files. It catches damage and edits. It is not a signature: a person who forges a bundle can set a matching revision. Validation, not the hash, is the defence.
- `generator` is informational. Bowerloom never trusts it.

## What stage 2 builds

- `encodeBundle(def, options)` and `decodeBundle(bytes)`. Both are pure.
- `inspectBundle(bundle)`: counts, tools, files that run code, secrets to add, notes names, borrowed items, and text that holds a path of another computer.
- `targetFromBundle(bundle, choices)`: the files an import writes. A notes name is linked to a stored path or left out. A name in neither list is left out.
- `isEmptyHarness(def)`, `exportAcknowledgement(summary)`, `importAcknowledgement(summary, executables)`.
- `readBundleFile(absPath)` and `writeBundleFile(absPath, bytes, options)`.

An import is a save. The only write is `applySave` in `packages/adoption`, under the project lock, with its journal. This package never writes a harness file.

## Trust boundary

A bundle from another person is data. Reading one starts no program and loads no code.

- `decodeBundle` is bounded: the file size is checked before a read, the JSON is strict (no duplicate key, no `__proto__`, depth at most `BUNDLE_LIMITS.jsonDepth`), shapes are closed, and each declared size is checked against the decoded bytes (the base64 length first).
- The path grammar is at least as strict as `planSave`'s `plainPath`: no empty, `.`, `..` or hidden segment, no backslash, no control, format, bidirectional or line-separator character, at most 1,024 characters and 255 bytes per segment, no 0.7 top-level name, no `knowledge.json`, depth at most 16, and no two paths equal under case or Unicode folding.
- A bundle path is only ever a key into `.bowerloom`. No other code turns one into a file system path.
- A hook, a script, an executable file and an MCP command are data. The package spawns nothing, evaluates nothing and imports nothing at run time. A static test checks the source for `child_process`, `vm`, `eval`, `Function(` and `import(`.
- Secrets: a literal secret value refuses the bundle (`BUNDLE_SECRET_FOUND`) on export and on import. References stay: `${NAME}` and `{ "keychain": "<entry>" }`. They are listed under secrets to add. The package never reads an environment variable or the keychain, and it does not check that a listed secret exists.
- Display: every string that came from a file is for a person to read, so the app passes it through `visible()` in main and the command line through `plainText()`.
- Race windows, named as `save.ts` names its own: the bundle file can change between the `lstat` and the read (the inode and size are checked after the read), and the export folder can change between the temporary file and the rename.

## Limits

`BUNDLE_LIMITS` in `src/index.ts`: bundle file 48 MiB; 4,096 files; 1 MiB per file; 32 MiB in all; 16 path segments; 1,024 characters per path and 255 bytes per segment; JSON depth 6; 200 notes names of up to 200 characters; 200 rows per preview list; 2 decoded bundles held in memory.

## Codes

Every refusal is a `BundleRefusal` with one of these codes. The words are `BUNDLE_MESSAGES` in `src/codes.ts`. A message never repeats a value from a file. The command line copies each sentence into `apps/cli/src/human.ts`, and `apps/docs/src/content/docs/reference/errors.md` repeats the same sentences. Save refusals (`SAVE_*`) pass through unchanged.

| Code | When | Words |
| --- | --- | --- |
| `BUNDLE_USAGE` | A choice names a notes name the bundle does not hold, a name is in both lists, or an argument is not allowed. | The choices do not fit this file, or a value of the call is not allowed. Nothing was written. |
| `BUNDLE_FORMAT` | The file is not JSON, not UTF-8, has a BOM, has a wrong or unknown format, a wrong shape, an unknown key, or a duplicate key. | This is not a Bowerloom harness file, or it is a form Bowerloom does not read. Nothing was written. |
| `BUNDLE_TOO_LARGE` | The file, the file count, one file or the total passes a limit. | This file is larger than Bowerloom reads, or it holds more files or bytes than a harness may. Nothing was written. |
| `BUNDLE_DAMAGED` | A size, a hash or the revision does not match the decoded bytes, or the base64 is bad. | This file does not match its own sizes or checksums, so it was changed or damaged. Nothing was written. |
| `BUNDLE_PATH_UNSAFE` | A path is not a plain path inside the harness. | This file names a path that is not a plain path inside the harness. Nothing was written. |
| `BUNDLE_SECRET_FOUND` | A file holds a literal secret value. | A file holds what looks like a secret value. A harness never carries one. Nothing was written. |
| `BUNDLE_INVALID` | The decoded files do not load as a harness. The loader's problems come with it, by path and code. | The files in this bundle do not make a harness that loads. Nothing was written. |
| `BUNDLE_FILE_UNSAFE` | The bundle file is a link, not a regular file, not yours, or changed while it was read. A write target is a link or a folder. | The bundle file is a link, is not a plain file of yours, or changed while it was read. Nothing was read or written. |
| `BUNDLE_EXISTS` | The command line would write over a file that exists. | A file exists at that place already. Bowerloom does not replace it. Nothing was written. |
| `IMPORT_FOLDER_HAS_HARNESS` | The folder's harness has an entry, instructions, a source or knowledge. | This folder has a harness with parts in it already. A file goes only into a folder with no harness, or with an empty one. Nothing was written. |
| `IMPORT_NEEDS_ACKNOWLEDGEMENT` | An import has files that can run or paths from another computer, and the acknowledgement is missing or not the one the plan showed. | This file holds files that can run, or paths from another computer. Tick that you read them, then go on. Nothing was written. |
| `EXPORT_NEEDS_ACKNOWLEDGEMENT` | An export has text that holds a path of this computer, and the acknowledgement is missing or not the one the plan showed. | These files hold a path from this computer. Tick that you read them, then go on. Nothing was written. |

## Tests

`test/*.test.mjs` is in the root `npm test` (the repository's coverage test requires it). `test:harness-bundle` runs this folder alone.
