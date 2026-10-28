/**
 * The fidelity rule (locked-in parts spec, sections 2 and 3). Every loss is reported, and an `enforced` entry whose
 * result is `weakened` or `absent` is refused unless a recorded override exists. The projection lanes build the loss
 * report; this module only judges it.
 */
import { isRecord } from './json.js';
import type { JsonValue, Problem } from './types.js';
import { PART_KEYS, RESULTS, STRENGTHS, isEngineId } from './words.js';
import type { EngineId, PartKey, Result, Strength } from './words.js';

/** How one engine carries one entry, or one field of it. A line that is not `exact` states its reason. */
export interface LossLine {
  readonly part: PartKey;
  readonly entry: string;
  readonly field?: string;
  readonly engine: EngineId;
  readonly strength: Strength;
  readonly result: Result;
  readonly reason: string;
}
/** The loss report: one line per part, entry (and field), and engine. */
export type LossReport = readonly LossLine[];

/**
 * A person's recorded approval to project one weakened or absent entry to one engine. It names the result it approves:
 * an approval of `weakened` does not cover `absent`.
 */
export interface FidelityOverride {
  readonly part: PartKey;
  readonly entry: string;
  readonly field?: string;
  readonly engine: EngineId;
  readonly result: 'weakened' | 'absent';
  /** The person who approved. */
  readonly who: string;
  /** When, as an ISO 8601 UTC time, such as 2026-10-28T14:00:00Z. */
  readonly when: string;
  readonly reason: string;
}

export interface FidelityVerdict {
  /** True when nothing is refused and the report and overrides have no fault. */
  readonly ok: boolean;
  /** Enforced lines that are weakened or absent with no matching override. */
  readonly refused: readonly LossLine[];
  /** Enforced lines that are weakened or absent, each with the override that approves it. */
  readonly approved: readonly { readonly line: LossLine; readonly override: FidelityOverride }[];
  /** Valid overrides that matched no refused line. */
  readonly unused: readonly FidelityOverride[];
  readonly problems: readonly Problem[];
}

/** True for an `enforced` line whose result is `weakened` or `absent`. */
export function needsOverride(line: Pick<LossLine, 'strength' | 'result'>): boolean {
  return line.strength === 'enforced' && (line.result === 'weakened' || line.result === 'absent');
}

const WHEN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const nonEmpty = (v: unknown, max = 1024): v is string => typeof v === 'string' && v.trim() !== '' && v.length <= max;
const OVERRIDE_KEYS = ['part', 'entry', 'field', 'engine', 'result', 'who', 'when', 'reason'];

export type ParseOverrideResult = { readonly ok: true; readonly override: FidelityOverride } | { readonly ok: false; readonly problems: readonly Problem[] };

/** Checks an override record: who, when, which entry, which engine, which result, and why. Unknown fields are refused. */
export function parseFidelityOverride(value: unknown): ParseOverrideResult {
  const problems: Problem[] = [];
  const bad = (message: string) => { problems.push({ code: 'OVERRIDE_INVALID', path: 'override', message }); };
  if (!isRecord(value as JsonValue)) { bad('An override must be an object.'); return { ok: false, problems }; }
  const v = value as Record<string, unknown>;
  for (const key of Object.keys(v)) if (!OVERRIDE_KEYS.includes(key)) bad(`An override has the field ${key}, which is not known.`);
  if (!(PART_KEYS as readonly unknown[]).includes(v.part)) bad(`part must be one of ${PART_KEYS.join(', ')}.`);
  if (!nonEmpty(v.entry, 256)) bad('entry must name the entry.');
  if (Object.hasOwn(v, 'field') && !nonEmpty(v.field, 256)) bad('field, when present, must name a field.');
  if (!isEngineId(v.engine)) bad('engine must be an engine id.');
  if (v.result !== 'weakened' && v.result !== 'absent') bad('result must be weakened or absent: only those need an override.');
  if (!nonEmpty(v.who, 256)) bad('who must name the person who approved.');
  if (!validWhen(v.when)) bad('when must be an ISO 8601 UTC time, such as 2026-10-28T14:00:00Z.');
  if (!nonEmpty(v.reason, 4096)) bad('reason must say why the person approved.');
  if (problems.length) return { ok: false, problems };
  const override: FidelityOverride = {
    part: v.part as PartKey, entry: v.entry as string, ...(Object.hasOwn(v, 'field') ? { field: v.field as string } : {}),
    engine: v.engine as EngineId, result: v.result as 'weakened' | 'absent', who: v.who as string, when: v.when as string, reason: v.reason as string,
  };
  return { ok: true, override };
}

function validWhen(value: unknown): boolean {
  if (typeof value !== 'string' || !WHEN.test(value)) return false;
  const time = new Date(value);
  return !Number.isNaN(time.getTime()) && time.toISOString().slice(0, 19) === value.slice(0, 19);
}

function lineFault(line: LossLine): string | null {
  if (!isRecord(line as unknown as JsonValue)) return 'A loss line must be an object.';
  if (!(PART_KEYS as readonly string[]).includes(line.part)) return 'A loss line names a part that is not known.';
  if (!nonEmpty(line.entry, 256)) return 'A loss line must name its entry.';
  if (line.field !== undefined && !nonEmpty(line.field, 256)) return 'A loss line field, when present, must name a field.';
  if (!isEngineId(line.engine)) return 'A loss line names an engine that is not known.';
  if (!(STRENGTHS as readonly string[]).includes(line.strength)) return 'A loss line strength must be enforced or advisory.';
  if (!(RESULTS as readonly string[]).includes(line.result)) return `A loss line result must be one of ${RESULTS.join(', ')}.`;
  if (typeof line.reason !== 'string') return 'A loss line reason must be text.';
  return null;
}

const matches = (o: FidelityOverride, l: LossLine) =>
  o.part === l.part && o.entry === l.entry && o.engine === l.engine && (o.field ?? null) === (l.field ?? null) && o.result === l.result;

/** Judges a loss report against the recorded overrides. */
export function checkFidelity(report: LossReport, overrides: readonly unknown[]): FidelityVerdict {
  const problems: Problem[] = [];
  const valid: FidelityOverride[] = [];
  overrides.forEach((value, i) => {
    const parsed = parseFidelityOverride(value);
    if (parsed.ok) valid.push(parsed.override);
    else problems.push(...parsed.problems.map(p => ({ ...p, path: `overrides[${i}]` })));
  });
  const refused: LossLine[] = [];
  const approved: { line: LossLine; override: FidelityOverride }[] = [];
  const used = new Set<FidelityOverride>();
  report.forEach((line, i) => {
    const fault = lineFault(line);
    if (fault) { problems.push({ code: 'LOSS_LINE_INVALID', path: `report[${i}]`, message: fault }); return; }
    if (line.result !== 'exact' && line.reason.trim() === '') {
      problems.push({ code: 'LOSS_WITHOUT_REASON', path: `report[${i}]`, message: `${line.part}/${line.entry} is ${line.result} in ${line.engine} and states no reason. Every loss is reported with its reason.` });
    }
    if (!needsOverride(line)) return;
    const override = valid.find(o => matches(o, line));
    if (override) { approved.push({ line, override }); used.add(override); } else refused.push(line);
  });
  return { ok: refused.length === 0 && problems.length === 0, refused, approved, unused: valid.filter(o => !used.has(o)), problems };
}
