/**
 * Layers and inheritance (section 6; section 12, checks 4 and 5; lead rulings R1, R2, and R7: restriction only).
 *
 * A chain runs from the top layer (the user store) down to the layer being resolved. Each layer inherits the resolved
 * set of the layer above it, then applies its own overrides and adds its own items.
 * - Additive parts combine. The same id in a lower layer replaces the higher item only through an explicit `replace`.
 * - `hide` removes an inherited item from the hiding layer and so from the layers that inherit from it. The layer that
 *   defines the item, and every other branch, still has it. `hidden` lists each one, because an engine that reads parent
 *   folders itself (Claude Code reads user and project skills) can still see it: the projection lane reports that.
 * - Guardrails combine by restriction. A rule that is not `allow`, and a sandbox requirement, from a higher layer apply
 *   in every layer below: no lower layer can hide or replace them, and no approval opens that lock.
 * - A lower layer can only restrict what a higher layer set. Unless a `LayerApproval` bound to the entry hash exists,
 *   it cannot add an `allow` rule, replace an `allow` rule with another `allow` rule, or hide or replace a hook, an MCP
 *   server, or a subagent (so it cannot widen a subagent's tools). Skills stay free to hide and replace.
 * - Trust boundary: a lower layer can add hooks, MCP servers, and subagents. A hook, and a server or subagent that holds
 *   a `${NAME}` or keychain reference, gets `needsApproval` with its layer, so the projection plan shows it to a person.
 * - A child layer's engines can only narrow its parent's. The resolved engines are the last layer's.
 * - After resolution, every reference must resolve for every engine: subagent skills, subagent `mcp:<server>` tools,
 *   and `allow` rules that name one skill or one server. A `deny` or `ask` rule for an absent item is a ban and passes.
 * - The order of `rules` carries no precedence: `deny` beats `ask` beats `allow`. A last-match-wins lane sorts them.
 */
import path from 'node:path';
import { layerApprovalMatches, parseLayerApproval } from './fidelity.js';
import type { LayerApproval } from './fidelity.js';
import { isRecord } from './json.js';
import { appliesTo } from './select.js';
import type {
  Definition, EngineTarget, GuardrailRule, HarnessFile, HookEntry, JsonValue, McpServer, PartEntries, Problem,
  SandboxRequirement, SkillEntry, SubagentEntry,
} from './types.js';
import { GUARDRAIL_ACTIONS, GUARDRAIL_EFFECTS, OVERRIDABLE_PARTS, isEngineId } from './words.js';
import type { EngineId, OverridablePart } from './words.js';

/** An item in a resolved set: the layer that holds it, and the layer of the item it replaced, if any. */
export interface Placed<T> {
  readonly item: T;
  readonly layer: number;
  /** True when the item comes from a layer above the last one in the chain. */
  readonly inherited: boolean;
  readonly replaces?: { readonly layer: number };
  /** Set on an item a lower layer added that runs a command or holds a secret reference (lead ruling R2). */
  readonly needsApproval?: { readonly layer: number; readonly reason: 'hook-command' | 'secret-reference' };
}

export interface HiddenItem {
  readonly part: OverridablePart;
  readonly id: string;
  /** The layer whose `hide` removed the item. */
  readonly layer: number;
  /** The layer that held the item. */
  readonly from: number;
}

/** A widening that a recorded approval allowed. */
export interface ApprovedChange {
  readonly layer: number;
  readonly part: OverridablePart;
  readonly id: string;
  readonly change: LayerApproval['change'];
  readonly approval: LayerApproval;
}

export interface ResolvedHarness {
  /** The id and description of the last layer. */
  readonly id: string;
  readonly description: string;
  /** The engines of the last layer: a subset of every layer above it. */
  readonly engines: readonly EngineTarget[];
  readonly skills: readonly Placed<SkillEntry>[];
  readonly subagents: readonly Placed<SubagentEntry>[];
  /** Guardrail rules. Their order carries no precedence. */
  readonly rules: readonly Placed<GuardrailRule>[];
  readonly sandbox: readonly Placed<SandboxRequirement>[];
  readonly hooks: readonly Placed<HookEntry>[];
  readonly mcp: readonly Placed<McpServer>[];
  readonly hidden: readonly HiddenItem[];
  readonly approved: readonly ApprovedChange[];
}

export type ResolveResult =
  | { readonly ok: true; readonly resolved: ResolvedHarness }
  | { readonly ok: false; readonly problems: readonly Problem[] };

/** The layer input: a loaded definition, or anything with the same folder, harness fields, and entries. */
export type LayerInput = Pick<Definition, 'folder' | 'entries'> & { readonly harness: Pick<HarnessFile, 'id' | 'description' | 'engines' | 'overrides'> };

export interface ResolveOptions {
  /** Recorded layer approvals, read from the app data folder. Each is checked with `parseLayerApproval`. */
  readonly approvals?: readonly unknown[];
  /** The present time, for the approvals. Default: the clock. */
  readonly now?: Date;
  /** True (the default) when the first layer is the user store, which may sit anywhere. Every later layer must sit inside the one above it. */
  readonly userStore?: boolean;
}

type Entry = { readonly id: string };
type Mutable<T> = { item: T; layer: number; replaces?: { layer: number } };
type ListKey = 'skills' | 'subagents' | 'rules' | 'hooks' | 'mcp';
const PARTS: readonly (readonly [OverridablePart, ListKey])[] = [
  ['skills', 'skills'], ['subagents', 'subagents'], ['guardrails', 'rules'], ['hooks', 'hooks'], ['mcp', 'mcp'],
];
/** Parts whose items a lower layer cannot hide or replace without an approval. */
const GUARDED: ReadonlySet<OverridablePart> = new Set(['subagents', 'hooks', 'mcp']);

/** Resolves a chain of layers, top first. The last layer is the one resolved. */
export function resolveLayers(chain: readonly LayerInput[], options: ResolveOptions = {}): ResolveResult {
  if (chain.length === 0) return { ok: false, problems: [{ code: 'NO_LAYERS', path: '.', message: 'A chain needs at least one layer.' }] };
  const problems: Problem[] = [];
  const approvals: LayerApproval[] = [];
  (options.approvals ?? []).forEach((value, i) => {
    const parsed = parseLayerApproval(value, options.now === undefined ? {} : { now: options.now });
    if (parsed.ok) approvals.push(parsed.approval);
    else problems.push(...parsed.problems.map(p => ({ ...p, path: `approvals[${i}]` })));
  });
  chain.forEach((layer, i) => validateLayer(layer, i, problems));
  if (problems.length) return { ok: false, problems };
  checkOrder(chain, options.userStore ?? true, problems);
  checkEngines(chain, problems);
  if (problems.length) return { ok: false, problems };

  const hidden: HiddenItem[] = [];
  const approved: ApprovedChange[] = [];
  const sets = new Map<OverridablePart, Mutable<Entry>[]>(PARTS.map(([part]) => [part, []]));
  const sandbox: Mutable<SandboxRequirement>[] = [];

  chain.forEach((layer, index) => {
    const fail = (code: string, message: string) => problems.push({ code, path: 'harness.json', message: `Layer ${index}: ${message}`, layer: index });
    /** True when the change is allowed: in the top layer, or with a matching approval. */
    const widen = (part: OverridablePart, change: LayerApproval['change'], entry: Entry, message: string): boolean => {
      if (index === 0) return true;
      const approval = approvals.find(a => layerApprovalMatches(a, part, change, entry));
      if (approval) { approved.push({ layer: index, part, id: entry.id, change, approval }); return true; }
      fail('LAYER_WIDENS', `${message} A lower layer can only restrict what a higher layer set, unless a person approved this exact entry.`);
      return false;
    };
    for (const [part, key] of PARTS) {
      const current = sets.get(part)!;
      const own = layer.entries[key] as readonly Entry[];
      const ownById = new Map(own.map(item => [item.id, item]));
      const handled = new Set<string>();
      for (const o of layer.harness.overrides.filter(o => o.part === part)) {
        handled.add(o.id);
        const at = current.findIndex(p => p.item.id === o.id);
        if (at < 0) {
          if (part === 'guardrails' && sandbox.some(p => p.item.id === o.id)) fail('GUARDRAIL_LOCKED', `the ${o.action} override names the sandbox requirement ${o.id}. No lower layer can hide or replace it.`);
          else fail('OVERRIDE_TARGET_MISSING', `the ${o.action} override names ${part}/${o.id}, which no higher layer holds.`);
          continue;
        }
        const target = current[at]!;
        if (part === 'guardrails' && (target.item as GuardrailRule).effect !== 'allow') {
          fail('GUARDRAIL_LOCKED', `the ${o.action} override names the ${(target.item as GuardrailRule).effect} rule ${o.id} of layer ${target.layer}. A lower layer cannot hide or replace a rule that is not allow.`);
          continue;
        }
        const mine = ownById.get(o.id);
        if (o.action === 'hide') {
          if (mine) { fail('HIDE_WITH_ITEM', `the layer hides ${part}/${o.id} and also holds an item with that id. Use replace.`); continue; }
          if (GUARDED.has(part) && !widen(part, 'hide', target.item, `the layer hides ${part}/${o.id} of layer ${target.layer}.`)) continue;
          current.splice(at, 1);
          hidden.push({ part, id: o.id, layer: index, from: target.layer });
        } else {
          if (!mine) { fail('REPLACE_WITHOUT_ITEM', `the replace override names ${part}/${o.id}, and the layer holds no item with that id.`); continue; }
          const widens = GUARDED.has(part) || (part === 'guardrails' && (mine as GuardrailRule).effect === 'allow');
          if (widens && !widen(part, 'replace', mine, `the layer replaces ${part}/${o.id} of layer ${target.layer}.`)) continue;
          current[at] = { item: mine, layer: index, replaces: { layer: target.layer } };
        }
      }
      for (const item of own) {
        if (handled.has(item.id)) continue;
        if (current.some(p => p.item.id === item.id) || (part === 'guardrails' && sandbox.some(p => p.item.id === item.id))) {
          fail('DUPLICATE_WITHOUT_REPLACE', `${part}/${item.id} is also in a higher layer. Add a replace override to use this one.`);
          continue;
        }
        if (part === 'guardrails' && (item as GuardrailRule).effect === 'allow' && !widen(part, 'add-allow', item, `the layer adds the allow rule ${item.id}.`)) continue;
        current.push({ item, layer: index });
      }
    }
    for (const item of layer.entries.sandbox) {
      if (sandbox.some(p => p.item.id === item.id) || sets.get('guardrails')!.some(p => p.item.id === item.id && p.layer < index)) {
        fail('DUPLICATE_WITHOUT_REPLACE', `guardrails/${item.id} is also in a higher layer.`);
        continue;
      }
      sandbox.push({ item, layer: index });
    }
  });
  if (problems.length) return { ok: false, problems };

  const last = chain.length - 1;
  const place = <T>(part: OverridablePart | null, list: Mutable<Entry>[] | Mutable<T>[]): Placed<T>[] => (list as Mutable<T>[]).map(p => {
    const flag = p.layer > 0 && part !== null ? trustFlag(part, p.item as Entry) : null;
    return {
      item: p.item, layer: p.layer, inherited: p.layer < last,
      ...(p.replaces ? { replaces: { layer: p.replaces.layer } } : {}),
      ...(flag ? { needsApproval: { layer: p.layer, reason: flag } } : {}),
    };
  });
  const lastHarness = chain[last]!.harness;
  const resolved: ResolvedHarness = {
    id: lastHarness.id, description: lastHarness.description, engines: lastHarness.engines,
    skills: place<SkillEntry>('skills', sets.get('skills')!),
    subagents: place<SubagentEntry>('subagents', sets.get('subagents')!),
    rules: place<GuardrailRule>('guardrails', sets.get('guardrails')!),
    sandbox: place<SandboxRequirement>(null, sandbox),
    hooks: place<HookEntry>('hooks', sets.get('hooks')!),
    mcp: place<McpServer>('mcp', sets.get('mcp')!),
    hidden, approved,
  };
  checkReferences(resolved, problems);
  return problems.length ? { ok: false, problems } : { ok: true, resolved };
}

/** The plain entries of a resolved set. */
export function entriesOf(resolved: ResolvedHarness): PartEntries {
  const items = <T>(list: readonly Placed<T>[]) => list.map(p => p.item);
  return {
    skills: items(resolved.skills), subagents: items(resolved.subagents), rules: items(resolved.rules),
    sandbox: items(resolved.sandbox), hooks: items(resolved.hooks), mcp: items(resolved.mcp),
  };
}

/** Why an item from a lower layer needs a person's approval in the plan, or null. */
function trustFlag(part: OverridablePart, item: Entry): 'hook-command' | 'secret-reference' | null {
  if (part === 'hooks') return 'hook-command';
  if (part !== 'mcp' && part !== 'subagents') return null;
  const holds = (v: unknown): boolean => {
    if (typeof v === 'string') return /\$\{[A-Za-z_][A-Za-z0-9_]*\}/.test(v);
    if (Array.isArray(v)) return v.some(holds);
    if (v !== null && typeof v === 'object') return Object.hasOwn(v, 'keychain') || Object.values(v).some(holds);
    return false;
  };
  return holds(item) ? 'secret-reference' : null;
}

/** The shape of a layer input that did not come from the loader: overrides, engines, rule words, and unique ids. */
function validateLayer(layer: LayerInput, index: number, problems: Problem[]): void {
  const bad = (message: string) => problems.push({ code: 'LAYER_INVALID', path: 'harness.json', message: `Layer ${index}: ${message}`, layer: index });
  if (!layer || typeof layer.folder !== 'string' || !path.isAbsolute(layer.folder)) { bad('the layer needs the absolute path of its .bowerloom folder.'); return; }
  const h = layer.harness;
  if (!h || !Array.isArray(h.overrides) || !Array.isArray(h.engines) || h.engines.length === 0) { bad('the harness needs overrides and at least one engine.'); return; }
  for (const e of h.engines) if (!isRecord(e as unknown as JsonValue) || !isEngineId(e.id)) bad('an engine is not an engine id.');
  for (const o of h.overrides) {
    if (!(OVERRIDABLE_PARTS as readonly unknown[]).includes(o?.part) || typeof o?.id !== 'string' || (o.action !== 'hide' && o.action !== 'replace')) bad('an override needs a known part, an id, and the action hide or replace.');
  }
  const e = layer.entries;
  for (const key of ['skills', 'subagents', 'rules', 'sandbox', 'hooks', 'mcp'] as const) {
    if (!Array.isArray(e?.[key]) || e[key].some(item => !isRecord(item as unknown as JsonValue) || typeof item.id !== 'string')) { bad(`entries.${key} must be a list of items with ids.`); return; }
  }
  for (const r of e.rules) {
    if (!(GUARDRAIL_EFFECTS as readonly string[]).includes(r.effect) || !(GUARDRAIL_ACTIONS as readonly string[]).includes(r.action)) bad(`the rule ${r.id} has an effect or an action that is not known.`);
  }
  for (const s of e.sandbox) if (typeof s.files !== 'boolean' || typeof s.network !== 'boolean') bad(`the sandbox requirement ${s.id} needs files and network.`);
  const groups: [string, readonly Entry[]][] = [['skills', e.skills], ['subagents', e.subagents], ['guardrails', [...e.rules, ...e.sandbox]], ['hooks', e.hooks], ['mcp', e.mcp]];
  for (const [part, list] of groups) {
    const seen = new Set<string>();
    for (const item of list) {
      if (seen.has(item.id)) problems.push({ code: 'DUPLICATE_ID', path: 'harness.json', message: `Layer ${index}: two items of ${part} have one id.`, layer: index });
      seen.add(item.id);
    }
  }
}

/** Each layer folder appears once, and each project layer sits inside the layer above it (security review S8). */
function checkOrder(chain: readonly LayerInput[], userStore: boolean, problems: Problem[]): void {
  const roots = chain.map(l => path.dirname(path.resolve(l.folder)));
  chain.forEach((_, i) => {
    if (i === 0) return;
    const fail = (message: string) => problems.push({ code: 'LAYER_ORDER', path: '.', message: `Layer ${i}: ${message}`, layer: i });
    if (roots.indexOf(roots[i]!) !== i) { fail('the same layer appears twice in the chain.'); return; }
    if (i === 1 && userStore) return;
    const rel = path.relative(roots[i - 1]!, roots[i]!);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) fail('the layer does not sit inside the layer above it. A chain runs from the top folder down.');
  });
}

/** A child layer's engines can only narrow its parent's (lead ruling R7). */
function checkEngines(chain: readonly LayerInput[], problems: Problem[]): void {
  chain.forEach((layer, i) => {
    if (i === 0) return;
    const parent = new Set(chain[i - 1]!.harness.engines.map(e => e.id));
    for (const e of layer.harness.engines) {
      if (!parent.has(e.id)) problems.push({ code: 'ENGINE_NOT_INHERITED', path: 'harness.json', message: `Layer ${i}: the engine ${e.id} is not listed by the layer above, and a child layer can only narrow the engines.`, layer: i });
    }
  });
}

const GLOB = /[*?[\]{}]/;

/** Every reference resolves for every engine it applies to. One problem per broken reference, naming the engines. */
function checkReferences(resolved: ResolvedHarness, problems: Problem[]): void {
  const broken = new Map<string, EngineId[]>();
  const add = (message: string, engine: EngineId) => { const list = broken.get(message) ?? []; list.push(engine); broken.set(message, list); };
  for (const { id: engine } of resolved.engines) {
    const skills = new Set(resolved.skills.map(p => p.item).filter(s => appliesTo(s, engine)).map(s => s.id));
    const servers = new Set(resolved.mcp.map(p => p.item).filter(s => appliesTo(s, engine)).map(s => s.id));
    for (const { item: sub } of resolved.subagents) {
      if (!appliesTo(sub, engine)) continue;
      for (const skill of sub.skills ?? []) if (!skills.has(skill)) add(`the subagent ${sub.id} lists the skill ${skill}, which is not there`, engine);
      for (const tool of sub.tools ?? []) if (tool.startsWith('mcp:') && !servers.has(tool.slice(4))) add(`the subagent ${sub.id} uses the MCP server ${tool.slice(4)}, which is not there`, engine);
    }
    for (const { item: rule } of resolved.rules) {
      if (rule.effect !== 'allow' || !appliesTo(rule, engine)) continue;
      if (rule.action === 'skill' && !GLOB.test(rule.pattern) && !skills.has(rule.pattern)) add(`the allow rule ${rule.id} names a skill that is not there`, engine);
      const server = rule.pattern.split('/')[0]!;
      if (rule.action === 'mcp' && !GLOB.test(server) && !servers.has(server)) add(`the allow rule ${rule.id} names an MCP server that is not there`, engine);
    }
  }
  for (const [message, engines] of broken) problems.push({ code: 'DANGLING_REFERENCE', path: '.', message: `After layers resolve, ${message} for ${engines.join(', ')}.` });
}
