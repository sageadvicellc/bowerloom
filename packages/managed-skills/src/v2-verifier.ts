/**
 * The managed owner of paths inside `.bowerloom/` (build plan 01, section 2): `managed/` and `managed-pending.json`.
 * It verifies the whole `managed/` namespace at once and accepts an entry only when it accounted for it: the exact
 * ignore file, the two fixed folders, and the canonical copy and catalog pins of each item's current receipt.
 * Anything else, including a planted file, a drifted item or an item with no receipt here, is refused.
 */
import fs from 'node:fs';
import { join, relative } from 'node:path';
import { ManagedSkillError, check, directory, exists, names, path as projectPath } from './observed.js';
import { MANAGED_ITEM_CODES, MANAGED_ROOT, catalogItem, currentV2, ignoreState, itemId, ownSurface } from './v2-observed.js';
import type { OwnerVerifier, OwnerVerdict, OwnedEntryKind } from '../../project-context/src/types.js';

const codeOf = (e: unknown): string => e instanceof ManagedSkillError && MANAGED_ITEM_CODES.includes(e.code) ? e.code : 'MANAGED_SKILL_REFUSED';
/** Every entry of `.bowerloom/managed/`, relative to `.bowerloom/`, that a current receipt or the fixed layout accounts for. */
function accounted(projectDir: string, itemsRoot: string, signal: AbortSignal): Map<string, OwnedEntryKind> {
  const live = () => check(!signal.aborted, 'MANAGED_SKILL_ABORTED'), bowerloom = join(projectDir, '.bowerloom'), root = join(projectDir, MANAGED_ROOT);
  const known = new Map<string, OwnedEntryKind>([['managed', 'directory']]); live(); directory(root);
  check(ignoreState(projectDir) === 'exact', 'MANAGED_SKILL_LOCAL_DRIFT'); known.set('managed/.gitignore', 'file');
  for (const folder of ['skills', 'catalog']) if (exists(join(root, folder))) { directory(join(root, folder)); known.set('managed/' + folder, 'directory'); }
  if (exists(join(root, 'catalog'))) for (const n of names(join(root, 'catalog'))) {
    live(); const item = catalogItem(n), state = join(itemsRoot, itemId(item)); check(exists(state), 'MANAGED_SKILL_PATH_OCCUPIED'); directory(state, true);
    const receipt = currentV2(projectDir, state, item); check(receipt !== null);
    for (const s of receipt.installed.filter(ownSurface)) for (const pin of s.pins ?? []) if (pin.path.startsWith(root + '/')) known.set(relative(bowerloom, pin.path), pin.sha256 === null ? 'directory' : 'file');
  }
  // Every entry on disk must be one of them, with the same kind.
  let count = 0;
  const walk = (abs: string): void => {
    live(); check(++count <= 4096); const s = fs.lstatSync(abs), rel = relative(bowerloom, abs);
    check(!s.isSymbolicLink() && known.get(rel) === (s.isDirectory() ? 'directory' : s.isFile() ? 'file' : undefined), 'MANAGED_SKILL_LOCAL_DRIFT');
    if (s.isDirectory()) for (const n of names(abs)) walk(join(abs, n));
  };
  walk(root); live(); return known;
}
export function managedVerifier(projectDir: string, itemsRoot: string): OwnerVerifier {
  projectPath(projectDir); projectPath(itemsRoot);
  const claims = (p: string): boolean => p === 'managed' || p.startsWith('managed/') || p === 'managed-pending.json';
  return Object.freeze({
    owner: 'managed' as const,
    claims: (p: string, _kind: OwnedEntryKind): boolean => typeof p === 'string' && claims(p),
    async verify(p: string, kind: OwnedEntryKind, signal: AbortSignal): Promise<OwnerVerdict> {
      try {
        check(typeof p === 'string' && claims(p) && signal instanceof AbortSignal && !signal.aborted, signal?.aborted ? 'MANAGED_SKILL_ABORTED' : 'MANAGED_SKILL_REFUSED');
        // A pending marker means an interrupted operation. Only `skills recover` resolves it.
        if (p === 'managed-pending.json') { check(kind === 'file'); return Object.freeze({ result: 'refused', code: 'MANAGED_SKILL_RECOVERY_REQUIRED' }); }
        const known = accounted(projectDir, itemsRoot, signal); check(known.get(p) === kind, 'MANAGED_SKILL_LOCAL_DRIFT');
        return Object.freeze({ result: 'verified' });
      } catch (e) { return Object.freeze({ result: 'refused', code: codeOf(e) }); }
    },
  });
}
