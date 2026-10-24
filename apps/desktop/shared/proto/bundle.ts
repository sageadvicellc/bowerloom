/**
 * Export and import (spec 6.7 and 8). A bundle holds skills and agents, tool references, and slice rules. It never holds a secret value,
 * a secret state, a wiki page, a slice's seed pages or a frozen page list. Library items are referenced by their library, so they are not exported.
 *
 * - `buildBundle(world, scopeIds)` makes the bundle from the chosen scopes.
 * - `previewImport(bundle, world)` says what an import would do, and does nothing: every file, every secret to add, every clash.
 * - `commitImport(bundle, world)` returns the world with the bundle added. Nothing runs on import; a hook arrives as a name with no code.
 * A bundle is data from outside, so it is checked first (`parseBundle`) and rebuilt from the fields we know. An unknown field is dropped.
 * A bundle of the wrong shape is refused with an Error whose message is plain words.
 * The files an import would write sit in the `.bowerloom` folder of the scope that receives them (spec 6.10). Pure: no clock, no random number, no file.
 */
import type {
  AgentItem, Bundle, BundleItem, FoundAt, HarnessItem, ImportClash, ImportFile, ImportPreview, InterfaceExtra, InterfaceId, SecretSlot, Slice, SliceRule, ToolItem, ToolKind, ToolReference, World,
} from './types.js';
import { contentOf, fileSlug, globalScope, uniqueId } from './common.js';

// --------------------------------------------------------------------------------------------------- export

/** Makes a bundle of the skills, agents, tool references and slice rules that belong to the chosen scopes. Scopes the world does not have are left out. */
export function buildBundle(world: World, scopeIds: readonly string[]): Bundle {
  const known = new Set(world.scopes.map(s => s.id));
  const chosen = [...new Set(scopeIds)].filter(id => known.has(id)), inScope = new Set(chosen);
  const items = world.items.filter((i): i is BundleItem => (i.kind === 'skill' || i.kind === 'agent') && i.library === null && inScope.has(i.scopeId));
  const toolIds = new Set<string>(), sliceIds = new Set<string>();
  for (const i of world.items) if (i.kind === 'tool' && inScope.has(i.scopeId)) toolIds.add(i.id); else if (i.kind === 'context-slice' && inScope.has(i.scopeId)) sliceIds.add(i.sliceId);
  for (const i of items) if (i.kind === 'agent') {
    for (const t of i.definition.toolAttachments) toolIds.add(t.toolId);
    if (i.definition.sliceId !== undefined) sliceIds.add(i.definition.sliceId);
  }
  const toolRefs = world.items.filter((i): i is ToolItem => i.kind === 'tool' && i.library === null && toolIds.has(i.id)).map((t): ToolReference => ({
    toolId: t.id, name: t.name, toolKind: t.toolKind, secret: t.toolKind === 'mcp' && t.secret !== null ? { kind: t.secret.kind, name: t.secret.name } : null,
  }));
  const sliceRules = world.slices.filter(s => sliceIds.has(s.id)).map(s => ({ sliceId: s.id, name: s.name, rule: s.rule }));
  return { scopeIds: chosen, items, toolRefs, sliceRules };
}

// --------------------------------------------------------------------------------------------------- checking a bundle from outside

const INTERFACES: readonly InterfaceId[] = ['claude-code', 'codex', 'opencode'];
const TOOL_KINDS: readonly ToolKind[] = ['mcp', 'prompt', 'hook'];
const NAME_LIMIT = 200;

const fail = (what: string): never => { throw new Error(`This is not a Bowerloom bundle: ${what}.`); };
const record = (v: unknown, what: string): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : fail(what));
const text = (v: unknown, what: string): string => (typeof v === 'string' ? v : fail(what));
const array = (v: unknown, what: string): unknown[] => (Array.isArray(v) ? v : fail(what));
const strings = (v: unknown, what: string): string[] => array(v, what).map(x => text(x, what));
const pick = <T extends string>(v: unknown, allowed: readonly T[], what: string): T => (allowed.includes(v as T) ? v as T : fail(what));
function nameOf(v: unknown, what: string): string {
  const s = text(v, what);
  return s.trim() === '' || s.length > NAME_LIMIT || /[\u0000-\u001f\u007f]/.test(s) ? fail(what) : s;
}

function parseFound(v: unknown, where: string): FoundAt {
  const r = record(v, `${where} has a place that is not in the right shape`);
  return { interface: pick(r.interface, INTERFACES, `${where} names an interface that Bowerloom does not know`), path: text(r.path, `${where} has a place with no path`), contentHash: text(r.contentHash, `${where} has a place with no content mark`), text: text(r.text, `${where} has a place with no text`) };
}

function parseRule(v: unknown, where: string): SliceRule {
  const r = record(v, `${where} has no rule`), kinds = record(r.pageTypesAndTags, `${where} has no page types and tags`), links = r.linksFromSeeds;
  const hops = links === null ? null : record(links, `${where} has links that are not in the right shape`).hops;
  if (links !== null && hops !== 1 && hops !== 2) fail(`${where} follows links for a number of steps that is not 1 or 2`);
  return { folders: strings(r.folders, `${where} has a folder list that is not in the right shape`), pageTypesAndTags: { types: strings(kinds.types, `${where} has a type list that is not in the right shape`), tags: strings(kinds.tags, `${where} has a tag list that is not in the right shape`) }, linksFromSeeds: links === null ? null : { hops: hops as 1 | 2 } };
}

function parseItem(v: unknown, n: number): BundleItem {
  const where = `item ${n + 1}`, r = record(v, `${where} is not in the right shape`);
  const kind = pick(r.kind, ['skill', 'agent'] as const, `${where} is not a skill or an agent`);
  const base = { id: nameOf(r.id, `${where} has no id`), name: nameOf(r.name, `${where} has no usable name`), scopeId: text(r.scopeId, `${where} has no scope`), foundAt: array(r.foundAt, `${where} has no list of places`).map(f => parseFound(f, where)), library: null };
  if (kind === 'skill') return { ...base, kind, description: text(r.description, `${where} has no description`) };
  const d = record(r.definition, `${where} has no definition`);
  const definition = {
    name: text(d.name, `${where} has no agent name`), role: text(d.role, `${where} has no role`), instructions: text(d.instructions, `${where} has no instructions`),
    skillIds: strings(d.skillIds, `${where} has a skill list that is not in the right shape`),
    toolAttachments: array(d.toolAttachments, `${where} has a tool list that is not in the right shape`).map(t => { const a = record(t, `${where} has a tool that is not in the right shape`); return { toolId: text(a.toolId, `${where} has a tool with no id`), access: pick(a.access, ['read-only', 'read-write'] as const, `${where} has a tool with an access class that Bowerloom does not know`) }; }),
  };
  const extras = array(r.extras, `${where} has no list of extras`).map((e): InterfaceExtra => { const x = record(e, `${where} has an extra that is not in the right shape`); return { interface: pick(x.interface, INTERFACES, `${where} has an extra for an interface that Bowerloom does not know`), badge: text(x.badge, `${where} has an extra with no badge`), key: text(x.key, `${where} has an extra with no key`), value: text(x.value, `${where} has an extra with no value`) }; });
  if (d.sliceId !== undefined) return { ...base, kind, definition: { ...definition, sliceId: text(d.sliceId, `${where} has a slice that is not in the right shape`) }, extras };
  return { ...base, kind, definition, extras };
}

function parseToolRef(v: unknown, n: number): ToolReference {
  const where = `tool ${n + 1}`, r = record(v, `${where} is not in the right shape`), toolKind = pick(r.toolKind, TOOL_KINDS, `${where} is not an MCP server, a saved prompt or a hook`);
  const base = { toolId: nameOf(r.toolId, `${where} has no id`), name: nameOf(r.name, `${where} has no usable name`), toolKind };
  if (r.secret === null || r.secret === undefined) return { ...base, secret: null };
  const s = record(r.secret, `${where} has a secret that is not in the right shape`);
  if (Object.keys(s).some(k => k !== 'kind' && k !== 'name')) fail(`${where} carries more than the name of its secret, and Bowerloom never accepts a secret value`);
  if (toolKind !== 'mcp') fail(`${where} is not an MCP server but names a secret`);
  return { ...base, secret: { kind: pick(s.kind, ['env', 'keychain'] as const, `${where} keeps its secret in a place that Bowerloom does not know`), name: nameOf(s.name, `${where} has a secret with no name`) } };
}

/** Checks a bundle that came from outside and rebuilds it from the fields Bowerloom knows. Throws an Error in plain words when the shape is wrong. */
export function parseBundle(value: unknown): Bundle {
  const r = record(value, 'it is not a list of parts');
  const items = array(r.items, 'the list of items is missing').map(parseItem);
  if (new Set(items.map(i => i.id)).size !== items.length) fail('two items have the same id');
  const toolRefs = array(r.toolRefs, 'the list of tools is missing').map(parseToolRef);
  if (new Set(toolRefs.map(t => t.toolId)).size !== toolRefs.length) fail('two tools have the same id');
  const sliceRules = array(r.sliceRules, 'the list of slice rules is missing').map((s, n) => {
    const x = record(s, `slice rule ${n + 1} is not in the right shape`);
    return { sliceId: nameOf(x.sliceId, `slice rule ${n + 1} has no id`), name: nameOf(x.name, `slice rule ${n + 1} has no usable name`), rule: parseRule(x.rule, `slice rule ${n + 1}`) };
  });
  return { scopeIds: strings(r.scopeIds, 'the list of scopes is missing'), items, toolRefs, sliceRules };
}

// --------------------------------------------------------------------------------------------------- import

interface Landing { readonly tools: ToolItem[]; readonly placed: Map<string, BundleItem>; readonly order: readonly BundleItem[]; readonly slices: Slice[]; readonly preview: ImportPreview }

const ruleKey = (rule: SliceRule): string => JSON.stringify([rule.folders, rule.pageTypesAndTags.types, rule.pageTypesAndTags.tags, rule.linksFromSeeds === null ? null : rule.linksFromSeeds.hops]);
const slotKey = (s: SecretSlot): string => `${s.kind}\u0000${s.name}`;

/** Works out everything an import does. The preview and the commit both read this one result, so what the person is shown is what happens. */
function land(input: unknown, world: World): Landing {
  const bundle = parseBundle(input);
  const home = globalScope(world) ?? world.scopes[0];
  if (home === undefined) throw new Error('This workspace has no place to put the imported items.');
  const scopes = new Map(world.scopes.map(s => [s.id, s]));
  const scopeFor = (id: string) => scopes.get(id) ?? home;
  const harness = (scopePath: string, rel: string): string => `${scopePath.replace(/\/+$/, '')}/.bowerloom/${rel}`;

  const itemIds = new Set(world.items.map(i => i.id)), sliceIds = new Set(world.slices.map(s => s.id));
  // Per scope and kind: the item with each name, the names, and the file names, so a new item never lands on an old one.
  const groups = new Map<string, { byName: Map<string, HarnessItem>; names: Set<string>; slugs: Set<string> }>();
  const group = (scopeId: string, kind: string) => {
    const key = `${scopeId}\u0000${kind}`;
    let g = groups.get(key);
    if (g === undefined) { g = { byName: new Map(), names: new Set(), slugs: new Set() }; groups.set(key, g); }
    return g;
  };
  for (const i of world.items) { const g = group(i.scopeId, i.kind); if (!g.byName.has(i.name)) g.byName.set(i.name, i); g.names.add(i.name); g.slugs.add(fileSlug(i.name)); }

  const idMap = new Map<string, string>(), sliceMap = new Map<string, string>();
  const secrets: SecretSlot[] = [], clashes: ImportClash[] = [];
  const toolFiles: ImportFile[] = [], sliceFiles: ImportFile[] = [], skillFiles = new Map<string, ImportFile>(), agentFiles = new Map<string, ImportFile>();

  // Tools: a tool that is already there (same kind, same name) is kept; a new one arrives as a reference with its secret still to be added.
  const tools: ToolItem[] = [];
  for (const ref of bundle.toolRefs) {
    const have = world.items.find((i): i is ToolItem => i.kind === 'tool' && i.toolKind === ref.toolKind && i.name === ref.name);
    if (ref.secret !== null) {
      const slot = ref.secret, ready = have !== undefined && have.toolKind === 'mcp' && have.secret !== null && have.secret.state === 'present' && have.secret.kind === slot.kind && have.secret.name === slot.name;
      if (!ready && !secrets.some(s => slotKey(s) === slotKey(slot))) secrets.push({ kind: slot.kind, name: slot.name });
    }
    if (have !== undefined) { idMap.set(ref.toolId, have.id); continue; }
    const id = itemIds.has(ref.toolId) ? uniqueId(itemIds, `${ref.toolId}-imported`) : ref.toolId;
    itemIds.add(id); idMap.set(ref.toolId, id);
    const shared = { id, kind: 'tool' as const, name: ref.name, scopeId: home.id, foundAt: [], library: null };
    if (ref.toolKind === 'mcp') { tools.push({ ...shared, toolKind: 'mcp', secret: ref.secret === null ? null : { kind: ref.secret.kind, name: ref.secret.name, state: 'missing' } }); toolFiles.push({ path: harness(home.path, `tools/${fileSlug(ref.name)}.json`), action: 'add' }); }
    else if (ref.toolKind === 'prompt') { tools.push({ ...shared, toolKind: 'prompt' }); toolFiles.push({ path: harness(home.path, `tools/${fileSlug(ref.name)}.md`), action: 'add' }); }
    else tools.push({ ...shared, toolKind: 'hook', runsCode: true });
  }

  // Slices: a rule that is already there under the same name is kept; a new one arrives with no seed pages, because page ids belong to one wiki.
  const slices: Slice[] = [];
  for (const rule of bundle.sliceRules) {
    const have = world.slices.find(s => s.name === rule.name && ruleKey(s.rule) === ruleKey(rule.rule));
    if (have !== undefined) { sliceMap.set(rule.sliceId, have.id); continue; }
    const id = uniqueId(sliceIds, rule.sliceId); sliceIds.add(id); sliceMap.set(rule.sliceId, id);
    const names = new Set([...world.slices, ...slices].map(s => s.name));
    let name = rule.name;
    for (let n = 1; names.has(name); n += 1) name = n === 1 ? `${rule.name} (imported)` : `${rule.name} (imported ${n})`;
    slices.push({ id, name, seeds: [], rule: rule.rule, pinned: false });
    sliceFiles.push({ path: harness(home.path, `slices/${fileSlug(name)}.json`), action: 'add' });
  }

  // Skills first, then agents, so an agent can follow the new id of a skill it uses.
  const placed = new Map<string, BundleItem>();
  const remap = (a: AgentItem): AgentItem => {
    const d = a.definition, sid = d.sliceId;
    return { ...a, definition: { ...d, skillIds: d.skillIds.map(s => idMap.get(s) ?? s), toolAttachments: d.toolAttachments.map(t => ({ toolId: idMap.get(t.toolId) ?? t.toolId, access: t.access })), ...(sid === undefined ? {} : { sliceId: sliceMap.get(sid) ?? sid }) } };
  };
  for (const kind of ['skill', 'agent'] as const) {
    for (const item of bundle.items) {
      if (item.kind !== kind) continue;
      const scope = scopeFor(item.scopeId), g = group(scope.id, kind), mapped: BundleItem = item.kind === 'agent' ? remap(item) : item;
      const same = g.byName.get(mapped.name);
      if (same !== undefined && contentOf(same) === contentOf(mapped)) { clashes.push({ itemId: item.id, name: item.name, reason: 'same-name' }); idMap.set(item.id, same.id); continue; }
      let name = mapped.name;
      if (same !== undefined || g.slugs.has(fileSlug(name))) {
        clashes.push({ itemId: item.id, name: item.name, reason: 'different-text' });
        for (let n = 1; g.names.has(name) || g.slugs.has(fileSlug(name)); n += 1) name = n === 1 ? `${mapped.name} (imported)` : `${mapped.name} (imported ${n})`;
      }
      const id = itemIds.has(mapped.id) ? uniqueId(itemIds, `${mapped.id}-imported`) : mapped.id;
      itemIds.add(id); idMap.set(item.id, id);
      const final: BundleItem = mapped.kind === 'agent' ? { ...mapped, id, name, scopeId: scope.id, definition: name === mapped.name ? mapped.definition : { ...mapped.definition, name } } : { ...mapped, id, name, scopeId: scope.id };
      placed.set(item.id, final);
      g.names.add(name); g.slugs.add(fileSlug(name)); g.byName.set(name, final);
      const file: ImportFile = { path: harness(scope.path, kind === 'skill' ? `skills/${fileSlug(name)}/SKILL.md` : `agents/${fileSlug(name)}.md`), action: 'add' };
      (kind === 'skill' ? skillFiles : agentFiles).set(item.id, file);
    }
  }
  const order = bundle.items.flatMap(i => { const p = placed.get(i.id); return p === undefined ? [] : [p]; });
  const files = [...toolFiles, ...bundle.items.flatMap(i => skillFiles.get(i.id) ?? []), ...bundle.items.flatMap(i => agentFiles.get(i.id) ?? []), ...sliceFiles];
  return { tools, placed, order, slices, preview: { files, secretsToAdd: secrets, clashes } };
}

/** What importing `bundle` into `world` would do, and nothing more: every file it would write, every secret to add, every clash. Changes nothing. */
export function previewImport(bundle: Bundle, world: World): ImportPreview {
  return land(bundle, world).preview;
}

/**
 * The world with the bundle added. Tools arrive as references (a secret is marked missing, a hook has no code). An item whose name is taken
 * with the same text is not added twice; with different text it is kept under a name ending in "(imported)". Nothing in the bundle runs.
 */
export function commitImport(bundle: Bundle, world: World): World {
  const { tools, order, slices } = land(bundle, world);
  if (tools.length === 0 && order.length === 0 && slices.length === 0) return world;
  return { ...world, items: [...world.items, ...tools, ...order], slices: [...world.slices, ...slices] };
}
