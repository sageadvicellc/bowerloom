/**
 * What the translations of MCP servers, subagents, and hooks share (locked-in parts spec, sections 5 to 7): the line
 * collector, the `${NAME:-x}` check of section 5.3 rule 1 (check 5), and the walk over every string of an entry.
 * Pure functions: nothing is read or written.
 */
import type { EngineId, JsonValue, LossLine, PartKey, Result } from '../../harness-definition/src/index.js';

/** A problem that refuses the projection of one entry. `ENV_DEFAULT`: the entry holds `${NAME:-x}` or a like form. */
export interface LockedProblem {
  readonly part: PartKey;
  readonly entry: string;
  readonly code: 'ENV_DEFAULT';
}

/**
 * True when the text holds a shell default or check form: `${NAME:-x}`, `${NAME-x}`, `${NAME:=x}`, `${NAME:?x}`,
 * `${NAME:+x}`, and their forms without the colon. No engine is documented to expand all of them, so Bowerloom never
 * copies one as literal text: it refuses the entry (section 5.3 rule 1; check 5).
 */
export function envDefaultIn(text: string): boolean {
  return /\$\{[A-Za-z_][A-Za-z0-9_]*:?[-=?+]/.test(text);
}

/** Every string inside a value, at any depth, keys too. */
export function stringsOf(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) stringsOf(v, out);
  else if (value !== null && typeof value === 'object') for (const [k, v] of Object.entries(value)) { out.push(k); stringsOf(v, out); }
  return out;
}

/** True when any string of the entry holds a default form. */
export const holdsEnvDefault = (entry: object): boolean => stringsOf(entry).some(envDefaultIn);

/** The `${NAME}` references of a text, and whether the text is exactly one of them. */
export function references(text: string): { readonly names: readonly string[]; readonly whole: string | null } {
  const names = [...text.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map(m => m[1]!);
  const whole = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(text)?.[1] ?? null;
  return { names, whole };
}

/** Splits a text into literal parts and `${NAME}` references, in order. */
export function referenceParts(text: string): ({ readonly literal: string } | { readonly name: string })[] {
  const out: ({ literal: string } | { name: string })[] = [];
  let at = 0;
  for (const m of text.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
    if (m.index! > at) out.push({ literal: text.slice(at, m.index) });
    out.push({ name: m[1]! });
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push({ literal: text.slice(at) });
  return out;
}

/** Collects the lines of one part and one engine. */
export class Lines {
  readonly lines: LossLine[] = [];
  readonly problems: LockedProblem[] = [];
  constructor(readonly part: PartKey, readonly engine: EngineId) {}
  line(entry: string, result: Result, reason: string, field?: string): void {
    this.lines.push({ part: this.part, entry, ...(field !== undefined ? { field } : {}), engine: this.engine, result, reason });
  }
  /** Records an ENV_DEFAULT problem and its absent line. */
  envDefault(entry: string): void {
    this.problems.push({ part: this.part, entry, code: 'ENV_DEFAULT' });
    this.line(entry, 'absent', 'The entry holds ${NAME:-x} or a like default form. No engine is documented to expand it, so Bowerloom never copies it as literal text and refuses the entry. Write ${NAME}, or set the value in the definition.');
  }
}

/**
 * Adds the keys of an engine-private block after the keys Bowerloom writes, unchanged. A key that Bowerloom already
 * writes is not overwritten: the names of such keys are returned, for a loss line. Null values are returned too when
 * `noNull` is set, because TOML has no null.
 */
export function addPrivate(entries: [string, JsonValue][], block: JsonValue | undefined, noNull = false): { readonly kept: readonly string[]; readonly dropped: readonly string[] } {
  if (block === undefined || block === null || typeof block !== 'object' || Array.isArray(block)) return { kept: [], dropped: [] };
  const kept: string[] = [], dropped: string[] = [];
  const taken = new Set(entries.map(([k]) => k));
  for (const [k, v] of Object.entries(block as Record<string, JsonValue>)) {
    if (taken.has(k) || (noNull && containsNull(v))) { dropped.push(k); continue; }
    entries.push([k, v]); kept.push(k);
  }
  return { kept, dropped };
}
const containsNull = (v: JsonValue): boolean => v === null || (Array.isArray(v) ? v.some(containsNull) : typeof v === 'object' ? Object.values(v).some(containsNull) : false);

/** The line of an engine-private block that was not carried whole. */
export function privateLine(out: Lines, entry: string, dropped: readonly string[], where: string): void {
  if (dropped.length) out.line(entry, 'absent', `The x-${out.engine} block names keys that Bowerloom writes itself, or a null that ${where} cannot hold, so these keys are not written: ${dropped.join(', ')}.`, `x-${out.engine}`);
}
