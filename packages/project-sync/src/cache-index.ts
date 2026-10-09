/**
 * Where a pin lives in the project's private cache (build plan 01, section 2, "Cache operations").
 * Each pinned entry maps to its normalized acquisition request and to eight fixed operation ids:
 * sha256 over the request digest and an attempt number 0 to 7, cut to 32 hex. Sync reuses the first completed one
 * whose stored request equals the entry's; it leaves partial ones untouched and reports them; it fetches into the
 * first id that is not used yet. Nothing here writes or reads the network.
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { revisionOf } from '../../skill-sources/src/validation.js';
import { inspectSkillCache } from '../../skill-sources/src/cache.js';
import type { AcquiredSkillCacheReceipt } from '../../skill-sources/src/cache.js';
import { planNpmAcquisition } from '../../skill-sources/src/npm.js';
import type { NpmAcquisitionRequest } from '../../skill-sources/src/npm.js';
import { planGitAcquisition } from '../../skill-sources/src/git.js';
import type { GitAcquisitionRequest } from '../../skill-sources/src/git.js';
import { toNpmRequest, toGitRequest, probeBinding } from '../../skill-manifest/src/requests.js';
import type { GitEntry, NpmEntry, PinnedEntry } from '../../skill-manifest/src/schema.js';
import { syncError } from './refusal.js';

export const CACHE_ATTEMPTS = 8;
const REQUEST_FORMAT = 'bowerloom/skills-sync-request/v1beta1';
const OPERATION_FORMAT = 'bowerloom/skills-sync-cache-operation/v1beta1';

export type PinnedRequest = { kind: 'npm'; request: NpmAcquisitionRequest; digest: string } | { kind: 'git'; request: GitAcquisitionRequest; digest: string };
/**
 * The acquisition request of a pinned entry, normalized by the existing planner (files and references sorted), and
 * its digest. The probe binding names no real folder: this plan can be compared, never acquired.
 */
export function entryRequest(entry: PinnedEntry): PinnedRequest {
  if (entry.source.kind === 'npm') {
    const request = planNpmAcquisition(toNpmRequest(entry as NpmEntry), probeBinding()).request as NpmAcquisitionRequest;
    return { kind: 'npm', request, digest: revisionOf({ format: REQUEST_FORMAT, kind: 'npm', request }) };
  }
  const request = planGitAcquisition(toGitRequest(entry as GitEntry), probeBinding()).request as GitAcquisitionRequest;
  return { kind: 'git', request, digest: revisionOf({ format: REQUEST_FORMAT, kind: 'git', request }) };
}
/** The fixed operation id of one attempt (0 to 7) of one request digest. */
export function cacheOperationId(digest: string, attempt: number): string {
  if (!/^[a-f0-9]{64}$/.test(digest) || !Number.isSafeInteger(attempt) || attempt < 0 || attempt >= CACHE_ATTEMPTS) throw new TypeError('cacheOperationId takes a request digest and an attempt from 0 to 7.');
  return createHash('sha256').update(JSON.stringify([OPERATION_FORMAT, digest, attempt])).digest('hex').slice(0, 32);
}

const same = (a: unknown, b: unknown): boolean => revisionOf(a) === revisionOf(b);
/** True when a completed cache receipt holds exactly what the request pins: source, skill, files, license, references. */
export function receiptMatches(pinned: PinnedRequest, receipt: Readonly<AcquiredSkillCacheReceipt>): boolean {
  const r = pinned.request, s = receipt.source as unknown as Record<string, unknown>;
  const source = pinned.kind === 'npm'
    ? s.kind === 'npm' && s.registry === 'https://registry.npmjs.org' && s.package === (r as NpmAcquisitionRequest).package && s.version === (r as NpmAcquisitionRequest).version
      && s.integrity === (r as NpmAcquisitionRequest).integrity && s.metadataSha256 === r.metadataSha256 && s.publisher === (r as NpmAcquisitionRequest).publisher && s.declaredLicense === r.declaredLicense
    : s.kind === 'git' && s.host === 'github.com' && s.repository === (r as GitAcquisitionRequest).repository && s.commit === (r as GitAcquisitionRequest).commit
      && s.tree === (r as GitAcquisitionRequest).tree && same(s.pathTrees, (r as GitAcquisitionRequest).pathTrees) && s.metadataSha256 === r.metadataSha256 && s.declaredLicense === r.declaredLicense;
  return source && same(receipt.skill, r.skill) && same(receipt.inventory, r.files) && same(receipt.license, r.license) && same(receipt.references, r.references);
}

export interface CacheLookup {
  status: 'cached' | 'needs-fetch';
  /** The completed operation to read (cached), or the first unused id to fetch into (needs-fetch). */
  operationId: string;
  snapshotRevision: string | null; receiptRevision: string | null;
  /** Earlier attempts that exist but are not completed. They are left as they are. */
  partial: string[];
}
const present = (p: string): boolean => { try { fs.lstatSync(p); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; } };
/**
 * Reads only. A completed operation whose stored request differs from the entry refuses SKILLS_SYNC_CONTENT_MISMATCH:
 * its id was derived from this request, so its bytes are not what skills.json pins.
 */
export async function lookupCache(cacheRoot: string, pinned: PinnedRequest): Promise<CacheLookup> {
  const partial: string[] = []; let firstUnused: string | null = null;
  for (let attempt = 0; attempt < CACHE_ATTEMPTS; attempt++) {
    const operationId = cacheOperationId(pinned.digest, attempt);
    if (!present(cacheRoot) || !present(join(cacheRoot, 'op-' + operationId))) { firstUnused ??= operationId; continue; }
    let inspected;
    try { inspected = await inspectSkillCache({ root: cacheRoot, operationId }); } catch { partial.push(operationId); continue; }
    if (inspected.status !== 'COMPLETED' || inspected.receipt === null || inspected.activeOwner) { partial.push(operationId); continue; }
    if (!receiptMatches(pinned, inspected.receipt)) throw syncError('SKILLS_SYNC_CONTENT_MISMATCH');
    return { status: 'cached', operationId, snapshotRevision: inspected.snapshotRevision, receiptRevision: inspected.receipt.revision, partial };
  }
  if (firstUnused === null) throw syncError('SKILLS_CACHE_RECOVERY_REQUIRED', 'Inspect them with bowerloom skills source inspect (bowerloom help advanced).');
  return { status: 'needs-fetch', operationId: firstUnused, snapshotRevision: null, receiptRevision: null, partial };
}
