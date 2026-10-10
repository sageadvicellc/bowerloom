/**
 * `skills add` keeps the bytes it verified in the machine's skills cache (Hanna, global skill cache, phase 2), so a
 * later `skills sync` of that pin needs no second download and works with --offline.
 *
 * It runs after skills.json is written, and only on bytes the resolver already verified against the new entry. It
 * reads no network. It creates only the shared folders (the state root chain and the cache, mode 0700), never this
 * project's own private folders. Under the cache lock it looks the pin up again: a pin already cached is left as it
 * is. Otherwise it stores the bytes in the first unused operation id through `seedSkillCache`, which checks every
 * byte against the plan again and reads the stored bytes back. A failure never undoes the pin: it is reported.
 */
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { DefinitionError } from '../../contracts/src/index.js';
import { withCacheLock } from '../../project-context/src/index.js';
import type { ProjectContext } from '../../project-context/src/types.js';
import { observeSkillCacheRoot, refusalSummary, seedSkillCache } from '../../skill-sources/src/cache.js';
import { planNpmAcquisition } from '../../skill-sources/src/npm.js';
import { planGitAcquisition } from '../../skill-sources/src/git.js';
import { directory, exists } from '../../managed-skills/src/observed.js';
import type { PinnedEntry } from '../../skill-manifest/src/schema.js';
import type { VerifiedBytes } from '../../skill-manifest/src/content.js';
import { entryRequest, lookupCache, receiptMatches } from './cache-index.js';
import { MIN_FREE_BYTES, stateLayout } from './plan.js';
import { syncError } from './refusal.js';

/** How long a seed waits for the cache lock that another command holds. A seed that cannot wait is reported. */
export const SEED_LOCK_WAIT_MS = 60000;
/** `seeded`: this run stored the bytes. `present`: the cache already held this pin. `failed`: nothing was stored. */
export type SeedResult = { root: string; status: 'seeded' | 'present' } | { root: string; status: 'failed'; codes: string[] };

/** The fixed codes of a seed failure: a Bowerloom refusal's code, or the listed cache codes. Never a message. */
function codesOf(error: unknown): string[] {
  if (error instanceof DefinitionError) return [error.code];
  const summary = refusalSummary(error); return [...summary.codes];
}
/** Creates the missing shared folders of the state chain and the cache, mode 0700. Another run may create one first. */
function sharedFolders(layout: { root: string; missing: string[] }): void {
  try {
    for (const p of layout.missing) {
      if (p === layout.root || p.startsWith(layout.root + '/')) continue;
      directory(dirname(p));
      if (!exists(p)) { try { fs.mkdirSync(p, { mode: 0o700 }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; } }
      directory(p, true);
    }
  } catch { throw syncError('SKILLS_STATE_UNSAFE'); }
}

/** Seeds the machine cache with one pinned entry's verified bytes. Never throws: a failure is the result. */
export async function seedPin(input: { project: ProjectContext; stateRoot: string }, entry: PinnedEntry, bytes: VerifiedBytes, signal: AbortSignal): Promise<SeedResult> {
  const root = join(input.stateRoot, 'cache');
  try {
    const layout = stateLayout(input), pinned = entryRequest(entry);
    if (bytes.kind !== pinned.kind) throw syncError('SKILLS_SYNC_CONTENT_MISMATCH');
    sharedFolders(layout);
    return await withCacheLock(layout.cacheRoot, signal, async held => {
      const found = await lookupCache({ cacheRoot: layout.cacheRoot, legacyCacheRoot: null }, pinned);
      if (found.status === 'cached') return { root, status: 'present' as const };
      held.assertHeld();
      const binding = observeSkillCacheRoot(layout.cacheRoot, found.operationId, MIN_FREE_BYTES);
      const plan = pinned.kind === 'npm' ? planNpmAcquisition(pinned.cacheRequest, binding) : planGitAcquisition(pinned.cacheRequest, binding);
      const receipt = await seedSkillCache(plan, plan.revision, bytes.metadata, bytes.data, signal);
      if (!receiptMatches(pinned, receipt) || receipt.operationId !== found.operationId) throw syncError('SKILLS_SYNC_CONTENT_MISMATCH');
      return { root, status: 'seeded' as const };
    }, { waitMs: SEED_LOCK_WAIT_MS });
  } catch (error) { return { root, status: 'failed', codes: codesOf(error) }; }
}
