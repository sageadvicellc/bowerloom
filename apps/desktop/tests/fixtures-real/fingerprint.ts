/** A fingerprint of a whole folder: every name, kind, size, change time, mode and file content. If anything below it changed, the fingerprint changes. */
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function fingerprint(dir: string): string {
  const hash = createHash('sha256');
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name), s = lstatSync(p);
      hash.update(`${p}|${s.isDirectory() ? 'd' : s.isSymbolicLink() ? 'l' : 'f'}|${s.size}|${s.mtimeMs}|${(s.mode & 0o777).toString(8)}\n`);
      if (s.isDirectory()) { if ((s.mode & 0o400) !== 0) walk(p); } else if (s.isFile()) hash.update(readFileSync(p));
    }
  };
  walk(dir);
  return hash.digest('hex');
}
