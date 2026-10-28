/**
 * The engine filter (section 4.1, decision 7; section 12, check 8) and engine-private blocks (section 2).
 * An entry with no filter applies to every engine. An entry with a filter applies only to the engines it lists.
 * An engine-private block goes only to its own engine, unchanged. The view records what it left out and why.
 */
import type { Definition, EngineTarget, Filterable, PartEntries, PrivateBlocks } from './types.js';
import { ENGINE_IDS, isEngineId } from './words.js';
import type { EngineId } from './words.js';

export function appliesTo(entry: Filterable, engine: EngineId): boolean {
  return entry.engines === undefined || entry.engines.includes(engine);
}

/** One thing a view left out: an entry for its filter, or another engine's private block. */
export type Excluded =
  | { readonly part: ExcludedPart; readonly id: string; readonly reason: 'engine-filter' }
  | { readonly part: ExcludedPart; readonly id: string; readonly reason: 'private-block'; readonly engine: EngineId };
export type ExcludedPart = 'skills' | 'subagents' | 'guardrails' | 'hooks' | 'mcp';

/** What one engine receives: the entries that apply to it, each with only its own private block. */
export interface EngineView extends PartEntries {
  /** Files under `engines/<engine>/`, relative to that folder. */
  readonly enginePrivate: readonly string[];
  /** Entries left out by their filter, and private blocks of other engines that were stripped, in part order. */
  readonly excluded: readonly Excluded[];
}

/** A definition, or resolved entries with their engines. */
export type ViewSource =
  | Pick<Definition, 'harness' | 'entries' | 'enginePrivate'>
  | { readonly entries: PartEntries; readonly engines: readonly EngineTarget[]; readonly enginePrivate?: Definition['enginePrivate'] };

type Entry = Filterable & { readonly id: string; readonly privateBlocks: PrivateBlocks };

function own<T extends Entry>(entries: readonly T[], engine: EngineId, part: ExcludedPart, excluded: Excluded[]): T[] {
  const out: T[] = [];
  for (const e of entries) {
    if (!appliesTo(e, engine)) { excluded.push({ part, id: e.id, reason: 'engine-filter' }); continue; }
    for (const other of ENGINE_IDS) if (other !== engine && e.privateBlocks[other] !== undefined) excluded.push({ part, id: e.id, reason: 'private-block', engine: other });
    const block = e.privateBlocks[engine];
    out.push({ ...e, privateBlocks: block === undefined ? {} : { [engine]: block } });
  }
  return out;
}

/**
 * The view of a definition, or of resolved entries, for one engine. Nothing in the source changes.
 * Throws a TypeError for a value that is not an engine id, and a RangeError for an engine the source does not list.
 */
export function selectForEngine(source: ViewSource, engine: EngineId): EngineView {
  if (!isEngineId(engine)) throw new TypeError('selectForEngine: the engine is not an engine id.');
  const engines = 'harness' in source ? source.harness.engines : source.engines;
  if (!engines.some(e => e.id === engine)) throw new RangeError(`selectForEngine: the source does not list the engine ${engine}.`);
  const e = source.entries;
  const excluded: Excluded[] = [];
  const skills = own(e.skills, engine, 'skills', excluded);
  const subagents = own(e.subagents, engine, 'subagents', excluded);
  const rules = own(e.rules, engine, 'guardrails', excluded);
  const sandbox = own(e.sandbox, engine, 'guardrails', excluded);
  const hooks = own(e.hooks, engine, 'hooks', excluded);
  const mcp = own(e.mcp, engine, 'mcp', excluded);
  return { skills, subagents, rules, sandbox, hooks, mcp, enginePrivate: [...(source.enginePrivate?.[engine] ?? [])], excluded };
}
