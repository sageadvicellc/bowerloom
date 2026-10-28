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
/** The old id of an engine that had one, or the id itself for an engine that is new in 0.8. */
export const oldIdOf = (engine: Engine): string => isWriterEngine(engine) ? CURRENT_TO_OLD[engine] : engine;
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
 * and `codex` only. A current list holds current ids only. Null when the list is not valid.
 */
export function decodeEngines(list: unknown, oldForm: boolean, max: number = ENGINE_IDS.length): Engine[] | null {
  if (!Array.isArray(list) || list.length === 0 || list.length > max) return null;
  const out: Engine[] = [];
  for (let i = 0; i < list.length; i++) {
    const item: unknown = list[i], engine = oldForm ? engineFromOldId(item) : (isEngine(item) ? item : undefined);
    // The order is the byte order of the ids as the file spells them.
    if (engine === undefined || (i > 0 && !((list[i - 1] as string) < (item as string)))) return null;
    out.push(engine);
  }
  return out;
}
/** The field of a file for these engines, in the form of the file: `{ engines }`, or `{ harnesses }` with old ids. */
export function engineField(engines: readonly Engine[], form: EngineForm): { engines: string[] } | { harnesses: string[] } {
  return form.oldForm === true ? { harnesses: engines.map(oldIdOf) } : { engines: [...engines] };
}
