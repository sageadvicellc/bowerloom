/**
 * `bowerloom receipt clean [--global]` (spec 08, 3.4, decision 18). After a person deletes the files of created items,
 * the authoring receipt still lists them, and `status` names each as missing. This removes those receipt entries, the
 * local skills.json entry of each gone skill, and (in a project) the `source: "project"` entry of bowerloom.json.
 *
 * It deletes no file and no installed copy, and it never touches the lock. A plan reads only. Apply runs under the
 * project lock (project scope) or `withStoreForWrite` (store scope), plans again, and writes only when the revision is
 * the approved one: the scratch the plan lists, then the config, then skills.json one entry at a time, then the receipt.
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { canonicalJson } from '../../contracts/src/index.js';
import { isHeldProjectLock, projectRefusal, verifyProjectPins, verifyStorePins } from '../../project-context/src/index.js';
import type { StoreContext } from '../../project-context/src/index.js';
import type { DirectoryIdentity, HeldProjectLock, ProjectContext } from '../../project-context/src/types.js';
import fs from 'node:fs';
import { lstatOrNull, realFolder, removeScratch } from '../../project-authoring/src/files.js';
import { refuse as authoringRefuse } from '../../project-authoring/src/refusal.js';
import { AUTHORING_FOLDER, itemPath, readAuthoringState, receiptOf, recordText } from '../../project-authoring/src/state.js';
import type { AuthoredItem, ItemKind } from '../../project-authoring/src/state.js';
import { writeReceiptRecord } from '../../project-authoring/src/receipt-write.js';
import { readConfig } from '../../project-config/src/config.js';
import { CONFIG_FILE, serializeConfig } from '../../project-config/src/schema.js';
import type { ProjectConfig } from '../../project-config/src/schema.js';
import { configRefusal } from '../../project-config/src/refusal.js';
import { writeGuardedFile } from '../../project-config/src/write.js';
import { applyManifestChange, manifestAfter, planManifestChange, projectTarget, readManifestState, storeTarget } from '../../skill-manifest/src/add.js';
import type { ManifestTarget } from '../../skill-manifest/src/add.js';
import { parseManifest } from '../../skill-manifest/src/schema.js';
import type { Manifest } from '../../skill-manifest/src/schema.js';
import { manifestRefusal } from '../../skill-manifest/src/refusal.js';
import { scratchFiles } from './change.js';
import { partialRefusal } from './refusal.js';

export const RECEIPT_CLEAN_PLAN_FORMAT = 'bowerloom/receipt-clean-plan/v1beta1' as const;
export const RECEIPT_CLEAN_RESULT_FORMAT = 'bowerloom/receipt-clean-result/v1beta1' as const;
type Read = { sha256: string; bytes: number };
type ConfigKind = 'skill' | 'prompt' | 'team';

export interface ReceiptCleanPlan {
  format: typeof RECEIPT_CLEAN_PLAN_FORMAT;
  scope: 'project' | 'store';
  /** For the store scope, `dir` is the store folder and `identity` is the store identity. */
  project: { dir: string; identity: DirectoryIdentity };
  /** Sorted by kind (skill, prompt, team, slice), then by id. `path` is relative to `.bowerloom` or to the store. */
  items: { kind: ItemKind; id: string; path: string }[];
  manifest: { steps: { id: string; before: Read | null; after: Read }[] } | null;
  config: { before: Read; after: Read; text: string; removes: { kind: ConfigKind; id: string }[] } | null;
  /** Null only when nothing is selected: there is then nothing to write. */
  receipt: { before: Read; after: Read; text: string } | null;
  scratch: string[];
  /** The project config and lock scratch. Empty for the store scope. */
  projectScratch: string[];
  writesAuthorized: false; executionAuthorized: false; revision: string;
}
export interface ReceiptCleanResult { format: typeof RECEIPT_CLEAN_RESULT_FORMAT; planRevision: string; scope: 'project' | 'store'; removed: { kind: ItemKind; id: string }[]; executionAuthorized: false }
export type ReceiptCleanInput = { scope: 'project'; project: ProjectContext } | { scope: 'store'; store: StoreContext };
/** Test hooks. Product code passes nothing. */
export interface ReceiptCleanHooks { readonly afterConfig?: () => void; readonly afterManifest?: () => void }

const sha = (v: string | Buffer): string => createHash('sha256').update(v).digest('hex');
const ORDER: readonly ItemKind[] = ['skill', 'prompt', 'team', 'slice'];
const byteOrder = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b));
const stale = (): Error => manifestRefusal('STALE_APPROVAL');
const LIST = { skill: 'skills', prompt: 'prompts', team: 'teams' } as const;

interface Scope { kind: 'project' | 'store'; dir: string; base: string; identity: DirectoryIdentity; target: ManifestTarget; project: ProjectContext | null; store: StoreContext | null }
function scopeOf(input: ReceiptCleanInput): Scope {
  if (input === null || typeof input !== 'object') throw projectRefusal('USAGE');
  if (input.scope === 'store') {
    const store = input.store;
    return { kind: 'store', dir: store.dir, base: store.dir, identity: store.identity, target: storeTarget(store.dir), project: null, store };
  }
  if (input.scope !== 'project') throw projectRefusal('USAGE');
  const project = input.project;
  return { kind: 'project', dir: project.dir, base: join(project.dir, '.bowerloom'), identity: project.identity, target: projectTarget(project.dir), project, store: null };
}
function pins(scope: Scope): void { if (scope.store) verifyStorePins(scope.store); else verifyProjectPins(scope.project!); }

/** "Gone" is the test of `gone` in apps/cli/src/held.ts: lstat fails with ENOENT. Any other failure is unsafe. */
function gone(path: string): boolean { return lstatOrNull(path) === null; }

/** Plans one receipt clean. It reads only. */
export function planReceiptClean(input: ReceiptCleanInput): ReceiptCleanPlan {
  const scope = scopeOf(input);
  pins(scope);
  const project = scope.project;
  const empty = (): ReceiptCleanPlan => body({ items: [], manifest: null, config: null, receipt: null, scratch: [], projectScratch: [] });
  const body = (rest: Pick<ReceiptCleanPlan, 'items' | 'manifest' | 'config' | 'receipt' | 'scratch' | 'projectScratch'>): ReceiptCleanPlan => {
    const b: Omit<ReceiptCleanPlan, 'revision'> = { format: RECEIPT_CLEAN_PLAN_FORMAT, scope: scope.kind, project: { dir: scope.dir, identity: scope.identity }, ...rest, writesAuthorized: false, executionAuthorized: false };
    return { ...b, revision: sha(canonicalJson(b)) };
  };
  // A project with no `.bowerloom` has no record of created items.
  if (project !== null && project.bowerloomIdentity === null) return empty();
  if (project !== null && lstatOrNull(join(project.dir, '.bowerloom-revision.json')) !== null) authoringRefuse('REVISION_PENDING');
  const state = readAuthoringState(scope.base);
  if (state.pending !== null) authoringRefuse('AUTHORING_PENDING');
  const receiptItems = state.receipt?.value.items ?? [];
  // Review S3 of PR 98: an area folder that is a link, dangling or not, is never followed and never makes an item gone.
  for (const area of ['skills', 'prompts', 'teams', 'slices']) {
    const at = join(scope.base, area);
    if (lstatOrNull(at) === null) continue;
    let inside = false;
    try { realFolder(at); inside = fs.realpathSync(at) === join(fs.realpathSync(scope.base), area); } catch { inside = false; }
    if (!inside) authoringRefuse('AUTHORING_UNSAFE_PATH', `The folder is ${scope.kind === 'store' ? '~/.bowerloom' : '.bowerloom'}/${area}.`);
  }
  const selected = receiptItems.filter(i => gone(join(scope.base, itemPath(i.kind, i.id))))
    .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || byteOrder(a.id, b.id));
  const projectScratch = project !== null ? scratchFiles(project.dir) : [];
  // Review L4: scratch goes even when nothing is gone.
  if (selected.length === 0) { pins(scope); return body({ items: [], manifest: null, config: null, receipt: null, scratch: state.scratch, projectScratch }); }
  // skills.json: one removal for each gone skill whose entry is local, in id order. A pinned entry is never removed.
  const manifestState = readManifestState(scope.target, { allowAbsent: true });
  let current: Manifest | null = manifestState.file ? parseManifest(manifestState.file.bytes, scope.target.limits) : null;
  let read: Read | null = manifestState.file ? { sha256: manifestState.file.sha256, bytes: manifestState.file.bytes.length } : null;
  const steps: NonNullable<ReceiptCleanPlan['manifest']>['steps'] = [];
  const goneSkills = selected.filter(i => i.kind === 'skill').map(i => i.id).sort(byteOrder);
  for (const id of goneSkills) {
    if (current?.skills.find(s => s.id === id)?.source.kind !== 'local') continue;
    const next = manifestAfter(current, { remove: id }, scope.target.limits), after = { sha256: sha(next.text), bytes: Buffer.byteLength(next.text) };
    steps.push({ id, before: read, after }); current = next.manifest; read = after;
  }
  // bowerloom.json: the project entry of each gone item, unless a skills.json entry for that skill stays.
  let config: ReceiptCleanPlan['config'] = null;
  if (project !== null) {
    const got = readConfig(project);
    if (got.state === 'invalid') throw configRefusal(got.code);
    if (got.state === 'absent' && project.configPresent) throw projectRefusal('PROJECT_UNSAFE');
    if (got.state === 'valid') {
      const next: ProjectConfig = JSON.parse(JSON.stringify(got.config)) as ProjectConfig, removes: { kind: ConfigKind; id: string }[] = [];
      for (const item of selected) {
        if (item.kind === 'slice') continue;
        const kind = item.kind as ConfigKind, list = next[LIST[kind]], at = list.findIndex(e => e.id === item.id && e.source === 'project');
        if (at < 0) continue;
        if (kind === 'skill' && current?.skills.some(s => s.id === item.id)) continue;
        list.splice(at, 1); removes.push({ kind, id: item.id });
      }
      if (removes.length) { const text = serializeConfig(next); config = { before: { sha256: got.sha256, bytes: got.bytes }, after: { sha256: sha(text), bytes: Buffer.byteLength(text) }, text, removes }; }
    }
  }
  const keep: AuthoredItem[] = receiptItems.filter(i => !selected.includes(i));
  const text = recordText(receiptOf(keep));
  const receipt = { before: state.receipt!.read, after: { sha256: sha(text), bytes: Buffer.byteLength(text) }, text };
  pins(scope);
  return body({
    items: selected.map(i => ({ kind: i.kind, id: i.id, path: itemPath(i.kind, i.id) })),
    manifest: steps.length ? { steps } : null, config, receipt, scratch: state.scratch, projectScratch,
  });
}

/** Removes the leftover temporaries of the config and lock writer that the plan listed: still regular files the user owns. */
function removeProjectScratch(dir: string, names: readonly string[]): void {
  for (const name of names) { const s = lstatOrNull(join(dir, name)); if (s !== null && s.isFile() && !s.isSymbolicLink() && s.uid === process.getuid?.()) removeScratch(join(dir, name)); }
}

/**
 * Applies an approved receipt clean. `held` is the project lock (project scope) or the store lock from
 * `withStoreForWrite` (store scope, with `store`). A store that `withStoreForWrite` just made refuses STALE_APPROVAL
 * before any write. The plan is made again and must have the approved revision.
 */
export function applyReceiptClean(input: ReceiptCleanInput, revision: string, held: HeldProjectLock, store?: { context: StoreContext; created: boolean }, hooks: ReceiptCleanHooks = {}): ReceiptCleanResult {
  if (!isHeldProjectLock(held)) throw manifestRefusal('PROJECT_LOCKED');
  const scope = scopeOf(input);
  if ((scope.kind === 'store') !== (store !== undefined) || (store !== undefined && store.context.dir !== scope.dir)) throw projectRefusal('USAGE');
  held.assertHeld(scope.dir);
  // Rule 1: a store this run made is not the store the plan read.
  if (store?.created === true) throw stale();
  if (typeof revision !== 'string') throw stale();
  const plan = planReceiptClean(input);
  if (plan.revision !== revision) throw stale();
  const live = (): void => { held.assertHeld(scope.dir); pins(scope); };
  const auth = join(scope.base, AUTHORING_FOLDER);
  // Review H1 of PR 98: what this run wrote, so that a refusal part way says so and names it.
  const done: string[] = [];
  try {
  // 0. Bowerloom's own scratch.
  if (plan.scratch.length) { live(); for (const name of plan.scratch) { removeScratch(join(auth, name)); done.push(`the scratch ${name}, removed`); } }
  if (plan.projectScratch.length) { live(); removeProjectScratch(scope.dir, plan.projectScratch); done.push('the leftover scratch of bowerloom.json and the lock, removed'); }
  if (plan.receipt === null) return { format: RECEIPT_CLEAN_RESULT_FORMAT, planRevision: plan.revision, scope: plan.scope, removed: [], executionAuthorized: false };
  // 1. The config.
  if (plan.config !== null) {
    live();
    writeGuardedFile(scope.dir, CONFIG_FILE, plan.config.text, plan.config.before.sha256, held, `.${CONFIG_FILE}`);
    done.push('bowerloom.json');
    hooks.afterConfig?.();
  }
  // 2. skills.json: one removal at a time, each made again now and checked against the bytes the plan bound.
  for (const step of plan.manifest?.steps ?? []) {
    live();
    const change = planManifestChange(scope.target, { remove: step.id }, { storeCreate: false });
    if ((change.before?.sha256 ?? null) !== (step.before?.sha256 ?? null) || change.after.sha256 !== step.after.sha256 || change.after.bytes !== step.after.bytes) throw stale();
    applyManifestChange(change, change.revision, held);
    done.push(`the skills.json entry of skill ${step.id}, removed`);
  }
  if (plan.manifest !== null) hooks.afterManifest?.();
  // 3. The receipt, once, last.
  const removedNames = new Set(plan.items.map(i => `${i.kind} ${i.id}`));
  const keep = (readAuthoringState(scope.base).receipt?.value.items ?? []).filter(i => !removedNames.has(`${i.kind} ${i.id}`));
  if (sha(recordText(receiptOf(keep))) !== plan.receipt.after.sha256) throw stale();
  writeReceiptRecord(auth, plan.revision, plan.receipt.before, keep, live, () => readAuthoringState(scope.base).receipt?.read ?? null);
  live();
  } catch (error) { throw partialRefusal(error, done, `bowerloom receipt clean${scope.kind === 'store' ? ' --global' : ''}`); }
  return { format: RECEIPT_CLEAN_RESULT_FORMAT, planRevision: plan.revision, scope: plan.scope, removed: plan.items.map(i => ({ kind: i.kind, id: i.id })), executionAuthorized: false };
}

