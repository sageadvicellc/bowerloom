/**
 * Prompts in `bowerloom apply` (build plan 01, M6). A prompt is an authored file, `.bowerloom/prompts/<name>.md`,
 * registered by `prompt create`. Apply installs it as a managed v1beta2 item of kind `prompt`: Claude Code gets
 * `.claude/commands/<name>.md`, Codex gets the skill wrapper `.agents/skills/prompt-<name>/SKILL.md` (Hanna,
 * answer 6). Its private folder and catalog are named `prompt-<name>`.
 *
 * Planning reads only. Every check of the planned child mirrors the skill check in apply.ts.
 */
import { join, relative } from 'node:path';
import { revisionOf } from '../../skill-sources/src/validation.js';
import { LIMITS, OP_TEMP, directory, exists, names, stablePins } from '../../managed-skills/src/observed.js';
import { readLocalPrompt } from '../../managed-skills/src/local-source.js';
import { catalogPath, currentV2, ownSurface } from '../../managed-skills/src/v2-observed.js';
import type { Harness, InventoryRow, ItemRef, ManagedItemPlan, ManagedItemReceipt, ManagedItemRequest, UpToDateV2 } from '../../managed-skills/src/v2-types.js';
import { readAuthoringState } from '../../project-authoring/src/state.js';
import type { ItemSurface, SyncItem } from './plan.js';
import { MIN_FREE_BYTES, beforePins, driftNext, driftedPaths, historyNext, readCatalog, recoverNext, strayHold, union } from './plan.js';
import { managedCode, syncError } from './refusal.js';
import { locateV2 } from '../../managed-skills/src/v2-observed.js';
import type { ItemClosure } from '../../managed-skills/src/v2-types.js';

export type PromptState = 'new' | 'edited' | 'harnesses-changed' | 'up-to-date' | 'drift' | 'orphaned';
/**
 * What a Claude Code command can do beyond text (review M6 finding 5): `allowed-tools` in its frontmatter grants tools,
 * and a line that starts with `!` runs a shell command when the command is used. The review names them; it never
 * quotes the prompt.
 */
export type PromptNotice = 'allowed-tools' | 'shell-lines';
export function promptNotices(text: string): PromptNotice[] {
  const notices: PromptNotice[] = [], lines = text.split(/\r?\n/);
  if (lines[0] === '---') { const end = lines.indexOf('---', 1); if (end > 0 && lines.slice(1, end).some(l => /^allowed-tools\s*:/.test(l))) notices.push('allowed-tools'); }
  if (lines.some(l => l.startsWith('!'))) notices.push('shell-lines');
  return notices;
}
export interface PromptItem {
  /** The prompt name, `.bowerloom/prompts/<id>.md`. */
  id: string;
  /** `prompt-<id>`: the name of its private folder and its catalog. */
  itemId: string;
  /** The teams the prompt is limited to; empty means every team. */
  teams: string[];
  state: PromptState; action: SyncItem['action'];
  /** The installed harnesses plus the requested ones. A harness is never dropped. */
  harnesses: Harness[];
  /** Paths relative to the project. `files` is the authored prompt's inventory. */
  expected: { files: InventoryRow[]; surfaces: ItemSurface[] };
  before: SyncItem['before'];
  previousReceiptRevision: string | null;
  history: number;
  hold: { code: string; next: string } | null;
  /** What the prompt's Claude Code command can do beyond text. Empty for an orphan. */
  notices: PromptNotice[];
}

const same = (a: unknown, b: unknown): boolean => revisionOf(a) === revisionOf(b);
const NULL_PINS = revisionOf(null);
const stale = (extra?: string) => syncError('STALE_APPROVAL', extra);

/** The registered prompts, from `.bowerloom/authoring/receipt.json`, sorted by name. Reads with the authoring guards. */
export function registeredPrompts(project: string): { id: string; teams: string[] }[] {
  const state = readAuthoringState(join(project, '.bowerloom'));
  return (state.receipt?.value.items ?? []).filter(i => i.kind === 'prompt').map(i => ({ id: i.id, teams: [...i.teams] })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** The item surfaces of a prompt for these harnesses, as the managed planner places them. */
export function promptSurfaces(project: string, id: string, harnesses: Harness[]): { id: ItemSurface['id']; kind: 'directory' | 'file'; path: string }[] {
  const req = { projectDir: project, item: { kind: 'prompt', id }, harnesses } as unknown as ManagedItemRequest;
  return locateV2(req, { name: id } as ItemClosure, { ignore: false, legacy: false }).filter(ownSurface);
}

const collision = (paths: string[], id: string) => syncError('APPLY_NAME_COLLISION', `Prompt ${id} goes to ${paths.join(' and ')}, and Bowerloom did not install what is there. Move it out of the way or rename the prompt, then run bowerloom apply.`);

/** Classifies one registered prompt. Reads only. */
export function classifyPrompt(project: string, itemsRoot: string, id: string, teams: string[], target: Harness[]): PromptItem {
  let files: InventoryRow[], notices: PromptNotice[];
  try { if (id.startsWith('prompt-')) throw new Error('reserved'); const read = readLocalPrompt(project, id, () => {}); files = [...read.inventory]; notices = promptNotices(read.files[0]!.text); }
  catch { throw syncError('PROMPT_INVALID', `The prompt is .bowerloom/prompts/${id}.md.`); }
  const ref: ItemRef = { kind: 'prompt', id }, itemId = 'prompt-' + id, stateDir = join(itemsRoot, itemId);
  let hold: PromptItem['hold'] = null, heldCode: string | null = null, state: PromptState = 'drift', action: SyncItem['action'] = 'hold', previous: ManagedItemReceipt | null = null;
  let harnesses = [...target];
  let ops: string[] = [];
  if (exists(stateDir)) {
    try { directory(stateDir, true); } catch { throw syncError('SKILLS_STATE_UNSAFE'); }
    const all = names(stateDir).filter(n => !OP_TEMP.test(n)); ops = all.filter(n => /^op-[a-f0-9]{64}$/.test(n));
    const stray = all.filter(n => !ops.includes(n));
    if (stray.length) hold = strayHold(itemId, stray, 'bowerloom apply');
    else if (ops.some(n => !exists(join(stateDir, n, 'receipt.json')))) hold = { code: 'MANAGED_SKILL_RECOVERY_REQUIRED', next: recoverNext(itemId) };
  }
  const catalog = catalogPath(project, ref);
  if (!exists(catalog)) { state = 'new'; action = 'install'; }
  else if (!exists(stateDir)) throw collision([relative(project, catalog)], id);
  else {
    try { previous = currentV2(project, stateDir, ref); } catch (e) { previous = null; heldCode = managedCode(e); }
    if (heldCode === 'MANAGED_SKILL_PATH_OCCUPIED') throw collision([relative(project, catalog)], id);
    if (previous !== null) {
      harnesses = union(previous.harnesses, target);
      if (!same(readCatalog(catalog).inventory, files)) { state = 'edited'; action = 'update'; }
      else if (harnesses.length > previous.harnesses.length) { state = 'harnesses-changed'; action = 'update'; }
      else { state = 'up-to-date'; action = 'none'; }
    }
  }
  const surfaces = promptSurfaces(project, id, harnesses), before = beforePins(surfaces, project);
  if (heldCode !== null && hold === null) {
    const changed = heldCode === 'MANAGED_SKILL_LOCAL_DRIFT' ? driftedPaths(project, stateDir, ref.id) : [];
    hold = { code: heldCode, next: heldCode === 'MANAGED_SKILL_LOCAL_DRIFT' ? driftNext(changed.length ? changed : before.map(b => b.path)).replace('bowerloom skills sync', 'bowerloom apply').replace('Sync never', 'Apply never') : `Run bowerloom status to see what changed in the copies of prompt ${id}.` };
  }
  if (action === 'install' && hold === null) {
    const taken = before.filter(b => b.stablePinsDigest !== NULL_PINS).map(b => b.path);
    if (taken.length) throw collision(taken, id);
  }
  if ((action === 'install' || action === 'update') && hold === null && ops.length >= LIMITS.history) {
    hold = { code: 'MANAGED_SKILL_HISTORY_FULL', next: historyNext(itemId, previous ? `op-${previous.operationKey}` : 'the newest op-<key> folder', 'bowerloom apply') };
  }
  if (hold !== null) action = 'hold';
  return {
    id, itemId, teams, state, action, harnesses,
    expected: { files, surfaces: surfaces.map(s => ({ id: s.id, path: relative(project, s.path) })) }, before,
    previousReceiptRevision: previous?.revision ?? null, history: ops.length, hold, notices,
  };
}

/** A prompt whose catalog is here and that is no longer registered. It is kept, never removed. */
export function orphanPrompt(project: string, itemsRoot: string, id: string): PromptItem {
  let previous: ManagedItemReceipt | null = null;
  try { previous = currentV2(project, join(itemsRoot, 'prompt-' + id), { kind: 'prompt', id }); } catch { previous = null; }
  return { id, itemId: 'prompt-' + id, teams: [], state: 'orphaned', action: 'none', harnesses: previous ? [...previous.harnesses] : [], expected: { files: [], surfaces: [] }, before: [], previousReceiptRevision: previous?.revision ?? null, history: 0, hold: null, notices: [] };
}

/** The child request of one prompt. Every field comes from the plan this run computed. */
export function promptRequest(project: string, itemsRoot: string, item: PromptItem): ManagedItemRequest {
  return {
    operation: item.action === 'install' ? 'install' : 'update', projectDir: project, stateDir: join(itemsRoot, item.itemId),
    item: { kind: 'prompt', id: item.id }, harnesses: [...item.harnesses], source: { kind: 'prompt', name: item.id },
    expectedPreviousRevision: item.previousReceiptRevision, minFreeBytes: MIN_FREE_BYTES, legacy: null,
  };
}

const rel = (dir: string, p: string): string => p.startsWith(dir + '/') ? p.slice(dir.length + 1) : p;
/** Phase B check of one prompt child against the parent plan's bindings. Anything that differs means a change since the approval. */
export function checkPromptChild(dir: string, item: PromptItem, req: ManagedItemRequest, child: ManagedItemPlan | UpToDateV2): ManagedItemPlan {
  if (child.format !== 'bowerloom/managed-item-plan/v1beta2') throw stale(`Prompt ${item.id} changed since the plan.`);
  const c = child as ManagedItemPlan, closure = c.core.closure;
  if (!same(c.core.request, req)) throw stale();
  if (!same(closure.inventory, item.expected.files) || !same(closure.source, { kind: 'prompt', path: `prompts/${item.id}.md` }) || closure.skill !== null) throw stale(`Prompt ${item.id} changed since the plan.`);
  const own = c.core.before.filter(ownSurface);
  if (!same(own.map(s => ({ id: s.id, path: rel(dir, s.path) })), item.expected.surfaces)) throw stale();
  if (!same(own.map(s => ({ id: s.id, path: rel(dir, s.path), stablePinsDigest: revisionOf(stablePins(s.pins)) })), item.before)) throw stale(`Prompt ${item.id} changed since the plan.`);
  if ((c.core.previous?.revision ?? null) !== item.previousReceiptRevision) throw stale();
  return c;
}
