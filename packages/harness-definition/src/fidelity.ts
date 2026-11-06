/**
 * The fidelity rule (locked-in parts spec, sections 2 and 3) and the approval records (lead rulings R3, R6, R8).
 *
 * - Every loss is reported: the check builds the expected set of (part, entry, engine) itself, from the entries and the
 *   engines, so a missing line is a problem. An empty report is never a pass.
 * - An `enforced` entry whose result is `weakened` or `absent` is refused unless a recorded approval exists.
 * - Strength comes from the definition, never from the caller (`strengthOf`).
 * - An approval records the hash of the entry it approves (`entryHash`). A change to the entry voids it.
 * - Approvals live outside the definition, in the app data folder, so they are not in the revision. This module holds
 *   the record types, their checks, and pure matchers only.
 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import { canonicalJson } from '../../contracts/src/index.js';
import { isRecord } from './json.js';
import { appliesTo } from './select.js';
import type { EngineTarget, JsonValue, PartEntries, Problem, SubagentEntry } from './types.js';
import { LOSS_PARTS, OVERRIDABLE_PARTS, PART_KEYS, RESULTS, isEngineId } from './words.js';
import type { EngineId, LossPart, OverridablePart, PartKey, Result, Strength } from './words.js';

/** The hash of one entry: SHA-256 over its canonical JSON. Fields that are undefined do not count. */
export function entryHash(entry: object): string {
  return 'sha256:' + createHash('sha256').update(canonicalJson(JSON.parse(JSON.stringify(entry))), 'utf8').digest('hex');
}

/**
 * How one engine carries one entry, or one field of it. A line that is not `exact` states its reason. `part` is a part
 * key, or `engine-private` for a file under `engines/<engine>/` (its entry is the definition path of the file).
 */
export interface LossLine {
  readonly part: LossPart;
  readonly entry: string;
  readonly field?: string;
  readonly engine: EngineId;
  readonly result: Result;
  readonly reason: string;
}
/** The loss report: one line or more per part, entry, and engine. */
export type LossReport = readonly LossLine[];
/** A line with the strength the definition gives it. */
export interface JudgedLine extends LossLine {
  readonly strength: Strength;
}

/** Who approved, when, and why, and the hash of the entry approved. */
interface ApprovalRecord {
  readonly entryHash: string;
  /** The person who approved. */
  readonly who: string;
  /** When, as an ISO 8601 UTC time, such as 2026-10-28T14:00:00Z. Never in the future. */
  readonly when: string;
  readonly reason: string;
}

/**
 * A person's recorded approval to project one weakened or absent entry to one engine. It names the result it approves:
 * an approval of `weakened` does not cover `absent`.
 */
export interface FidelityApproval extends ApprovalRecord {
  readonly part: PartKey;
  readonly entry: string;
  readonly field?: string;
  readonly engine: EngineId;
  readonly result: 'weakened' | 'absent';
}

/**
 * A person's recorded approval for a lower layer to widen what a higher layer set (lead ruling R1): add an `allow` rule,
 * or hide or replace a hook, an MCP server, a subagent, or an `allow` rule with another `allow` rule. `entryHash` is the
 * hash of the lower layer's entry for `add-allow` and `replace`, and of the hidden entry for `hide`. `folder` is the
 * `.bowerloom` folder of the layer that makes the change, so an approval for one project never matches another.
 * `targetHash`, for `replace` only, is the hash of the replaced item.
 */
export interface LayerApproval extends ApprovalRecord {
  readonly part: OverridablePart;
  readonly entry: string;
  readonly change: 'add-allow' | 'hide' | 'replace';
  /** The absolute path of the `.bowerloom` folder of the layer that makes the change. */
  readonly folder: string;
  readonly targetHash?: string;
}

export interface ApprovalOptions {
  /** The present time. An approval dated after it is refused. Default: the clock. */
  readonly now?: Date;
}

const WHEN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const HASH = /^sha256:[0-9a-f]{64}$/;
const nonEmpty = (v: unknown, max = 1024): v is string => typeof v === 'string' && v.trim() !== '' && v.length <= max;

function validWhen(value: unknown, now: Date): boolean {
  if (typeof value !== 'string' || !WHEN.test(value)) return false;
  const time = new Date(value);
  return !Number.isNaN(time.getTime()) && time.toISOString().slice(0, 19) === value.slice(0, 19) && time.getTime() <= now.getTime();
}

/** Checks the shared fields and the key set. A field whose value is undefined counts as absent. */
function record(value: unknown, keys: readonly string[], now: Date, bad: (message: string) => void): Record<string, unknown> | undefined {
  if (!isRecord(value as JsonValue)) { bad('An approval must be an object.'); return undefined; }
  const v = Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, x]) => x !== undefined));
  if (Object.keys(v).some(k => !keys.includes(k))) bad('An approval has a field that is not known.');
  if (!nonEmpty(v.entry, 256)) bad('entry must name the entry.');
  if (typeof v.entryHash !== 'string' || !HASH.test(v.entryHash)) bad('entryHash must be the sha256 hash of the approved entry.');
  if (!nonEmpty(v.who, 256)) bad('who must name the person who approved.');
  if (!validWhen(v.when, now)) bad('when must be an ISO 8601 UTC time, such as 2026-10-28T14:00:00Z, and not in the future.');
  if (!nonEmpty(v.reason, 4096)) bad('reason must say why the person approved.');
  return v;
}

export type ParseResult<K extends string, T> = ({ readonly ok: true } & { readonly [P in K]: T }) | { readonly ok: false; readonly problems: readonly Problem[] };

/** Checks a fidelity approval record. Unknown fields are refused. */
export function parseFidelityApproval(value: unknown, options: ApprovalOptions = {}): ParseResult<'approval', FidelityApproval> {
  const problems: Problem[] = [];
  const bad = (message: string) => { problems.push({ code: 'APPROVAL_INVALID', path: 'approval', message }); };
  const v = record(value, ['part', 'entry', 'field', 'engine', 'result', 'entryHash', 'who', 'when', 'reason'], options.now ?? new Date(), bad);
  if (!v) return { ok: false, problems };
  if (!(PART_KEYS as readonly unknown[]).includes(v.part)) bad(`part must be one of ${PART_KEYS.join(', ')}.`);
  if (Object.hasOwn(v, 'field') && !nonEmpty(v.field, 256)) bad('field, when present, must name a field.');
  if (!isEngineId(v.engine)) bad('engine must be an engine id.');
  if (v.result !== 'weakened' && v.result !== 'absent') bad('result must be weakened or absent: only those need an approval.');
  if (problems.length) return { ok: false, problems };
  const approval: FidelityApproval = {
    part: v.part as PartKey, entry: v.entry as string, ...(Object.hasOwn(v, 'field') ? { field: v.field as string } : {}),
    engine: v.engine as EngineId, result: v.result as 'weakened' | 'absent', entryHash: v.entryHash as string,
    who: v.who as string, when: v.when as string, reason: v.reason as string,
  };
  return { ok: true, approval };
}

/** Checks a layer approval record. Unknown fields are refused. */
export function parseLayerApproval(value: unknown, options: ApprovalOptions = {}): ParseResult<'approval', LayerApproval> {
  const problems: Problem[] = [];
  const bad = (message: string) => { problems.push({ code: 'APPROVAL_INVALID', path: 'approval', message }); };
  const v = record(value, ['part', 'entry', 'change', 'folder', 'entryHash', 'targetHash', 'who', 'when', 'reason'], options.now ?? new Date(), bad);
  if (!v) return { ok: false, problems };
  if (!(OVERRIDABLE_PARTS as readonly unknown[]).includes(v.part)) bad(`part must be one of ${OVERRIDABLE_PARTS.join(', ')}.`);
  if (!['add-allow', 'hide', 'replace'].includes(v.change as string)) bad('change must be add-allow, hide, or replace.');
  if (typeof v.folder !== 'string' || !path.isAbsolute(v.folder) || v.folder.length > 4096) bad('folder must be the absolute path of the layer\'s .bowerloom folder.');
  if (v.change === 'replace' ? typeof v.targetHash !== 'string' || !HASH.test(v.targetHash) : Object.hasOwn(v, 'targetHash')) bad('targetHash is the sha256 hash of the replaced item, for replace only.');
  if (problems.length) return { ok: false, problems };
  return {
    ok: true,
    approval: {
      part: v.part as OverridablePart, entry: v.entry as string, change: v.change as LayerApproval['change'], folder: v.folder as string,
      entryHash: v.entryHash as string, ...(v.change === 'replace' ? { targetHash: v.targetHash as string } : {}),
      who: v.who as string, when: v.when as string, reason: v.reason as string,
    },
  };
}

/** True when an approval covers a line about this entry. */
export function fidelityApprovalMatches(approval: FidelityApproval, line: LossLine, entry: object): boolean {
  return approval.part === line.part && approval.entry === line.entry && approval.engine === line.engine
    && (approval.field ?? null) === (line.field ?? null) && approval.result === line.result && approval.entryHash === entryHash(entry);
}
/**
 * True when an approval covers this change of this entry by the layer in `folder`. For `replace`, `target` is the
 * replaced item, and the approval must name its hash.
 */
export function layerApprovalMatches(approval: LayerApproval, part: OverridablePart, change: LayerApproval['change'], entry: { readonly id: string }, folder: string, target?: object): boolean {
  if (approval.part !== part || approval.entry !== entry.id || approval.change !== change || approval.entryHash !== entryHash(entry)) return false;
  if (path.resolve(approval.folder) !== path.resolve(folder)) return false;
  return change !== 'replace' || (target !== undefined && approval.targetHash === entryHash(target));
}

/**
 * The strength of an entry, or of one field of it, from the definition:
 * - a guardrail rule that is `deny` or `ask` is enforced, whatever it declares; an `allow` rule has its own strength;
 * - a sandbox requirement is enforced;
 * - a hook has its own strength;
 * - a subagent with a tool limit is enforced for the entry and for the `tools` field; any other field is advisory;
 * - skills, MCP servers, engine-private files, and parts with no entries are advisory.
 */
export function strengthOf(part: LossPart, entry: object, field?: string): Strength {
  const e = entry as Record<string, unknown>;
  if (part === 'guardrails') {
    if (Object.hasOwn(e, 'files') && Object.hasOwn(e, 'network')) return 'enforced';
    return e.effect === 'allow' && e.strength === 'advisory' ? 'advisory' : 'enforced';
  }
  if (part === 'hooks') return e.strength === 'advisory' ? 'advisory' : 'enforced';
  if (part === 'subagents') return (e as Partial<SubagentEntry>).tools !== undefined && (field === undefined || field === 'tools') ? 'enforced' : 'advisory';
  return 'advisory';
}

/** True for an `enforced` line whose result is `weakened` or `absent`. */
export function needsApproval(line: { readonly strength: Strength; readonly result: Result }): boolean {
  return line.strength === 'enforced' && (line.result === 'weakened' || line.result === 'absent');
}

export interface FidelityVerdict {
  /** True when nothing is refused and the report and approvals have no fault. */
  readonly ok: boolean;
  /** Enforced lines that are weakened or absent with no matching approval. */
  readonly refused: readonly JudgedLine[];
  /** Enforced lines that are weakened or absent, each with the approval that covers it. */
  readonly approved: readonly { readonly line: JudgedLine; readonly approval: FidelityApproval }[];
  /** Valid approvals that matched no line. They do not change `ok`. */
  readonly unused: readonly FidelityApproval[];
  readonly problems: readonly Problem[];
}

/** What the check judges: the entries (of one definition, or resolved layers) and the engines projected to. */
export interface FidelitySource {
  readonly entries: PartEntries;
  readonly engines: readonly (EngineTarget | EngineId)[];
}

const LINE_KEYS = ['part', 'entry', 'field', 'engine', 'result', 'reason'];
const ENTRY_PARTS: readonly [PartKey, (e: PartEntries) => readonly ({ id: string; engines?: readonly EngineId[] })[]][] = [
  ['skills', e => e.skills], ['subagents', e => e.subagents], ['guardrails', e => [...e.rules, ...e.sandbox]], ['hooks', e => e.hooks], ['mcp', e => e.mcp],
];

/** Judges a loss report against the definition and the recorded approvals. */
export function checkFidelity(source: FidelitySource, report: LossReport, approvals: readonly unknown[], options: ApprovalOptions = {}): FidelityVerdict {
  const problems: Problem[] = [];
  const engines = source.engines.map(e => typeof e === 'string' ? e : e.id);
  const valid: FidelityApproval[] = [];
  approvals.forEach((value, i) => {
    const parsed = parseFidelityApproval(value, options);
    if (parsed.ok) valid.push(parsed.approval);
    else problems.push(...parsed.problems.map(p => ({ ...p, path: `approvals[${i}]` })));
  });

  // The expected set: every entry, for every engine it applies to.
  const byKey = new Map<string, object>();
  const expected = new Set<string>();
  for (const [part, list] of ENTRY_PARTS) for (const entry of list(source.entries)) {
    byKey.set(`${part}\n${entry.id}`, entry);
    for (const engine of engines) if (appliesTo(entry, engine)) expected.add(`${part}\n${entry.id}\n${engine}`);
  }

  const refused: JudgedLine[] = [];
  const approved: { line: JudgedLine; approval: FidelityApproval }[] = [];
  const used = new Set<FidelityApproval>();
  const seen = new Set<string>();
  report.forEach((line, i) => {
    const where = `report[${i}]`;
    const fault = lineFault(line, engines);
    if (fault) { problems.push({ code: 'LOSS_LINE_INVALID', path: where, message: fault }); return; }
    const entry = byKey.get(`${line.part}\n${line.entry}`);
    const entryPart = ENTRY_PARTS.some(([p]) => p === line.part);
    if (entryPart && (!entry || !expected.has(`${line.part}\n${line.entry}\n${line.engine}`))) {
      problems.push({ code: 'LOSS_LINE_UNKNOWN', path: where, message: `The line names an entry of ${line.part} that does not apply to ${line.engine} in this definition.` });
      return;
    }
    seen.add(`${line.part}\n${line.entry}\n${line.engine}`);
    if (line.result !== 'exact' && line.reason.trim() === '') {
      problems.push({ code: 'LOSS_WITHOUT_REASON', path: where, message: `The line is ${line.result} and states no reason. Every loss is reported with its reason.` });
    }
    const judged: JudgedLine = { ...line, strength: entry ? strengthOf(line.part, entry, line.field) : 'advisory' };
    if (!needsApproval(judged)) return;
    const approval = entry && valid.find(a => fidelityApprovalMatches(a, line, entry));
    if (approval) { approved.push({ line: judged, approval }); used.add(approval); } else refused.push(judged);
  });
  for (const key of expected) {
    if (seen.has(key)) continue;
    const [part, entry, engine] = key.split('\n');
    problems.push({ code: 'LOSS_LINE_MISSING', path: 'report', message: `The report has no line for ${part} ${entry} in ${engine}. Every entry needs a line for every engine it applies to, exact ones too.` });
  }
  return { ok: refused.length === 0 && problems.length === 0, refused, approved, unused: valid.filter(a => !used.has(a)), problems };
}

function lineFault(line: LossLine, engines: readonly EngineId[]): string | null {
  if (!isRecord(line as unknown as JsonValue)) return 'A loss line must be an object.';
  if (Object.keys(line).some(k => !LINE_KEYS.includes(k))) return 'A loss line has a field that is not known. The definition gives the strength, not the report.';
  if (!(LOSS_PARTS as readonly string[]).includes(line.part)) return 'A loss line names a part that is not known.';
  if (!nonEmpty(line.entry, 256)) return 'A loss line must name its entry.';
  if (line.field !== undefined && !nonEmpty(line.field, 256)) return 'A loss line field, when present, must name a field.';
  if (!isEngineId(line.engine) || !engines.includes(line.engine)) return 'A loss line names an engine that the harness does not project to.';
  if (!(RESULTS as readonly string[]).includes(line.result)) return `A loss line result must be one of ${RESULTS.join(', ')}.`;
  if (typeof line.reason !== 'string') return 'A loss line reason must be text.';
  return null;
}
