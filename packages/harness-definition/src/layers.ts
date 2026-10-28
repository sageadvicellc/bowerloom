/**
 * Layers and inheritance (section 6; section 12, checks 4 and 5).
 *
 * A chain runs from the top layer (the user store) down to the layer being resolved. Each layer inherits the resolved
 * set of the layer above it, then applies its own overrides and adds its own items:
 * - Additive parts combine. The same id in a lower layer replaces the higher item only through an explicit `replace`.
 * - `hide` removes an inherited item from the hiding layer and so from the layers that inherit from it. The layer that
 *   defines the item, and every other branch, still has it.
 * - Guardrails combine by restriction. A `deny` or an `ask` rule from a higher layer applies in every layer below it:
 *   no lower layer can hide or replace it. A lower layer can add rules, and can hide or replace an `allow` rule.
 * - Sandbox requirements only add up.
 */
import type {
  Definition, GuardrailRule, HookEntry, McpServer, PartEntries, Problem, SandboxRequirement, SkillEntry, SubagentEntry,
} from './types.js';
import type { OverridablePart } from './words.js';

/** An item in a resolved set: the layer that holds it, and the layer of the item it replaced, if any. */
export interface Placed<T> {
  readonly item: T;
  readonly layer: number;
  /** True when the item comes from a layer above the last one in the chain. */
  readonly inherited: boolean;
  readonly replaces?: { readonly layer: number };
}

export interface HiddenItem {
  readonly part: OverridablePart;
  readonly id: string;
  /** The layer whose `hide` removed the item. */
  readonly layer: number;
  /** The layer that held the item. */
  readonly from: number;
}

export interface ResolvedHarness {
  readonly skills: readonly Placed<SkillEntry>[];
  readonly subagents: readonly Placed<SubagentEntry>[];
  readonly rules: readonly Placed<GuardrailRule>[];
  readonly sandbox: readonly Placed<SandboxRequirement>[];
  readonly hooks: readonly Placed<HookEntry>[];
  readonly mcp: readonly Placed<McpServer>[];
  readonly hidden: readonly HiddenItem[];
}

export type ResolveResult =
  | { readonly ok: true; readonly resolved: ResolvedHarness }
  | { readonly ok: false; readonly problems: readonly Problem[] };

/** The layer input: a loaded definition, or anything with the same overrides and entries. */
export type LayerInput = Pick<Definition, 'entries'> & { readonly harness: Pick<Definition['harness'], 'overrides'> };

type Entry = { readonly id: string };
type Mutable<T> = { item: T; layer: number; replaces?: { layer: number } };
const PARTS: readonly (readonly [OverridablePart, 'skills' | 'subagents' | 'rules' | 'hooks' | 'mcp'])[] = [
  ['skills', 'skills'], ['subagents', 'subagents'], ['guardrails', 'rules'], ['hooks', 'hooks'], ['mcp', 'mcp'],
];

/** Resolves a chain of layers, top first. The last layer is the one resolved. */
export function resolveLayers(chain: readonly LayerInput[]): ResolveResult {
  if (chain.length === 0) return { ok: false, problems: [{ code: 'NO_LAYERS', path: '.', message: 'A chain needs at least one layer.' }] };
  const problems: Problem[] = [];
  const hidden: HiddenItem[] = [];
  const sets = new Map<OverridablePart, Mutable<Entry>[]>(PARTS.map(([part]) => [part, []]));
  const sandbox: Mutable<SandboxRequirement>[] = [];

  chain.forEach((layer, index) => {
    const fail = (code: string, message: string) => problems.push({ code, path: 'harness.json', message: `Layer ${index}: ${message}`, layer: index });
    for (const [part, key] of PARTS) {
      const current = sets.get(part)!;
      const own = layer.entries[key] as readonly Entry[];
      const ownById = new Map(own.map(item => [item.id, item]));
      const handled = new Set<string>();
      for (const o of layer.harness.overrides.filter(o => o.part === part)) {
        handled.add(o.id);
        const at = current.findIndex(p => p.item.id === o.id);
        if (at < 0) { fail('OVERRIDE_TARGET_MISSING', `the ${o.action} override names ${part}/${o.id}, which no higher layer holds.`); continue; }
        const target = current[at]!;
        if (part === 'guardrails') {
          const effect = (target.item as GuardrailRule).effect;
          if (effect === 'deny' || effect === 'ask') { fail('GUARDRAIL_LOCKED', `the ${o.action} override names the ${effect} rule ${o.id} of layer ${target.layer}. A lower layer cannot hide or replace a ${effect} rule.`); continue; }
        }
        const mine = ownById.get(o.id);
        if (o.action === 'hide') {
          if (mine) { fail('HIDE_WITH_ITEM', `the layer hides ${part}/${o.id} and also holds an item with that id. Use replace.`); continue; }
          current.splice(at, 1);
          hidden.push({ part, id: o.id, layer: index, from: target.layer });
        } else {
          if (!mine) { fail('REPLACE_WITHOUT_ITEM', `the replace override names ${part}/${o.id}, and the layer holds no item with that id.`); continue; }
          current[at] = { item: mine, layer: index, replaces: { layer: target.layer } };
        }
      }
      for (const item of own) {
        if (handled.has(item.id)) continue;
        if (current.some(p => p.item.id === item.id)) { fail('DUPLICATE_WITHOUT_REPLACE', `${part}/${item.id} is also in a higher layer. Add a replace override to use this one.`); continue; }
        current.push({ item, layer: index });
      }
    }
    for (const item of layer.entries.sandbox) sandbox.push({ item, layer: index });
  });

  if (problems.length) return { ok: false, problems };
  const last = chain.length - 1;
  const place = <T>(list: Mutable<Entry>[] | Mutable<T>[]): Placed<T>[] => (list as Mutable<T>[]).map(p => ({
    item: p.item, layer: p.layer, inherited: p.layer < last, ...(p.replaces ? { replaces: { layer: p.replaces.layer } } : {}),
  }));
  return {
    ok: true,
    resolved: {
      skills: place<SkillEntry>(sets.get('skills')!),
      subagents: place<SubagentEntry>(sets.get('subagents')!),
      rules: place<GuardrailRule>(sets.get('guardrails')!),
      sandbox: place<SandboxRequirement>(sandbox),
      hooks: place<HookEntry>(sets.get('hooks')!),
      mcp: place<McpServer>(sets.get('mcp')!),
      hidden,
    },
  };
}

/** The plain entries of a resolved set. */
export function entriesOf(resolved: ResolvedHarness): PartEntries {
  const items = <T>(list: readonly Placed<T>[]) => list.map(p => p.item);
  return {
    skills: items(resolved.skills), subagents: items(resolved.subagents), rules: items(resolved.rules),
    sandbox: items(resolved.sandbox), hooks: items(resolved.hooks), mcp: items(resolved.mcp),
  };
}
