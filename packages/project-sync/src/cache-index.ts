/**
 * Where a pin lives in the machine's skills cache (Hanna, global skill cache). The cache sits in the private state
 * root, `<stateRoot>/cache`, and serves every project on the machine, for npm and GitHub content alike.
 *
 * A pin's content key is sha256 over its normalized acquisition request with the skills.json entry id left out: the
 * source and its pin (version or commit), the integrity or trees, the source root, the skill name and allowed tools,
 * the license and the file inventory. Teams never reach a request. The same pin under two ids, or in two projects,
 * has one key. Each key maps to eight fixed operation ids: sha256 over the key and an attempt number 0 to 7, cut to
 * 32 hex. Sync reuses the first completed one whose receipt holds what the entry pins; it leaves partial ones
 * untouched; it fetches into the first id that is not used yet, under the cache lock.
 *
 * Earlier betas kept one cache per project, `<stateRoot>/<projectId>/cache`, keyed on the request with the entry id
 * in it. That cache is a read-only fallback: it is looked up after the machine cache, never written, moved or deleted.
 * Nothing here writes or reads the network.
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
/** The digest format of the per-project caches of earlier betas: the request with the entry id in it. */
const REQUEST_FORMAT = 'bowerloom/skills-sync-request/v1beta1';
/** The content key format of the machine cache: the request with the entry id replaced by the skill name. */
const CONTENT_FORMAT = 'bowerloom/skill-content-key/v1beta1';
const OPERATION_FORMAT = 'bowerloom/skills-sync-cache-operation/v1beta1';

interface Pinned<K extends 'npm' | 'git', R> {
  kind: K;
  /** The entry's request, with the entry id as `skill.id`. Project-side checks compare against it. */
  request: R;
  /** The request a cache operation stores: the same, with `skill.id` set to the skill name, so no entry id is in it. */
  cacheRequest: R;
  /** The content key: the digest of `cacheRequest`. It names the machine cache operations of this pin. */
  digest: string;
  /** The digest of `request`, which named this pin's operations in the per-project caches of earlier betas. */
  legacyDigest: string;
}
export type PinnedRequest = Pinned<'npm', NpmAcquisitionRequest> | Pinned<'git', GitAcquisitionRequest>;
/** A request whose entry id is the skill name: what the content key covers, and nothing of skills.json beyond it. */
function contentOf<R extends { skill: { id: string; name: string } }>(request: R): R { return { ...request, skill: { ...request.skill, id: request.skill.name } }; }
/**
 * The acquisition request of a pinned entry, normalized by the existing planner (files and references sorted), its
 * content request and both digests. The probe binding names no real folder: these plans can be compared, never acquired.
 */
export function entryRequest(entry: PinnedEntry): PinnedRequest {
  if (entry.source.kind === 'npm') {
    const request = planNpmAcquisition(toNpmRequest(entry as NpmEntry), probeBinding()).request as NpmAcquisitionRequest;
    const cacheRequest = planNpmAcquisition(contentOf(request), probeBinding()).request as NpmAcquisitionRequest;
    return { kind: 'npm', request, cacheRequest, digest: revisionOf({ format: CONTENT_FORMAT, kind: 'npm', request: cacheRequest }), legacyDigest: revisionOf({ format: REQUEST_FORMAT, kind: 'npm', request }) };
  }
  const request = planGitAcquisition(toGitRequest(entry as GitEntry), probeBinding()).request as GitAcquisitionRequest;
  const cacheRequest = planGitAcquisition(contentOf(request), probeBinding()).request as GitAcquisitionRequest;
  return { kind: 'git', request, cacheRequest, digest: revisionOf({ format: CONTENT_FORMAT, kind: 'git', request: cacheRequest }), legacyDigest: revisionOf({ format: REQUEST_FORMAT, kind: 'git', request }) };
}
/** The fixed operation id of one attempt (0 to 7) of one request digest. */
export function cacheOperationId(digest: string, attempt: number): string {
  if (!/^[a-f0-9]{64}$/.test(digest) || !Number.isSafeInteger(attempt) || attempt < 0 || attempt >= CACHE_ATTEMPTS) throw new TypeError('cacheOperationId takes a request digest and an attempt from 0 to 7.');
  return createHash('sha256').update(JSON.stringify([OPERATION_FORMAT, digest, attempt])).digest('hex').slice(0, 32);
}

const same = (a: unknown, b: unknown): boolean => revisionOf(a) === revisionOf(b);
/** A skill record without its id: the name, source root and allowed tools that a content key covers. */
const content = (skill: unknown): unknown => { if (skill === null || typeof skill !== 'object') return skill; const { id: _id, ...rest } = skill as Record<string, unknown>; return rest; };
/**
 * True when a completed cache receipt holds exactly what the request pins: source, skill, files, license, references.
 * The skill is compared without its id: a machine cache operation stores the skill name there, and an operation of an
 * earlier per-project cache stores the entry id. Neither is what the content key covers.
 */
export function receiptMatches(pinned: PinnedRequest, receipt: Readonly<AcquiredSkillCacheReceipt>): boolean {
  const r = pinned.request, s = receipt.source as unknown as Record<string, unknown>;
  const source = pinned.kind === 'npm'
    ? s.kind === 'npm' && s.registry === 'https://registry.npmjs.org' && s.package === (r as NpmAcquisitionRequest).package && s.version === (r as NpmAcquisitionRequest).version
      && s.integrity === (r as NpmAcquisitionRequest).integrity && s.metadataSha256 === r.metadataSha256 && s.publisher === (r as NpmAcquisitionRequest).publisher && s.declaredLicense === r.declaredLicense
    : s.kind === 'git' && s.host === 'github.com' && s.repository === (r as GitAcquisitionRequest).repository && s.commit === (r as GitAcquisitionRequest).commit
      && s.tree === (r as GitAcquisitionRequest).tree && same(s.pathTrees, (r as GitAcquisitionRequest).pathTrees) && s.metadataSha256 === r.metadataSha256 && s.declaredLicense === r.declaredLicense;
  return source && same(content(receipt.skill), content(r.skill)) && same(receipt.inventory, r.files) && same(receipt.license, r.license) && same(receipt.references, r.references);
}

export interface CacheLookup {
  status: 'cached' | 'needs-fetch';
  /** The cache folder of `operationId`: the machine cache, or for a cached pin, an earlier per-project cache. */
  root: string;
  /** The completed operation to read (cached), or the first unused id to fetch into (needs-fetch). */
  operationId: string;
  snapshotRevision: string | null; receiptRevision: string | null;
  /** Earlier attempts in the machine cache that exist but are not completed. They are left as they are. */
  partial: string[];
}
/** The machine cache, and the read-only per-project cache of an earlier beta (null when there is none to read). */
export interface CacheRoots { cacheRoot: string; legacyCacheRoot: string | null }
const present = (p: string): boolean => { try { fs.lstatSync(p); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; } };
type Found = { kind: 'cached'; lookup: CacheLookup } | { kind: 'open'; firstUnused: string | null; partial: string[] };
/** The attempts of one digest in one cache folder. Reads only. */
async function scan(root: string, digest: string, pinned: PinnedRequest): Promise<Found> {
  const partial: string[] = []; let firstUnused: string | null = null;
  for (let attempt = 0; attempt < CACHE_ATTEMPTS; attempt++) {
    const operationId = cacheOperationId(digest, attempt);
    if (!present(root) || !present(join(root, 'op-' + operationId))) { firstUnused ??= operationId; continue; }
    let inspected;
    try { inspected = await inspectSkillCache({ root, operationId }); } catch { partial.push(operationId); continue; }
    if (inspected.status !== 'COMPLETED' || inspected.receipt === null || inspected.activeOwner) { partial.push(operationId); continue; }
    if (!receiptMatches(pinned, inspected.receipt)) throw syncError('SKILLS_SYNC_CONTENT_MISMATCH');
    return { kind: 'cached', lookup: { status: 'cached', root, operationId, snapshotRevision: inspected.snapshotRevision, receiptRevision: inspected.receipt.revision, partial } };
  }
  return { kind: 'open', firstUnused, partial };
}
/**
 * Reads only, and never writes either folder. The machine cache comes first; then, read-only, the per-project cache
 * of an earlier beta. A completed operation whose stored request differs from the entry refuses
 * SKILLS_SYNC_CONTENT_MISMATCH: its id was derived from this request, so its bytes are not what skills.json pins.
 */
export async function lookupCache(roots: CacheRoots, pinned: PinnedRequest): Promise<CacheLookup> {
  const machine = await scan(roots.cacheRoot, pinned.digest, pinned);
  if (machine.kind === 'cached') return machine.lookup;
  if (roots.legacyCacheRoot !== null && present(roots.legacyCacheRoot)) {
    const legacy = await scan(roots.legacyCacheRoot, pinned.legacyDigest, pinned);
    if (legacy.kind === 'cached') return { ...legacy.lookup, partial: machine.partial };
  }
  if (machine.firstUnused === null) throw syncError('SKILLS_CACHE_RECOVERY_REQUIRED', 'Inspect them with bowerloom skills source inspect (bowerloom help advanced).');
  return { status: 'needs-fetch', root: roots.cacheRoot, operationId: machine.firstUnused, snapshotRevision: null, receiptRevision: null, partial: machine.partial };
}
