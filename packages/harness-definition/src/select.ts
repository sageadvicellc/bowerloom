/**
 * The engine filter (section 4.1, decision 7; section 12, check 8) and engine-private blocks (section 2).
 * An entry with no filter applies to every engine. An entry with a filter applies only to the engines it lists.
 * An engine-private block goes only to its own engine, unchanged.
 */
import type { Definition, Filterable, PartEntries, PrivateBlocks } from './types.js';
import type { EngineId } from './words.js';

export function appliesTo(entry: Filterable, engine: EngineId): boolean {
  return entry.engines === undefined || entry.engines.includes(engine);
}

/** What one engine receives: the entries that apply to it, each with only its own private block. */
export interface EngineView extends PartEntries {
  /** Files under `engines/<engine>/`, relative to that folder. */
  readonly enginePrivate: readonly string[];
}

function own<T extends Filterable & { readonly privateBlocks: PrivateBlocks }>(entries: readonly T[], engine: EngineId): T[] {
  return entries.filter(e => appliesTo(e, engine)).map(e => {
    const block = e.privateBlocks[engine];
    return { ...e, privateBlocks: block === undefined ? {} : { [engine]: block } };
  });
}

/** The view of a definition, or of resolved entries, for one engine. Nothing in the source changes. */
export function selectForEngine(source: Pick<Definition, 'entries' | 'enginePrivate'>, engine: EngineId): EngineView {
  const e = source.entries;
  return {
    // Skills carry no engine filter: the portable frontmatter has no field for one.
    skills: [...e.skills],
    subagents: own(e.subagents, engine),
    rules: own(e.rules, engine),
    sandbox: own(e.sandbox, engine),
    hooks: own(e.hooks, engine),
    mcp: own(e.mcp, engine),
    enginePrivate: [...(source.enginePrivate[engine] ?? [])],
  };
}
