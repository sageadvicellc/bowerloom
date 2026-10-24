/**
 * The harness editor's rules, as pure functions (spec 6.3, 6.6 and 6.13). The canvas reports a wire, a drop or a menu choice with node ids.
 * Each function here turns that into what the screen should do: dispatch one StoreAction, ask the person for one more choice, or refuse
 * and say why in plain words. Nothing here reads a clock, a random number or a file, and nothing changes its input.
 *
 * Refusals the editor keeps:
 *  - A hook cannot be created, copied, wired or edited (spec 6.13).
 *  - A library item cannot be edited in place. A person makes an editable copy first (spec 6.2).
 *  - An inherited, hidden or replaced agent is not changed from a project, because that would change the global one.
 *  - A wire between kinds that do not connect does nothing.
 */
import type { AccessClass, AgentItem, HarnessItem, OverrideMode, World } from './types.js';
import type { HarnessMapModel, HarnessNode } from './harnessmodel.js';
import { joinWords as joinAnd } from './words.js';
import { reachesScope } from './common.js';
import { conflictCopies, keepBothProblem } from './conflicts.js';
import type { StoreAction } from './store.js';

/** What the screen does with an event from the canvas. */
export type EditorOutcome =
  /** Send this one action to the store. `message` says what was done, for the live region. */
  | { readonly kind: 'action'; readonly action: StoreAction; readonly message: string }
  /** A tool was wired to an agent: ask which access class, then send `attachTool`. `current` is the class now, or null. */
  | { readonly kind: 'choose-access'; readonly agentId: string; readonly toolId: string; readonly agentName: string; readonly toolName: string; readonly current: AccessClass | null }
  /** A replace was asked for: ask which item takes its place, then send `setOverride`. */
  | { readonly kind: 'choose-replacement'; readonly itemId: string; readonly itemName: string }
  /** Nothing changes. `message` says why, in plain words. */
  | { readonly kind: 'refused'; readonly message: string };

/** The world as drawn: the draft world and the graph built from it. */
export interface EditorContext { readonly world: World; readonly model: HarnessMapModel }

/** The plain reason a hook is never created, copied, wired or edited. */
export const HOOK_REFUSAL = 'A hook runs code on its own, with no prompt. Bowerloom shows a hook and keeps it, but never creates, copies, wires or changes one.';

/** The plain reason a group is not wired. */
export const GROUP_REFUSAL = 'A library is shown as one group. Open the group first, then use the item you want.';

const refuse = (message: string): EditorOutcome => ({ kind: 'refused', message });

type Thing =
  | { readonly kind: 'item'; readonly item: HarnessItem; readonly node: HarnessNode }
  | { readonly kind: 'scope' | 'interface' | 'group'; readonly node: HarnessNode };

function thingOf(ctx: EditorContext, id: string): Thing | undefined {
  const node = ctx.model.nodes.find(n => n.id === id);
  if (node === undefined) return undefined;
  if (node.kind === 'scope' || node.kind === 'interface' || node.kind === 'group') return { kind: node.kind, node };
  const item = ctx.world.items.find(i => i.id === id);
  return item === undefined ? undefined : { kind: 'item', item, node };
}

/** The word for a thing, with its article: "a skill", "an agent", "a hook". */
export function kindPhrase(t: Thing): string {
  const word = t.kind === 'item'
    ? (t.item.kind === 'tool' ? (t.item.toolKind === 'hook' ? 'hook' : 'tool') : t.item.kind === 'context-slice' ? 'slice' : t.item.kind)
    : t.kind === 'scope' ? 'harness' : t.kind === 'interface' ? 'interface' : 'library';
  return `${/^[aeiou]/.test(word) ? 'an' : 'a'} ${word}`;
}
const upperFirst = (text: string): string => text.slice(0, 1).toUpperCase() + text.slice(1);

const isHook = (t: Thing): boolean => t.kind === 'item' && t.item.kind === 'tool' && t.item.toolKind === 'hook';
const scopeName = (world: World, id: string): string => world.scopes.find(s => s.id === id)?.name ?? id;
const libraryName = (world: World, id: string): string => world.libraries.find(l => l.id === id)?.name ?? id;

export { reachesScope };

/** Why an item cannot be changed in place, or null when it can. A library item is read only; a hook is never edited; a ghost, a replaced and an inherited item belong elsewhere. */
export function editRefusal(ctx: EditorContext, id: string): string | null {
  const t = thingOf(ctx, id);
  if (t === undefined) return 'That item is not on the page any more.';
  if (isHook(t)) return HOOK_REFUSAL;
  if (t.kind !== 'item') return `You cannot change ${kindPhrase(t)} this way.`;
  const { item, node } = t;
  if (item.library !== null) return `${item.name} comes from the library ${libraryName(ctx.world, item.library.library)} and is read only. Make an editable copy first, then change the copy.`;
  if (node.hidden) return `${item.name} is hidden here. Show it again first.`;
  if (node.replaced) return `${item.name} is replaced here. Change the replacement instead.`;
  if (node.inherited) return `${item.name} is inherited from ${node.fromScope ?? 'the global harness'}. Change it there, or drop it on this harness to make a copy that you can change here.`;
  return null;
}

/** True when the item can be changed where it is. */
export const canEditInPlace = (ctx: EditorContext, id: string): boolean => editRefusal(ctx, id) === null;

/** Why a skill, tool or slice cannot be wired to the agent now, or null when it can. */
function partnerRefusal(ctx: EditorContext, partner: Extract<Thing, { kind: 'item' }>, agent: AgentItem): string | null {
  const { item, node } = partner;
  if (node.hidden) return `${item.name} is hidden here. Show it again first.`;
  if (node.replaced) return `${item.name} is replaced here. Wire the replacement instead.`;
  if (!reachesScope(ctx.world, agent.scopeId, item.scopeId)) return `${item.name} belongs to ${scopeName(ctx.world, item.scopeId)}, so ${agent.name} in ${scopeName(ctx.world, agent.scopeId)} cannot use it.`;
  return null;
}

/**
 * A wire was drawn between two nodes, in either direction. A skill joins an agent (attachSkill), a tool joins an agent (the person picks an access class
 * first, then attachTool), and an agent joins a slice (assignSlice). Every other pair is refused with the reason.
 */
export function connectOutcome(ctx: EditorContext, sourceId: string, targetId: string): EditorOutcome {
  const a = thingOf(ctx, sourceId), b = thingOf(ctx, targetId);
  if (a === undefined || b === undefined) return refuse('That item is not on the page any more.');
  if (a.node.id === b.node.id) return refuse('A wire needs two different items.');
  if (isHook(a) || isHook(b)) return refuse(HOOK_REFUSAL);
  if (a.kind === 'group' || b.kind === 'group') return refuse(GROUP_REFUSAL);
  const agentThing = [a, b].find((t): t is Extract<Thing, { kind: 'item' }> => t.kind === 'item' && t.item.kind === 'agent');
  const other = agentThing === undefined ? undefined : (agentThing === a ? b : a);
  const connects = other !== undefined && other.kind === 'item' && (other.item.kind === 'skill' || other.item.kind === 'tool' || other.item.kind === 'context-slice');
  if (agentThing === undefined || other === undefined || other.kind !== 'item' || !connects) {
    return refuse(`${upperFirst(kindPhrase(a))} and ${kindPhrase(b)} do not connect. A wire joins a skill to an agent, a tool to an agent, or an agent to a slice.`);
  }
  const agent = agentThing.item as AgentItem, partner = other.item;
  const why = editRefusal(ctx, agent.id) ?? partnerRefusal(ctx, other, agent);
  if (why !== null) return refuse(why);

  if (partner.kind === 'skill') {
    if (agent.definition.skillIds.includes(partner.id)) return refuse(`${agent.name} already uses the skill ${partner.name}.`);
    return { kind: 'action', action: { type: 'attachSkill', agentId: agent.id, skillId: partner.id }, message: `${agent.name} now uses the skill ${partner.name}.` };
  }
  if (partner.kind === 'tool') {
    const current = agent.definition.toolAttachments.find(t => t.toolId === partner.id)?.access ?? null;
    return { kind: 'choose-access', agentId: agent.id, toolId: partner.id, agentName: agent.name, toolName: partner.name, current };
  }
  if (partner.kind === 'context-slice') {
    if (agent.definition.sliceId === partner.sliceId) return refuse(`${agent.name} already reads the slice ${partner.name}.`);
    return { kind: 'action', action: { type: 'assignSlice', agentId: agent.id, sliceId: partner.sliceId }, message: `${agent.name} now reads the slice ${partner.name}.` };
  }
  return refuse('Those two do not connect.');
}

/** The action that attaches a tool once the person has picked an access class. The message is for the live region. */
export function attachToolOutcome(agentId: string, toolId: string, access: AccessClass, words: Readonly<Record<AccessClass, string>>, agentName: string, toolName: string): EditorOutcome {
  return { kind: 'action', action: { type: 'attachTool', agentId, toolId, access }, message: `${agentName} now has the tool ${toolName}, with access: ${words[access]}.` };
}

/**
 * A node was dropped on another node. On a harness (scope) node, a skill or an agent is installed into that scope as a copy the person can edit.
 * On an agent, a skill, a tool or a slice behaves as a wire does. Everything else is refused.
 */
export function dropOutcome(ctx: EditorContext, draggedId: string, targetId: string): EditorOutcome {
  const dragged = thingOf(ctx, draggedId), target = thingOf(ctx, targetId);
  if (dragged === undefined || target === undefined) return refuse('That item is not on the page any more.');
  if (dragged.node.id === target.node.id) return refuse('Drop an item on a different item.');
  if (isHook(dragged)) return refuse(HOOK_REFUSAL);
  if (dragged.kind === 'group') return refuse(GROUP_REFUSAL);
  if (target.kind === 'interface') return refuse('Items reach an interface when you apply the changes. There is nothing to drop on an interface.');
  if (target.kind === 'scope') {
    if (dragged.kind !== 'item') return refuse(`You cannot drop ${kindPhrase(dragged)} on a harness.`);
    const { item } = dragged, scope = ctx.world.scopes.find(s => s.id === target.node.scopeId);
    if (scope === undefined) return refuse('That harness is not on the page any more.');
    if (item.kind !== 'skill' && item.kind !== 'agent') return refuse(`Only skills and agents can be dropped on a harness. ${upperFirst(kindPhrase(dragged))} is attached to an agent with a wire.`);
    if (item.scopeId === scope.id && item.library === null) return refuse(`${item.name} is already in ${scope.name}.`);
    const library = item.library === null ? '' : ' that you can edit';
    return { kind: 'action', action: { type: 'installItem', itemId: item.id, targetScopeId: scope.id }, message: `Installed a copy${library} of ${item.name} into ${scope.name}.` };
  }
  return connectOutcome(ctx, draggedId, targetId);
}

/**
 * A choice in a project: keep an inherited item from the parent, hide it, or replace it. Replace with no `replacementItemId` asks the screen to
 * let the person pick one. Refused in the global scope, for an item the project owns, and when nothing would change.
 */
export function overrideOutcome(ctx: EditorContext, itemId: string, mode: OverrideMode, replacementItemId?: string): EditorOutcome {
  const t = thingOf(ctx, itemId);
  if (t === undefined) return refuse('That item is not on the page any more.');
  if (t.kind === 'item' && t.item.kind === 'tool' && t.item.toolKind === 'hook' && mode === 'replace') return refuse(HOOK_REFUSAL);
  if (t.kind !== 'item') return refuse(`You cannot keep, hide or replace ${kindPhrase(t)}.`);
  const scope = ctx.world.scopes.find(s => s.id === ctx.model.scopeId), { item, node } = t;
  if (scope === undefined || scope.kind !== 'project') return refuse('Keep, hide and replace work inside a project. Switch to a project first.');
  if (!node.inherited) return refuse(`${item.name} belongs to ${scope.name}. Only items inherited from ${scopeName(ctx.world, item.scopeId)} can be kept, hidden or replaced.`);
  const parent = node.fromScope ?? scopeName(ctx.world, item.scopeId);
  if (mode === 'inherit') {
    if (!node.hidden && !node.replaced) return refuse(`${item.name} is already kept from ${parent}.`);
    return { kind: 'action', action: { type: 'setOverride', scopeId: scope.id, itemId: item.id, mode: 'inherit' }, message: `${item.name} is kept from ${parent} again.` };
  }
  if (mode === 'hide') {
    if (node.hidden) return refuse(`${item.name} is already hidden here.`);
    return { kind: 'action', action: { type: 'setOverride', scopeId: scope.id, itemId: item.id, mode: 'hide' }, message: `${item.name} is hidden in ${scope.name}. It shows as a ghost, and you can bring it back.` };
  }
  if (replacementItemId === undefined) return { kind: 'choose-replacement', itemId: item.id, itemName: item.name };
  const replacement = ctx.world.items.find(i => i.id === replacementItemId);
  if (replacement === undefined || replacement.id === item.id) return refuse('Pick a different item to take its place.');
  return {
    kind: 'action', action: { type: 'setOverride', scopeId: scope.id, itemId: item.id, mode: 'replace', replacementItemId: replacement.id },
    message: `${item.name} is replaced in ${scope.name} by ${replacement.name}.`,
  };
}

/** The items that may take the place of `item` in the current scope: the same kind (and the same kind of tool), reachable from the scope, not hidden, own items first. */
export function replacementChoices(ctx: EditorContext, itemId: string): HarnessItem[] {
  const item = ctx.world.items.find(i => i.id === itemId);
  if (item === undefined) return [];
  const sameKind = (other: HarnessItem): boolean => other.kind === item.kind && (item.kind !== 'tool' || (other.kind === 'tool' && other.toolKind === item.toolKind));
  const here = ctx.model.scopeId;
  const hidden = new Set(ctx.model.nodes.filter(n => n.hidden).map(n => n.id));
  return ctx.world.items
    .filter(other => other.id !== item.id && sameKind(other) && reachesScope(ctx.world, here, other.scopeId) && !hidden.has(other.id))
    .sort((x, y) => Number(y.scopeId === here) - Number(x.scopeId === here) || Number(x.library !== null) - Number(y.library !== null) || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
}

/** What a choice on a node's menu does. `open` and the group choices are the screen's own and are not decided here. */
export function menuOutcome(ctx: EditorContext, nodeId: string, action: 'hide' | 'unhide' | 'replace'): EditorOutcome {
  return overrideOutcome(ctx, nodeId, action === 'hide' ? 'hide' : action === 'unhide' ? 'inherit' : 'replace');
}

/** Install a library item, or any item, into the current scope as a copy that can be edited. */
export function copyOutcome(ctx: EditorContext, itemId: string): EditorOutcome {
  const t = thingOf(ctx, itemId);
  if (t === undefined || t.kind !== 'item') return refuse('That item is not on the page any more.');
  if (isHook(t)) return refuse(HOOK_REFUSAL);
  const scope = ctx.world.scopes.find(s => s.id === ctx.model.scopeId);
  if (scope === undefined) return refuse('That harness is not on the page any more.');
  return { kind: 'action', action: { type: 'installItem', itemId: t.item.id, targetScopeId: scope.id }, message: `Installed an editable copy of ${t.item.name} into ${scope.name}.` };
}

// ------------------------------------------------------------------------------------------------------------- conflicts

/** Keep the copy at `index` of `foundAt`; the other copies are dropped from the item. */
export function keepOneOutcome(item: HarnessItem, index: number): EditorOutcome {
  const copy = conflictCopies(item).find(c => c.index === index);
  if (copy === undefined) return refuse('That copy is not there.');
  return { kind: 'action', action: { type: 'resolveConflict', itemId: item.id, keep: index }, message: `Kept the copy from ${copy.interfaceNames} of ${item.name}. The other copies are no longer part of it.` };
}

/** Keep every copy as its own item, under the given names. Refused with the reason when a name cannot be used. */
export function keepBothOutcome(world: World, item: HarnessItem, names: readonly string[]): EditorOutcome {
  const problem = keepBothProblem(world, item.id, names);
  if (problem !== null) return refuse(problem);
  const trimmed = names.map(n => n.trim());
  return { kind: 'action', action: { type: 'resolveConflict', itemId: item.id, keep: 'keep-both', names: trimmed }, message: `Kept both copies of ${item.name}, as ${joinAnd(trimmed.map(n => `"${n}"`))}.` };
}
