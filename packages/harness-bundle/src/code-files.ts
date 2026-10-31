/**
 * Which files of a bundle can run. A file runs when an agent is told to run it, so the execute bit and the folder `scripts/` are not the whole answer: a skill may
 * carry `skills/x/run.sh` with no execute bit and tell the agent to run it. So a file is classed as code by, in this order:
 *  1. `executable`: it has an execute bit;
 *  2. `hook`: it is `hooks.json`, the file that names the commands a hook runs;
 *  3. `script`: it is under `scripts/`;
 *  4. `extension`: its name ends in one of CODE_EXTENSIONS, in any case, anywhere in the bundle;
 *  5. `shebang`: its bytes begin with `#!`, anywhere in the bundle.
 * Built, not a stub: the tests of stage 1 use it, and lane A calls it for every record.
 */
export const CODE_EXTENSIONS: readonly string[] = Object.freeze([
  '.sh', '.bash', '.zsh', '.fish', '.ksh', '.csh', '.py', '.pyw', '.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.rb', '.pl', '.pm', '.php', '.lua', '.r',
  '.ps1', '.psm1', '.bat', '.cmd', '.vbs', '.wsf', '.command', '.app', '.exe', '.dll', '.so', '.dylib', '.jar', '.scpt', '.applescript',
]);
export type CodeWhy = 'executable' | 'hook' | 'script' | 'extension' | 'shebang';

/** The reason a file counts as code, or null. `bytes` are the decoded bytes of the file; only the first two are read. */
export function codeWhy(path: string, bytes: Uint8Array, executable: boolean): CodeWhy | null {
  if (executable) return 'executable';
  if (path === 'hooks.json') return 'hook';
  if (path.startsWith('scripts/')) return 'script';
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  if (CODE_EXTENSIONS.some(ext => name.endsWith(ext) && name.length > ext.length)) return 'extension';
  if (bytes.length >= 2 && bytes[0] === 0x23 && bytes[1] === 0x21) return 'shebang';
  return null;
}
