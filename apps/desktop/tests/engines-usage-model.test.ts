// The model of the Engines and usage module (shared/engines-usage/model.ts): one row for each engine Bowerloom detects, with its config read from the state the page already holds and its usage
// summed from figures that the session logs held. A figure that was not read shows as a gap ("Not read") and is never a zero or a guess. Every number is a sum of numbers that were read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ENGINES_WORDS, CONNECTIONS_SHOWN, PLACES_SHOWN, USAGE_RUN_CAP, enginesView } from '../shared/engines-usage/model.js';
import type { EngineRowView, FigureRead, UsageSource } from '../shared/engines-usage/model.js';
import { figuresStateWords, runsRefusalWords, countWords as numberWords } from '../shared/harness/runs-real.js';
import { bannedHere } from '../shared/harness/words.js';
import { NO_FIGURES, fakeFigures, fakePart, fakeRun, fakeSource, FAKE_KEY, deepFreeze, setupState, stringsIn } from './engines-usage-fixture.js';
import type { RunView } from '../shared/api/runs.js';

const none: UsageSource = { kind: 'ready', runs: [], reads: new Map(), total: 0 };
const fact = (row: EngineRowView, group: 'config' | 'usage', key: string) => row[group].find(f => f.key === key);
const valueOf = (row: EngineRowView, group: 'config' | 'usage', key: string): string | undefined => fact(row, group, key)?.value;
const rowOf = (rows: readonly EngineRowView[], id: string): EngineRowView => { const row = rows.find(r => r.id === id); assert.ok(row, id); return row; };
const read = (figures: ReturnType<typeof fakeFigures>): FigureRead => ({ kind: 'figures', figures });
function ready(runs: readonly RunView[], reads: Record<string, FigureRead>, total = runs.length): UsageSource {
  return { kind: 'ready', runs, reads: new Map(Object.entries(reads)), total };
}

// ---- the rows

test('one row for each engine Bowerloom detects, in the order of the engines, named as a person says them', () => {
  const view = enginesView(setupState(), none);
  assert.deepEqual(view.rows.map(r => r.id), ['claude-code', 'codex', 'opencode']);
  assert.deepEqual(view.rows.map(r => r.name), ['Claude Code', 'Codex', 'OpenCode']);
  assert.deepEqual(view.rows.map(r => r.state), ['ready', 'ready', 'not-found']);
});

test('a found engine shows its state, where it was found, whether the sheets offer it, and whether Bowerloom writes its files', () => {
  const rows = enginesView(setupState(), none).rows;
  const claude = rowOf(rows, 'claude-code'), codex = rowOf(rows, 'codex');
  assert.equal(valueOf(claude, 'config', 'status'), 'Ready');
  assert.equal(valueOf(claude, 'config', 'found-at'), 'Found at ~/.claude');
  assert.equal(valueOf(claude, 'config', 'offered'), 'Yes');
  assert.equal(valueOf(claude, 'config', 'writes'), 'Yes');
  assert.equal(valueOf(codex, 'config', 'found-at'), 'Found at ~/.codex and ~/.agents');
  assert.equal(valueOf(codex, 'config', 'offered'), 'No');
});

test('the counts of each engine come from the parts its folders hold, and a found engine with nothing of a kind reads 0', () => {
  const rows = enginesView(setupState(), none).rows;
  const claude = rowOf(rows, 'claude-code'), codex = rowOf(rows, 'codex');
  assert.deepEqual(['skills', 'agents', 'connections', 'hooks', 'prompts'].map(k => valueOf(claude, 'config', k)), ['3', '1', '2', '1', '1']);
  assert.deepEqual(['skills', 'agents', 'connections', 'hooks', 'prompts'].map(k => valueOf(codex, 'config', k)), ['1', '0', '1', '0', '0']);
  assert.equal(valueOf(claude, 'config', 'folders'), '2');
  assert.deepEqual(claude.places, ['~', '~/Projects/alpha']);
  assert.deepEqual(codex.places, ['~']);
});

test('an engine that was not found shows its state and nothing it did not read: no count, no folder', () => {
  const opencode = rowOf(enginesView(setupState(), none).rows, 'opencode');
  assert.deepEqual(opencode.config.map(f => f.key), ['status', 'found-at']);
  assert.equal(valueOf(opencode, 'config', 'status'), 'Not found');
  assert.deepEqual(opencode.places, []); assert.deepEqual(opencode.connections, []);
});

test('an engine whose config file has a problem says so and keeps its counts', () => {
  const state = setupState();
  const problem = { ...state, interfaces: state.interfaces.map(i => (i.id === 'codex' ? { ...i, health: 'problem' as const, healthWords: 'Config file has a problem' } : i)) };
  const codex = rowOf(enginesView(problem, none).rows, 'codex');
  assert.equal(codex.state, 'problem'); assert.equal(valueOf(codex, 'config', 'status'), 'Config file has a problem'); assert.equal(valueOf(codex, 'config', 'skills'), '1 (may be low)', 'a count after a config problem can be low');
  assert.equal(valueOf(codex, 'config', 'hooks'), '0 (may be low)', 'never a bare 0');
});

test('the connections of an engine are listed by name with a line about each, and the secret is only "set"', () => {
  const claude = rowOf(enginesView(setupState(), none).rows, 'claude-code');
  assert.deepEqual(claude.connections, [
    { name: 'tracker', summary: 'Starts node on this computer.', secretSet: true, secretNotChecked: false },
    { name: 'docs', summary: 'Connects to docs.example.test.', secretSet: false, secretNotChecked: false },
  ]);
  assert.equal(claude.moreConnections, 0);
});

test('a long list is cut at a fixed length and says how many more there are', () => {
  const state = setupState();
  const many = Array.from({ length: CONNECTIONS_SHOWN + 3 }, (_, i) => fakePart(`many-${i}`, 'tool', `server-${i}`, 'src-cc-home', { toolKind: 'mcp' }));
  const folders = Array.from({ length: PLACES_SHOWN + 2 }, (_, i) => fakeSource(`src-extra-${i}`, 'Codex', `~/Projects/p${i}`, [], 'project'));
  const view = enginesView({ ...state, parts: [...state.parts, ...many], sources: [...state.sources, ...folders] }, none);
  const claude = rowOf(view.rows, 'claude-code'), codex = rowOf(view.rows, 'codex');
  assert.equal(claude.connections.length, CONNECTIONS_SHOWN); assert.equal(claude.moreConnections, 5);
  assert.equal(valueOf(claude, 'config', 'connections'), String(CONNECTIONS_SHOWN + 5), 'the count is the whole count, not the shown count');
  assert.equal(codex.places.length, PLACES_SHOWN); assert.equal(codex.morePlaces, 3);
  assert.equal(valueOf(codex, 'config', 'folders'), String(PLACES_SHOWN + 3));
});

test('a read that stopped early, or read only part, says that the counts can be low', () => {
  const state = setupState();
  for (const real of [{ ...state.real!, stoppedEarly: true }, { ...state.real!, onlyPartRead: true }]) {
    const view = enginesView({ ...state, real }, none);
    assert.ok(view.notes.includes(ENGINES_WORDS.countsLow), JSON.stringify(real));
  }
  assert.deepEqual(enginesView(state, none).notes.filter(n => n === ENGINES_WORDS.countsLow), []);
});

test('a part found in two engines is counted once, and the view says so in one line', () => {
  assert.ok(enginesView(setupState(), none).notes.includes(ENGINES_WORDS.countedOnce));
});

// ---- usage

test('usage is the sum of the figures that were read, per engine, and says from how many runs', () => {
  const runs = [fakeRun('run-1', 'claude-code', '2026-11-11T10:00:00.000Z'), fakeRun('run-2', 'claude-code', '2026-11-11T09:00:00.000Z'), fakeRun('run-3', 'claude-code', '2026-11-11T08:00:00.000Z'), fakeRun('run-4', 'codex', '2026-11-11T07:00:00.000Z')];
  const source = ready(runs, {
    'run-1': read(fakeFigures({ inputTokens: 1000, outputTokens: 200, durationMs: 60_000, model: 'model-b' })),
    'run-2': read(fakeFigures({ inputTokens: 500, outputTokens: 100, durationMs: 120_000, model: 'model-a' })),
    'run-3': read(NO_FIGURES('not-found')),
    'run-4': read(fakeFigures({ inputTokens: 7, outputTokens: 9, durationMs: 1000, model: 'model-c' })),
  });
  const rows = enginesView(setupState(), source).rows;
  const claude = rowOf(rows, 'claude-code'), codex = rowOf(rows, 'codex');
  assert.equal(valueOf(claude, 'usage', 'runs'), '3');
  assert.equal(valueOf(claude, 'usage', 'logs-read'), '2 of 3');
  assert.equal(valueOf(claude, 'usage', 'input'), '1,500 (from 2 of 3 runs)');
  assert.equal(valueOf(claude, 'usage', 'output'), '300 (from 2 of 3 runs)');
  assert.equal(valueOf(claude, 'usage', 'time'), '3 minutes (from 2 of 3 runs)');
  assert.equal(valueOf(claude, 'usage', 'models'), 'model-a, model-b');
  assert.deepEqual(claude.usageNotes, ['1 run: ' + figuresStateWords('not-found', null, null)!]);
  assert.equal(valueOf(codex, 'usage', 'input'), '7'); assert.equal(valueOf(codex, 'usage', 'output'), '9'); assert.equal(valueOf(codex, 'usage', 'time'), '1 second');
  assert.deepEqual(codex.usageNotes, []);
});

test('a figure that no log held shows as a gap, "Not read", and never as 0, while a 0 that a log held is a 0', () => {
  const runs = [fakeRun('run-1', 'claude-code', '2026-11-11T10:00:00.000Z'), fakeRun('run-2', 'codex', '2026-11-11T09:00:00.000Z')];
  const source = ready(runs, {
    'run-1': read(fakeFigures({ inputTokens: null, outputTokens: 0, durationMs: null, model: null })),
    'run-2': read(fakeFigures({ inputTokens: 0, outputTokens: null })),
  });
  const rows = enginesView(setupState(), source).rows;
  const claude = rowOf(rows, 'claude-code'), codex = rowOf(rows, 'codex');
  assert.deepEqual([valueOf(claude, 'usage', 'input'), fact(claude, 'usage', 'input')!.reported], ['Not read', false]);
  assert.deepEqual([valueOf(claude, 'usage', 'output'), fact(claude, 'usage', 'output')!.reported], ['0', true]);
  assert.deepEqual([valueOf(claude, 'usage', 'time'), valueOf(claude, 'usage', 'models')], ['Not read', 'Not read']);
  assert.deepEqual([valueOf(codex, 'usage', 'input'), valueOf(codex, 'usage', 'output')], ['0', 'Not read']);
});

test('an engine whose logs Bowerloom cannot read gives no figure and says so with the words of the log reader', () => {
  const runs = [fakeRun('run-1', 'opencode', '2026-11-11T10:00:00.000Z'), fakeRun('run-2', 'opencode', '2026-11-11T09:00:00.000Z')];
  const source = ready(runs, { 'run-1': read(NO_FIGURES('not-available')), 'run-2': read(NO_FIGURES('not-available')) });
  const opencode = rowOf(enginesView(setupState(), source).rows, 'opencode');
  assert.equal(valueOf(opencode, 'usage', 'runs'), '2'); assert.equal(valueOf(opencode, 'usage', 'logs-read'), '0 of 2');
  assert.deepEqual(['input', 'output', 'time', 'models'].map(k => valueOf(opencode, 'usage', k)), ['Not read', 'Not read', 'Not read', 'Not read']);
  assert.deepEqual(opencode.usageNotes, ['2 runs: Figures are not available for this engine.']);
});

test('an engine with no recorded run shows 0 runs, no figure, and says there is nothing to read', () => {
  const claude = rowOf(enginesView(setupState(), none).rows, 'claude-code');
  assert.deepEqual(claude.usage.map(f => [f.key, f.value]), [['runs', '0']]);
  assert.deepEqual(claude.usageNotes, [ENGINES_WORDS.noRuns]);
});

test('a refused read counts as unread and carries the words of its code', () => {
  const runs = [fakeRun('run-1', 'codex', '2026-11-11T10:00:00.000Z')];
  const source = ready(runs, { 'run-1': { kind: 'refused', code: 'UNKNOWN_FOLDER' } });
  const codex = rowOf(enginesView(setupState(), source).rows, 'codex');
  assert.equal(valueOf(codex, 'usage', 'input'), 'Not read'); assert.equal(valueOf(codex, 'usage', 'logs-read'), '0 of 1');
  assert.deepEqual(codex.usageNotes, ['1 run: ' + runsRefusalWords('UNKNOWN_FOLDER')]);
});

test('a log that was found and read in part gives its own words, and no count', () => {
  const runs = [fakeRun('run-1', 'claude-code', '2026-11-11T10:00:00.000Z')];
  const source = ready(runs, { 'run-1': read(fakeFigures({ reason: 'partial', inputTokens: null, outputTokens: null })) });
  const claude = rowOf(enginesView(setupState(), source).rows, 'claude-code');
  assert.deepEqual(claude.usageNotes, ['1 run: ' + figuresStateWords('found', 'partial', null)!]);
  assert.equal(valueOf(claude, 'usage', 'input'), 'Not read');
});

test('notes of the same kind are counted together, and each kind has its own line', () => {
  const runs = [1, 2, 3].map(n => fakeRun(`run-${n}`, 'claude-code', `2026-11-11T0${n}:00:00.000Z`));
  const source = ready(runs, { 'run-1': read(NO_FIGURES('not-found')), 'run-2': read(NO_FIGURES('not-found')), 'run-3': read(NO_FIGURES('ambiguous')) });
  const claude = rowOf(enginesView(setupState(), source).rows, 'claude-code');
  assert.deepEqual([...claude.usageNotes].sort(), ['1 run: ' + figuresStateWords('ambiguous', null, null)!, '2 runs: ' + figuresStateWords('not-found', null, null)!].sort());
});

test('when the list of runs was cut, the view names how many were read and how many there are, and counts only what was read', () => {
  const runs = Array.from({ length: USAGE_RUN_CAP + 10 }, (_, i) => fakeRun(`run-${i + 1}`, 'claude-code', `2026-11-11T10:${String(i % 60).padStart(2, '0')}:00.000Z`));
  const reads: Record<string, FigureRead> = {};
  for (const run of runs.slice(0, USAGE_RUN_CAP)) reads[run.id] = read(fakeFigures({ inputTokens: 10 }));
  const view = enginesView(setupState(), ready(runs, reads, runs.length));
  const claude = rowOf(view.rows, 'claude-code');
  assert.equal(valueOf(claude, 'usage', 'runs'), String(USAGE_RUN_CAP + 10));
  assert.equal(valueOf(claude, 'usage', 'logs-read'), `${USAGE_RUN_CAP} of ${USAGE_RUN_CAP + 10}`, 'x of all the runs of the engine, not of the runs that were read');
  assert.equal(valueOf(claude, 'usage', 'input'), numberWords(USAGE_RUN_CAP * 10));
  assert.ok(view.notes.includes(ENGINES_WORDS.cut(USAGE_RUN_CAP, USAGE_RUN_CAP + 10)));
});

test('an engine that has runs and is not one of the three Bowerloom reads gets its own row, after them, and no config', () => {
  const runs = [fakeRun('run-1', 'pi', '2026-11-11T10:00:00.000Z')];
  const rows = enginesView(setupState(), ready(runs, { 'run-1': read(NO_FIGURES('not-available')) })).rows;
  assert.deepEqual(rows.map(r => r.id), ['claude-code', 'codex', 'opencode', 'pi']);
  const pi = rowOf(rows, 'pi');
  assert.equal(pi.name, 'Pi'); assert.equal(pi.state, 'not-found'); assert.equal(pi.stateWords, ENGINES_WORDS.notRead);
  assert.deepEqual(pi.config.map(f => f.key), ['status']);
  assert.equal(valueOf(pi, 'usage', 'runs'), '1');
});

test('a run of an engine that is no engine of the app does not make a row', () => {
  const runs = [fakeRun('run-1', 'nonesuch' as never, '2026-11-11T10:00:00.000Z')];
  assert.deepEqual(enginesView(setupState(), ready(runs, {})).rows.map(r => r.id), ['claude-code', 'codex', 'opencode']);
});

test('when the figures cannot be read yet, the view says why in one line for each row and shows no figure', () => {
  const cases: [UsageSource, string][] = [
    [{ kind: 'sample' }, ENGINES_WORDS.sample], [{ kind: 'no-bridge' }, ENGINES_WORDS.noBridge], [{ kind: 'loading' }, ENGINES_WORDS.loading], [{ kind: 'failed', code: 'STORE_DAMAGED' }, runsRefusalWords('STORE_DAMAGED')],
  ];
  for (const [source, words] of cases) {
    for (const row of enginesView(setupState(), source).rows) { assert.deepEqual(row.usage, [], source.kind); assert.deepEqual(row.usageNotes, [words], source.kind); }
  }
});

test('the sums are exact: the number shown is the sum of the numbers read, over many runs', () => {
  const runs = Array.from({ length: 200 }, (_, i) => fakeRun(`run-${i + 1}`, 'claude-code', `2026-11-11T10:00:${String(i % 60).padStart(2, '0')}.000Z`));
  const reads: Record<string, FigureRead> = {};
  let input = 0, output = 0;
  runs.forEach((run, i) => { const a = (i * 7919) % 10007, b = (i * 104729) % 9973; input += a; output += b; reads[run.id] = read(fakeFigures({ inputTokens: a, outputTokens: b, durationMs: 1000 })); });
  const claude = rowOf(enginesView(setupState(), ready(runs, reads)).rows, 'claude-code');
  assert.equal(valueOf(claude, 'usage', 'input'), numberWords(input)); assert.equal(valueOf(claude, 'usage', 'output'), numberWords(output));
});

// ---- hidden things, odd input, size

test('text that looks like a key is hidden in every string the view shows: names, lines, folders, where it was found, and model names', () => {
  const state = setupState();
  const hostile = {
    ...state,
    interfaces: state.interfaces.map(i => (i.id === 'claude-code' ? { ...i, foundAt: `Found at ~/.claude api_key = "${FAKE_KEY}"` } : i)),
    parts: [...state.parts, fakePart('bad-1', 'tool', `server ${FAKE_KEY}`, 'src-cc-home', { toolKind: 'mcp', hasSecret: true, description: `Connects to host with token=${FAKE_KEY}` })],
    sources: [...state.sources, fakeSource('src-bad', 'Claude Code', `~/p ${FAKE_KEY}`, [], 'project')],
  };
  const runs = [fakeRun('run-1', 'claude-code', '2026-11-11T10:00:00.000Z')];
  const view = enginesView(hostile, ready(runs, { 'run-1': read(fakeFigures({ model: FAKE_KEY })) }));
  assert.equal(JSON.stringify(view).includes(FAKE_KEY), false);
  assert.equal(JSON.stringify(view).includes('FAKEFAKE'), false);
});

test('the view holds no name of a secret and no value of one: a connection carries a flag and nothing else about it', () => {
  const claude = rowOf(enginesView(setupState(), none).rows, 'claude-code');
  for (const connection of claude.connections) assert.deepEqual(Object.keys(connection).sort(), ['name', 'secretNotChecked', 'secretSet', 'summary']);
});

test('the view does not change its input, which can be frozen all the way down', () => {
  const state = deepFreeze(setupState());
  const runs = deepFreeze([fakeRun('run-1', 'claude-code', '2026-11-11T10:00:00.000Z')]);
  const source = deepFreeze(ready(runs, { 'run-1': read(fakeFigures()) }));
  assert.doesNotThrow(() => enginesView(state, source));
  assert.deepEqual(enginesView(state, source), enginesView(state, source), 'the same input gives the same view');
});

test('names with Unicode, emoji, markup and SQL characters stay plain text, and a name of any length is cut', () => {
  const state = setupState();
  const odd = ['Kafé ☕ 日本語', '<script>alert(1)</script>', `'; DROP TABLE parts; --`, 'x'.repeat(5000), 'line\nbreak‮evil'].map((name, i) => fakePart(`odd-${i}`, 'tool', name, 'src-cx-home', { toolKind: 'mcp', description: name }));
  const view = enginesView({ ...state, parts: [...state.parts, ...odd] }, none);
  const codex = rowOf(view.rows, 'codex');
  for (const c of codex.connections) { assert.ok(c.name.length <= 200, c.name.length.toString()); assert.equal(/[\n‮]/.test(c.name + c.summary), false); }
  assert.ok(codex.connections.some(c => c.name === 'Kafé ☕ 日本語'));
});

test('10,000 parts and 5,000 runs are summed without a stall', () => {
  const state = setupState();
  const parts = Array.from({ length: 10_000 }, (_, i) => fakePart(`big-${i}`, i % 3 === 0 ? 'skill' : 'tool', `part ${i}`, i % 2 === 0 ? 'src-cc-home' : 'src-cx-home', { toolKind: 'mcp' }));
  const runs = Array.from({ length: 5000 }, (_, i) => fakeRun(`run-${i + 1}`, i % 2 === 0 ? 'claude-code' : 'codex', '2026-11-11T10:00:00.000Z'));
  const reads: Record<string, FigureRead> = {};
  for (const run of runs) reads[run.id] = read(fakeFigures());
  const began = performance.now();
  const view = enginesView({ ...state, parts: [...state.parts, ...parts] }, ready(runs, reads));
  assert.ok(performance.now() - began < 30_000, 'a generous bound: it only catches a quadratic loop');
  assert.equal(rowOf(view.rows, 'claude-code').moreConnections > 0, true);
  assert.equal(valueOf(rowOf(view.rows, 'claude-code'), 'usage', 'runs'), '2500');
});

test('an empty state gives the three engines as not found, with no count, and does not throw', () => {
  const state = { ...setupState(), parts: [], sources: [] };
  const view = enginesView(state, none);
  assert.equal(view.rows.length, 3);
  assert.equal(valueOf(rowOf(view.rows, 'claude-code'), 'config', 'skills'), '0');
  const nothing = enginesView({ ...state, interfaces: [] }, none);
  assert.deepEqual(nothing.rows, [], 'no engine detected and no run: no row');
});

test('the words obey the rules of the preview: no banned word in any string of the view or of the words table', () => {
  const runs = [fakeRun('run-1', 'claude-code', '2026-11-11T10:00:00.000Z'), fakeRun('run-2', 'pi', '2026-11-11T09:00:00.000Z'), fakeRun('run-3', 'codex', '2026-11-11T08:00:00.000Z')];
  const source = ready(runs, { 'run-1': read(NO_FIGURES('not-found')), 'run-2': read(NO_FIGURES('not-available')), 'run-3': { kind: 'refused', code: 'FAILED' } }, 90);
  const state = { ...setupState(), real: { couldNotRead: 0, stoppedEarly: true, notes: [], textsCut: 0 } };
  const texts: string[] = [ENGINES_WORDS.cut(50, 90), ENGINES_WORDS.unknownEngines(3), ENGINES_WORDS.orphans(2), ENGINES_WORDS.noneRead(4), ENGINES_WORDS.lastReadFailed('Bowerloom could not do that.')];
  for (const word of Object.values(ENGINES_WORDS)) if (typeof word === 'string') texts.push(word);
  for (const s of [source, none, { kind: 'sample' } as UsageSource, { kind: 'no-bridge' } as UsageSource, { kind: 'loading' } as UsageSource, { kind: 'failed', code: 'FAILED' } as UsageSource]) {
    const view = enginesView(state, s);
    // Names a person gave to fixture parts are not words of the screen, so they are not held to the rule.
    const own = stringsIn({ notes: view.notes, rows: view.rows.map(r => ({ name: r.name, stateWords: r.stateWords, config: r.config, usage: r.usage, usageNotes: r.usageNotes, configNotes: r.configNotes })) });
    texts.push(...own);
  }
  for (const text of texts) assert.equal(bannedHere(text), null, text);
  assert.equal(Object.isFrozen(ENGINES_WORDS), true);
});

// ---- fix round 1

const partial = (over: object = { stoppedEarly: true }) => ({ ...setupState(), real: { couldNotRead: 0, stoppedEarly: false, notes: [], textsCut: 0, ...over } });

test('a figure from a log that was capped, still written or read in part is marked, and a clean run beside it does not hide the mark', () => {
  const runs = [fakeRun('run-1', 'claude-code', '2026-11-11T10:00:00.000Z'), fakeRun('run-2', 'claude-code', '2026-11-11T09:00:00.000Z'), fakeRun('run-3', 'codex', '2026-11-11T08:00:00.000Z'), fakeRun('run-4', 'codex', '2026-11-11T07:00:00.000Z')];
  const source = ready(runs, {
    'run-1': read(fakeFigures({ inputTokens: 1000, outputTokens: 10, durationMs: 60_000 })),
    'run-2': read(fakeFigures({ reason: 'capped', inputTokens: 500, outputTokens: 5, durationMs: 60_000 })),
    'run-3': read(fakeFigures({ reason: 'still-writing', inputTokens: 7, outputTokens: 1, durationMs: 60_000 })),
    'run-4': read(fakeFigures({ reason: 'partial', inputTokens: 3, outputTokens: 1, durationMs: 60_000 })),
  });
  const rows = enginesView(setupState(), source).rows;
  const claude = rowOf(rows, 'claude-code'), codex = rowOf(rows, 'codex');
  assert.equal(valueOf(claude, 'usage', 'input'), '1,500 (may be low)');
  assert.equal(valueOf(claude, 'usage', 'time'), '2 minutes (may be low)');
  assert.equal(valueOf(codex, 'usage', 'input'), '10 (may be low, may change)');
  assert.ok(claude.usageNotes.some(n => n.includes(figuresStateWords('found', 'capped', null)!)), 'the reason is told too');
  const clean = enginesView(setupState(), ready(runs.slice(0, 1), { 'run-1': read(fakeFigures({ inputTokens: 1000 })) }));
  assert.equal(valueOf(rowOf(clean.rows, 'claude-code'), 'usage', 'input'), '1,000', 'a clean run carries no mark');
  const still = enginesView(setupState(), ready(runs.slice(2, 3), { 'run-3': read(fakeFigures({ reason: 'still-writing', inputTokens: 7 })) }));
  assert.equal(valueOf(rowOf(still.rows, 'codex'), 'usage', 'input'), '7 (may change)');
});

test('a mark and a partial count join in one pair of brackets', () => {
  const runs = [fakeRun('run-1', 'claude-code', '2026-11-11T10:00:00.000Z'), fakeRun('run-2', 'claude-code', '2026-11-11T09:00:00.000Z')];
  const source = ready(runs, { 'run-1': read(fakeFigures({ reason: 'capped', inputTokens: 5 })), 'run-2': read(NO_FIGURES('not-found')) });
  assert.equal(valueOf(rowOf(enginesView(setupState(), source).rows, 'claude-code'), 'usage', 'input'), '5 (from 1 of 2 runs, may be low)');
});

test('"Logs read" is x of all the runs of the engine, and an engine whose runs were all left out by the cap says so and not "0 of 0"', () => {
  const runs = [fakeRun('run-1', 'claude-code', '2026-11-11T10:00:00.000Z'), fakeRun('run-2', 'codex', '2026-11-11T09:00:00.000Z'), fakeRun('run-3', 'codex', '2026-11-11T08:00:00.000Z')];
  const view = enginesView(setupState(), ready(runs, { 'run-1': read(fakeFigures()) }, 3));
  assert.equal(valueOf(rowOf(view.rows, 'claude-code'), 'usage', 'logs-read'), '1 of 1');
  const codex = rowOf(view.rows, 'codex');
  assert.equal(valueOf(codex, 'usage', 'logs-read'), ENGINES_WORDS.noneRead(2));
  assert.equal(valueOf(codex, 'usage', 'runs'), '2');
  assert.deepEqual(codex.usage.filter(f => /^(input|output|time|models)$/.test(f.key)).map(f => f.value), ['Not read', 'Not read', 'Not read', 'Not read']);
  assert.ok(!stringsIn(view).some(t => /\b0 of 0\b/.test(t)));
});

test('runs of a name that is no engine are counted in one note, and they do not count as left out by the cap', () => {
  const runs = [fakeRun('run-1', 'nonesuch' as never, '2026-11-11T10:00:00.000Z'), fakeRun('run-2', 'other' as never, '2026-11-11T09:00:00.000Z'), fakeRun('run-3', 'codex', '2026-11-11T08:00:00.000Z')];
  const view = enginesView(setupState(), ready(runs, { 'run-3': read(fakeFigures()) }, 3));
  assert.deepEqual(view.notes.filter(n => n === ENGINES_WORDS.unknownEngines(2)), [ENGINES_WORDS.unknownEngines(2)]);
  assert.ok(!view.notes.includes(ENGINES_WORDS.cut(1, 3)), 'the two unknown runs are not "older runs"');
  assert.ok(!enginesView(setupState(), none).notes.some(n => n === ENGINES_WORDS.unknownEngines(0)));
});

test('after a partial read, each count says it may be low, and no count is a bare 0', () => {
  for (const over of [{ stoppedEarly: true }, { onlyPartRead: true }]) {
    const rows = enginesView(partial(over), none).rows;
    const claude = rowOf(rows, 'claude-code'), codex = rowOf(rows, 'codex');
    assert.deepEqual(['skills', 'agents', 'connections', 'hooks', 'prompts', 'folders'].map(k => valueOf(claude, 'config', k)), ['3 (may be low)', '1 (may be low)', '2 (may be low)', '1 (may be low)', '1 (may be low)', '2 (may be low)'], JSON.stringify(over));
    assert.equal(valueOf(codex, 'config', 'agents'), '0 (may be low)');
    for (const row of rows.filter(r => r.state !== 'not-found')) for (const f of row.config.filter(c => ['skills', 'agents', 'connections', 'hooks', 'prompts', 'folders'].includes(c.key))) assert.match(f.value, /may be low/, `${row.id} ${f.key}`);
  }
  assert.equal(valueOf(rowOf(enginesView(setupState(), none).rows, 'claude-code'), 'config', 'skills'), '3', 'a whole read has no mark');
});

test('parts whose folder is not in the list are counted in one note and never dropped without a word', () => {
  const state = setupState();
  const orphans = [fakePart('lost-1', 'skill', 'Lost one', 'src-missing'), fakePart('lost-2', 'tool', 'Lost two', 'src-missing-too', { toolKind: 'mcp' })];
  assert.ok(enginesView({ ...state, parts: [...state.parts, ...orphans] }, none).notes.includes(ENGINES_WORDS.orphans(2)));
  assert.ok(!enginesView(state, none).notes.some(n => n === ENGINES_WORDS.orphans(0)));
});

test('after a partial read, a connection with no flag says "Secret: not checked", and never implies that it has no secret', () => {
  const rows = enginesView(partial(), none).rows;
  const docs = rowOf(rows, 'claude-code').connections.find(c => c.name === 'docs')!, tracker = rowOf(rows, 'claude-code').connections.find(c => c.name === 'tracker')!;
  assert.deepEqual([docs.secretSet, docs.secretNotChecked], [false, true]);
  assert.deepEqual([tracker.secretSet, tracker.secretNotChecked], [true, false]);
  assert.equal(ENGINES_WORDS.secretNotChecked, 'Secret: not checked');
  const whole = rowOf(enginesView(setupState(), none).rows, 'claude-code').connections.find(c => c.name === 'docs')!;
  assert.deepEqual([whole.secretSet, whole.secretNotChecked], [false, false]);
});

test('a health word the app does not know shows as a problem, not as not found', () => {
  const state = setupState();
  const odd = { ...state, interfaces: state.interfaces.map(i => (i.id === 'codex' ? { ...i, health: 'weird' as never } : i)) };
  assert.equal(rowOf(enginesView(odd, none).rows, 'codex').state, 'problem');
});

test('when the last read failed after a good one, the view keeps the good figures and says the last read failed', () => {
  const runs = [fakeRun('run-1', 'claude-code', '2026-11-11T10:00:00.000Z')];
  const good = ready(runs, { 'run-1': read(fakeFigures({ inputTokens: 42 })) });
  const view = enginesView(setupState(), { ...good, lastReadFailed: 'STORE_DAMAGED' } as UsageSource);
  assert.equal(valueOf(rowOf(view.rows, 'claude-code'), 'usage', 'input'), '42');
  assert.ok(view.notes.includes(ENGINES_WORDS.lastReadFailed(runsRefusalWords('STORE_DAMAGED'))));
  assert.ok(!enginesView(setupState(), good).notes.some(n => n.includes('last read failed')));
});
