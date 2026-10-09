/**
 * Registered owners of paths inside `.bowerloom/` (build plan 01, section 2). `inspectStartup` asks them about any entry
 * the startup receipt does not account for. A path passes only when exactly one owner claims it and that owner
 * verifies it. Without owners, `inspectStartup` behaves as it did at cc117ac.
 */
import type { OwnedEntryKind, OwnerName, OwnerVerifier } from '../../project-context/src/types.js';

/** At most this many owners. There are three: authoring, manifest and managed. */
export const OWNER_LIMIT = 8;
const NAMES: readonly OwnerName[] = ['authoring', 'manifest', 'managed'];
const CODE = /^[A-Z][A-Z0-9_]{0,99}$/;

/** What one owner said about one entry. */
export type OwnerOutcome =
  | { readonly result: 'verified' | 'edited'; readonly owner: OwnerName }
  | { readonly result: 'refused'; readonly code: string }
  | { readonly result: 'unclaimed' };

/** True for a list of at most OWNER_LIMIT verifiers, each with a known owner name and the two functions. */
export function validOwners(value: unknown): value is readonly OwnerVerifier[] {
  return Array.isArray(value) && value.length <= OWNER_LIMIT && value.every(o => o !== null && typeof o === 'object'
    && NAMES.includes((o as OwnerVerifier).owner) && typeof (o as OwnerVerifier).claims === 'function' && typeof (o as OwnerVerifier).verify === 'function');
}

function claimsSafely(owner: OwnerVerifier, path: string, kind: OwnedEntryKind): boolean {
  try { return owner.claims(path, kind) === true; } catch { return false; }
}

/**
 * Asks the owners about one entry. No claim: `unclaimed`. Two or more claims: OWNER_CONFLICT, and no owner is asked.
 * One claim: that owner's verdict. A verifier that throws, or answers with anything but an exact verdict, is
 * OWNER_REFUSED. `path` is relative to `.bowerloom/`.
 */
export async function askOwners(owners: readonly OwnerVerifier[], path: string, kind: OwnedEntryKind, signal: AbortSignal): Promise<OwnerOutcome> {
  const claimants = owners.filter(owner => claimsSafely(owner, path, kind));
  if (claimants.length === 0) return { result: 'unclaimed' };
  if (claimants.length > 1) return { result: 'refused', code: 'OWNER_CONFLICT' };
  const owner = claimants[0]!;
  let verdict: unknown;
  try { verdict = await owner.verify(path, kind, signal); } catch { return { result: 'refused', code: 'OWNER_REFUSED' }; }
  if (verdict === null || typeof verdict !== 'object') return { result: 'refused', code: 'OWNER_REFUSED' };
  const keys = Object.keys(verdict), v = verdict as { result?: unknown; code?: unknown };
  if ((v.result === 'verified' || v.result === 'edited') && keys.length === 1) return { result: v.result, owner: owner.owner };
  if (v.result === 'refused' && keys.length === 2 && typeof v.code === 'string' && CODE.test(v.code)) return { result: 'refused', code: v.code };
  return { result: 'refused', code: 'OWNER_REFUSED' };
}
