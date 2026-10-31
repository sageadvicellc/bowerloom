/**
 * Which files of a bundle can run. A file runs when an agent is told to run it, so a list of bad extensions is never enough: `helper.node`, `setup.hta`, a Mach-O
 * binary named `helper` and `run.sh.txt` with a `#!` line all run. So the rule is an allowlist. A file is DATA only when all of these hold; otherwise it can run,
 * and the person sees it listed with its hash and ticks.
 *  - its name is a named kind of data (below), in any case, and does not end in a space or a dot;
 *  - a text kind goes with valid UTF-8 bytes that hold no NUL; a binary kind (an image or a font) begins with its own signature;
 *  - its first bytes, after any number of UTF-8 byte order marks, are not `#!`, ELF, Mach-O (all four thin forms and the two fat forms) or WebAssembly, and for a
 *    non-text file not PE (`MZ`: two bytes only, so a text note that begins with "MZ" is not taken for a program);
 *  - its name is not a manifest that runs commands (`package.json`, `Cargo.toml`, a compose file, `Makefile`, …).
 * A file with no extension (apart from README, LICENSE and NOTICE), a file with any other extension, a name that ends in a space or a dot, and bytes that are missing
 * are all "can run". The reason is the first that holds: `executable` (the execute bit), `hook` (`hooks.json`), `script` (under `scripts/`), `shebang`, `binary` (the
 * magic bytes of a program, or an image or font whose bytes are not its own kind), `manifest`, `extension` (a known code extension, kept so the screen can say why),
 * then `not-data` for every other file.
 *
 * This list is a screen, not a proof. A tick means "I read what was listed". A text file can still hold commands that a tool may run when an agent is told to
 * run it (`curl x | sh` in a note), and nothing here detects that. Built, not a stub: the tests of stage 1 use it, and lane A calls it for every record.
 */

/** Extensions of files that hold text and nothing that runs. The bytes must be valid UTF-8 with no NUL. `.svg` and `.html` are not here: they can hold script. */
export const TEXT_DATA_EXTENSIONS: readonly string[] = Object.freeze(['.md', '.markdown', '.txt', '.rst', '.json', '.jsonc', '.yaml', '.yml', '.toml', '.csv', '.tsv', '.css']);
/** Extensions of files that hold images or fonts and nothing that runs. The bytes must begin with the kind's own signature. `.pdf` is not here: a PDF can carry script. */
export const BINARY_DATA_EXTENSIONS: readonly string[] = Object.freeze(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.otf']);
export const DATA_EXTENSIONS: readonly string[] = Object.freeze([...TEXT_DATA_EXTENSIONS, ...BINARY_DATA_EXTENSIONS]);
/** Names with no extension that are text data, in any case: README, LICENSE and NOTICE. With a data extension they pass by the extension. */
export const DATA_NAMES: readonly string[] = Object.freeze(['readme', 'license', 'notice']);

/** Base names (lower case) of files that tell a tool which commands to run. They are never data, whatever their extension says. */
export const MANIFEST_NAMES: readonly string[] = Object.freeze([
  'package.json', 'pyproject.toml', 'cargo.toml', 'composer.json', 'taskfile.yml', 'taskfile.yaml', 'justfile', 'makefile', 'gnumakefile', 'dockerfile',
  'gemfile', 'rakefile', 'build.gradle', 'build.gradle.kts', 'pom.xml', 'cmakelists.txt', 'procfile', 'vagrantfile', 'jenkinsfile', 'tox.ini', 'setup.cfg',
]);
/** `docker-compose.yml`, `compose.yaml`, `docker-compose.override.yml` and the like. */
const COMPOSE = /^(?:docker-)?compose(?:\.[^.]+)*\.ya?ml$/;

/** Extensions that are code beyond doubt. Every file with an extension not in DATA_EXTENSIONS can run; this list only gives the reason `extension`. */
export const CODE_EXTENSIONS: readonly string[] = Object.freeze([
  '.sh', '.bash', '.zsh', '.fish', '.ksh', '.csh', '.py', '.pyw', '.pyc', '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.rb', '.pl', '.pm', '.php', '.lua', '.r',
  '.go', '.rs', '.java', '.class', '.swift', '.ex', '.exs', '.groovy', '.kts', '.awk', '.tcl', '.sql', '.ps1', '.psm1', '.bat', '.cmd', '.com', '.scr', '.vbs', '.vbe',
  '.jse', '.wsf', '.hta', '.lnk', '.url', '.desktop', '.plist', '.command', '.app', '.exe', '.dll', '.so', '.dylib', '.node', '.wasm', '.msi', '.pkg', '.dmg', '.jar',
  '.scpt', '.applescript', '.svg', '.html', '.htm', '.pdf', '.ipynb', '.mk',
]);
export type CodeWhy = 'executable' | 'hook' | 'script' | 'shebang' | 'binary' | 'manifest' | 'extension' | 'not-data';

/** Magic bytes of programs, tested on any file after the byte order marks. */
const MAGIC: readonly (readonly number[])[] = [
  [0x7f, 0x45, 0x4c, 0x46], // ELF
  [0xfe, 0xed, 0xfa, 0xce], [0xfe, 0xed, 0xfa, 0xcf], [0xce, 0xfa, 0xed, 0xfe], [0xcf, 0xfa, 0xed, 0xfe], // Mach-O, 32 and 64 bit, both byte orders
  [0xca, 0xfe, 0xba, 0xbe], [0xbe, 0xba, 0xfe, 0xca], // Mach-O fat (the first form is also a Java class)
  [0x00, 0x61, 0x73, 0x6d], // WebAssembly
];
/** PE ("MZ") is two bytes, so it is tested on files that are not text data only. */
const PE = [0x4d, 0x5a];
/** The signature of each binary data extension; every list is one alternative. WebP is `RIFF`, four size bytes, `WEBP`. */
const SIGNATURES: Readonly<Record<string, readonly (readonly (number | null)[])[]>> = Object.freeze({
  '.png': [[0x89, 0x50, 0x4e, 0x47]], '.jpg': [[0xff, 0xd8, 0xff]], '.jpeg': [[0xff, 0xd8, 0xff]], '.gif': [[0x47, 0x49, 0x46, 0x38]],
  '.webp': [[0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50]], '.ico': [[0x00, 0x00, 0x01, 0x00]],
  '.woff': [[0x77, 0x4f, 0x46, 0x46]], '.woff2': [[0x77, 0x4f, 0x46, 0x32]], '.otf': [[0x4f, 0x54, 0x54, 0x4f]],
  '.ttf': [[0x00, 0x01, 0x00, 0x00], [0x74, 0x72, 0x75, 0x65]],
});
const startsWith = (bytes: Uint8Array, at: number, magic: readonly (number | null)[]): boolean => bytes.length >= at + magic.length && magic.every((b, i) => b === null || bytes[at + i] === b);
const utf8 = new TextDecoder('utf-8', { fatal: true });
const validText = (bytes: Uint8Array): boolean => { if (bytes.includes(0)) return false; try { utf8.decode(bytes); return true; } catch { return false; } };

/**
 * The reason a file can run, or null when it is data. `bytes` are the decoded bytes of the file; missing bytes (null, undefined or not a Uint8Array) are not data.
 * Never throws.
 */
export function codeWhy(path: string, bytes: Uint8Array, executable: boolean): CodeWhy | null {
  if (executable) return 'executable';
  if (typeof path !== 'string' || !(bytes instanceof Uint8Array)) return 'not-data';
  if (path === 'hooks.json') return 'hook';
  if (path.startsWith('scripts/')) return 'script';
  const name = path.slice(path.lastIndexOf('/') + 1);
  const lower = name.toLowerCase();
  if (MANIFEST_NAMES.includes(lower) || COMPOSE.test(lower)) return 'manifest';
  let at = 0;
  while (startsWith(bytes, at, [0xef, 0xbb, 0xbf])) at += 3;
  if (startsWith(bytes, at, [0x23, 0x21])) return 'shebang';
  if (MAGIC.some(m => startsWith(bytes, at, m))) return 'binary';
  const dot = name.lastIndexOf('.');
  if (name === '' || /[ .]$/.test(name)) return 'not-data';
  const ext = dot > 0 ? lower.slice(dot) : '';
  const textKind = TEXT_DATA_EXTENSIONS.includes(ext) || (dot <= 0 && DATA_NAMES.includes(lower));
  if (!textKind && startsWith(bytes, at, PE)) return 'binary';
  if (textKind) return validText(bytes) ? null : 'not-data';
  if (CODE_EXTENSIONS.includes(ext)) return 'extension';
  if (BINARY_DATA_EXTENSIONS.includes(ext)) return SIGNATURES[ext]!.some(sig => startsWith(bytes, 0, sig)) ? null : 'binary';
  return 'not-data';
}
