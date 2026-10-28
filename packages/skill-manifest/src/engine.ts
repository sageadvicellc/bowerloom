/**
 * The engines of Bowerloom 0.8, in one place. An engine is the coding tool a person works in. A harness is the
 * definition a person writes; it is a different thing and has its own words elsewhere.
 *
 * This file holds the canonical list and type, the mapping from the spelling of old files, and the typed refusal for an
 * engine that has no writer yet. A later step moves it to a core package, so every other file imports from here.
 *
 * Old files (`skills.json`, `bowerloom.json`, and the receipts and catalogs of managed copies) name the engines in a field
 * called `harnesses`, and call Claude Code `claude`. Reading such a file maps to the current names and never changes the
 * file. A file that Bowerloom writes back keeps the form it was read in. A file that Bowerloom creates uses `engines`
 * and `claude-code`.
 */
import { DefinitionError } from '../../contracts/src/index.js';

/** Every engine id, in the order of the 0.8 harness definition (section 11). */
export const ENGINE_IDS = Object.freeze(['claude-code', 'codex', 'opencode', 'pi', 'deepseek-harness'] as const);
export type Engine = (typeof ENGINE_IDS)[number];
export const isEngine = (value: unknown): value is Engine => typeof value === 'string' && (ENGINE_IDS as readonly string[]).includes(value);

/** How a person reads each engine id. */
export const ENGINE_NAMES: Readonly<Record<Engine, string>> = Object.freeze({
  'claude-code': 'Claude Code', codex: 'Codex', opencode: 'OpenCode', pi: 'Pi', 'deepseek-harness': 'DeepSeek Harness',
});

/** The engines that a code path can write files for today. Every other engine is refused by `writerEngines`. */
export const WRITER_ENGINE_IDS = Object.freeze(['claude-code', 'codex'] as const);
export type WriterEngine = (typeof WRITER_ENGINE_IDS)[number];
export const isWriterEngine = (value: unknown): value is WriterEngine => typeof value === 'string' && (WRITER_ENGINE_IDS as readonly string[]).includes(value);

/** What a new file names when nobody chose: the engines that have a writer. */
export const DEFAULT_ENGINES: readonly WriterEngine[] = WRITER_ENGINE_IDS;

/**
 * An old spelling: `claude` for Claude Code, `codex` for Codex. Only these two ever existed. Files that Bowerloom 0.7 wrote
 * name engines this way, and so do the records that are hashed (the plans, journals, receipts and catalogs of managed copies).
 * A type with this name is an id as a file stores it.
 */
export type OldEngineId = 'claude' | 'codex';
const OLD_TO_CURRENT: Readonly<Record<OldEngineId, WriterEngine>> = Object.freeze({ claude: 'claude-code', codex: 'codex' });
const CURRENT_TO_OLD: Readonly<Record<WriterEngine, OldEngineId>> = Object.freeze({ 'claude-code': 'claude', codex: 'codex' });
/** The engine of an old id, or undefined. Only `claude` and `codex` ever existed. */
export const engineFromOldId = (value: unknown): WriterEngine | undefined => typeof value === 'string' && Object.hasOwn(OLD_TO_CURRENT, value) ? OLD_TO_CURRENT[value as OldEngineId] : undefined;
/** The old id of an engine that had one. Used to write a file that already exists in the old form. */
export const oldIdOfWriter = (engine: WriterEngine): OldEngineId => CURRENT_TO_OLD[engine];
/** The old id of an engine. An engine that is new in 0.8 has none, so asking for one is the writer refusal. */
export const oldIdOf = (engine: Engine): OldEngineId => {
  if (!isWriterEngine(engine)) throw new EngineWriterRefusal(engine);
  return CURRENT_TO_OLD[engine];
};
/** What an API that stores the old ids takes from a caller: `claude-code` is mapped to the stored `claude`, anything else is left as it is. */
export const toStoredId = (value: unknown): unknown => (value === 'claude-code' ? 'claude' : value);
/** An id as a person or an old file may spell it: a current id, or an old one. */
export const parseEngineId = (value: unknown): Engine | undefined => isEngine(value) ? value : engineFromOldId(value);

/** The refusal for an engine that is known but has no writer. The code and the words are fixed. */
export class EngineWriterRefusal extends DefinitionError {
  constructor(readonly engine: Engine) { super('ENGINE_NO_WRITER', `no writer for engine ${engine} yet`); this.name = 'EngineWriterRefusal'; }
}
export const isEngineWriterRefusal = (error: unknown): error is EngineWriterRefusal => error instanceof EngineWriterRefusal;
/** The list when every engine in it has a writer. Otherwise throws EngineWriterRefusal for the first engine that has none. */
export function writerEngines(engines: readonly Engine[]): WriterEngine[] {
  for (const engine of engines) if (!isWriterEngine(engine)) throw new EngineWriterRefusal(engine);
  return [...engines] as WriterEngine[];
}

/** Which form a file is in. `oldForm` is set on what a parser returns for an old file, so the writer can keep the form. */
export interface EngineForm { readonly oldForm?: true }
/** The key an old file uses for the engine list. */
export const OLD_ENGINES_KEY = 'harnesses';
export const ENGINES_KEY = 'engines';

/** Which key of a parsed object carries the engines: `engines`, or the old `harnesses`. Null when it has neither or both. */
export function engineKeyOf(value: Record<string, unknown>): typeof ENGINES_KEY | typeof OLD_ENGINES_KEY | null {
  const current = Object.hasOwn(value, ENGINES_KEY), old = Object.hasOwn(value, OLD_ENGINES_KEY);
  return current === old ? null : current ? ENGINES_KEY : OLD_ENGINES_KEY;
}
/**
 * The engines of a parsed list: not empty, no more than `max`, unique and in byte order. An old list may hold `claude`
 * and `codex` only. A current list holds current ids only. Null when the list is not valid (`engineListProblem` says why).
 */
export function decodeEngines(list: unknown, oldForm: boolean, max: number = ENGINE_IDS.length): Engine[] | null {
  if (engineListProblem(list, oldForm, max) !== null) return null;
  return (list as unknown[]).map(item => (oldForm ? engineFromOldId(item) : item) as Engine);
}
/**
 * The field of a file for these engines, in the form of the file: `{ engines }`, or `{ harnesses }` with old ids. The ids
 * are written in byte order, because the readers want that order and ENGINE_IDS is not in it.
 */
export function engineField(engines: readonly Engine[], form: EngineForm): { engines: string[] } | { harnesses: string[] } {
  const byBytes = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  return form.oldForm === true ? { harnesses: engines.map(oldIdOf).sort(byBytes) } : { engines: [...engines].sort(byBytes) };
}
/** True when two parsed files have the same form: both old, or both current. A file that does not exist yet (null) takes any form. */
export const sameForm = (before: EngineForm | null, after: EngineForm): boolean => before === null || (before.oldForm === true) === (after.oldForm === true);

const PLAIN_ID = /^[a-z][a-z0-9-]{0,31}$/;
/**
 * Why an engine list is not valid, in words that may name the first id that is wrong. An id is named only when it is short
 * plain text, so a file can never put its own text into a message. Null when the list is valid.
 */
export function engineListProblem(list: unknown, oldForm: boolean, max: number = ENGINE_IDS.length): string | null {
  if (!Array.isArray(list)) return 'The engine list must be a list.';
  if (list.length === 0) return 'The engine list must name at least one engine.';
  if (list.length > max) return `The engine list names more than ${max} engines.`;
  for (let i = 0; i < list.length; i++) {
    const item: unknown = list[i], engine = oldForm ? engineFromOldId(item) : (isEngine(item) ? item : undefined);
    if (engine === undefined) return typeof item === 'string' && PLAIN_ID.test(item) ? `The engine list names "${item}", which ${oldForm ? 'the old form (harnesses) does not take: it takes claude and codex' : 'is not an engine id'}.` : 'The engine list names an id that is not an engine id.';
    if (i > 0 && !((list[i - 1] as string) < (item as string))) return 'The engine list must be sorted with no repeats.';
  }
  return null;
}
