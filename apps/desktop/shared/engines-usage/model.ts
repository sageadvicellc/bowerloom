/**
 * The model of the Engines and usage module (v0.9 lane 5): one row for each engine Bowerloom detects, with its config and its usage. Pure: no React, no clock, no file, no random number. A terminal view could reuse it.
 *
 * Config comes from the state the page already holds (what the reader of the person's folders found). It is counts, names and one line about each connection. A connection with a secret in its config
 * carries one flag, `secretSet`, and nothing else about the secret: no name of a variable or header, and no value. Every string that comes from the state is scrubbed once more here before it is shown.
 *
 * Usage comes from the figures that the session logs held, through the two read calls of the runs bridge (read.ts). Each number shown is a sum of numbers that were read. A figure that no log held is "Not read":
 * it is never a zero and never a guess, and the line says from how many runs it was read. A reason why a figure is missing uses the words of the log reader (shared/harness/runs-real.ts).
 */
import { ENGINE_IDS } from '../engine/engines.js';
import { ENGINE_NAMES } from '../engine/types.js';
import type { EngineId } from '../engine/types.js';
import type { RunFigures, RunView } from '../api/runs.js';
import { countWords as numberWords, durationWords, figuresStateWords, runsRefusalWords } from '../harness/runs-real.js';
import { hasWriter } from '../harness/types.js';
import type { HarnessState, Interface, Part, ScanSource } from '../harness/types.js';
import { cleanLine, cut, scrubText } from '../real/redact.js';

/** The most runs whose logs are read. The newest are read first, and the view says when older runs were left out. */
export const USAGE_RUN_CAP = 50;
/** The most connections and folders one row lists. The count is always the whole count. */
export const CONNECTIONS_SHOWN = 12;
export const PLACES_SHOWN = 6;

export const ENGINES_WORDS = Object.freeze({
  title: 'Engines and usage',
  hint: 'What each engine has set up on this computer, and what its session logs say it used. A figure that was not read shows as Not read.',
  sample: 'The sample has no session logs, so it shows no usage. Your own folders show it.',
  noBridge: 'This window cannot read the run record, so usage is not shown.',
  loading: 'Reading the session logs.',
  noRuns: 'No run is recorded for this engine, so there is nothing to read. Record a run in Runs.',
  countsLow: 'The read stopped early or read only part of your folders. The counts can be low.',
  countedOnce: 'A part found in two engines counts once, under the first.',
  notRead: 'Bowerloom reads no folder of this engine yet.',
  emptyEngine: 'Bowerloom found no skill, agent, connection, hook or saved prompt in its folders.',
  none: 'No engine was found, and no run is recorded.',
  secretSet: 'Secret: set',
  secretNotChecked: 'Secret: not checked',
  unknownEngines: (count: number): string => `${count} ${count === 1 ? 'run names' : 'runs name'} an engine this app does not know. ${count === 1 ? 'It is' : 'They are'} not counted.`,
  orphans: (count: number): string => `${count} ${count === 1 ? 'part has' : 'parts have'} no known folder, so ${count === 1 ? 'it is' : 'they are'} not counted.`,
  noneRead: (total: number): string => `None of the ${total} ${total === 1 ? 'run was' : 'runs were'} read. Only the newest ${USAGE_RUN_CAP} runs are read.`,
  lastReadFailed: (words: string): string => `The last read failed. ${words} These are the figures of the read before it.`,
  readAgain: 'Read again',
  reading: 'Reading',
  listLabel: 'Engines',
  configTitle: 'Config',
  usageTitle: 'Usage',
  connectionsTitle: 'Connections',
  foldersTitle: 'Folders read',
  more: (count: number): string => `and ${count} more`,
  cut: (read: number, total: number): string => `Read the newest ${read} of ${total} runs. Older runs are not counted.`,
});

/** What reading one run's log gave: its figures, or the short code of the refusal. A refusal is never a figure. */
export type FigureRead = { readonly kind: 'figures'; readonly figures: RunFigures } | { readonly kind: 'refused'; readonly code: string };

/** Where the usage figures stand. `sample`: the sample launch has no logs. `no-bridge`: the window has no runs bridge. `ready`: `runs` is the whole list, `reads` holds the runs whose log was read, `total` is the whole count. */
export type UsageSource =
  | { readonly kind: 'sample' } | { readonly kind: 'no-bridge' } | { readonly kind: 'loading' } | { readonly kind: 'failed'; readonly code: string }
  | { readonly kind: 'ready'; readonly runs: readonly RunView[]; readonly reads: ReadonlyMap<string, FigureRead>; readonly total: number; /** The short code of a later read that failed. These figures are the ones of the read before it. */ readonly lastReadFailed?: string };

/** One line of a row: a label and a value. `reported` is false for a gap ("Not read"), so the screen can show it quietly. */
export interface Fact { readonly key: string; readonly label: string; readonly value: string; readonly reported: boolean }
/** `secretSet`: the reader found a secret in the config. `secretNotChecked`: the read was partial and found none, which does not prove there is none. Both false: the whole read found none. */
export interface ConnectionView { readonly name: string; readonly summary: string; readonly secretSet: boolean; readonly secretNotChecked: boolean }
export interface EngineRowView {
  readonly id: string;
  readonly name: string;
  readonly state: 'ready' | 'problem' | 'not-found';
  readonly stateWords: string;
  readonly config: readonly Fact[];
  readonly configNotes: readonly string[];
  readonly places: readonly string[];
  readonly morePlaces: number;
  readonly connections: readonly ConnectionView[];
  readonly moreConnections: number;
  readonly usage: readonly Fact[];
  readonly usageNotes: readonly string[];
}
export interface EnginesView { readonly rows: readonly EngineRowView[]; readonly notes: readonly string[] }

/** The part of the state the view reads. */
export type ConfigState = Pick<HarnessState, 'interfaces' | 'parts' | 'sources' | 'real'>;

const GAP = 'Not read';
const plain = (text: string, max = 120): string => cut(cleanLine(scrubText(text)), max);
const fact = (key: string, label: string, value: string, reported = true): Fact => ({ key, label, value, reported });
const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

// ---- config

interface Tally { skills: number; agents: number; hooks: number; prompts: number; connections: Part[] }
const emptyTally = (): Tally => ({ skills: 0, agents: 0, hooks: 0, prompts: 0, connections: [] });

/** The parts of each engine, by the name of the engine that its source was read for. A part found in two engines is one part with one source, so it counts once. */
function tallyParts(parts: readonly Part[], sources: readonly ScanSource[]): { readonly tallies: Map<string, Tally>; readonly orphans: number } {
  const sourceById = new Map<string, ScanSource>();
  for (const source of sources) sourceById.set(source.id, source);
  const tallies = new Map<string, Tally>();
  let orphans = 0;
  for (const part of parts) {
    const source = sourceById.get(part.origin);
    if (source === undefined) { orphans += 1; continue; }
    let tally = tallies.get(source.interfaceName);
    if (tally === undefined) { tally = emptyTally(); tallies.set(source.interfaceName, tally); }
    if (part.kind === 'skill') tally.skills += 1;
    else if (part.kind === 'agent') tally.agents += 1;
    else if (part.kind === 'tool') {
      if (part.toolKind === 'hook') tally.hooks += 1;
      else if (part.toolKind === 'prompt') tally.prompts += 1;
      else if (part.toolKind === 'mcp') tally.connections.push(part);
    }
  }
  return { tallies, orphans };
}

/** The folders each engine was read in, written with `~`, each once, in the order of the sources. */
function foldersOf(sources: readonly ScanSource[]): Map<string, string[]> {
  const found = new Map<string, Set<string>>();
  for (const source of sources) {
    const label = plain(source.label ?? source.name, 100);
    if (label === '') continue;
    let set = found.get(source.interfaceName);
    if (set === undefined) { set = new Set(); found.set(source.interfaceName, set); }
    set.add(label);
  }
  return new Map([...found].map(([name, set]) => [name, [...set]]));
}

const connectionOf = (part: Part, partial: boolean): ConnectionView => ({ name: plain(part.name, 80), summary: plain(part.description === '' ? part.summary : part.description, 120), secretSet: part.hasSecret === true, secretNotChecked: partial && part.hasSecret !== true });

// ---- usage

interface Usage { readonly facts: readonly Fact[]; readonly notes: readonly string[] }

/**
 * "1,500 (from 2 of 3 runs, may be low)". The number is the sum of the numbers that the logs held. The words inside the brackets say what is not whole: some runs gave none, a log was capped or read in part (the sum can be
 * low), or a log may still be written (the sum can change). A clean sum has no brackets. When no run gave the figure, it is a gap.
 */
function figureFact(key: string, label: string, found: readonly RunFigures[], pick: (f: RunFigures) => number | null, format: (n: number) => string, read: number): Fact {
  let sum = 0, from = 0, low = false, change = false;
  for (const f of found) {
    const value = pick(f);
    if (value === null) continue;
    sum += value; from += 1;
    if (f.reason === 'capped' || f.reason === 'partial') low = true;
    if (f.reason === 'still-writing') change = true;
  }
  if (from === 0) return fact(key, label, GAP, false);
  const marks = [...(from < read ? [`from ${from} of ${read} runs`] : []), ...(low ? ['may be low'] : []), ...(change ? ['may change'] : [])];
  return fact(key, label, marks.length === 0 ? format(sum) : `${format(sum)} (${marks.join(', ')})`);
}

function usageOfEngine(runs: readonly RunView[], reads: ReadonlyMap<string, FigureRead>): Usage {
  if (runs.length === 0) return { facts: [fact('runs', 'Runs recorded', '0')], notes: [ENGINES_WORDS.noRuns] };
  const got: FigureRead[] = [];
  for (const run of runs) { const one = reads.get(run.id); if (one !== undefined) got.push(one); }
  const found: RunFigures[] = [];
  const notes = new Map<string, { count: number; words: string }>();
  const note = (key: string, words: string): void => { const known = notes.get(key); if (known === undefined) notes.set(key, { count: 1, words }); else known.count += 1; };
  for (const one of got) {
    if (one.kind === 'refused') { note(`refused|${one.code}`, runsRefusalWords(one.code)); continue; }
    if (one.figures.state === 'found') found.push(one.figures);
    const words = figuresStateWords(one.figures.state, one.figures.reason, null);
    if (words !== null) note(`figures|${one.figures.state}|${one.figures.reason ?? ''}`, words);
  }
  const models = [...new Set(found.flatMap(f => (f.model === null ? [] : [plain(f.model, 80)])))].sort();
  return {
    facts: [
      fact('runs', 'Runs recorded', String(runs.length)),
      got.length === 0 ? fact('logs-read', 'Logs read', ENGINES_WORDS.noneRead(runs.length), false) : fact('logs-read', 'Logs read', `${found.length} of ${runs.length}`),
      figureFact('input', 'Input', found, f => f.inputTokens, numberWords, got.length),
      figureFact('output', 'Output', found, f => f.outputTokens, numberWords, got.length),
      figureFact('time', 'Time in runs', found, f => f.durationMs, durationWords, got.length),
      models.length === 0 ? fact('models', 'Models', GAP, false) : fact('models', 'Models', models.join(', ')),
    ],
    notes: [...notes.values()].map(n => `${plural(n.count, 'run', 'runs')}: ${n.words}`),
  };
}

function usageFor(source: UsageSource, runsOf: (id: string) => readonly RunView[]): (id: string) => Usage {
  switch (source.kind) {
    case 'sample': return () => ({ facts: [], notes: [ENGINES_WORDS.sample] });
    case 'no-bridge': return () => ({ facts: [], notes: [ENGINES_WORDS.noBridge] });
    case 'loading': return () => ({ facts: [], notes: [ENGINES_WORDS.loading] });
    case 'failed': return () => ({ facts: [], notes: [runsRefusalWords(source.code)] });
    case 'ready': return id => usageOfEngine(runsOf(id), source.reads);
  }
}

// ---- the view

const isEngine = (id: string): id is EngineId => (ENGINE_IDS as readonly string[]).includes(id);

/** The runs of each engine, and how many runs name a thing that is no engine of the app. Those are left out of every row, and the view counts them in one note. */
function runsByEngine(source: UsageSource): { readonly by: Map<string, RunView[]>; readonly unknown: number } {
  const by = new Map<string, RunView[]>();
  let unknown = 0;
  if (source.kind !== 'ready') return { by, unknown };
  for (const run of source.runs) {
    if (!isEngine(run.engine)) { unknown += 1; continue; }
    const list = by.get(run.engine);
    if (list === undefined) by.set(run.engine, [run]); else list.push(run);
  }
  return { by, unknown };
}

const STATE_OF: Readonly<Record<Interface['health'], EngineRowView['state']>> = Object.freeze({ ready: 'ready', problem: 'problem', 'not-found': 'not-found' });
/** A health word the app does not know is a problem: it is never read as "not found", which would say that nothing is there. */
const stateOf = (health: string): EngineRowView['state'] => (Object.hasOwn(STATE_OF, health) ? STATE_OF[health as Interface['health']] : 'problem');

export function enginesView(state: ConfigState, source: UsageSource): EnginesView {
  const { tallies, orphans } = tallyParts(state.parts, state.sources), folders = foldersOf(state.sources);
  const { by: runsBy, unknown } = runsByEngine(source), usageOf = usageFor(source, id => runsBy.get(id) ?? []);
  const partialRead = state.real?.stoppedEarly === true || state.real?.onlyPartRead === true;
  const rows: EngineRowView[] = [];
  const seen = new Set<string>();
  for (const iface of state.interfaces) {
    seen.add(iface.id);
    const name = plain(iface.name, 60), health = stateOf(iface.health), found = health !== 'not-found';
    const tally = tallies.get(iface.name) ?? emptyTally(), places = folders.get(iface.name) ?? [];
    // A count after a partial read, or for an engine whose config has a problem, can be low. It says so, and a 0 is never bare.
    const count = (n: number): string => (partialRead || health === 'problem' ? `${n} (may be low)` : String(n));
    const config: Fact[] = [fact('status', 'Status', plain(iface.healthWords, 80)), fact('found-at', 'Where it was found', plain(iface.foundAt, 160))];
    const configNotes: string[] = [];
    if (found) {
      config.push(
        fact('offered', 'Offered when you install or start', iface.on ? 'Yes' : 'No'), fact('writes', 'Bowerloom writes its files', hasWriter(iface.id) ? 'Yes' : 'Not yet'),
        fact('skills', 'Skills', count(tally.skills)), fact('agents', 'Agents', count(tally.agents)), fact('connections', 'Connections', count(tally.connections.length)),
        fact('hooks', 'Hooks', count(tally.hooks)), fact('prompts', 'Saved prompts', count(tally.prompts)), fact('folders', 'Folders read', count(places.length)),
      );
      if (tally.skills + tally.agents + tally.hooks + tally.prompts + tally.connections.length === 0) configNotes.push(ENGINES_WORDS.emptyEngine);
    }
    const usage = usageOf(iface.id);
    rows.push({
      id: iface.id, name, state: health, stateWords: plain(iface.healthWords, 80), config, configNotes,
      places: places.slice(0, PLACES_SHOWN), morePlaces: Math.max(0, places.length - PLACES_SHOWN),
      connections: tally.connections.slice(0, CONNECTIONS_SHOWN).map(c => connectionOf(c, partialRead)), moreConnections: Math.max(0, tally.connections.length - CONNECTIONS_SHOWN),
      usage: usage.facts, usageNotes: usage.notes,
    });
  }
  // An engine that has runs and that Bowerloom reads no folder of: its usage is shown, and its config is not claimed.
  for (const id of ENGINE_IDS) {
    if (seen.has(id) || !runsBy.has(id)) continue;
    const usage = usageOf(id);
    rows.push({
      id, name: ENGINE_NAMES[id], state: 'not-found', stateWords: ENGINES_WORDS.notRead, config: [fact('status', 'Status', ENGINES_WORDS.notRead)], configNotes: [], places: [], morePlaces: 0, connections: [], moreConnections: 0,
      usage: usage.facts, usageNotes: usage.notes,
    });
  }
  const notes: string[] = [];
  if (rows.some(r => r.state !== 'not-found')) {
    if (partialRead) notes.push(ENGINES_WORDS.countsLow);
    notes.push(ENGINES_WORDS.countedOnce);
  }
  if (orphans > 0) notes.push(ENGINES_WORDS.orphans(orphans));
  if (source.kind === 'ready') {
    if (unknown > 0) notes.push(ENGINES_WORDS.unknownEngines(unknown));
    const known = source.runs.length - unknown;
    if (known > source.reads.size) notes.push(ENGINES_WORDS.cut(source.reads.size, known));
    if (source.lastReadFailed !== undefined) notes.push(ENGINES_WORDS.lastReadFailed(runsRefusalWords(source.lastReadFailed)));
  }
  return { rows, notes };
}
