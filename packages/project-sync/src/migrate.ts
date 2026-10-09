/**
 * `skills migrate plan|apply --state <v1-state-dir>` (build plan 01, section 6). One v1beta1 install becomes one
 * v1beta2 item through the M4 `migrate` operation, which moves `.bowerloom-skills/` into its operation folder as a
 * backup and publishes the v2 surfaces for the skills.json harnesses (plus the v1 harness: none is dropped).
 *
 * Plan requires a clean v1 inspection (committed, no marker, no drift) and a skills.json entry with the same source
 * pin and file hashes; without one it refuses and prints the exact `skills add` command. The pinned bytes come from
 * the project's private cache, else from the cache the v1 install read, else they are fetched in phase A, as in sync.
 * The v1 private state folder is read, never written.
 */
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { strictJson } from '../../codex-adapter/src/safe.js';
import { revisionOf, freezeSkillData, relativeSkillPath } from '../../skill-sources/src/validation.js';
import { readAcquiredSkillCache } from '../../skill-sources/src/cache.js';
import type { AcquiredSkillCacheReceipt, AcquiredSkillCacheSelector } from '../../skill-sources/src/cache.js';
import { MARKER as V1_MARKER, exists, inspectObservedManagedSkill, parsed, path as managedPath, raw } from '../../managed-skills/src/observed.js';
import { MARKER_V2 } from '../../managed-skills/src/v2-observed.js';
import { LEGACY_NAMESPACE, legacyPresent } from '../../managed-skills/src/migrate.js';
import type { Harness, ItemSource, ManagedItemReceipt, ManagedItemRequest } from '../../managed-skills/src/v2-types.js';
import { readManifestState } from '../../skill-manifest/src/add.js';
import { parseManifest } from '../../skill-manifest/src/schema.js';
import { pinOf } from '../../skill-manifest/src/check.js';
import type { PinnedEntry } from '../../skill-manifest/src/schema.js';
import { withProjectLock } from '../../project-context/src/index.js';
import type { DirectoryIdentity, PinnedDirectory, ProjectContext } from '../../project-context/src/types.js';
import { entryRequest, lookupCache, receiptMatches } from './cache-index.js';
import type { PinnedRequest } from './cache-index.js';
import { managedPort } from './deps.js';
import type { ManagedPort, SyncDeps } from './deps.js';
import { MIN_FREE_BYTES, beforePins, byPath, checkProjectAncestry, itemSurfaces, pendingRefusal, stateLayout, union } from './plan.js';
import type { SyncItem } from './plan.js';
import { checkChild, createPrivateFolders, fetchPin, selectorFor } from './apply.js';
import { outward, syncError } from './refusal.js';

export const MIGRATE_PLAN_FORMAT = 'bowerloom/skills-migrate-plan/v1beta1' as const;
export interface MigrateInput { project: ProjectContext; stateRoot: string; legacyStateDir: string }
export interface MigratePlan {
  format: typeof MIGRATE_PLAN_FORMAT;
  project: { dir: string; identity: DirectoryIdentity; ancestry: readonly PinnedDirectory[]; bowerloomIdentity: DirectoryIdentity };
  manifest: { sha256: string; bytes: number };
  legacy: { stateDir: string; operationKey: string; receiptRevision: string; harness: Harness; catalogSha256: string };
  /** Where the pinned bytes come from: this project's cache, the cache the v1 install read, or a fetch in phase A. */
  bytesFrom: 'project-cache' | 'legacy-cache' | 'fetch';
  legacySelector: AcquiredSkillCacheSelector | null;
  item: SyncItem;
  privateState: { root: string; projectId: string; cacheRoot: string; itemsRoot: string; create: string[]; pins: { path: string; identity: { device: string; inode: string; birthtimeNs: string; uid: number; mode: number } }[] };
  network: { required: boolean; hosts: string[] };
  writesAuthorized: false; executionAuthorized: false; revision: string;
}

const OK_PACKAGE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/, OK_VERSION = /^[0-9A-Za-z.+-]{1,128}$/, OK_REPO = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9._-]*$/, OK_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** The exact `skills add` command for the v1 catalog's pin, or null when a field is not one the command can carry. */
function addCommand(source: Record<string, unknown>, skill: { id?: unknown; sourceRoot?: unknown }): string | null {
  try { relativeSkillPath(skill.sourceRoot); } catch { return null; }
  if (typeof skill.id !== 'string' || !OK_ID.test(skill.id)) return null;
  if (source.kind === 'npm' && typeof source.package === 'string' && OK_PACKAGE.test(source.package) && typeof source.version === 'string' && OK_VERSION.test(source.version)) return `bowerloom skills add npm:${source.package}@${source.version}:${skill.sourceRoot as string} --id ${skill.id}`;
  if (source.kind === 'git' && typeof source.repository === 'string' && OK_REPO.test(source.repository) && typeof source.commit === 'string' && /^[a-f0-9]{40}$/.test(source.commit)) return `bowerloom skills add github:${source.repository}@${source.commit}:${skill.sourceRoot as string} --id ${skill.id}`;
  return null;
}

interface MigrateObserved { plan: MigratePlan; pinned: PinnedRequest }
async function observeMigrate(input: MigrateInput): Promise<MigrateObserved> {
  const project = input.project, dir = project.dir;
  checkProjectAncestry(project);
  try { managedPath(input.legacyStateDir); } catch { throw syncError('SKILLS_MIGRATE_STATE_INVALID'); }
  if (!legacyPresent(dir)) throw syncError('SKILLS_MIGRATE_NOTHING');
  if (exists(join(dir, V1_MARKER))) throw syncError('MANAGED_SKILL_RECOVERY_REQUIRED', 'It is an operation of the earlier Bowerloom. Finish it with bowerloom skills recover plan --request <json> (bowerloom help advanced), then migrate.');
  if (exists(join(dir, MARKER_V2))) throw pendingRefusal(dir);
  let seen;
  try { seen = await inspectObservedManagedSkill({ projectDir: dir, stateDir: input.legacyStateDir }); } catch { throw syncError('SKILLS_MIGRATE_STATE_INVALID'); }
  if (seen.status !== 'committed' || seen.receipt === null || seen.operationKey === null) throw syncError('SKILLS_MIGRATE_STATE_INVALID');
  const catalogBytes = raw(join(dir, LEGACY_NAMESPACE, 'catalog.json'), 262144, false).bytes;
  const catalog = strictJson(new TextDecoder('utf-8', { fatal: true }).decode(catalogBytes), 262144) as { source: Record<string, unknown>; skill: { id: string; name: string; sourceRoot: string }; inventory: unknown; license: unknown; references: unknown; harness: Harness };
  const state = readManifestState(dir), manifest = state.file ? parseManifest(state.file.bytes) : null;
  const entry = manifest?.skills.find(e => e.id === catalog.skill.id && e.source.kind !== 'local') as PinnedEntry | undefined;
  const pinned = entry ? entryRequest(entry) : null;
  const pretend = { source: catalog.source, skill: catalog.skill, inventory: catalog.inventory, license: catalog.license, references: catalog.references } as unknown as AcquiredSkillCacheReceipt;
  if (!state.file || !manifest || !entry || !pinned || !receiptMatches(pinned, pretend)) {
    const command = addCommand(catalog.source ?? {}, catalog.skill ?? {});
    throw syncError('SKILLS_MIGRATE_NOT_IN_MANIFEST', command ? `Pin it first: ${command}` : 'Pin the same source and version in skills.json with bowerloom skills add, then migrate.');
  }
  const layout = stateLayout(input), id = entry.id;
  // The pinned bytes: this project's cache, else the cache the v1 install read, else a fetch.
  const cache = await lookupCache(layout.cacheRoot, pinned);
  let bytesFrom: MigratePlan['bytesFrom'] = cache.status === 'cached' ? 'project-cache' : 'fetch', legacySelector: AcquiredSkillCacheSelector | null = null;
  if (cache.status !== 'cached') {
    try {
      const intent = parsed<{ plan: { core: { request: { cache: AcquiredSkillCacheSelector } } } }>(join(input.legacyStateDir, 'op-' + seen.operationKey, 'intent.json'), ['format', 'plan', 'operationIdentity', 'approvalRevision']);
      const selector = intent.plan.core.request.cache, controller = new AbortController();
      const closure = await readAcquiredSkillCache(selector, { signal: controller.signal, deadlineMs: performance.now() + 25000 });
      if (receiptMatches(pinned, closure.receipt)) { bytesFrom = 'legacy-cache'; legacySelector = { root: selector.root, operationId: selector.operationId, expectedSnapshotRevision: selector.expectedSnapshotRevision, expectedReceiptRevision: selector.expectedReceiptRevision }; }
    } catch { /* That cache is gone or changed: fetch instead. */ }
  }
  const harnesses = union(manifest.harnesses, [catalog.harness]), surfaces = itemSurfaces(dir, id, entry.skill.name, harnesses);
  const item: SyncItem = {
    id, kind: entry.source.kind, pin: pinOf(entry), state: bytesFrom === 'fetch' ? 'needs-fetch' : 'cached', action: 'install', harnesses, requestDigest: pinned.digest,
    cacheOperationId: bytesFrom === 'legacy-cache' ? null : cache.operationId, cache: bytesFrom === 'legacy-cache' ? null : cache,
    expected: { files: byPath(pinned.request.files.map(f => ({ path: f.path, sha256: f.sha256, bytes: f.bytes }))), surfaces: surfaces.map(s => ({ id: s.id, path: s.path.slice(dir.length + 1) })) },
    before: beforePins(surfaces, dir), previousReceiptRevision: null, history: 0, hold: null,
  };
  const fetch = bytesFrom === 'fetch', create = [...layout.missing.filter(p => p !== layout.cacheRoot || fetch)];
  const stateDir = join(layout.itemsRoot, id); if (!exists(stateDir)) create.push(stateDir);
  const body = {
    format: MIGRATE_PLAN_FORMAT,
    project: { dir, identity: project.identity, ancestry: project.ancestry, bowerloomIdentity: project.bowerloomIdentity },
    manifest: { sha256: state.file.sha256, bytes: state.file.bytes.length },
    legacy: { stateDir: input.legacyStateDir, operationKey: seen.operationKey, receiptRevision: seen.receipt.revision, harness: catalog.harness, catalogSha256: revisionOf(catalogBytes.toString('base64')) },
    bytesFrom, legacySelector, item,
    privateState: { root: layout.root, projectId: project.projectId, cacheRoot: layout.cacheRoot, itemsRoot: layout.itemsRoot, create, pins: layout.pins },
    network: { required: fetch, hosts: fetch ? [entry.source.kind === 'npm' ? 'registry.npmjs.org' : 'api.github.com'] : [] },
    writesAuthorized: false as const, executionAuthorized: false as const,
  };
  return { plan: freezeSkillData({ ...body, revision: revisionOf(body) }) as MigratePlan, pinned };
}

/** `skills migrate plan`. Reads only. */
export async function planMigrate(input: MigrateInput): Promise<MigratePlan> {
  try { return (await observeMigrate(input)).plan; } catch (e) { throw outward(e); }
}

/** `skills migrate apply`: the same locked phases as sync, for the one migrate child. */
export async function applyMigrate(input: MigrateInput, revision: string, deps: SyncDeps): Promise<ManagedItemReceipt> {
  if (typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision)) throw syncError('STALE_APPROVAL');
  const managed: ManagedPort = deps.managed ?? managedPort;
  try {
    return await withProjectLock(input.project.dir, new AbortController().signal, async held => {
      const { plan, pinned } = await observeMigrate(input);
      if (plan.revision !== revision) throw syncError('STALE_APPROVAL');
      if (deps.signal.aborted) throw syncError('SKILLS_SYNC_INTERRUPTED', 'Nothing was changed.');
      createPrivateFolders(plan, held, plan.project.dir);
      const item = plan.item;
      let source: ItemSource;
      if (plan.bytesFrom === 'legacy-cache') source = { kind: 'cache', selector: plan.legacySelector! };
      else {
        if (plan.bytesFrom === 'fetch') await fetchPin(item, pinned, plan.privateState.cacheRoot, deps);
        source = { kind: 'cache', selector: await selectorFor(item, pinned, plan.privateState.cacheRoot) };
      }
      const req: ManagedItemRequest = {
        operation: 'migrate', projectDir: plan.project.dir, stateDir: join(plan.privateState.itemsRoot, item.id), item: { kind: 'skill', id: item.id },
        harnesses: [...item.harnesses], source, expectedPreviousRevision: null, minFreeBytes: MIN_FREE_BYTES, legacy: { stateDir: plan.legacy.stateDir, operationKey: plan.legacy.operationKey },
      };
      const child = checkChild(plan.project.dir, item, pinned, req, await managed.plan(req, {}));
      if (child.core.legacy?.receiptRevision !== plan.legacy.receiptRevision) throw syncError('STALE_APPROVAL');
      return managed.apply(held, req, child.revision, {});
    });
  } catch (e) { throw outward(e); }
}
