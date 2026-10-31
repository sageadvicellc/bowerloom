/** What every engine reader gets: the project reader, the engines of the harness, and the lists it adds to. */
import type { EngineId, GuardrailAction } from '../../harness-definition/src/index.js';
import type { ProjectReader } from './files.js';
import type { Candidate, ManagedConversion, Place } from './model.js';

/**
 * The engine versions whose documented file forms the readers follow (portable parts and locked-in parts specs, front
 * matter). Pi and DeepSeek Harness come from documents and source only.
 */
export const READER_VERSIONS: Readonly<Record<EngineId, string>> = Object.freeze({
  'claude-code': '2.1.310', codex: '0.157.0', opencode: '1.18.30', pi: '1.4.0', 'deepseek-harness': '0.2.2-alpha.2',
});
/** DeepSeek Harness is pinned: every release is a prerelease, and its README promises breaking changes. */
export const DSH_PINNED_TAG = '0.2.2-alpha.2';

export interface Context {
  readonly r: ProjectReader;
  /** The engines of the harness, in ENGINE_IDS order. */
  readonly engines: readonly EngineId[];
  readonly versions: Readonly<Partial<Record<EngineId, string>>>;
  readonly cands: Candidate[];
  readonly warnings: string[];
  readonly managed: ManagedConversion[];
  /** Explicit models found in engine settings, by engine. */
  readonly models: Partial<Record<EngineId, { model: string; path: string }>>;
  /** Deny or ask rules, by engine and action, that could not be carried (ruling A2). `*` is every action. */
  readonly lost: { readonly engine: EngineId; readonly action: LostAction }[];
}

export type LostAction = GuardrailAction | '*';
/** Records that a deny or ask of one action from one engine could not be carried. */
export function lose(ctx: Context, engine: EngineId, action: LostAction): void { ctx.lost.push({ engine, action }); }

/** The engines of the harness that read a place. */
export const reading = (ctx: Context, engines: readonly EngineId[]): EngineId[] => ctx.engines.filter(e => engines.includes(e));

/** A place of one engine file, with the version whose form the reader follows. */
export function place(path: string, engines: readonly EngineId[], shape: string, owner: EngineId | null, extra: { pointer?: string; kind?: Place['kind'] } = {}): Place {
  return {
    path, ...(extra.pointer !== undefined ? { pointer: extra.pointer } : {}), engines: [...engines], kind: extra.kind ?? 'engine', shape,
    shapeVersion: owner === null ? null : READER_VERSIONS[owner],
  };
}
