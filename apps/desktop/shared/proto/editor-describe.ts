/**
 * The words of the harness editor, as pure functions: what the inspector says about a selected node, what the change bar says, and how a
 * projection plan is grouped for the person. Plain sentences, the spec's nouns (harness, skill, agent, tool, hook, slice, version), no command line.
 * A file path appears only as a detail (where an item was found, or a file in the plan), never as a main label.
 */
import type { HarnessItem, InterfaceId, Plan, PlanChange, World } from './types.js';
import type { HarnessMapModel, HarnessNode, HarnessNodeKind } from './harnessmodel.js';
import { ACCESS_WORDS, interfaceName } from './harnessmodel.js';
import { describeRule } from './slicerule.js';
import type { StoreAction } from './store.js';

/** One button of the inspector. `store` is the action to send for a plain button. Buttons with no `store` open something on the screen. */
export interface SelectionAction {
  readonly id: 'keep-from-global' | 'hide-here' | 'replace-here' | 'copy' | 'resolve' | 'remove-skill' | 'remove-tool' | 'clear-slice' | 'toggle-group';
  readonly label: string;
  /** For the three project choices: true when it is the current choice. Absent for other buttons. */
  readonly pressed?: boolean;
  readonly store?: StoreAction;
  /** The item or node this button is about (the skill or tool to remove, for example). */
  readonly targetId?: string;
  /** What to say when the button has done its work, for a plain button. */
  readonly done?: string;
}

/** Everything the inspector shows for one node. */
export interface SelectionView {
  readonly nodeId: string;
  readonly kind: HarnessNodeKind;
  /** "Skill", "Agent", "Tool", "Hook", "Slice", "Harness", "Interface", "Library". */
  readonly kindWord: string;
  readonly name: string;
  /** Plain sentences that say what it is. */
  readonly sentence: string;
  /** More plain lines: what an agent uses, who uses a skill. */
  readonly facts: readonly string[];
  /** Where the item was found: the interface and its invented path. Empty for something that is not a file. */
  readonly foundAt: readonly { readonly interfaceName: string; readonly path: string }[];
  readonly foundNote: string;
  /** The states in words, such as "Runs code with no prompt". */
  readonly flags: readonly string[];
  /** Why the item cannot be changed here, or null. */
  readonly readOnlyNote: string | null;
  readonly actions: readonly SelectionAction[];
}

const KIND_WORD = (node: HarnessNode): string => (node.kind === 'tool' ? (node.toolKind === 'hook' ? 'Hook' : 'Tool') : node.kind === 'context-slice' ? 'Slice'
  : node.kind === 'scope' ? 'Harness' : node.kind === 'interface' ? 'Interface' : node.kind === 'group' ? 'Library' : node.kind === 'skill' ? 'Skill' : 'Agent');

const joinAnd = (items: readonly string[]): string => (items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);
const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const names = (list: readonly string[], max = 4): string => (list.length <= max ? joinAnd(list) : `${list.slice(0, max).join(', ')} and ${list.length - max} more`);

function sentenceOf(world: World, node: HarnessNode, item: HarnessItem | undefined): string {
  if (item !== undefined) {
    switch (item.kind) {
      case 'skill': return `A skill is a reusable set of instructions for one kind of task. ${item.description}`;
      case 'agent': return `An agent is a named role with its own instructions, skills and tools. Its role is ${item.definition.role}.`;
      case 'context-slice': {
        const slice = world.slices.find(s => s.id === item.sliceId);
        return `A slice is a chosen part of the knowledge base. ${slice === undefined ? '' : describeRule(slice.rule, world.wikiPages)}`.trim();
      }
      case 'tool':
        if (item.toolKind === 'hook') return 'A hook is a script that an interface runs on its own at set moments. It runs code with no prompt.';
        if (item.toolKind === 'prompt') return 'A tool is something an agent can use. This one is a saved prompt, a command you can run by name.';
        return `A tool is something an agent can use. This one is an MCP server, a link to an outside service. ${item.secret === null ? 'It needs no secret.'
          : `Its secret is kept in ${item.secret.kind === 'env' ? 'an environment variable' : 'the keychain'} named ${item.secret.name}. Bowerloom stores only that name, never the value.`}`;
    }
  }
  switch (node.kind) {
    case 'scope': return node.fromScope === null && world.scopes.find(s => s.id === node.scopeId)?.kind === 'global'
      ? 'The global harness holds what every project starts with: its skills, agents, tools and slices.'
      : 'A project harness starts with everything in the global harness. For each inherited item you can keep it, hide it, or replace it here.';
    case 'interface': {
      const info = world.interfaces.find(i => i.id === node.interfaceId);
      const state = info === undefined ? '' : info.installed === 'installed' ? ' It is installed on this computer.' : info.installed === 'unknown' ? ' Bowerloom has not looked for it yet.' : ' It is not installed on this computer.';
      const wall = info === undefined ? '' : info.enforcement === 'blocks reads' ? ' It can block reads outside a slice.' : ' It can only advise: it cannot block reads outside a slice.';
      return `${node.label} is a program you talk to.${state}${wall}`;
    }
    case 'group': {
      const lib = world.libraries.find(l => l.id === node.id.replace(/^group:/, ''));
      return `${lib?.name ?? 'This library'} is an installed library. Its items are read only and pinned to version ${lib?.installedVersion ?? 'one version'}.${lib?.newerVersion === undefined ? '' : ` Version ${lib.newerVersion} is waiting.`}`;
    }
    default: return node.detail;
  }
}

function flagsOf(world: World, node: HarnessNode, item: HarnessItem | undefined): string[] {
  const out: string[] = [];
  const nameOf = (id: string | null): string => (id === null ? 'another item' : (world.items.find(i => i.id === id)?.name ?? id));
  if (node.hidden) out.push('Hidden here. It shows as a ghost and nothing is written for it.');
  else if (node.replaced) out.push(`Replaced here by ${nameOf(node.replacedBy)}.`);
  else if (node.inherited) out.push(`Inherited from ${node.fromScope ?? 'the global harness'}.`);
  if (node.runsCode) out.push('Runs code with no prompt.');
  if (node.secretMissing) out.push('Secret missing: the reference points at nothing.');
  if (node.conflict) out.push('Conflict: found in several interfaces with different text.');
  if (node.newerVersion) {
    const newer = item?.library?.newerVersion ?? world.libraries.find(l => l.id === (item?.library?.library ?? node.id.replace(/^group:/, '')))?.newerVersion;
    out.push(`New version waiting${newer === undefined ? '' : `: ${newer}`}.`);
  }
  if (node.libraryPinned && node.kind !== 'group' && item?.library) {
    const lib = world.libraries.find(l => l.id === item.library!.library);
    out.push(`From the library ${lib?.name ?? item.library.library}, read only, pinned to ${item.library.pinnedVersion}.`);
  }
  if (node.notInstalled) out.push('Not installed on this computer.');
  return out;
}

function factsOf(world: World, item: HarnessItem | undefined): string[] {
  if (item === undefined) return [];
  const byId = new Map(world.items.map(i => [i.id, i.name]));
  if (item.kind === 'agent') {
    const d = item.definition;
    const slice = d.sliceId === undefined ? null : (world.slices.find(s => s.id === d.sliceId)?.name ?? d.sliceId);
    return [
      d.skillIds.length === 0 ? 'Uses no skills yet. Draw a wire from a skill to this agent.' : `Uses ${count(d.skillIds.length, 'skill')}: ${names(d.skillIds.map(id => byId.get(id) ?? id))}.`,
      d.toolAttachments.length === 0 ? 'Has no tools yet. Draw a wire from a tool to this agent.' : `Has ${count(d.toolAttachments.length, 'tool')}: ${names(d.toolAttachments.map(t => `${byId.get(t.toolId) ?? t.toolId} (${ACCESS_WORDS[t.access]})`))}.`,
      slice === null ? 'Reads no slice.' : `Reads the slice ${slice}.`,
    ];
  }
  if (item.kind === 'skill' || item.kind === 'tool') {
    const users = world.items.filter(i => i.kind === 'agent' && (item.kind === 'skill' ? i.definition.skillIds.includes(item.id) : i.definition.toolAttachments.some(t => t.toolId === item.id)));
    return [users.length === 0 ? 'No agent uses it yet.' : `Used by ${count(users.length, 'agent')}: ${names(users.map(u => u.name))}.`];
  }
  if (item.kind === 'context-slice') {
    const users = world.items.filter(i => i.kind === 'agent' && i.definition.sliceId === item.sliceId);
    return [users.length === 0 ? 'No agent reads it yet.' : `Read by ${count(users.length, 'agent')}: ${names(users.map(u => u.name))}.`];
  }
  return [];
}

/**
 * What the inspector shows for a node, or null when the node is not in the model. The buttons that apply:
 * in a project, an inherited item can be kept from global, hidden or replaced; a library item can be copied; an item found in several
 * interfaces with different text can be resolved; an agent the person may edit shows a remove button for each skill, tool and slice;
 * a library group opens or closes.
 */
export function describeSelection(world: World, model: HarnessMapModel, nodeId: string): SelectionView | null {
  const node = model.nodes.find(n => n.id === nodeId);
  if (node === undefined) return null;
  const item = node.kind === 'scope' || node.kind === 'interface' || node.kind === 'group' ? undefined : world.items.find(i => i.id === node.id);
  const scope = world.scopes.find(s => s.id === model.scopeId);
  const actions: SelectionAction[] = [];
  let readOnlyNote: string | null = null;

  if (item !== undefined) {
    const isHook = item.kind === 'tool' && item.toolKind === 'hook';
    if (scope?.kind === 'project' && node.inherited) {
      actions.push(
        { id: 'keep-from-global', label: 'Keep from global', pressed: !node.hidden && !node.replaced, store: { type: 'setOverride', scopeId: scope.id, itemId: item.id, mode: 'inherit' } },
        { id: 'hide-here', label: 'Hide here', pressed: node.hidden, store: { type: 'setOverride', scopeId: scope.id, itemId: item.id, mode: 'hide' } },
      );
      if (!isHook) actions.push({ id: 'replace-here', label: 'Replace here', pressed: node.replaced });
    }
    if (isHook) readOnlyNote = 'Hooks cannot be created or edited in Bowerloom. You can see one, keep it, or hide it in a project.';
    else if (item.library !== null) {
      readOnlyNote = 'This item comes from a library, so it is read only. Make an editable copy to change it.';
      if (scope !== undefined) actions.push({ id: 'copy', label: 'Make an editable copy', store: { type: 'installItem', itemId: item.id, targetScopeId: scope.id } });
    }
    if (node.conflict) actions.push({ id: 'resolve', label: 'Resolve the conflict', targetId: item.id });
    if (item.kind === 'agent' && item.library === null && !node.inherited && !node.hidden && !node.replaced) {
      const byId = new Map(world.items.map(i => [i.id, i.name]));
      for (const id of item.definition.skillIds) actions.push({ id: 'remove-skill', label: `Remove the skill ${byId.get(id) ?? id}`, done: `${item.name} no longer uses the skill ${byId.get(id) ?? id}.`, targetId: id, store: { type: 'detachSkill', agentId: item.id, skillId: id } });
      for (const t of item.definition.toolAttachments) actions.push({ id: 'remove-tool', label: `Remove the tool ${byId.get(t.toolId) ?? t.toolId}`, done: `${item.name} no longer has the tool ${byId.get(t.toolId) ?? t.toolId}.`, targetId: t.toolId, store: { type: 'detachTool', agentId: item.id, toolId: t.toolId } });
      if (item.definition.sliceId !== undefined) actions.push({ id: 'clear-slice', label: 'Stop reading the slice', done: `${item.name} reads no slice now.`, store: { type: 'assignSlice', agentId: item.id, sliceId: null } });
    } else if (item.kind === 'agent' && item.library === null && node.inherited) {
      readOnlyNote = `This agent is inherited from ${node.fromScope ?? 'the global harness'}. Change it there, or drop it on this harness to make a copy you can change here.`;
    }
  }
  if (node.kind === 'group') actions.push({ id: 'toggle-group', label: node.expanded ? 'Show as one group' : `Show all ${node.memberCount ?? 0} items`, targetId: node.id });

  const foundAt = item === undefined ? [] : item.foundAt.map(f => ({ interfaceName: interfaceName(f.interface), path: f.path }));
  return {
    nodeId: node.id, kind: node.kind, kindWord: KIND_WORD(node), name: node.label, sentence: sentenceOf(world, node, item), facts: factsOf(world, item),
    foundAt, foundNote: item === undefined ? '' : foundAt.length === 0 ? 'Not a file in any interface. It lives in Bowerloom.' : '',
    flags: flagsOf(world, node, item), readOnlyNote, actions,
  };
}

// ------------------------------------------------------------------------------------------------------------- the change bar

/** The line at the left of the change bar. `fileCount` is the number of changes in the projection plan. */
export function changeBarText(dirty: boolean, fileCount: number): string {
  if (!dirty) return 'No changes waiting';
  if (fileCount === 0) return 'Changes waiting. No file would change.';
  return `${count(fileCount, 'change')} waiting`;
}

/** The reason the Apply button is off, or null when it is on. */
export function applyReason(dirty: boolean): string | null {
  return dirty ? null : 'There is nothing to apply. Make a change first.';
}

/** The words for an action on a file. */
export const ACTION_WORDS: Readonly<Record<PlanChange['action'], string>> = Object.freeze({ add: 'Add', change: 'Change', remove: 'Remove' });

const ORDER: readonly InterfaceId[] = ['claude-code', 'codex', 'opencode'];

/** One interface's share of a plan. */
export interface PlanGroup { readonly interface: InterfaceId; readonly name: string; readonly changes: readonly PlanChange[]; readonly summary: string }

/** The plan grouped by interface, in the usual order, leaving out an interface with no change. */
export function groupPlan(plan: Plan): PlanGroup[] {
  return ORDER.map(id => ({ id, changes: plan.changes.filter(c => c.interface === id) })).filter(g => g.changes.length > 0).map(g => {
    const n = (action: PlanChange['action']): number => g.changes.filter(c => c.action === action).length;
    const parts = ([['add', n('add')], ['change', n('change')], ['remove', n('remove')]] as const).filter(([, k]) => k > 0).map(([a, k]) => `${k} ${a === 'add' ? 'added' : a === 'change' ? 'changed' : 'removed'}`);
    return { interface: g.id, name: interfaceName(g.id), changes: g.changes, summary: parts.join(', ') };
  });
}

/** "Written to Claude Code, Codex and OpenCode (simulated)" for the interfaces the plan touched. */
export function writtenLine(plan: Plan): string {
  const groups = groupPlan(plan);
  return groups.length === 0 ? 'Nothing needed to be written (simulated)' : `Written to ${joinAnd(groups.map(g => g.name))} (simulated)`;
}

/** The line that says the version was saved, with its number. */
export function savedLine(counter: number, label: string): string {
  return `Saved as version ${counter}: ${label}`;
}
