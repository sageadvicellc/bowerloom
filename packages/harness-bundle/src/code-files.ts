/**
 * Which files of a bundle can run. A file runs when an agent is told to run it, so a list of bad extensions is never enough: `helper.node`, `setup.hta`, a Mach-O
 * binary named `helper` and `run.sh.txt` with a `#!` line all run. So the rule is an allowlist. A file is DATA only when all of these hold; otherwise it can run,
 * and the person sees it listed with its hash and ticks.
 *  - its name ends in a data extension (DATA_EXTENSIONS), in any case, and the name does not end in a space or a dot;
 *  - a text data extension (`.md`, `.json`, …) goes with valid UTF-8 bytes;
 *  - its first bytes, after an optional UTF-8 byte order mark, are not `#!`, ELF, Mach-O (all four thin forms and the two fat forms), PE (`MZ`) or WebAssembly.
 * A file with no extension, a file with any other extension, a name that ends in a space or a dot, and bytes that are missing are all "can run".
 * The reason is the first that holds: `executable` (the execute bit), `hook` (`hooks.json`), `script` (under `scripts/`), `shebang`, `binary` (the magic bytes),
 * `extension` (a known code extension, kept so the screen can say why), then `not-data` for every other file.
 * Built, not a stub: the tests of stage 1 use it, and lane A calls it for every record.
 */

/** Extensions of files that hold text and nothing that runs. The bytes must be valid UTF-8. `.svg` is not here: it can hold script. */
export const TEXT_DATA_EXTENSIONS: readonly string[] = Object.freeze(['.md', '.markdown', '.txt', '.json', '.jsonc', '.yaml', '.yml', '.toml', '.csv', '.tsv']);
/** Extensions of files that hold images, a document or a font, and nothing that runs. */
export const BINARY_DATA_EXTENSIONS: readonly string[] = Object.freeze(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.woff', '.woff2', '.ttf', '.otf']);
export const DATA_EXTENSIONS: readonly string[] = Object.freeze([...TEXT_DATA_EXTENSIONS, ...BINARY_DATA_EXTENSIONS]);

/** Extensions that are code beyond doubt. Every file with an extension not in DATA_EXTENSIONS can run; this list only gives the reason `extension`. */
export const CODE_EXTENSIONS: readonly string[] = Object.freeze([
  '.sh', '.bash', '.zsh', '.fish', '.ksh', '.csh', '.py', '.pyw', '.pyc', '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.rb', '.pl', '.pm', '.php', '.lua', '.r',
  '.go', '.rs', '.java', '.class', '.swift', '.ex', '.exs', '.groovy', '.kts', '.awk', '.tcl', '.sql', '.ps1', '.psm1', '.bat', '.cmd', '.com', '.scr', '.vbs', '.vbe',
  '.jse', '.wsf', '.hta', '.lnk', '.url', '.desktop', '.plist', '.command', '.app', '.exe', '.dll', '.so', '.dylib', '.node', '.wasm', '.msi', '.pkg', '.dmg', '.jar',
  '.scpt', '.applescript', '.svg', '.ipynb', '.mk',
]);
export type CodeWhy = 'executable' | 'hook' | 'script' | 'shebang' | 'binary' | 'extension' | 'not-data';

const MAGIC: readonly (readonly number[])[] = [
  [0x7f, 0x45, 0x4c, 0x46], // ELF
  [0xfe, 0xed, 0xfa, 0xce], [0xfe, 0xed, 0xfa, 0xcf], [0xce, 0xfa, 0xed, 0xfe], [0xcf, 0xfa, 0xed, 0xfe], // Mach-O, 32 and 64 bit, both byte orders
  [0xca, 0xfe, 0xba, 0xbe], [0xbe, 0xba, 0xfe, 0xca], // Mach-O fat (the first form is also a Java class)
  [0x4d, 0x5a], // PE, "MZ"
  [0x00, 0x61, 0x73, 0x6d], // WebAssembly
];
const startsWith = (bytes: Uint8Array, at: number, magic: readonly number[]): boolean => bytes.length >= at + magic.length && magic.every((b, i) => bytes[at + i] === b);
const utf8 = new TextDecoder('utf-8', { fatal: true });
const validUtf8 = (bytes: Uint8Array): boolean => { try { utf8.decode(bytes); return true; } catch { return false; } };

/**
 * The reason a file can run, or null when it is data. `bytes` are the decoded bytes of the file; missing bytes (null, undefined or not a Uint8Array) are not data.
 * Never throws.
 */
export function codeWhy(path: string, bytes: Uint8Array, executable: boolean): CodeWhy | null {
  if (executable) return 'executable';
  if (typeof path !== 'string' || !(bytes instanceof Uint8Array)) return 'not-data';
  if (path === 'hooks.json') return 'hook';
  if (path.startsWith('scripts/')) return 'script';
  const at = startsWith(bytes, 0, [0xef, 0xbb, 0xbf]) ? 3 : 0;
  if (startsWith(bytes, at, [0x23, 0x21])) return 'shebang';
  if (MAGIC.some(m => startsWith(bytes, at, m))) return 'binary';
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (name === '' || /[ .]$/.test(name) || dot <= 0) return 'not-data';
  const ext = name.slice(dot).toLowerCase();
  if (CODE_EXTENSIONS.includes(ext)) return 'extension';
  if (TEXT_DATA_EXTENSIONS.includes(ext)) return validUtf8(bytes) ? null : 'not-data';
  return BINARY_DATA_EXTENSIONS.includes(ext) ? null : 'not-data';
}
