/**
 * What every engine translator returns: the engine form in memory, one loss line per entry, the list of what it wrote
 * and from which entry, and the private blocks it carries. Nothing here writes a file; step 3 writes the forms.
 */
import type { EngineId, GuardrailRule, JsonValue, LossLine, Result, SandboxRequirement } from '../../harness-definition/src/index.js';

/** One engine-form item and the entry it came from. `where` names its place in the form, for a person. */
export interface Written {
  readonly source: string;
  readonly where: string;
}

/**
 * What an engine decides for a request that no written rule matches (ruling R8). `written` is true when Bowerloom
 * writes that default into the engine form itself.
 */
export interface EngineDefault {
  readonly decision: import('./decision.js').Decision;
  readonly written: boolean;
  readonly reason: string;
}

/** The sandbox an engine will enforce. */
export interface SandboxForm {
  readonly files: boolean;
  readonly network: boolean;
}

export interface Translation<F> {
  readonly engine: EngineId;
  readonly form: F;
  /** One line per rule and sandbox requirement that applies to the engine, exact ones too. */
  readonly lines: readonly LossLine[];
  readonly written: readonly Written[];
  /** The engine-private block of each entry that wrote something, unchanged, for the writer to carry. */
  readonly privateBlocks: Readonly<Record<string, JsonValue>>;
  /** The blocks of entries that wrote nothing, with why each is left out (ruling R16). */
  readonly excludedPrivateBlocks: readonly { readonly entry: string; readonly reason: string }[];
}

/** Collects lines and writes while one engine is translated. */
export class Collector {
  readonly lines: LossLine[] = [];
  readonly written: Written[] = [];
  readonly privateBlocks: Record<string, JsonValue> = {};
  constructor(readonly engine: EngineId) {}

  private readonly blocks = new Map<string, JsonValue>();

  line(entry: GuardrailRule | SandboxRequirement, result: Result, reason: string): void {
    this.lines.push({ part: 'guardrails', entry: entry.id, engine: this.engine, result, reason });
    const block = entry.privateBlocks[this.engine];
    if (block !== undefined) this.blocks.set(entry.id, block);
  }

  wrote(source: string, where: string): void {
    this.written.push({ source, where });
  }

  done<F>(form: F): Translation<F> {
    const excluded: { entry: string; reason: string }[] = [];
    for (const [entry, block] of this.blocks) {
      if (this.written.some(w => w.source === entry)) this.privateBlocks[entry] = block;
      else excluded.push({ entry, reason: `The entry writes nothing in ${this.engine}, so its ${this.engine} block has no place to go.` });
    }
    return { engine: this.engine, form, lines: this.lines, written: this.written, privateBlocks: this.privateBlocks, excludedPrivateBlocks: excluded };
  }
}

/** The text that every line about a rule that was not written carries. Check 2 of section 12 reads it. */
export const NOT_WRITTEN = 'Not written.';
