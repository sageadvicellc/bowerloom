/**
 * Path rules for everything the main process reads. A path is read only when its real location is inside a root the
 * person chose (the store, or a folder they added) and no part of it below that root is a link.
 */
import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

export class OutsideRoot extends Error {
  readonly code: 'OUTSIDE_ROOT' | 'THROUGH_LINK' | 'NOT_FOUND';
  constructor(code: 'OUTSIDE_ROOT' | 'THROUGH_LINK' | 'NOT_FOUND', message: string) { super(message); this.code = code; }
}

/** True when `child` is `root` or sits below it. Both must be real, absolute paths. */
export function isInside(root: string, child: string): boolean {
  if (!isAbsolute(root) || !isAbsolute(child)) return false;
  const rel = relative(root, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel) && rel.split(sep)[0] !== '..');
}

/** The real path of a root, or null when it is not there. */
export function realRoot(root: string): string | null {
  try { return realpathSync(root); } catch { return null; }
}

/**
 * Checks `candidate` against `roots` and returns its real path. Refuses a path whose real location is outside every root,
 * and a path that reaches its place through a link below the root.
 */
export function resolveInside(roots: readonly string[], candidate: string): string {
  if (!isAbsolute(candidate) || candidate.includes('\0')) throw new OutsideRoot('OUTSIDE_ROOT', 'The path is not an absolute path.');
  let real: string;
  try { real = realpathSync(candidate); } catch { throw new OutsideRoot('NOT_FOUND', 'The folder is not there.'); }
  for (const root of roots) {
    const realOfRoot = realRoot(root);
    if (realOfRoot === null || !isInside(realOfRoot, real)) continue;
    // Walk the candidate below the root, as written, and refuse a link on the way.
    const written = candidate.startsWith(root) ? relative(root, candidate) : relative(realOfRoot, real);
    let at = candidate.startsWith(root) ? root : realOfRoot;
    for (const part of written.split(sep).filter(Boolean)) {
      at = join(at, part);
      let stat; try { stat = lstatSync(at); } catch { throw new OutsideRoot('NOT_FOUND', 'The folder is not there.'); }
      if (stat.isSymbolicLink()) throw new OutsideRoot('THROUGH_LINK', 'The path goes through a link, which the viewer does not follow.');
    }
    return real;
  }
  throw new OutsideRoot('OUTSIDE_ROOT', 'The path is outside the folders you chose.');
}

/** A name that is one plain path part: no separator, no dot parts, no control character. */
export const isPlainName = (name: string): boolean => name.length > 0 && name.length <= 255 && !/[\0/\\\p{Cc}\p{Cf}]/u.test(name) && name !== '.' && name !== '..';
export const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const isId = (value: unknown): value is string => typeof value === 'string' && value.length <= 64 && ID.test(value);
