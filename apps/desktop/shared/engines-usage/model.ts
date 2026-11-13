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
  | { readonly kind: 'ready'; readonly runs: readonly RunView[]; readonly reads: ReadonlyMap<string, FigureRead>; readonly total: number };

/** One line of a row: a label and a value. `reported` is false for a gap ("Not read"), so the screen can show it quietly. */
export interface Fact { readonly key: string; readonly label: string; readonly value: string; readonly reported: boolean }
export interface ConnectionView { readonly name: string; readonly summary: string; readonly secretSet: boolean }
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
function tallyParts(parts: readonly Part[], sources: readonly ScanSource[]): Map<string, Tally> {
  const sourceById = new Map<string, ScanSource>();
  for (const source of sources) sourceById.set(source.id, source);
  const tallies = new Map<string, Tally>();
  for (const part of parts) {
    const source = sourceById.get(part.origin);
    if (source === undefined) continue;
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
  return tallies;
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

const connectionOf = (part: Part): ConnectionView => ({ name: plain(part.name, 80), summary: plain(part.description === '' ? part.summary : part.description, 120), secretSet: part.hasSecret === true });

// ---- usage

interface Usage { readonly facts: readonly Fact[]; readonly notes: readonly string[] }

const sumOf = (values: readonly (number | null)[]): { readonly sum: number; readonly from: number } => {
  let sum = 0, from = 0;
  for (const value of values) if (value !== null) { sum += value; from += 1; }
  return { sum, from };
};

/** "1,500 (from 2 of 3 runs)", or the plain number when every run that was read gave one, or a gap when none did. */
function figureFact(key: string, label: string, values: readonly (number | null)[], format: (n: number) => string, read: number): Fact {
  const { sum, from } = sumOf(values);
  if (from === 0) return fact(key, label, GAP, false);
  return fact(key, label, from < read ? `${format(sum)} (from ${from} of ${read} runs)` : format(sum));
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
      fact('logs-read', 'Logs read', `${found.length} of ${got.length}`),
      figureFact('input', 'Input', found.map(f => f.inputTokens), numberWords, got.length),
      figureFact('output', 'Output', found.map(f => f.outputTokens), numberWords, got.length),
      figureFact('time', 'Time in runs', found.map(f => f.durationMs), durationWords, got.length),
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

/** The runs of each engine. A run of a name that is no engine of the app is left out. */
function runsByEngine(source: UsageSource): Map<string, RunView[]> {
  const by = new Map<string, RunView[]>();
  if (source.kind !== 'ready') return by;
  for (const run of source.runs) {
    if (!isEngine(run.engine)) continue;
    const list = by.get(run.engine);
    if (list === undefined) by.set(run.engine, [run]); else list.push(run);
  }
  return by;
}

const STATE_OF: Readonly<Record<Interface['health'], EngineRowView['state']>> = Object.freeze({ ready: 'ready', problem: 'problem', 'not-found': 'not-found' });

export function enginesView(state: ConfigState, source: UsageSource): EnginesView {
  const tallies = tallyParts(state.parts, state.sources), folders = foldersOf(state.sources);
  const runsBy = runsByEngine(source), usageOf = usageFor(source, id => runsBy.get(id) ?? []);
  const rows: EngineRowView[] = [];
  const seen = new Set<string>();
  for (const iface of state.interfaces) {
    seen.add(iface.id);
    const name = plain(iface.name, 60), health = STATE_OF[iface.health] ?? 'not-found', found = health !== 'not-found';
    const tally = tallies.get(iface.name) ?? emptyTally(), places = folders.get(iface.name) ?? [];
    const config: Fact[] = [fact('status', 'Status', plain(iface.healthWords, 80)), fact('found-at', 'Where it was found', plain(iface.foundAt, 160))];
    const configNotes: string[] = [];
    if (found) {
      config.push(
        fact('offered', 'Offered when you install or start', iface.on ? 'Yes' : 'No'), fact('writes', 'Bowerloom writes its files', hasWriter(iface.id) ? 'Yes' : 'Not yet'),
        fact('skills', 'Skills', String(tally.skills)), fact('agents', 'Agents', String(tally.agents)), fact('connections', 'Connections', String(tally.connections.length)),
        fact('hooks', 'Hooks', String(tally.hooks)), fact('prompts', 'Saved prompts', String(tally.prompts)), fact('folders', 'Folders read', String(places.length)),
      );
      if (tally.skills + tally.agents + tally.hooks + tally.prompts + tally.connections.length === 0) configNotes.push(ENGINES_WORDS.emptyEngine);
    }
    const usage = usageOf(iface.id);
    rows.push({
      id: iface.id, name, state: health, stateWords: plain(iface.healthWords, 80), config, configNotes,
      places: places.slice(0, PLACES_SHOWN), morePlaces: Math.max(0, places.length - PLACES_SHOWN),
      connections: tally.connections.slice(0, CONNECTIONS_SHOWN).map(connectionOf), moreConnections: Math.max(0, tally.connections.length - CONNECTIONS_SHOWN),
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
    if (state.real?.stoppedEarly === true || state.real?.onlyPartRead === true) notes.push(ENGINES_WORDS.countsLow);
    notes.push(ENGINES_WORDS.countedOnce);
  }
  if (source.kind === 'ready' && source.total > source.reads.size) notes.push(ENGINES_WORDS.cut(source.reads.size, source.total));
  return { rows, notes };
}
