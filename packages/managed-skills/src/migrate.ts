/**
 * Migration from v1beta1 to v1beta2 (build plan 01, section 6). Reads the v1 install through the unchanged v1
 * inspection and binds its receipt. Nothing here writes, and nothing ever writes the v1 private state folder.
 * The v2 migrate operation then moves the whole v1 namespace `.bowerloom-skills/` into its operation folder as
 * one backup-only surface (`legacy`), so a rollback renames it back with every v1 inode and time intact.
 */
import { join } from 'node:path';
import { strictJson } from '../../codex-adapter/src/safe.js';
import { inspectObservedManagedSkill } from './observed.js';
import { MARKER as V1_MARKER, check, directory, exists, names, raw, same, schema, stablePins } from './observed.js';
import { wideTree } from './v2-observed.js';
import type { Lifetime } from './observed.js';
import type { AcquiredSkillClosure } from '../../skill-sources/src/cache.js';
import type { FilePin } from './observed-types.js';
import type { LegacyCore, ManagedItemRequest } from './v2-types.js';

export const LEGACY_NAMESPACE = '.bowerloom-skills';
export const V1_RECEIPT_FORMAT = 'bowerloom/observed-managed-skill-receipt/v1beta1' as const;
/** v1 content anywhere in the project: its namespace or its pending marker. */
export function legacyPresent(projectDir: string): boolean { return exists(join(projectDir, LEGACY_NAMESPACE)) || exists(join(projectDir, V1_MARKER)); }

export interface LegacyRead { core: LegacyCore; projection: { path: string; pins: FilePin[] | null } }
/**
 * A clean, committed v1 install (no marker, no drift) whose catalog names exactly the pin and file hashes of the
 * cache closure being migrated to, for the same item, on a harness the v2 request keeps. The namespace holds only
 * what the v1 receipt installed there, so the migrate move never carries a user's own file out of the project.
 */
export async function readLegacy(v: ManagedItemRequest, acquired: Readonly<AcquiredSkillClosure>, life: Lifetime): Promise<LegacyRead> {
  const legacy = v.legacy; check(v.operation === 'migrate' && legacy !== null);
  check(!exists(join(v.projectDir, V1_MARKER)), 'MANAGED_SKILL_RECOVERY_REQUIRED'); directory(legacy.stateDir, true); life.check();
  const seen = await inspectObservedManagedSkill({ projectDir: v.projectDir, stateDir: legacy.stateDir }); life.check();
  check(seen.status === 'committed' && seen.receipt !== null && seen.operationKey === legacy.operationKey && seen.receipt.operationKey === legacy.operationKey);
  const r = seen.receipt;
  check(r.projectDir === v.projectDir && r.stateDir === legacy.stateDir && v.harnesses.includes(r.harness));
  const catalog = schema<{ source: unknown; skill: unknown; inventory: unknown }>(strictJson(new TextDecoder('utf-8', { fatal: true }).decode(raw(join(v.projectDir, LEGACY_NAMESPACE, 'catalog.json'), 262144, false).bytes), 262144),
    ['format', 'operationKey', 'policy', 'source', 'skill', 'license', 'references', 'inventory', 'harness', 'executionAuthorized']);
  // The cache may be the machine cache, whose receipt names no entry id (cacheClosure): the v1 catalog's skill is
  // compared with the receipt's skill under the item's id, and that id is the one the v1 install used.
  check(same(catalog.source, acquired.receipt.source) && same(catalog.inventory, acquired.receipt.inventory) && same(catalog.skill, { ...acquired.receipt.skill, id: v.item.id }));
  const projection = r.installed.find(s => s.kind === 'projection'); check(projection !== undefined && projection.pins !== null);
  const namespace = join(v.projectDir, LEGACY_NAMESPACE), skills = join(namespace, 'skills'), id = v.item.id;
  const canonical = r.installed.find(s => s.kind === 'canonical'), catalogSurface = r.installed.find(s => s.kind === 'catalog');
  check(canonical?.pins && catalogSurface?.pins && canonical.path === join(skills, id) && catalogSurface.path === join(namespace, 'catalog.json'));
  // Exactly the namespace folder, `skills/`, and the receipt's canonical and catalog pins: nothing else is moved.
  check(same(names(namespace), ['catalog.json', 'skills']) && same(names(skills), [id]), 'MANAGED_SKILL_LEGACY_PRESENT');
  const sorted = (pins: FilePin[]) => [...pins].sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  const tree = wideTree(namespace, 262144, () => life.check(), 2 * 1024 * 1024 + 262144), folders = tree.filter(p => p.path === namespace || p.path === skills);
  check(folders.length === 2 && folders.every(p => p.sha256 === null), 'MANAGED_SKILL_LEGACY_PRESENT');
  check(same(stablePins(sorted(tree.filter(p => p.path !== namespace && p.path !== skills))), stablePins(sorted([...canonical.pins, ...catalogSurface.pins]))), 'MANAGED_SKILL_LEGACY_PRESENT');
  const receiptPin = raw(join(legacy.stateDir, 'op-' + legacy.operationKey, 'receipt.json')).pin; life.check();
  return { core: { stateDir: legacy.stateDir, operationKey: legacy.operationKey, receiptRevision: r.revision, receiptPin, harness: r.harness }, projection: { path: projection.path, pins: projection.pins } };
}
