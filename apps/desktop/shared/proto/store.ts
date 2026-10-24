/**
 * The prototype's in-memory store (spec sections 3, 6.3, 6.6, 6.9 and 6.13).
 *
 * `createStore(world)` holds one state and tells subscribers when it changes. All the rules live in the pure `reduceStore` below.
 * Every edit changes only `draft`. `apply` commits the draft and appends one Version; `restore` appends a NEW version equal to an
 * old one and never deletes history. Versions are ordered by a logical counter that grows by 1, never by a clock.
 * Nothing here reads a clock or a random number, and nothing changes an input: every update builds new objects.
 * An action that would change nothing (or that names something that is not there) returns the very same state, so it leaves no step to undo.
 */
import type { AccessClass, AgentItem, HarnessItem, OverrideMode, SkillItem, Slice, SliceRule, Version, World } from './types.js';
import { globalScope, uniqueId } from './common.js';
import { LIBRARY_CATALOG, catalogAgentPath, catalogAgentText, catalogHash, catalogItemId, catalogSkillPath } from './library-catalog.js';
import { liveMatch } from './slicematch.js';

/** Every action the store understands. The first group edits the draft; the second group moves between draft, committed and versions. */
export type StoreAction =
  | { readonly type: 'setOverride'; readonly scopeId: string; readonly itemId: string; readonly mode: OverrideMode; readonly replacementItemId?: string }
  | { readonly type: 'attachSkill'; readonly agentId: string; readonly skillId: string }
  | { readonly type: 'detachSkill'; readonly agentId: string; readonly skillId: string }
  | { readonly type: 'attachTool'; readonly agentId: string; readonly toolId: string; readonly access: AccessClass }
  | { readonly type: 'detachTool'; readonly agentId: string; readonly toolId: string }
  | { readonly type: 'installItem'; readonly itemId: string; readonly targetScopeId: string }
  | { readonly type: 'addLibrary'; readonly libraryId: string }
  | { readonly type: 'moveSkill'; readonly agentId: string; readonly skillId: string; readonly toIndex: number }
  | { readonly type: 'resolveConflict'; readonly itemId: string; readonly keep: number }
  | { readonly type: 'resolveConflict'; readonly itemId: string; readonly keep: 'keep-both'; readonly names: readonly string[] }
  | { readonly type: 'createSlice'; readonly name: string; readonly rule: SliceRule; readonly seeds?: readonly string[]; readonly scopeId?: string }
  | { readonly type: 'updateSliceRule'; readonly sliceId: string; readonly rule: SliceRule }
  | { readonly type: 'pinSlice'; readonly sliceId: string }
  | { readonly type: 'unpinSlice'; readonly sliceId: string }
  | { readonly type: 'assignSlice'; readonly agentId: string; readonly sliceId: string | null }
  | { readonly type: 'undo' }
  | { readonly type: 'redo' }
  | { readonly type: 'discard' }
  | { readonly type: 'apply'; readonly label: string }
  | { readonly type: 'restore'; readonly versionId: string };

/**
 * What the store holds. `committed` is what was applied. `draft` is committed plus the edits not yet applied; only `committed` carries
 * versions, and `draft.versions` is always the same list. The two stacks hold earlier drafts, newest last. `headVersionId` is the newest version, or null.
 */
export interface StoreState {
  readonly committed: World;
  readonly draft: World;
  readonly undoStack: readonly World[];
  readonly redoStack: readonly World[];
  readonly headVersionId: string | null;
}

/** The store: read the state, send an action, and ask to be told of changes. `subscribe` answers a function that stops the listening. */
export interface Store {
  getState(): StoreState;
  dispatch(action: StoreAction): void;
  subscribe(listener: () => void): () => void;
}

/** How many earlier drafts undo keeps. */
export const MAX_UNDO = 100;

const snapshots = new WeakMap<World, string>();

/** The world as JSON text, without its versions. This is what a version stores. The text is kept per world object, so asking twice costs once. */
export function snapshotOf(world: World): string {
  const known = snapshots.get(world);
  if (known !== undefined) return known;
  const { versions: _versions, ...rest } = world;
  const text = JSON.stringify(rest);
  snapshots.set(world, text);
  return text;
}

/** True when the draft differs from what was applied. */
export function isDirty(state: StoreState): boolean {
  return state.draft !== state.committed && snapshotOf(state.draft) !== snapshotOf(state.committed);
}

function headOf(world: World): string | null {
  let head: Version | null = null;
  for (const v of world.versions) if (head === null || v.counter > head.counter) head = v;
  return head === null ? null : head.id;
}

const withVersions = (draft: World, versions: readonly Version[]): World => (draft.versions === versions ? draft : { ...draft, versions });
const pushCapped = (stack: readonly World[], world: World): World[] => [...stack, world].slice(-MAX_UNDO);

function nextVersion(world: World, parentId: string | null, label: string, snapshotJson: string): Version {
  const counter = world.versions.reduce((most, v) => Math.max(most, v.counter), 0) + 1;
  return { id: uniqueId(world.versions.map(v => v.id), `v${counter}`), parentId, counter, label, snapshotJson };
}

// --------------------------------------------------------------------------------------------------- draft edits

const isAgent = (item: HarnessItem | undefined): item is AgentItem => item !== undefined && item.kind === 'agent';

/** Changes one agent that the person owns. A library agent is read-only until it is copied with `installItem`. */
function editAgent(world: World, agentId: string, change: (agent: AgentItem) => AgentItem): World {
  const index = world.items.findIndex(i => i.id === agentId);
  const agent = world.items[index];
  if (!isAgent(agent) || agent.library !== null) return world;
  const next = change(agent);
  return next === agent ? world : { ...world, items: world.items.map((item, i) => (i === index ? next : item)) };
}

const hasKind = (world: World, id: string, kind: HarnessItem['kind']): boolean => world.items.some(i => i.id === id && i.kind === kind);

function setOverride(world: World, a: Extract<StoreAction, { type: 'setOverride' }>): World {
  const scope = world.scopes.find(s => s.id === a.scopeId), item = world.items.find(i => i.id === a.itemId);
  if (scope === undefined || scope.kind !== 'project' || item === undefined || item.scopeId === a.scopeId) return world;
  if (a.mode === 'replace' && (a.replacementItemId === undefined || a.replacementItemId === a.itemId || !world.items.some(i => i.id === a.replacementItemId))) return world;
  const same = (o: { scopeId: string; itemId: string }): boolean => o.scopeId === a.scopeId && o.itemId === a.itemId;
  const previous = world.overrides.find(same);
  if (previous === undefined && a.mode === 'inherit') return world;
  if (previous !== undefined && previous.mode === a.mode && previous.replacementItemId === (a.mode === 'replace' ? a.replacementItemId : undefined)) return world;
  if (a.mode === 'inherit') return { ...world, overrides: world.overrides.filter(o => !same(o)) };
  const entry = a.mode === 'replace' && a.replacementItemId !== undefined
    ? { scopeId: a.scopeId, itemId: a.itemId, mode: a.mode, replacementItemId: a.replacementItemId } as const
    : { scopeId: a.scopeId, itemId: a.itemId, mode: a.mode } as const;
  return { ...world, overrides: previous === undefined ? [...world.overrides, entry] : world.overrides.map(o => (same(o) ? entry : o)) };
}

function named(item: HarnessItem, name: string): HarnessItem {
  return item.kind === 'agent' ? { ...item, name, definition: { ...item.definition, name } } : { ...item, name };
}

/** The name when it is free in that scope for that kind of item, else "name copy", "name copy 2" and so on. */
function freeName(world: World, scopeId: string, kind: HarnessItem['kind'], base: string): string {
  const taken = new Set(world.items.filter(i => i.scopeId === scopeId && i.kind === kind).map(i => i.name));
  if (!taken.has(base)) return base;
  const first = `${base} copy`;
  if (!taken.has(first)) return first;
  for (let n = 2; ; n += 1) if (!taken.has(`${first} ${n}`)) return `${first} ${n}`;
}

function installItem(world: World, a: Extract<StoreAction, { type: 'installItem' }>): World {
  const item = world.items.find(i => i.id === a.itemId);
  if (item === undefined || !world.scopes.some(s => s.id === a.targetScopeId)) return world;
  const copy: HarnessItem = { ...named(item, freeName(world, a.targetScopeId, item.kind, item.name)), id: uniqueId(world.items.map(i => i.id), `${item.id}-copy`), scopeId: a.targetScopeId, library: null };
  return { ...world, items: [...world.items, copy] };
}

/**
 * Adds one library of the invented catalog: its source, and its skills and agents as read-only items of the global harness, pinned to its version.
 * Refused (the same state comes back) when the library is not in the catalog, is already there, there is no global harness, or an item id is taken.
 */
function addLibrary(world: World, a: Extract<StoreAction, { type: 'addLibrary' }>): World {
  const lib = LIBRARY_CATALOG.find(l => l.id === a.libraryId), global = globalScope(world);
  if (lib === undefined || global === undefined || world.libraries.some(l => l.id === lib.id)) return world;
  const taken = new Set(world.items.map(i => i.id));
  const ids = [...lib.skills.map(s => catalogItemId(lib.id, s.key)), ...lib.agents.map(g => catalogItemId(lib.id, g.key))];
  if (ids.some(id => taken.has(id)) || new Set(ids).size !== ids.length) return world;
  const ref = { library: lib.id, pinnedVersion: lib.version } as const;
  const skills = lib.skills.map((s): SkillItem => ({
    id: catalogItemId(lib.id, s.key), kind: 'skill', name: s.name, scopeId: global.id, library: ref, description: s.description,
    foundAt: s.interfaces.map(face => ({ interface: face, path: catalogSkillPath(lib, s, face), contentHash: catalogHash(s.text), text: s.text })),
  }));
  const agents = lib.agents.map((g): AgentItem => {
    const text = catalogAgentText(g);
    return {
      id: catalogItemId(lib.id, g.key), kind: 'agent', name: g.name, scopeId: global.id, library: ref,
      foundAt: [{ interface: 'claude-code', path: catalogAgentPath(lib, g), contentHash: catalogHash(text), text }],
      definition: { name: g.name, role: g.role, instructions: g.instructions, skillIds: g.skillKeys.map(k => catalogItemId(lib.id, k)), toolAttachments: [] }, extras: [],
    };
  });
  return { ...world, libraries: [...world.libraries, { id: lib.id, name: lib.name, installedVersion: lib.version }], items: [...world.items, ...skills, ...agents] };
}

/** Moves one skill of an agent to a new place in its list. Nothing changes for an unknown skill, a place outside the list, or the place it has now. */
function moveSkill(world: World, a: Extract<StoreAction, { type: 'moveSkill' }>): World {
  return editAgent(world, a.agentId, agent => {
    const ids = agent.definition.skillIds, from = ids.indexOf(a.skillId);
    if (from < 0 || !Number.isInteger(a.toIndex) || a.toIndex < 0 || a.toIndex >= ids.length || a.toIndex === from) return agent;
    const next = ids.filter(id => id !== a.skillId);
    next.splice(a.toIndex, 0, a.skillId);
    return { ...agent, definition: { ...agent.definition, skillIds: next } };
  });
}

function resolveConflict(world: World, a: Extract<StoreAction, { type: 'resolveConflict' }>): World {
  const index = world.items.findIndex(i => i.id === a.itemId), item = world.items[index];
  if (item === undefined) return world;
  const hashes = [...new Set(item.foundAt.map(f => f.contentHash))];
  if (hashes.length < 2) return world;
  if (a.keep !== 'keep-both') {
    const chosen = item.foundAt[a.keep];
    if (!Number.isInteger(a.keep) || chosen === undefined) return world;
    return { ...world, items: world.items.map((it, i) => (i === index ? { ...it, foundAt: it.foundAt.filter(f => f.contentHash === chosen.contentHash) } : it)) };
  }
  const names = a.names.map(n => n.trim());
  const others = new Set(world.items.filter(i => i !== item && i.scopeId === item.scopeId && i.kind === item.kind).map(i => i.name));
  if (names.length !== hashes.length || names.some(n => n === '' || others.has(n)) || new Set(names).size !== names.length) return world;
  const taken = new Set(world.items.map(i => i.id));
  const parts = hashes.map((hash, n): HarnessItem => {
    const group = item.foundAt.filter(f => f.contentHash === hash);
    if (n === 0) return { ...named(item, names[n]!), foundAt: group };
    const id = uniqueId(taken, `${item.id}-${n + 1}`); taken.add(id);
    return { ...named(item, names[n]!), id, foundAt: group };
  });
  return { ...world, items: [...world.items.slice(0, index), ...parts, ...world.items.slice(index + 1)] };
}

function createSlice(world: World, a: Extract<StoreAction, { type: 'createSlice' }>): World {
  const name = a.name.trim(), scope = a.scopeId === undefined ? globalScope(world) : world.scopes.find(s => s.id === a.scopeId);
  if (name === '' || scope === undefined) return world;
  const known = new Set(world.wikiPages.map(p => p.id));
  const taken = new Set([...world.slices.map(s => s.id), ...world.items.map(i => i.id)]);
  let n = 1;
  while (taken.has(`slice-${n}`) || taken.has(`slice-${n}-item`)) n += 1;
  const id = `slice-${n}`;
  const slice: Slice = { id, name, seeds: [...new Set(a.seeds ?? [])].filter(s => known.has(s)), rule: structuredClone(a.rule), pinned: false };
  const shown: HarnessItem = { id: `${id}-item`, kind: 'context-slice', name, scopeId: scope.id, foundAt: [], library: null, sliceId: id };
  return { ...world, slices: [...world.slices, slice], items: [...world.items, shown] };
}

function editSlice(world: World, sliceId: string, change: (slice: Slice) => Slice): World {
  const index = world.slices.findIndex(s => s.id === sliceId), slice = world.slices[index];
  if (slice === undefined) return world;
  const next = change(slice);
  return next === slice ? world : { ...world, slices: world.slices.map((s, i) => (i === index ? next : s)) };
}

function editDraft(world: World, action: StoreAction): World {
  switch (action.type) {
    case 'setOverride': return setOverride(world, action);
    case 'attachSkill': return !hasKind(world, action.skillId, 'skill') ? world : editAgent(world, action.agentId, a => (a.definition.skillIds.includes(action.skillId) ? a : { ...a, definition: { ...a.definition, skillIds: [...a.definition.skillIds, action.skillId] } }));
    case 'detachSkill': return editAgent(world, action.agentId, a => (a.definition.skillIds.includes(action.skillId) ? { ...a, definition: { ...a.definition, skillIds: a.definition.skillIds.filter(s => s !== action.skillId) } } : a));
    case 'attachTool': return !hasKind(world, action.toolId, 'tool') ? world : editAgent(world, action.agentId, a => {
      const now = a.definition.toolAttachments.find(t => t.toolId === action.toolId);
      if (now !== undefined && now.access === action.access) return a;
      const toolAttachments = now === undefined ? [...a.definition.toolAttachments, { toolId: action.toolId, access: action.access }] : a.definition.toolAttachments.map(t => (t.toolId === action.toolId ? { toolId: t.toolId, access: action.access } : t));
      return { ...a, definition: { ...a.definition, toolAttachments } };
    });
    case 'detachTool': return editAgent(world, action.agentId, a => (a.definition.toolAttachments.some(t => t.toolId === action.toolId) ? { ...a, definition: { ...a.definition, toolAttachments: a.definition.toolAttachments.filter(t => t.toolId !== action.toolId) } } : a));
    case 'installItem': return installItem(world, action);
    case 'addLibrary': return addLibrary(world, action);
    case 'moveSkill': return moveSkill(world, action);
    case 'resolveConflict': return resolveConflict(world, action);
    case 'createSlice': return createSlice(world, action);
    case 'updateSliceRule': return editSlice(world, action.sliceId, s => (JSON.stringify(s.rule) === JSON.stringify(action.rule) ? s : { ...s, rule: structuredClone(action.rule) }));
    case 'pinSlice': return editSlice(world, action.sliceId, s => (s.pinned ? s : { ...s, pinned: true, pinnedPageIds: liveMatch(world, s).map(p => p.id) }));
    case 'unpinSlice': return editSlice(world, action.sliceId, s => {
      if (!s.pinned && s.pinnedPageIds === undefined) return s;
      const { pinnedPageIds: _frozen, ...live } = s;
      return { ...live, pinned: false };
    });
    case 'assignSlice': {
      if (action.sliceId !== null && !world.slices.some(s => s.id === action.sliceId)) return world;
      return editAgent(world, action.agentId, a => {
        if (action.sliceId === null) {
          if (a.definition.sliceId === undefined) return a;
          const { sliceId: _gone, ...rest } = a.definition;
          return { ...a, definition: rest };
        }
        return a.definition.sliceId === action.sliceId ? a : { ...a, definition: { ...a.definition, sliceId: action.sliceId } };
      });
    }
    default: return world;
  }
}

// --------------------------------------------------------------------------------------------------- the reducer

function restoreWorld(committed: World, versionId: string): World | null {
  const old = committed.versions.find(v => v.id === versionId);
  if (old === undefined) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(old.snapshotJson); } catch { return null; }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const p = parsed as Record<string, unknown>;
  for (const key of ['interfaces', 'items', 'scopes', 'overrides', 'wikiPages', 'slices', 'libraries']) if (!Array.isArray(p[key])) return null;
  return { ...(p as unknown as Omit<World, 'versions'>), versions: committed.versions };
}

/** The pure rule of the store: a state and an action in, the next state out. Never changes its inputs. */
export function reduceStore(state: StoreState, action: StoreAction): StoreState {
  switch (action.type) {
    case 'undo': {
      const earlier = state.undoStack[state.undoStack.length - 1];
      if (earlier === undefined) return state;
      return { ...state, draft: withVersions(earlier, state.committed.versions), undoStack: state.undoStack.slice(0, -1), redoStack: pushCapped(state.redoStack, state.draft) };
    }
    case 'redo': {
      const later = state.redoStack[state.redoStack.length - 1];
      if (later === undefined) return state;
      return { ...state, draft: withVersions(later, state.committed.versions), redoStack: state.redoStack.slice(0, -1), undoStack: pushCapped(state.undoStack, state.draft) };
    }
    case 'discard': {
      if (!isDirty(state)) return state;
      return { ...state, draft: state.committed, undoStack: pushCapped(state.undoStack, state.draft), redoStack: [] };
    }
    case 'apply': {
      if (!isDirty(state)) return state;
      const label = action.label.trim();
      const version = nextVersion(state.committed, state.headVersionId, label === '' ? 'Applied changes' : label, snapshotOf(state.draft));
      const committed: World = { ...state.draft, versions: [...state.committed.versions, version] };
      snapshots.set(committed, snapshotOf(state.draft));
      return { ...state, committed, draft: committed, headVersionId: version.id };
    }
    case 'restore': {
      const restored = restoreWorld(state.committed, action.versionId);
      const old = state.committed.versions.find(v => v.id === action.versionId);
      if (restored === null || old === undefined) return state;
      const version = nextVersion(state.committed, state.headVersionId, `Restored: ${old.label}`, old.snapshotJson);
      const committed: World = { ...restored, versions: [...state.committed.versions, version] };
      snapshots.set(committed, old.snapshotJson);
      const keep = snapshotOf(state.draft) === old.snapshotJson ? state.undoStack : pushCapped(state.undoStack, state.draft);
      return { committed, draft: committed, undoStack: keep, redoStack: [], headVersionId: version.id };
    }
    default: {
      const draft = editDraft(state.draft, action);
      if (draft === state.draft) return state;
      return { ...state, draft, undoStack: pushCapped(state.undoStack, state.draft), redoStack: [] };
    }
  }
}

/** Makes a store around `world`. The world is not changed; it is the first committed state and the first draft. */
export function createStore(world: World): Store {
  let state: StoreState = { committed: world, draft: world, undoStack: [], redoStack: [], headVersionId: headOf(world) };
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    dispatch(action) {
      const next = reduceStore(state, action);
      if (next === state) return;
      state = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
