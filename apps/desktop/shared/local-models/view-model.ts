/**
 * The display logic of the local models screen, pure: no React, no Node, no clock. The screen draws what these functions return, and a terminal view could reuse them.
 * A figure the server did not give is null and reads "not reported". It is never 0 and never blank. A server that is down, starting or unreachable is a state with words, never a crash.
 * The words live here. The speed unit "tokens/s" says "token", which the preview's word test bans everywhere else. That test (tests/harness-words.test.ts) lets this file, and only the text "tokens/s" in it, say the word.
 */
import type { LocalModel, LocalModelsNote, LocalModelsReport, ModelState } from './types.js';

export type Tone = 'good' | 'warn' | 'bad' | 'quiet';

export const LOCAL_WORDS = Object.freeze({
  title: 'Local models',
  notReported: 'not reported',
  refresh: 'Refresh',
  refreshing: 'Reading the servers.',
  loading: 'Reading the local model servers.',
  noBridge: 'This window cannot read local model servers.',
  sample: 'Sample data. These servers are made up.',
  stale: 'The last read failed. These figures are from the read before.',
  failedFirst: 'The local model servers could not be read. Trying again.',
  empty: 'No local model servers are set up. Add a port to the local models file.',
  list: 'Local model servers',
  idle: 'Idle',
});

const STATE_WORDS: Readonly<Record<ModelState, string>> = Object.freeze({ up: 'Up', down: 'Down', unreachable: 'Not answering', unsupported: 'Not supported', starting: 'Starting' });
const STATE_TONE: Readonly<Record<ModelState, Tone>> = Object.freeze({ up: 'good', down: 'bad', unreachable: 'warn', unsupported: 'warn', starting: 'warn' });
const STATE_RANK: Readonly<Record<ModelState, number>> = Object.freeze({ up: 0, starting: 1, unreachable: 2, unsupported: 3, down: 4 });
const REASON_WORDS: Readonly<Record<string, string>> = Object.freeze({
  CONNECTION_REFUSED: 'Nothing is listening on this port.', TIMEOUT: 'The server did not answer in time.', BAD_RESPONSE: 'The server answered in a form this app cannot read.',
  LOADING: 'The server is loading a model.', UNSUPPORTED_PROVIDER: 'This kind of server cannot be read yet.',
});

export const stateWords = (state: ModelState): string => STATE_WORDS[state];
export const stateTone = (state: ModelState): Tone => STATE_TONE[state];
/** A plain sentence for a reason code, or null when the code has none. The code itself is never shown as the only explanation. */
export const reasonWords = (code: string | null): string | null => (code === null ? null : REASON_WORDS[code] ?? null);

const finite = (n: number | null): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const GROUP = /\B(?=(\d{3})+(?!\d))/g;

/** A count with thousands separators, or "not reported". */
export const formatCount = (n: number | null): string => (finite(n) ? String(Math.round(n)).replace(GROUP, ',') : LOCAL_WORDS.notReported);

/** A size in bytes as MB or GB with one decimal, or "not reported". 0 is a real size and reads "0 MB". */
export function formatBytes(n: number | null): string {
  if (!finite(n)) return LOCAL_WORDS.notReported;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  return `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)} MB`;
}

/** A speed as "12.3 tokens/s", or "not reported". */
export const formatRate = (n: number | null): string => (finite(n) ? `${n.toFixed(1)} tokens/s` : LOCAL_WORDS.notReported);

/** The last part of a path, whatever the separator. A folder never shows, even if a server sent one. */
export function baseName(value: string | null): string | null {
  if (value === null) return null;
  const last = value.split(/[\\/]/).filter(part => part !== '').pop();
  return last === undefined ? null : last;
}

/** Context use as a whole percent from 0 to 100, or null when either figure is missing or the size is 0. */
export function contextPercent(peak: number | null, size: number | null): number | null {
  if (!finite(peak) || !finite(size) || size === 0) return null;
  return Math.min(100, Math.max(0, Math.round((peak / size) * 100)));
}

export function contextWords(model: LocalModel): string {
  const pct = contextPercent(model.contextUsedPeak, model.contextSize);
  if (pct === null) return model.contextSize === null ? LOCAL_WORDS.notReported : `${formatCount(model.contextUsedPeak)} of ${formatCount(model.contextSize)}`;
  return `${pct}% (${formatCount(model.contextUsedPeak)} of ${formatCount(model.contextSize)})`;
}

export function requestsWords(model: LocalModel): string {
  if (model.activeRequests === null) return LOCAL_WORDS.notReported;
  const waiting = model.deferredRequests !== null && model.deferredRequests > 0 ? `, ${model.deferredRequests} waiting` : '';
  return `${model.activeRequests} active${waiting}`;
}

export interface Fact { readonly key: string; readonly label: string; readonly value: string; readonly reported: boolean }

/** The figures of one row, in a fixed order. Memory and uptime are always present: no process is read, so they read "not reported". */
export function factsOf(model: LocalModel): readonly Fact[] {
  const fact = (key: string, label: string, value: string, given: boolean): Fact => ({ key, label, value, reported: given });
  const file = baseName(model.modelFile);
  return Object.freeze([
    fact('file', 'Model file', file ?? LOCAL_WORDS.notReported, file !== null),
    fact('quantization', 'Quantization', model.quantization ?? LOCAL_WORDS.notReported, model.quantization !== null),
    fact('size', 'Size', formatBytes(model.fileBytes), finite(model.fileBytes)),
    fact('context', 'Context size', formatCount(model.contextSize), finite(model.contextSize)),
    fact('speed', 'Speed', formatRate(model.generationTokensPerSecond), finite(model.generationTokensPerSecond)),
    fact('requests', 'Requests', requestsWords(model), model.activeRequests !== null),
    fact('use', 'Context use', contextWords(model), model.contextSize !== null),
    fact('memory', 'Memory', LOCAL_WORDS.notReported, false),
    fact('uptime', 'Uptime', LOCAL_WORDS.notReported, false),
  ]);
}

export interface Row {
  readonly id: string;
  readonly name: string;
  readonly stateText: string;
  readonly tone: Tone;
  /** A plain sentence for a state that is not "up", or null. */
  readonly why: string | null;
  /** True for a card that shows only the title, the state and the reason: it has no facts and no notes. */
  readonly compact: boolean;
  readonly facts: readonly Fact[];
  /** The row's own notes as plain sentences, when the report carries them (a later report version). Empty when it does not. */
  readonly notes: readonly string[];
}

const NOTE_WORDS: Readonly<Record<string, string>> = Object.freeze({
  PARTIAL_READ: 'Some figures of this server could not be read.', METRICS_OFF: 'This server runs without metrics, so speed and request figures are not reported.',
  METRICS_UNREADABLE: 'The metrics of this server could not be read.',
});

/** The notes a row carries, if any. Reads an array of { code, text } or of codes; anything else is no notes. */
export function rowNotes(model: LocalModel): readonly string[] {
  const raw = (model as { notes?: unknown }).notes;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const code = typeof item === 'string' ? item : item !== null && typeof item === 'object' && typeof (item as { code?: unknown }).code === 'string' ? (item as { code: string }).code : null;
    const text = item !== null && typeof item === 'object' && typeof (item as { text?: unknown }).text === 'string' ? (item as { text: string }).text : null;
    const words = text ?? (code === null ? null : NOTE_WORDS[code] ?? null);
    if (words !== null && !out.includes(words)) out.push(words);
  }
  return Object.freeze(out);
}

/** The file ending that a model file name carries. Only this one is cut: a dot inside a name ("Name-3.5-9B") is not an ending. */
const FILE_ENDING = /\.gguf$/i;
/** A quantization suffix, with the separator before it: "-Q8_0", "-Q4_K_M", "-IQ3_XS", "-MXFP4", "-F16", "-BF16". */
const QUANT_SUFFIX = /[-_.](?:I?Q\d(?:_[A-Z0-9]+)*|MXFP\d|BF16|F16|F32)$/i;

/** The title of a card: the model name without its ending and quantization, then the port. With no model name, the file base name without its ending. With neither, the kind of server. */
export function titleOf(model: LocalModel): string {
  const named = baseName(model.modelName);
  let what: string;
  if (named !== null) {
    what = named.replace(FILE_ENDING, '');
    const quant = model.quantization;
    if (quant !== null && quant !== '' && what.toLowerCase().endsWith(`-${quant}`.toLowerCase())) what = what.slice(0, what.length - quant.length - 1);
    else what = what.replace(QUANT_SUFFIX, '');
    if (what === '') what = named;
  } else {
    const file = baseName(model.modelFile);
    what = file === null ? model.provider : file.replace(FILE_ENDING, '') || file;
  }
  return `${what} \u00b7 port ${model.port}`;
}

/** A server that is down, not answering or starting has nothing to show but its state and the reason, so its card is compact. */
const COMPACT_STATES: readonly ModelState[] = Object.freeze(['down', 'unreachable', 'starting'] as ModelState[]);

export function rowOf(model: LocalModel): Row {
  const compact = COMPACT_STATES.includes(model.state);
  return Object.freeze({
    id: model.id, name: titleOf(model), stateText: stateWords(model.state), tone: stateTone(model.state), why: model.state === 'up' ? null : reasonWords(model.stateReason),
    compact, facts: compact ? Object.freeze([]) : factsOf(model), notes: compact ? Object.freeze([]) : rowNotes(model),
  });
}

/** Up first, then starting, not answering, not supported and down; then by name, then by port. */
export function sortModels(models: readonly LocalModel[]): readonly LocalModel[] {
  return [...models].sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || (baseName(a.modelName) ?? '').localeCompare(baseName(b.modelName) ?? '') || a.port - b.port);
}

export type ReportView =
  /** The probe itself failed: the report holds no servers and no count. Only the note's sentence is shown. */
  | { readonly kind: 'probe-failed'; readonly sentences: readonly string[]; readonly rows: readonly []; readonly summary: null }
  | { readonly kind: 'empty'; readonly sentences: readonly string[]; readonly rows: readonly []; readonly summary: string }
  | { readonly kind: 'rows'; readonly sentences: readonly string[]; readonly rows: readonly Row[]; readonly summary: string };

const noteSentence = (note: LocalModelsNote): string => note.text;

/** "2 up, 1 down", or "None up" when nothing is up. */
export function summaryOf(models: readonly LocalModel[]): string {
  const up = models.filter(m => m.state === 'up').length, down = models.filter(m => m.state === 'down').length, other = models.length - up - down;
  const parts = [`${up} up`, ...(down > 0 ? [`${down} down`] : []), ...(other > 0 ? [`${other} not ready`] : [])];
  return parts.join(', ');
}

/**
 * What the screen shows for a report. A PROBE_FAILED note means the report is empty because the read failed, not because no server is set up: the note's sentence is shown
 * instead of the empty state and instead of any count. Every other note is shown as its plain sentence, such as PARTIAL_READ.
 */
export function viewOf(report: LocalModelsReport): ReportView {
  const sentences = report.notes.map(noteSentence);
  if (report.notes.some(n => n.code === 'PROBE_FAILED')) return Object.freeze({ kind: 'probe-failed', sentences: Object.freeze(sentences), rows: Object.freeze([]) as readonly [], summary: null });
  if (report.models.length === 0) return Object.freeze({ kind: 'empty', sentences: Object.freeze(sentences.filter((_, i) => report.notes[i]!.code !== 'NO_ENDPOINTS')), rows: Object.freeze([]) as readonly [], summary: summaryOf([]) });
  return Object.freeze({ kind: 'rows', sentences: Object.freeze(sentences), rows: Object.freeze(sortModels(report.models).map(rowOf)), summary: summaryOf(report.models) });
}

/** True when the last good read is older than the limit, or the last call failed. `now` and `sampledAt` are milliseconds. */
export const STALE_AFTER_MS = 10_000;
export const REFRESH_MS = 3_000;
export const isStale = (failed: boolean, sampledAt: number | null, now: number): boolean => failed || (sampledAt !== null && now - sampledAt > STALE_AFTER_MS);
