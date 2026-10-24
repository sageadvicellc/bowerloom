/**
 * What the skills and agents screens share (prototype slice S6): how an install is decided, which harnesses a menu offers, the sentence that
 * says a change is waiting, and the list of libraries the "Add skills" panel shows. Pure: no clock, no random number, no file, and no input is changed.
 *
 * The rules are the harness editor's. An install is the editor's own drop on a harness (`dropOutcome`), a keep, hide or replace is `overrideOutcome`,
 * and the words for what is waiting are the change bar's (`changeBarText`). This file only builds the small context those functions need.
 */
import { buildHarnessMap, groupIdOf, scopeNodeId } from './harnessmodel.js';
import { interfaceName, joinWords } from './words.js';
import type { HarnessMapModel } from './harnessmodel.js';
import { dropOutcome } from './editor-actions.js';
import type { EditorContext, EditorOutcome } from './editor-actions.js';
import { changeBarText, editsOf, groupPlan } from './editor-describe.js';
import { reduceStore } from './store.js';
import { LIBRARY_CATALOG } from './library-catalog.js';
import type { InterfaceId, Plan, Scope, World } from './types.js';

export { joinWords };

/** "3 skills", "1 skill". */
export const countWord = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** A scope as a person reads it in a list: "Studio (global)" or "Copperfen (project)". The harness editor's scope switch uses the same shape. */
export const scopeLabel = (scope: Scope): string => `${scope.name} (${scope.kind === 'global' ? 'global' : 'project'})`;

/** The ids of every library group, so a graph model built from them has each library item as a node of its own. */
export const everyGroup = (world: World): string[] => world.libraries.map(l => groupIdOf(l.id));

/** The editor's context for one harness, with every library open: what the editor's rules need to know about the nodes. */
export function contextFor(world: World, scopeId: string): EditorContext {
  return { world, model: buildHarnessMap(world, { scopeId, showInherited: true, expandedGroups: everyGroup(world) }) };
}

/**
 * The context for installing `itemId` into `targetScopeId`: a small model holding the item's node and the target harness node.
 * The item may belong to a harness other than the target, so its node is taken from the model of its own harness. Null when either is not there.
 */
export function installContext(world: World, itemId: string, targetScopeId: string): EditorContext | null {
  const item = world.items.find(i => i.id === itemId);
  if (item === undefined || !world.scopes.some(s => s.id === targetScopeId)) return null;
  const itemNode = contextFor(world, item.scopeId).model.nodes.find(n => n.id === itemId);
  const scopeNode = contextFor(world, targetScopeId).model.nodes.find(n => n.id === scopeNodeId(targetScopeId));
  if (itemNode === undefined || scopeNode === undefined) return null;
  const model: HarnessMapModel = { scopeId: targetScopeId, nodes: [itemNode, scopeNode], edges: [] };
  return { world, model };
}

/** What installing an item (a skill or an agent) into a harness does: the editor's drop on a harness. A library item installs as an editable copy. */
export function installOutcome(world: World, itemId: string, targetScopeId: string): EditorOutcome {
  const ctx = installContext(world, itemId, targetScopeId);
  if (ctx === null) return { kind: 'refused', message: 'That item is not on the page any more.' };
  return dropOutcome(ctx, itemId, scopeNodeId(targetScopeId));
}

/** One line of an "Install to" menu: a harness, and why it cannot be chosen when it cannot. */
export interface InstallTarget { readonly scopeId: string; readonly label: string; readonly disabled: boolean; readonly reason: string | null; readonly isGlobal: boolean }

/** Every harness a menu offers for an item, the global harness first. A harness the item cannot go to is disabled and says why. */
export function installTargets(world: World, itemId: string): InstallTarget[] {
  return [...world.scopes].sort((a, b) => Number(b.kind === 'global') - Number(a.kind === 'global')).map(scope => {
    const outcome = installOutcome(world, itemId, scope.id);
    const refused = outcome.kind !== 'action';
    return { scopeId: scope.id, label: scopeLabel(scope), disabled: refused, reason: outcome.kind === 'refused' ? outcome.message : refused ? 'This cannot be installed here.' : null, isGlobal: scope.kind === 'global' };
  });
}

/** The first harness a menu or a button chooses: the global one, as long as it takes the item; else the first harness that does; else null. */
export function defaultTarget(targets: readonly InstallTarget[]): InstallTarget | null {
  return targets.find(t => t.isGlobal && !t.disabled) ?? targets.find(t => !t.disabled) ?? null;
}

/** The sentence that follows a confirmation: how many changes wait, and where they are applied. It reuses the change bar's own words. */
export function waitingSentence(dirty: boolean, fileCount: number, editCount: number): string {
  const waiting = changeBarText(dirty, fileCount, editCount);
  return `${waiting.endsWith('.') ? waiting : `${waiting}.`} Apply on the Harness screen.`;
}

/** What the "Waiting to apply" list shows: the change bar's line, and one short line for each interface the changes would reach. */
export interface WaitingView { readonly headline: string; readonly lines: readonly string[]; readonly dirty: boolean }

export function waitingView(dirty: boolean, plan: Plan): WaitingView {
  return { headline: changeBarText(dirty, plan.changes.length, editsOf(plan)), dirty, lines: dirty ? groupPlan(plan).map(g => `${g.name}: ${g.summary}`) : [] };
}

// ------------------------------------------------------------------------------------------------------------- libraries

/** Adding a library, decided with the store's own rule: when the store would return the same state, the library is not added, and the screen says so. */
export function addLibraryOutcome(world: World, libraryId: string): EditorOutcome {
  const action = { type: 'addLibrary', libraryId } as const;
  const before = { committed: world, draft: world, undoStack: [], redoStack: [], headVersionId: null };
  return reduceStore(before, action) === before ? { kind: 'refused', message: 'Already added.' } : { kind: 'action', action, message: 'Added.' };
}

/** One library the "Add skills" panel lists. An installed one comes from the world; an available one comes from the catalog. */
export interface LibraryOffer {
  readonly id: string; readonly name: string; readonly state: 'installed' | 'available'; readonly version: string; readonly newerVersion: string | null;
  readonly skillCount: number; readonly agentCount: number; readonly summary: string;
}

/** The libraries a person can see in the panel: those already in the world first, then the catalog libraries that are not in it yet. */
export function libraryOffers(world: World): LibraryOffer[] {
  const installed = world.libraries.map((lib): LibraryOffer => {
    const own = world.items.filter(i => i.library?.library === lib.id);
    const skills = own.filter(i => i.kind === 'skill').length, agents = own.filter(i => i.kind === 'agent').length;
    return { id: lib.id, name: lib.name, state: 'installed', version: lib.installedVersion, newerVersion: lib.newerVersion ?? null, skillCount: skills, agentCount: agents, summary: `${countWord(skills, 'skill')} and ${countWord(agents, 'agent')}.` };
  });
  const have = new Set(world.libraries.map(l => l.id));
  const available = LIBRARY_CATALOG.filter(l => !have.has(l.id)).map((lib): LibraryOffer => ({
    id: lib.id, name: lib.name, state: 'available', version: lib.version, newerVersion: null, skillCount: lib.skills.length, agentCount: lib.agents.length, summary: lib.summary,
  }));
  return [...installed, ...available];
}

/** One sentence the panel says about libraries. */
export const LIBRARY_STAYS_REFERENCE = 'A library stays a reference until you edit an item. Then Bowerloom makes your own copy of that one item.';

/** What the "From a folder" source says when skills are ticked. It reads nothing and changes nothing. */
export function folderNote(folderName: string, skillCount: number): string {
  return `Noted ${countWord(skillCount, 'skill')} from ${folderName}. Bowerloom reads a folder only after you approve it, so nothing was added.`;
}

/** The names of the interfaces in the usual order, as a person says them. */
export function interfaceWords(ids: readonly InterfaceId[]): string {
  const order: readonly InterfaceId[] = ['claude-code', 'codex', 'opencode'];
  return joinWords(order.filter(id => ids.includes(id)).map(interfaceName));
}
