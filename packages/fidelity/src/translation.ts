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
  /** The engine-private block of each entry that is not `absent`, unchanged, for the writer to carry. */
  readonly privateBlocks: Readonly<Record<string, JsonValue>>;
}

/** Collects lines and writes while one engine is translated. */
export class Collector {
  readonly lines: LossLine[] = [];
  readonly written: Written[] = [];
  readonly privateBlocks: Record<string, JsonValue> = {};
  constructor(readonly engine: EngineId) {}

  line(entry: GuardrailRule | SandboxRequirement, result: Result, reason: string): void {
    this.lines.push({ part: 'guardrails', entry: entry.id, engine: this.engine, result, reason });
    const block = entry.privateBlocks[this.engine];
    if (result !== 'absent' && block !== undefined) this.privateBlocks[entry.id] = block;
  }

  wrote(source: string, where: string): void {
    this.written.push({ source, where });
  }

  done<F>(form: F): Translation<F> {
    return { engine: this.engine, form, lines: this.lines, written: this.written, privateBlocks: this.privateBlocks };
  }
}

/** The text that every line about a rule that was not written carries. Check 2 of section 12 reads it. */
export const NOT_WRITTEN = 'Not written.';
