# harness-bundle

The harness bundle of Bowerloom 0.8: the one file a harness travels in (spec section 6.7). This package encodes a loaded definition into a bundle, decodes and checks a bundle, says what it holds, builds the target files of an import, and reads and writes the bundle file with bounds. `bowerloom harness export` and `bowerloom harness import` and the app's Export and Import sheets all call it.

Status: stage 1, the contract. The types, constants, codes and words here are final. `importAcknowledgement`, `exportAcknowledgement` and `importChoicesOf` are built. The other functions in `src/index.ts` throw `not built` until stage 2 lane A builds them.

## The file

- Format `bowerloom/harness-bundle/v1beta1`. UTF-8 JSON, one object, no compression, no archive. 2-space indent and one final line feed, so it reads and diffs as text.
- Keys in this order: `format`, `harness`, `generator`, `revision`, `files`, `knowledge`. The shapes are in `src/types.ts` (`BundleEnvelope`, `BundleFileRecord`).
- A file record has `path`, `size`, `sha256`, `encoding` (`utf8` or `base64`), `data`, and `executable: true` only when the file has an execute bit. Files sort by path in byte order. `encodeBundle` writes a record as `base64` when that is smaller than the escaped text.
- The file never holds `knowledge.json` (paths stay on the computer they belong to), a secret value, the home path of the exporter, or a path the exporter added. A notes source travels as a kind and a name.
- Unknown keys anywhere are refused. A key such as `type`, `link`, `target`, `mode` or `owner` fails.
- `revision` is `sha256:` plus the definition revision of the decoded files. It catches damage and edits. It is not a signature: a person who forges a bundle can set a matching revision. Validation, not the hash, is the defence. It is the one prefixed revision. Every plan revision (`ExportPlan`, `ImportPlan`, the app's views) is bare lowercase hex.
- `generator` is informational. Bowerloom never trusts it.

## What stage 2 builds

- `encodeBundle(def, options)` and `decodeBundle(bytes)`. Both are async and pure. They yield between files, so the main process is never held.
- `inspectBundle(bundle)`: counts, tools (with their command, arguments, host, hook text and a hash of the whole entry), files that run code (with hashes), the references the file reads from this computer and where each one goes, notes names, borrowed items, and text that holds a path of another computer (with the text and its hash).
- `targetFromBundle(bundle, choices)`: the files an import writes. A notes name is linked to a stored path or left out. A name in neither is left out.
- `isEmptyHarness(def)`.

Built now, because they depend on nothing else: `addressOf(url)` and `codeWhy(path, bytes, executable)`.

## Addresses and files that run

- A tool's host is the host a client would really reach. `addressOf` masks each `${NAME}`, parses the address with `URL`, and shows `hostname` plus `:port`. So `https://github.com:${TOKEN}@evil.example/` shows `evil.example` and the flag `credentials`; a backslash address shows the host a client reads and the flag `backslash`; `https://[::1]:8080/` shows `[::1]:8080`; an address that does not parse shows `unreadable address`.
- A file is data only when it passes an allowlist; every other file can run and is listed with its hash. Data: a name that ends in `.md .markdown .txt .json .jsonc .yaml .yml .toml .csv .tsv` (valid UTF-8 bytes) or `.png .jpg .jpeg .gif .webp .ico .pdf .woff .woff2 .ttf .otf`, in any case, with no trailing space or dot, and whose first bytes (after an optional UTF-8 byte order mark) are not `#!`, ELF, Mach-O, PE (`MZ`) or WebAssembly. So `skills/x/run.sh`, `helper.node`, `setup.hta`, a file with no extension, an `.svg`, `a.sh ` and a Mach-O file named `helper` are all listed and ticked, and `run.sh.txt` is data until it begins with `#!`. The execute bit, `hooks.json` and `scripts/` count first. Missing bytes count as code; the function never throws.
- `readBundleFile(absPath)`, `bundleTargetIdentity(absPath)` and `writeBundleFile(absPath, bytes, options)`. All async.

Built now, because they depend on the summary only: `exportAcknowledgement(summary, revision)`, `importAcknowledgement(summary, executables, revision)` and `importChoicesOf(raw, names)`.

An import is a save. The only write is `applySave` in `packages/adoption`, under the project lock, with its journal. This package never writes a harness file.

## Acknowledgements

A tick covers what the person was shown, and the hash binds it.

- `importAcknowledgement` hashes the save plan's revision and: every tool that runs code (a stdio MCP server, a hook) or reaches a host (a remote MCP server) by kind, name and the hash of its whole entry, so a bundle with only an `mcp.json` still needs a tick; every reference in a url, an argument, a command or a header; every file that can run by path and hash; every file written with an execute bit (a sorted, unique list); and every foreign-path hit by path, line and the hash of its text. It is null when all of them are empty.
- `exportAcknowledgement` hashes the plan's revision and the foreign-path hits. It is null when there are none.
- A reference in an `env` value alone needs no tick: `env` applies to a stdio server, which runs code and is ticked as a tool. A reference in a header does need one, because a header goes to the host the file names. Every sink shows on screen.

## References are a way out for values

A `${NAME}` reference tells the engine to read a value from this computer and give it to the tool. The name may be set on this computer already. A hostile file can place `${GITHUB_TOKEN}` in a url, an argument, a command or a header, and the value goes to the host the file names. So the summary lists each reference with its sinks: the tool, the field (`env`, `header`, `arg`, `url`, `command`) and the host. The screen says that the file reads these values from this computer and passes them to these tools. It never tells a person to create a variable without showing where it goes. The package does not read an environment variable or the keychain, and it does not check that a listed name exists.

## Trust boundary

A bundle from another person is data. Reading one starts no program and loads no code.

- `decodeBundle` is bounded: the file size is checked before a read, the JSON is strict (no duplicate key, no `__proto__`, depth at most `BUNDLE_LIMITS.jsonDepth`), shapes are closed, and each declared size is checked against the decoded bytes (the base64 length first).
- The path grammar is at least as strict as `planSave`'s `plainPath`: no empty, `.`, `..` or hidden segment, no backslash, no control, format, bidirectional or line-separator character, at most 1,024 characters and 255 bytes per segment, no 0.7 top-level name, no `knowledge.json`, depth at most 16, and no two paths equal under case or Unicode folding.
- A bundle path is only ever a key into `.bowerloom`. No other code turns one into a file system path.
- A hook, a script, an executable file and an MCP command are data. The package spawns nothing, evaluates nothing and imports nothing at run time. A static test checks the source for `child_process`, `vm`, `eval`, `Function(` and `import(`.
- Secrets: a literal secret value refuses the bundle (`BUNDLE_SECRET_FOUND`) on export and on import. References stay: `${NAME}` and `{ "keychain": "<entry>" }`. They are listed with their sinks.
- Notes names are untrusted keys. `constructor` is a valid name. Choices are a `Map` and a `Set` (`ImportChoices`), built by `importChoicesOf` from own properties only.
- Refusals: a message holds the table sentence and at most 20 paths. Each path is cut to 120 characters with an ellipsis, and its control, format and line-separator characters are escaped. So a path in a message is quoted text of bounded size. It is not a promise that no text from the file appears. No other text from a file is repeated, and `BundleRefusal.paths` holds the shortened form only.
- Display: every string that came from a file is for a person to read, so the app passes it through `visible()` in main and the command line through `plainText()`.
- The read: `readBundleFile` opens with `O_NOFOLLOW | O_NONBLOCK`, calls `fstat` on the descriptor, and refuses anything that is not a regular file of the user. A file of another user is refused too (a shared volume may hit this; the words say "that you own").
- Race windows, named as `save.ts` names its own: the bundle file can change between the open and the end of the read (the identity and size are checked after the read), and the export folder can change between the temporary file and the rename (the target identity is checked again right before it).

## What the callers must do

- The app's main process (lane C) validates every argument of every share call before it uses one: a bundle id against `SHARE_BUNDLE_ID` and looked up by the exact string in a `Map`, never by `Number()`; the choices shape with `importChoicesOf`; every notes id against the ids main gave out; the name and count limits; the revision and the acknowledgement as 64 lowercase hex characters (or null where allowed).
- Main enforces `SAVE_EXECUTABLE_UNACKNOWLEDGED` itself. `applySave` does not check an acknowledgement.
- Main computes the acknowledgement from the summary of the bundle it holds, built in the same call by `inspectBundle`, and never from a summary or a field the window sent. The hash covers each tool's `sha256` and not its shown fields (`command`, `host`, `addressFlags`), so a summary with edited shown fields and the old `sha256` gives the same hash; the rule keeps that from mattering.
- Main compares the acknowledgement it computes now with the one it receives, with the plan revision and the bundle hash it holds, and writes only when all three match.
- Main passes `replace` only when the file existed when the save dialog returned, the person agreed to replace it, and `bundleTargetIdentity` still gives the same identity. Main passes the real path of the target folder (`realpath`), so the person sees the folder that is written.
- The command line never replaces a file.

## The file functions: what lane A builds to

- `readBundleFile`: `O_RDONLY | O_NOFOLLOW | O_NONBLOCK`; `fstat` on the descriptor before any read (a folder also opens with `O_RDONLY`); a regular file of the user, at most 48 MiB; read at most one byte past the size; a short read or a read past the size refuses; the identity and size are compared again after the read.
- `bundleTargetIdentity`: `lstat` with `bigint: true`. The identity is `dev`, `ino`, `size`, `mtimeNs` and `birthtimeNs`, because an inode number can be reused soon after a delete.
- `writeBundleFile`: resolve the parent with `realpath` once and refuse if it is not the folder given; write the temporary file in that folder with a name that starts with a dot and ends in `.part` (a sync folder skips it) and holds at least 64 random bits, created with `O_CREAT | O_EXCL | O_NOFOLLOW` and mode 0600 at creation; remove it on any failure.
  - Without `replace`: `link(tmp, target)` then unlink the temporary name. `link` fails with EEXIST when anything is there, so a file made in between is never replaced. Never "check, then rename".
  - Where `link` fails with EPERM, ENOTSUP, EXDEV or EMLINK (exFAT and FAT sticks, some network shares and sync folders have no hard links): `copyFile(tmp, target, COPYFILE_EXCL)`, then unlink the temporary file. `COPYFILE_EXCL` refuses when the target exists (`BUNDLE_EXISTS`). If the copy fails part way, remove the target only when it is still the file this call made. Never `rename` without `replace`.
  - With `replace`: read the identity again right before the `rename` and refuse if it differs. A short window remains between that read and the rename.
- Tests lane A must add are listed as `todo` tests in `test/hostile-todo.test.mjs`. A second review runs them.

## Limits

`BUNDLE_LIMITS` in `src/limits.ts`: bundle file 48 MiB; 4,096 files; 1 MiB per file; 32 MiB in all; 16 path segments; 1,024 characters per path and 255 bytes per segment; JSON depth 6; 200 notes names of up to 200 characters; 200 rows per preview list; 2 decoded bundles held in memory; 200 characters of any command, host, hook or foreign-path text in a summary, and 20 arguments of a tool. A definition at its own limits can pass 48 MiB once JSON escapes are counted. `encodeBundle` then refuses `BUNDLE_TOO_LARGE`, so export never writes a file that import refuses.

## Codes

Every refusal is a `BundleRefusal` with one of these codes. The words are `BUNDLE_MESSAGES` in `src/codes.ts`. The command line copies each sentence into `apps/cli/src/human.ts`, and `apps/docs/src/content/docs/reference/errors.md` repeats the same sentences. Save refusals (`SAVE_*`) pass through unchanged.

| Code | When | Words |
| --- | --- | --- |
| `BUNDLE_USAGE` | A choice names a notes name the bundle does not hold, a name is in both lists, or an argument is not allowed. | The choices do not fit this file, or a value of the call is not allowed. Nothing was written. |
| `BUNDLE_FORMAT` | The file is not JSON, not UTF-8, has a BOM, has a wrong or unknown format, a wrong shape, an unknown key, or a duplicate key. | This is not a Bowerloom harness file, or it is a form Bowerloom does not read. Nothing was written. |
| `BUNDLE_TOO_LARGE` | The file, the file count, one file or the total passes a limit. | This file is larger than Bowerloom reads, or it holds more files or bytes than a harness may. Nothing was written. |
| `BUNDLE_DAMAGED` | A size, a hash or the revision does not match the decoded bytes, or the base64 is bad. | This file does not match its own sizes or checksums, so it was changed or damaged. Nothing was written. |
| `BUNDLE_PATH_UNSAFE` | A path is not a plain path inside the harness. | This file names a path that is not a plain path inside the harness. Nothing was written. |
| `BUNDLE_SECRET_FOUND` | A file holds a literal secret value. | A file holds what looks like a secret value. A harness never carries one. Nothing was written. |
| `BUNDLE_INVALID` | The decoded files do not load as a harness. The loader's problems come with it, by path and code. | The files in this bundle do not make a harness that loads. Nothing was written. |
| `BUNDLE_FILE_UNSAFE` | The bundle file is a link, not a regular file, not owned by the user, or changed while it was read. A write target is a link or a folder, or is not the file the person agreed to replace. | The bundle file is a link, is not a plain file that you own, or changed while it was read. Nothing was read or written. |
| `BUNDLE_EXISTS` | The command line would write over a file that exists. | A file exists at that place already. Bowerloom does not replace it. Nothing was written. |
| `IMPORT_FOLDER_HAS_HARNESS` | The folder's harness has an entry, instructions, a source or knowledge. | This folder has a harness with parts in it already. An import goes only into a folder with no harness, or with an empty one. Nothing was written. |
| `IMPORT_NEEDS_ACKNOWLEDGEMENT` | An import has tools that run code or reach a host, files that can run, references in a url, argument, command or header, or paths from another computer, and the acknowledgement is missing or not the one the plan showed. | This file holds tools or files that can run, values it reads from this computer, or paths from another computer. Tick that you read them, then import. Nothing was written. |
| `EXPORT_NEEDS_ACKNOWLEDGEMENT` | An export has text that holds a path of this computer, and the acknowledgement is missing or not the one the plan showed. | These files hold a path from this computer. Tick that you read them, then export. Nothing was written. |

## Tests

`test/*.test.mjs` is in the root `npm test` (the repository's coverage test requires it). `test:harness-bundle` runs this folder alone.
