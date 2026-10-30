/**
 * The schema of one usage event (version 1). Every field is allowlisted. A value that fails its check is dropped:
 * the event is still kept without it, and the raw value is never stored. Pure functions, no file access.
 */
export const EVENT_SOURCES = ['cli', 'app'] as const;
export const EVENT_KINDS = ['scenario', 'error', 'check'] as const;
export const SCENARIOS = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'] as const;
export const OUTCOMES = ['done', 'refused'] as const;
export const ENGINES = ['claude-code', 'codex'] as const;
export const ANSWERS = ['yes', 'partly', 'no'] as const;
export const NOTE_LIMIT = 500;

export type EventSource = (typeof EVENT_SOURCES)[number];
export type EventKind = (typeof EVENT_KINDS)[number];
export type Scenario = (typeof SCENARIOS)[number];
export type Outcome = (typeof OUTCOMES)[number];
export type EngineName = (typeof ENGINES)[number];
export type Answer = (typeof ANSWERS)[number];

export interface UsageEvent {
  v: 1;
  at: string;
  source: EventSource;
  kind: EventKind;
  scenario?: Scenario;
  outcome?: Outcome;
  code?: string;
  step?: string;
  engines?: EngineName[];
  plan?: string;
  target?: string;
  answer?: Answer;
  note?: string;
}

const CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const STEP = /^[a-z][a-z0-9-]{1,31}$/;
const PLAN = /^(sha256:)?[0-9a-f]{64}$/;
const TARGET = /^[0-9a-f]{16}$/;
const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
// Separators become a space. Every other control, DEL, C1 control, format character (bidi and zero-width) is removed.
const SEPARATORS = /[\n\r\t\u2028\u2029]/g;
const HIDDEN = /[\u0000-\u001f\u007f-\u009f\p{Cf}]/gu;

const member = <T extends string>(list: readonly T[], value: unknown): T | undefined =>
  typeof value === 'string' && (list as readonly string[]).includes(value) ? (value as T) : undefined;
const matching = (pattern: RegExp, value: unknown): string | undefined => (typeof value === 'string' && pattern.test(value) ? value : undefined);

/** Free text from a check question: separators to spaces, hidden characters removed, at most 500 characters. Undefined when empty. */
export function cleanNote(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  let text = value.replace(SEPARATORS, ' ').replace(HIDDEN, '').replace(/ {2,}/g, ' ').trim();
  if (text.length > NOTE_LIMIT) {
    text = text.slice(0, NOTE_LIMIT);
    // Never end on half of a surrogate pair.
    if (/[\ud800-\udbff]$/.test(text)) text = text.slice(0, -1);
    text = text.trimEnd();
  }
  return text === '' ? undefined : text;
}

/** `at` in whole seconds, UTC: 2026-10-30T14:00:00Z. */
export function isoSeconds(date: Date): string { return date.toISOString().replace(/\.\d{3}Z$/, 'Z'); }

/** The checked optional fields of an event, in schema order. `target` is passed through only when it is already an id. */
export function checkedFields(raw: Readonly<Record<string, unknown>>, kind: EventKind): Omit<UsageEvent, 'v' | 'at' | 'source' | 'kind'> {
  const out: Omit<UsageEvent, 'v' | 'at' | 'source' | 'kind'> = {};
  const scenario = member(SCENARIOS, raw.scenario); if (scenario !== undefined) out.scenario = scenario;
  const outcome = member(OUTCOMES, raw.outcome); if (outcome !== undefined) out.outcome = outcome;
  const code = matching(CODE, raw.code); if (code !== undefined) out.code = code;
  const step = matching(STEP, raw.step); if (step !== undefined) out.step = step;
  if (Array.isArray(raw.engines) && raw.engines.length > 0 && raw.engines.every(e => member(ENGINES, e) !== undefined)) {
    out.engines = ENGINES.filter(e => (raw.engines as unknown[]).includes(e));
  }
  const plan = matching(PLAN, raw.plan); if (plan !== undefined) out.plan = plan;
  const target = matching(TARGET, raw.target); if (target !== undefined) out.target = target;
  if (kind === 'check') {
    const answer = member(ANSWERS, raw.answer); if (answer !== undefined) out.answer = answer;
    const note = cleanNote(raw.note); if (note !== undefined) out.note = note;
  }
  return out;
}

const plainObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** One line of the log as an event, or null when it is not a valid version 1 event. Bad optional fields are dropped. */
export function parseEvent(value: unknown): UsageEvent | null {
  if (!plainObject(value) || value.v !== 1) return null;
  const at = matching(AT, value.at);
  const source = member(EVENT_SOURCES, value.source), kind = member(EVENT_KINDS, value.kind);
  if (at === undefined || Number.isNaN(Date.parse(at)) || source === undefined || kind === undefined) return null;
  return { v: 1, at, source, kind, ...checkedFields(value, kind) };
}

/** A new event from caller input, stamped with the clock. Null when the source or the kind is not valid. `target` is set by the log. */
export function newEvent(input: unknown, now: Date): UsageEvent | null {
  if (!plainObject(input)) return null;
  const source = member(EVENT_SOURCES, input.source), kind = member(EVENT_KINDS, input.kind);
  if (source === undefined || kind === undefined || Number.isNaN(now.getTime())) return null;
  // The caller never supplies a target id, only a root folder, which the log turns into an id.
  const { target: _ignored, ...rest } = input;
  return { v: 1, at: isoSeconds(now), source, kind, ...checkedFields(rest, kind) };
}
