/**
 * Export and import (spec 6.7 and 8). A bundle holds skills and agents, tool references, and slice rules. It never holds a secret value that Bowerloom
 * keeps, a secret state, a wiki page, a slice's seed pages or a frozen page list. Library items are referenced by their library, so they are not exported.
 * It does hold the text of the skills and agents, and the places they were found, written as paths inside each harness (no home folder, no user name).
 *
 * - `buildBundle(world, scopeIds)` makes the bundle from the chosen scopes, and adds the owned skills that the chosen agents use.
 * - `previewImport(bundle, world)` says what an import would do, and does nothing: every file and its size, every secret to add, every clash,
 *   every access class it would grant, and every reference it cannot resolve.
 * - `commitImport(bundle, world)` returns the world with the bundle added. Nothing runs on import; a hook arrives as a name with no code.
 * A bundle is data from outside, so it is checked first (`parseBundle`) and rebuilt from the fields we know. An unknown field is dropped.
 * A bundle of the wrong shape or past a limit is refused with an Error whose message is plain words.
 * The files an import would write sit in the `.bowerloom` folder of the scope that receives them (spec 6.10). Pure: no clock, no random number, no file.
 */
import type {
  AgentItem, Bundle, BundleItem, ContextSliceItem, FoundAt, HarnessItem, ImportClash, ImportFile, ImportGrant, ImportPreview, InterfaceExtra, InterfaceId, SecretSlot, Slice, SliceRule, ToolItem, ToolKind, ToolReference, World,
} from './types.js';
import { contentOf, fileSlug, globalScope, uniqueId } from './common.js';

/** The most a bundle may hold. Past these a file is refused, because nothing real is that large. */
export const BUNDLE_LIMITS = { textBytes: 2 * 1024 * 1024, items: 2000, tools: 500, slices: 200, depth: 8 } as const;

// --------------------------------------------------------------------------------------------------- export

/**
 * A found path as it leaves the export: relative to the scope's own folder when it sits there, else with the home folder and the user name taken off.
 * No segment is `.` or `..`, and no path starts with a slash or a drive letter. A path with nothing left becomes "unnamed".
 */
export function exportPath(path: string, scopePath?: string): string {
  const slashed = path.replace(/\\/g, '/'), base = scopePath === undefined ? '' : scopePath.replace(/\\/g, '/').replace(/\/+$/, '');
  let rel = base !== '' && slashed.startsWith(`${base}/`) ? slashed.slice(base.length + 1) : slashed;
  rel = rel.replace(/^[A-Za-z]:(?=\/)/, '').replace(/^\/+(?:Users|home)\/[^/]+\//i, '');
  const parts = rel.split('/').filter(p => p !== '' && p !== '.' && p !== '..');
  return parts.length === 0 ? 'unnamed' : parts.join('/');
}

/** Makes a bundle of the skills, agents, tool references and slice rules that belong to the chosen scopes. Scopes the world does not have are left out. */
export function buildBundle(world: World, scopeIds: readonly string[]): Bundle {
  const known = new Set(world.scopes.map(s => s.id));
  const chosen = [...new Set(scopeIds)].filter(id => known.has(id)), inScope = new Set(chosen);
  const scopePath = new Map(world.scopes.map(s => [s.id, s.path]));
  const byId = new Map(world.items.map(i => [i.id, i]));
  const owned = (i: HarnessItem): i is BundleItem => (i.kind === 'skill' || i.kind === 'agent') && i.library === null;
  // The owned skills an agent of the bundle uses travel with it, wherever they live. A library skill stays a reference.
  const used = new Set<string>();
  for (const i of world.items) if (owned(i) && i.kind === 'agent' && inScope.has(i.scopeId)) for (const id of i.definition.skillIds) {
    const skill = byId.get(id);
    if (skill !== undefined && skill.kind === 'skill' && skill.library === null) used.add(id);
  }
  const items = world.items.filter(owned).filter(i => inScope.has(i.scopeId) || used.has(i.id)).map((i): BundleItem => ({ ...i, foundAt: i.foundAt.map(f => ({ ...f, path: exportPath(f.path, scopePath.get(i.scopeId)) })) }));
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
/** Control characters except newline and tab, the C1 controls, and the marks that reorder text. None may sit in a short field. */
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f‪-‮⁦-⁩]/;
const ENV_NAME = /^[A-Z_][A-Z0-9_]{0,63}$/, LABEL_NAME = /^[A-Za-z0-9 ._-]{1,64}$/;

const fail = (what: string): never => { throw new Error(`This is not a Bowerloom bundle: ${what}.`); };
const record = (v: unknown, what: string): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : fail(what));
/** Any text, newlines and all: instructions and skill text. */
const text = (v: unknown, what: string): string => (typeof v === 'string' ? v : fail(what));
/** A short field: text with no control character, so a name or a label cannot hide or redraw anything. A newline and a tab are allowed. */
const short = (v: unknown, what: string): string => (CONTROL.test(text(v, what)) ? fail(`${what.replace(/ has (no|a) .*$/, '')} has a control character in a short field, and Bowerloom never accepts one`) : v as string);
const array = (v: unknown, what: string): unknown[] => (Array.isArray(v) ? v : fail(what));
const strings = (v: unknown, what: string): string[] => array(v, what).map(x => short(x, what));
const pick = <T extends string>(v: unknown, allowed: readonly T[], what: string): T => (allowed.includes(v as T) ? v as T : fail(what));
function nameOf(v: unknown, what: string): string {
  const s = text(v, what);
  return s.trim() === '' || s.length > NAME_LIMIT || /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/.test(s) ? fail(what) : s;
}

/** True when the value nests deeper than `limit` objects and lists. A loop counts as infinitely deep. Walks without recursion. */
function tooDeep(value: unknown, limit: number): boolean {
  const stack: Array<[unknown, number]> = [[value, 1]];
  for (let at = stack.pop(); at !== undefined; at = stack.pop()) {
    const [v, depth] = at;
    if (typeof v !== 'object' || v === null) continue;
    if (depth > limit) return true;
    for (const child of Array.isArray(v) ? v : Object.values(v)) stack.push([child, depth + 1]);
  }
  return false;
}

function parseFound(v: unknown, where: string): FoundAt {
  const r = record(v, `${where} has a place that is not in the right shape`);
  return { interface: pick(r.interface, INTERFACES, `${where} names an interface that Bowerloom does not know`), path: short(r.path, `${where} has a place with no path`), contentHash: short(r.contentHash, `${where} has a place with no content mark`), text: text(r.text, `${where} has a place with no text`) };
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
  const base = { id: nameOf(r.id, `${where} has no id`), name: nameOf(r.name, `${where} has no usable name`), scopeId: short(r.scopeId, `${where} has no scope`), foundAt: array(r.foundAt, `${where} has no list of places`).map(f => parseFound(f, where)), library: null };
  if (kind === 'skill') return { ...base, kind, description: short(r.description, `${where} has no description`) };
  const d = record(r.definition, `${where} has no definition`);
  const definition = {
    name: short(d.name, `${where} has no agent name`), role: short(d.role, `${where} has no role`), instructions: text(d.instructions, `${where} has no instructions`),
    skillIds: strings(d.skillIds, `${where} has a skill list that is not in the right shape`),
    toolAttachments: array(d.toolAttachments, `${where} has a tool list that is not in the right shape`).map(t => { const a = record(t, `${where} has a tool that is not in the right shape`); return { toolId: short(a.toolId, `${where} has a tool with no id`), access: pick(a.access, ['read-only', 'read-write'] as const, `${where} has a tool with an access class that Bowerloom does not know`) }; }),
  };
  const extras = array(r.extras, `${where} has no list of extras`).map((e): InterfaceExtra => { const x = record(e, `${where} has an extra that is not in the right shape`); return { interface: pick(x.interface, INTERFACES, `${where} has an extra for an interface that Bowerloom does not know`), badge: short(x.badge, `${where} has an extra with no badge`), key: short(x.key, `${where} has an extra with no key`), value: short(x.value, `${where} has an extra with no value`) }; });
  if (d.sliceId !== undefined) return { ...base, kind, definition: { ...definition, sliceId: short(d.sliceId, `${where} has a slice that is not in the right shape`) }, extras };
  return { ...base, kind, definition, extras };
}

/** A secret name must look like what it names: an environment variable, or a short label for a keychain entry. The name is never repeated in the refusal. */
function secretName(kind: SecretSlot['kind'], v: unknown, where: string): string {
  const s = text(v, `${where} has a secret with no name`);
  if (kind === 'env' ? !ENV_NAME.test(s) : !LABEL_NAME.test(s)) {
    fail(kind === 'env'
      ? `${where} has a secret name that is not an environment variable name (capital letters, digits and underscores, not starting with a digit, up to 64 characters)`
      : `${where} has a secret name that is not a keychain label (letters, digits, spaces, dots, dashes and underscores, up to 64 characters)`);
  }
  return s;
}

function parseToolRef(v: unknown, n: number): ToolReference {
  const where = `tool ${n + 1}`, r = record(v, `${where} is not in the right shape`), toolKind = pick(r.toolKind, TOOL_KINDS, `${where} is not an MCP server, a saved prompt or a hook`);
  const base = { toolId: nameOf(r.toolId, `${where} has no id`), name: nameOf(r.name, `${where} has no usable name`), toolKind };
  if (r.secret === null || r.secret === undefined) return { ...base, secret: null };
  const s = record(r.secret, `${where} has a secret that is not in the right shape`);
  if (Object.keys(s).some(k => k !== 'kind' && k !== 'name')) fail(`${where} carries more than the name of its secret, and Bowerloom never accepts a secret value`);
  if (toolKind !== 'mcp') fail(`${where} is not an MCP server but names a secret`);
  const kind = pick(s.kind, ['env', 'keychain'] as const, `${where} keeps its secret in a place that Bowerloom does not know`);
  return { ...base, secret: { kind, name: secretName(kind, s.name, where) } };
}

/**
 * Checks a bundle that came from outside and rebuilds it from the fields Bowerloom knows. Throws an Error in plain words when the shape is wrong
 * or the bundle is past a limit (`BUNDLE_LIMITS`: 2,000 items, 500 tools, 200 slice rules, 8 levels of nesting).
 */
export function parseBundle(value: unknown): Bundle {
  const r = record(value, 'it is not a list of parts');
  if (tooDeep(value, BUNDLE_LIMITS.depth)) fail(`it is nested too deeply (more than ${BUNDLE_LIMITS.depth} levels)`);
  const rawItems = array(r.items, 'the list of items is missing'), rawTools = array(r.toolRefs, 'the list of tools is missing'), rawSlices = array(r.sliceRules, 'the list of slice rules is missing');
  if (rawItems.length > BUNDLE_LIMITS.items) fail(`it has too many items (more than ${BUNDLE_LIMITS.items})`);
  if (rawTools.length > BUNDLE_LIMITS.tools) fail(`it has too many tools (more than ${BUNDLE_LIMITS.tools})`);
  if (rawSlices.length > BUNDLE_LIMITS.slices) fail(`it has too many slice rules (more than ${BUNDLE_LIMITS.slices})`);
  const items = rawItems.map(parseItem);
  const toolRefs = rawTools.map(parseToolRef);
  const ids = [...items.map(i => i.id), ...toolRefs.map(t => t.toolId)];
  if (new Set(ids).size !== ids.length) fail('two parts have the same id');
  const hooks = new Set(toolRefs.filter(t => t.toolKind === 'hook').map(t => t.toolId));
  for (const i of items) if (i.kind === 'agent' && i.definition.toolAttachments.some(t => hooks.has(t.toolId))) fail(`${i.name} is wired to a hook, and Bowerloom never wires a hook`);
  const sliceRules = rawSlices.map((s, n) => {
    const x = record(s, `slice rule ${n + 1} is not in the right shape`);
    return { sliceId: nameOf(x.sliceId, `slice rule ${n + 1} has no id`), name: nameOf(x.name, `slice rule ${n + 1} has no usable name`), rule: parseRule(x.rule, `slice rule ${n + 1}`) };
  });
  return { scopeIds: strings(r.scopeIds, 'the list of scopes is missing'), items, toolRefs, sliceRules };
}

// --------------------------------------------------------------------------------------------------- import

interface Landing {
  readonly tools: ToolItem[]; readonly placed: Map<string, BundleItem>; readonly order: readonly BundleItem[]; readonly slices: Slice[]; readonly sliceItems: ContextSliceItem[]; readonly preview: ImportPreview;
}

const ruleKey = (rule: SliceRule): string => JSON.stringify([rule.folders, rule.pageTypesAndTags.types, rule.pageTypesAndTags.tags, rule.linksFromSeeds === null ? null : rule.linksFromSeeds.hops]);
const slotKey = (s: SecretSlot): string => `${s.kind}\u0000${s.name}`;
/** A file name compared in lower case, so "Foo" and "foo" meet on a disk that ignores case. */
const slugOf = (name: string): string => fileSlug(name).toLowerCase();
const importedName = (base: string, n: number): string => (n === 0 ? base : n === 1 ? `${base} (imported)` : `${base} (imported ${n})`);

/** `base`, then "base (imported)", "base (imported 2)" and so on, for as long as `taken` holds the name: the names an earlier import of the same thing may have used. */
function family(base: string, taken: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (let n = 0; taken.has(importedName(base, n)); n += 1) out.push(importedName(base, n));
  return out;
}

/** The first "base (imported)" name that is free: the name is not taken and its file name is not either. */
function freeName(base: string, names: ReadonlySet<string>, slugs: ReadonlySet<string>): string {
  let name = base;
  for (let n = 1; names.has(name) || slugs.has(slugOf(name)); n += 1) name = importedName(base, n);
  return name;
}

const withName = (item: BundleItem, name: string): BundleItem => (item.kind === 'agent' ? { ...item, name, definition: name === item.definition.name ? item.definition : { ...item.definition, name } } : { ...item, name });

/** What a file would hold, as text, to say how big it is. The prototype writes no file, so this is the text it would write. */
function fileText(item: BundleItem): string {
  if (item.kind === 'skill') return `Skill: ${item.name}\n${item.description}\n\n${item.foundAt[0]?.text ?? ''}`;
  const d = item.definition;
  return [`Agent: ${item.name}`, `Role: ${d.role}`, `Instructions: ${d.instructions}`, `Skills: ${d.skillIds.join(', ')}`, `Tools: ${d.toolAttachments.map(t => `${t.toolId} (${t.access})`).join(', ')}`, ...item.extras.map(e => `${e.badge}: ${e.key} = ${e.value}`)].join('\n');
}

/** Works out everything an import does. The preview and the commit both read this one result, so what the person is shown is what happens. */
function land(input: unknown, world: World): Landing {
  const bundle = parseBundle(input);
  const home = globalScope(world) ?? world.scopes[0];
  if (home === undefined) throw new Error('This workspace has no place to put the imported items.');
  const scopes = new Map(world.scopes.map(s => [s.id, s]));
  const scopeFor = (id: string) => scopes.get(id) ?? home;
  const harness = (scopePath: string, rel: string): string => `${scopePath.replace(/\/+$/, '')}/.bowerloom/${rel}`;

  const itemIds = new Set(world.items.map(i => i.id)), sliceIds = new Set(world.slices.map(s => s.id));
  // Per scope and kind: the item with each name, the names, and the file names in lower case, so a new item never lands on an old one.
  const groups = new Map<string, { byName: Map<string, HarnessItem>; names: Set<string>; slugs: Set<string> }>();
  const group = (scopeId: string, kind: string) => {
    const key = `${scopeId}\u0000${kind}`;
    let g = groups.get(key);
    if (g === undefined) { g = { byName: new Map(), names: new Set(), slugs: new Set() }; groups.set(key, g); }
    return g;
  };
  for (const i of world.items) { const g = group(i.scopeId, i.kind); if (!g.byName.has(i.name)) g.byName.set(i.name, i); g.names.add(i.name); g.slugs.add(slugOf(i.name)); }

  // Three id maps, one per kind of thing, so a skill id and a tool id can never be taken for each other.
  const itemMap = new Map<string, string>(), toolMap = new Map<string, string>(), sliceMap = new Map<string, string>();
  const secrets: SecretSlot[] = [], clashes: ImportClash[] = [];
  const toolFiles: ImportFile[] = [], sliceFiles: ImportFile[] = [], skillFiles = new Map<string, ImportFile>(), agentFiles = new Map<string, ImportFile>();
  const toolNames = new Map<string, string>(world.items.filter(i => i.kind === 'tool').map(i => [i.id, i.name]));

  // Tools: a tool that is already there (same kind, same name) is kept; a new one arrives as a reference with its secret still to be added.
  const tools: ToolItem[] = [], toolGroup = group(home.id, 'tool');
  const worldTools = world.items.filter((i): i is ToolItem => i.kind === 'tool');
  const sameSecret = (t: ToolItem, slot: SecretSlot | null): boolean => (t.toolKind !== 'mcp' ? slot === null : slot === null ? t.secret === null : t.secret !== null && t.secret.kind === slot.kind && t.secret.name === slot.name);
  for (const ref of bundle.toolRefs) {
    const names = new Set([...worldTools, ...tools].map(t => t.name));
    const have = [...worldTools, ...tools].find(t => t.toolKind === ref.toolKind && (t.name === ref.name || (family(ref.name, names).includes(t.name) && sameSecret(t, ref.secret))));
    if (ref.secret !== null) {
      const slot = ref.secret, ready = have !== undefined && have.toolKind === 'mcp' && have.secret !== null && have.secret.state === 'present' && have.secret.kind === slot.kind && have.secret.name === slot.name;
      if (!ready && !secrets.some(s => slotKey(s) === slotKey(slot))) secrets.push({ kind: slot.kind, name: slot.name });
    }
    if (have !== undefined) { toolMap.set(ref.toolId, have.id); continue; }
    const id = itemIds.has(ref.toolId) ? uniqueId(itemIds, `${ref.toolId}-imported`) : ref.toolId;
    itemIds.add(id); toolMap.set(ref.toolId, id);
    let name = ref.name;
    if (ref.toolKind !== 'hook') {
      name = freeName(ref.name, toolGroup.names, toolGroup.slugs);
      if (name !== ref.name) clashes.push({ itemId: ref.toolId, name: ref.name, reason: 'different-text' });
      toolGroup.names.add(name); toolGroup.slugs.add(slugOf(name));
    }
    toolNames.set(id, name);
    const shared = { id, kind: 'tool' as const, name, scopeId: home.id, foundAt: [], library: null };
    if (ref.toolKind === 'mcp') {
      const secret = ref.secret === null ? null : { kind: ref.secret.kind, name: ref.secret.name, state: 'missing' as const };
      tools.push({ ...shared, toolKind: 'mcp', secret });
      toolFiles.push({ path: harness(home.path, `tools/${fileSlug(name)}.json`), action: 'add', characters: JSON.stringify({ name, secret: ref.secret }).length });
    } else if (ref.toolKind === 'prompt') { tools.push({ ...shared, toolKind: 'prompt' }); toolFiles.push({ path: harness(home.path, `tools/${fileSlug(name)}.md`), action: 'add', characters: `Saved prompt: ${name}`.length }); }
    else tools.push({ ...shared, toolKind: 'hook', runsCode: true });
  }

  // Slices: a rule that is already there under the same name is kept; a new one arrives with no seed pages, because page ids belong to one wiki.
  // Each new slice also arrives as a slice item of the home harness, so the Agents screen and the graph can show it.
  const slices: Slice[] = [], sliceItems: ContextSliceItem[] = [];
  const sliceSlugs = new Set(world.slices.map(s => slugOf(s.name)));
  for (const rule of bundle.sliceRules) {
    const all = [...world.slices, ...slices], names = new Set(all.map(s => s.name));
    const kin = family(rule.name, names);
    const have = all.find(s => kin.includes(s.name) && ruleKey(s.rule) === ruleKey(rule.rule));
    if (have !== undefined) { sliceMap.set(rule.sliceId, have.id); continue; }
    const id = uniqueId(sliceIds, rule.sliceId); sliceIds.add(id); sliceMap.set(rule.sliceId, id);
    const name = freeName(rule.name, names, sliceSlugs);
    if (name !== rule.name) clashes.push({ itemId: rule.sliceId, name: rule.name, reason: 'different-text' });
    sliceSlugs.add(slugOf(name));
    slices.push({ id, name, seeds: [], rule: rule.rule, pinned: false });
    const itemId = uniqueId(itemIds, `${id}-item`); itemIds.add(itemId);
    sliceItems.push({ id: itemId, kind: 'context-slice', name, scopeId: home.id, foundAt: [], library: null, sliceId: id });
    sliceFiles.push({ path: harness(home.path, `slices/${fileSlug(name)}.json`), action: 'add', characters: JSON.stringify({ name, rule: rule.rule }).length });
  }

  // Skills first, then agents, so an agent can follow the new id of a skill it uses.
  const placed = new Map<string, BundleItem>();
  const remap = (a: AgentItem): AgentItem => {
    const d = a.definition, sid = d.sliceId;
    return { ...a, definition: { ...d, skillIds: d.skillIds.map(s => itemMap.get(s) ?? s), toolAttachments: d.toolAttachments.map(t => ({ toolId: toolMap.get(t.toolId) ?? t.toolId, access: t.access })), ...(sid === undefined ? {} : { sliceId: sliceMap.get(sid) ?? sid }) } };
  };
  for (const kind of ['skill', 'agent'] as const) {
    for (const item of bundle.items) {
      if (item.kind !== kind) continue;
      const scope = scopeFor(item.scopeId), g = group(scope.id, kind), mapped: BundleItem = item.kind === 'agent' ? remap(item) : item;
      // The same thing may be there already, under its own name or under a name an earlier import gave it.
      const twin = family(mapped.name, g.names).map(n => g.byName.get(n)).find((existing): existing is HarnessItem => existing !== undefined && contentOf(existing) === contentOf(withName(mapped, existing.name)));
      if (twin !== undefined) { clashes.push({ itemId: item.id, name: item.name, reason: 'same-name' }); itemMap.set(item.id, twin.id); continue; }
      let name = mapped.name;
      if (g.byName.has(name) || g.slugs.has(slugOf(name))) {
        clashes.push({ itemId: item.id, name: item.name, reason: 'different-text' });
        name = freeName(mapped.name, g.names, g.slugs);
      }
      const id = itemIds.has(mapped.id) ? uniqueId(itemIds, `${mapped.id}-imported`) : mapped.id;
      itemIds.add(id); itemMap.set(item.id, id);
      const foundAt = mapped.foundAt.map(f => ({ ...f, path: `${scope.path.replace(/\/+$/, '')}/${exportPath(f.path)}` }));
      const final: BundleItem = { ...withName(mapped, name), id, scopeId: scope.id, foundAt };
      placed.set(item.id, final);
      g.names.add(name); g.slugs.add(slugOf(name)); g.byName.set(name, final);
      const file: ImportFile = { path: harness(scope.path, kind === 'skill' ? `skills/${fileSlug(name)}/SKILL.md` : `agents/${fileSlug(name)}.md`), action: 'add', characters: fileText(final).length };
      (kind === 'skill' ? skillFiles : agentFiles).set(item.id, file);
    }
  }
  const order = bundle.items.flatMap(i => { const p = placed.get(i.id); return p === undefined ? [] : [p]; });
  const files = [...toolFiles, ...bundle.items.flatMap(i => skillFiles.get(i.id) ?? []), ...bundle.items.flatMap(i => agentFiles.get(i.id) ?? []), ...sliceFiles];

  // What the import would grant, and what it points at that nothing holds.
  const kindOf = new Map<string, string>(world.items.map(i => [i.id, i.kind === 'tool' && i.toolKind === 'hook' ? 'hook' : i.kind]));
  for (const t of tools) kindOf.set(t.id, t.toolKind === 'hook' ? 'hook' : 'tool');
  for (const i of order) kindOf.set(i.id, i.kind);
  const knownSlices = new Set([...world.slices, ...slices].map(s => s.id));
  const grants: ImportGrant[] = [], missing: string[] = [];
  for (const item of order) if (item.kind === 'agent') {
    const d = item.definition;
    for (const t of d.toolAttachments) {
      const name = toolNames.get(t.toolId);
      if (name !== undefined) grants.push({ agent: item.name, tool: name, access: t.access });
      if (kindOf.get(t.toolId) !== 'tool') missing.push(`${item.name} uses the tool ${t.toolId}, which is neither in this file nor in your setup.`);
    }
    for (const s of d.skillIds) if (kindOf.get(s) !== 'skill') missing.push(`${item.name} uses the skill ${s}, which is neither in this file nor in your setup.`);
    if (d.sliceId !== undefined && !knownSlices.has(d.sliceId)) missing.push(`${item.name} reads the slice ${d.sliceId}, which is neither in this file nor in your setup.`);
  }
  return { tools, placed, order, slices, sliceItems, preview: { files, secretsToAdd: secrets, clashes, grants, missingRefs: [...new Set(missing)] } };
}

/** What importing `bundle` into `world` would do, and nothing more: every file it would write, every secret to add, every clash, every grant, every missing reference. Changes nothing. */
export function previewImport(bundle: Bundle, world: World): ImportPreview {
  return land(bundle, world).preview;
}

/**
 * The world with the bundle added. Tools arrive as references (a secret is marked missing, a hook has no code). An item whose name is taken
 * with the same text is not added twice, not even when an earlier import kept it under a name ending in "(imported)"; with different text it is
 * kept under a name ending in "(imported)". A new slice rule arrives with its slice item. Nothing in the bundle runs.
 */
export function commitImport(bundle: Bundle, world: World): World {
  const { tools, order, slices, sliceItems } = land(bundle, world);
  if (tools.length === 0 && order.length === 0 && slices.length === 0) return world;
  return { ...world, items: [...world.items, ...tools, ...order, ...sliceItems], slices: [...world.slices, ...slices] };
}
