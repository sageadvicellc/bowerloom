// The display logic of the local models screen (shared/local-models/view-model.ts): "not reported" for a missing figure and never 0, basenames only, states with words,
// the order of rows, the optional notes of a row, and a failed probe that shows the note's sentence and never an empty state or a zero count.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCAL_WORDS, REFRESH_MS, STALE_AFTER_MS, baseName, noteSentence, stateTone, contextPercent, contextWords, factsOf, formatBytes, formatCount, formatRate, isStale, reasonWords, rowNotes, rowOf, sortModels, stateWords, summaryOf, viewOf } from '../shared/local-models/view-model.js';
import type { LocalModel, LocalModelsReport } from '../shared/local-models/types.js';
import { createSampleLocal, sampleLocalReport, LOCAL_MODELS_MANIFEST } from '../shared/local-models/sample.js';

const NR = 'not reported';
const model = (over: Partial<LocalModel> = {}): LocalModel => ({
  id: 'llama-server:8091', provider: 'llama-server', port: 8091, state: 'up', stateReason: null, modelName: 'Example-9B-Q8_0.gguf', modelFile: 'Example-9B-Q8_0.gguf', quantization: 'Q8_0',
  parameterCount: null, fileBytes: 9518764032, contextSize: 32768, contextTrain: null, contextUsedPeak: 8192, slotsTotal: 2, activeRequests: 1, deferredRequests: 0,
  promptTokensPerSecond: 400, generationTokensPerSecond: 38.44, processMemoryBytes: null, uptimeSeconds: null, build: null, notes: [], sampledAt: '2026-11-11T10:00:00Z', ...over,
});
const report = (over: Partial<LocalModelsReport> = {}): LocalModelsReport => ({ sampledAt: '2026-11-11T10:00:00Z', models: [model()], endpointsConfigured: 1, notes: [], ...over });
const NULLS: Partial<LocalModel> = { modelName: null, modelFile: null, quantization: null, fileBytes: null, contextSize: null, contextUsedPeak: null, activeRequests: null, deferredRequests: null, generationTokensPerSecond: null };

test('a missing figure reads "not reported" and a real 0 reads 0', () => {
  for (const f of [formatCount, formatBytes, formatRate]) assert.equal(f(null), NR);
  assert.equal(formatCount(0), '0'); assert.equal(formatBytes(0), '0.0 MB'); assert.equal(formatRate(0), '0.0 tokens/s');
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1]) { assert.equal(formatCount(bad), NR); assert.equal(formatBytes(bad), NR); assert.equal(formatRate(bad), NR); }
});

test('numbers are formatted the same way every time', () => {
  assert.equal(formatCount(32768), '32,768'); assert.equal(formatCount(1234567), '1,234,567');
  assert.equal(formatBytes(9518764032), '9.5 GB'); assert.equal(formatBytes(250_000_000), '250 MB'); assert.equal(formatBytes(12_300_000), '12.3 MB');
  assert.equal(formatRate(38.44), '38.4 tokens/s'); assert.equal(formatRate(61.2), '61.2 tokens/s');
});

test('a file name is the last part of a path, with any separator, and never a folder', () => {
  assert.equal(baseName('Example-9B-Q8_0.gguf'), 'Example-9B-Q8_0.gguf');
  assert.equal(baseName('/models/dir/Example-9B.gguf'), 'Example-9B.gguf');
  assert.equal(baseName('C:\\models\\Example-9B.gguf'), 'Example-9B.gguf');
  assert.equal(baseName('/models/dir/'), 'dir');
  assert.equal(baseName(null), null); assert.equal(baseName(''), null); assert.equal(baseName('///'), null);
});

test('context use is a whole percent clamped to 0..100, and null when a figure is missing or the size is 0', () => {
  assert.equal(contextPercent(8192, 32768), 25); assert.equal(contextPercent(40000, 32768), 100); assert.equal(contextPercent(0, 32768), 0);
  assert.equal(contextPercent(null, 32768), null); assert.equal(contextPercent(10, null), null); assert.equal(contextPercent(10, 0), null);
  assert.equal(contextWords(model()), '25% (8,192 of 32,768)');
  assert.equal(contextWords(model({ contextUsedPeak: null })), `${NR} of 32,768`);
  assert.equal(contextWords(model({ contextSize: null, contextUsedPeak: null })), NR);
});

test('every row shows memory and uptime as "not reported", and the figures it has', () => {
  const facts = Object.fromEntries(factsOf(model()).map(f => [f.key, f]));
  assert.equal(facts.memory!.value, NR); assert.equal(facts.memory!.reported, false);
  assert.equal(facts.uptime!.value, NR); assert.equal(facts.uptime!.reported, false);
  assert.equal(facts.file!.value, 'Example-9B-Q8_0.gguf'); assert.equal(facts.quantization!.value, 'Q8_0'); assert.equal(facts.size!.value, '9.5 GB');
  assert.equal(facts.context!.value, '32,768'); assert.equal(facts.speed!.value, '38.4 tokens/s'); assert.equal(facts.requests!.value, '1 active');
  assert.equal(facts.port, undefined, 'the port is in the title, not a field');
  assert.deepEqual(factsOf(model()).map(f => f.key), ['file', 'quantization', 'size', 'context', 'speed', 'requests', 'use', 'memory', 'uptime']);
  // Memory is not reported even when a later report carries a number: this version reads no process.
  assert.equal(Object.fromEntries(factsOf(model({ processMemoryBytes: 5 })).map(f => [f.key, f.value])).memory, NR);
});

test('a row whose server gave nothing shows "not reported" for every figure and no 0', () => {
  const facts = factsOf(model(NULLS));
  for (const f of facts) assert.equal(f.value, NR, f.key);
  assert.ok(facts.every(f => !/\b0\b/.test(f.value)));
  assert.equal(rowOf(model(NULLS)).name, 'llama-server \u00b7 port 8091');
});

test('the model file of a row is its base name even when the server sent a folder', () => {
  const row = rowOf(model({ modelFile: '/Users/someone/models/Example-9B.gguf', modelName: '/Users/someone/models/Example-9B.gguf' }));
  assert.equal(row.name, 'Example-9B \u00b7 port 8091');
  assert.equal(row.facts.find(f => f.key === 'file')!.value, 'Example-9B.gguf');
  assert.doesNotMatch(JSON.stringify(row), /someone|models\//);
});

test('the title is the model name without its quantization and extension, then the port; with no name it is the file base name without extension, then the provider', () => {
  assert.equal(rowOf(model()).name, 'Example-9B \u00b7 port 8091');
  assert.equal(rowOf(model({ modelName: 'Example-20B-MXFP4.gguf', quantization: 'MXFP4', port: 8092 })).name, 'Example-20B \u00b7 port 8092');
  assert.equal(rowOf(model({ modelName: 'Example-9B-Q4_K_M.gguf', quantization: null })).name, 'Example-9B \u00b7 port 8091', 'a known quantization suffix goes even when the server gave none');
  assert.equal(rowOf(model({ modelName: 'Qwen3.5-9B-Q8_0', quantization: 'Q8_0' })).name, 'Qwen3.5-9B \u00b7 port 8091', 'a dot inside a name is not an extension');
  assert.equal(rowOf(model({ modelName: 'Example-9B', quantization: null })).name, 'Example-9B \u00b7 port 8091');
  assert.equal(rowOf(model({ modelName: null, modelFile: '/models/Example-9B-Q8_0.gguf' })).name, 'Example-9B-Q8_0 \u00b7 port 8091');
  assert.equal(rowOf(model({ modelName: null, modelFile: null, port: 8093 })).name, 'llama-server \u00b7 port 8093');
  assert.equal(rowOf(model({ modelName: '', modelFile: '', port: 8093 })).name, 'llama-server \u00b7 port 8093');
});

test('a down, starting or unreachable server is a compact card: the title, the state, the reason and its own notes; no fact and no "not reported" field', () => {
  for (const [state, reason] of [['down', 'CONNECTION_REFUSED'], ['unreachable', 'TIMEOUT'], ['starting', 'LOADING']] as const) {
    const row = rowOf({ ...model({ ...NULLS, state, stateReason: reason }), notes: [{ code: 'PARTIAL_READ' }] } as unknown as LocalModel);
    assert.deepEqual(row.facts, [], state); assert.deepEqual(row.notes, ['Some figures of this server could not be read.'], `${state}: a compact card keeps its own notes`); assert.equal(row.compact, true, state);
    assert.equal(row.name, 'llama-server \u00b7 port 8091'); assert.ok(row.why !== null && row.why.length > 5, state);
    assert.doesNotMatch(JSON.stringify(row), /not reported/, state);
  }
  const unknown = rowOf(model({ ...NULLS, state: 'down', stateReason: 'SOMETHING_NEW' }));
  assert.match(unknown.why ?? '', /SOMETHING_NEW/, 'an unknown reason code still has a sentence that names it'); assert.deepEqual(unknown.facts, []);
  assert.equal(rowOf(model()).compact, false); assert.equal(rowOf(model()).facts.length, 9);
  assert.equal(rowOf(model({ ...NULLS, state: 'unsupported', stateReason: 'UNSUPPORTED_PROVIDER' })).compact, false, 'only the three states of the answer are compact');
});

test('a down, starting, unreachable or unsupported server is a state with words and a sentence, not a crash and not a zero', () => {
  assert.deepEqual((['up', 'starting', 'down', 'unreachable', 'unsupported'] as const).map(stateWords), ['Up', 'Starting', 'Down', 'Not answering', 'Not supported']);
  const down = rowOf(model({ ...NULLS, state: 'down', stateReason: 'CONNECTION_REFUSED' }));
  assert.equal(down.stateText, 'Down'); assert.equal(down.tone, 'bad'); assert.equal(down.why, 'Nothing is listening on this port.');
  const starting = rowOf(model({ ...NULLS, state: 'starting', stateReason: 'LOADING' }));
  assert.equal(starting.stateText, 'Starting'); assert.equal(starting.why, 'The server is loading a model.');
  assert.equal(rowOf(model({ ...NULLS, state: 'unreachable', stateReason: 'TIMEOUT' })).why, 'The server did not answer in time.');
  assert.equal(rowOf(model()).why, null);
  assert.equal(reasonWords('SOMETHING_NEW'), null); assert.equal(reasonWords(null), null);
});

test('rows are sorted: up first, then starting, not answering, not supported and down; then by name, then by port', () => {
  const sorted = sortModels([
    model({ id: 'd', state: 'down', modelName: 'A' }), model({ id: 'u2', modelName: 'B', port: 2 }), model({ id: 's', state: 'starting', modelName: 'A' }),
    model({ id: 'u1', modelName: 'A', port: 9 }), model({ id: 'x', state: 'unsupported' }), model({ id: 'r', state: 'unreachable' }), model({ id: 'u0', modelName: 'A', port: 3 }),
  ]);
  assert.deepEqual(sorted.map(m => m.id), ['u0', 'u1', 'u2', 's', 'r', 'x', 'd']);
});

test('the summary counts up, down and the others', () => {
  assert.equal(summaryOf([]), '0 up');
  assert.equal(summaryOf([model(), model(), model({ state: 'down' }), model({ state: 'starting' })]), '2 up, 1 down, 1 not ready');
});

test('a PARTIAL_READ note is shown as its plain sentence, and the rows still show', () => {
  const view = viewOf(report({ notes: [{ code: 'PARTIAL_READ', text: 'A server answered, but some of its figures could not be read.' }] }));
  assert.equal(view.kind, 'rows');
  assert.deepEqual(view.sentences, ['A server answered, but some of its figures could not be read.']);
  assert.equal(view.rows.length, 1);
});

test('PROBE_FAILED: the report holds no servers and a zero count, and the view is the note\'s sentence, never the empty state and never a count', () => {
  const sentence = 'The probe of the local model servers failed. It will be tried again.';
  const view = viewOf(report({ models: [], endpointsConfigured: 0, notes: [{ code: 'PROBE_FAILED', text: sentence }] }));
  assert.equal(view.kind, 'probe-failed');
  assert.deepEqual(view.sentences, [sentence]);
  assert.equal(view.summary, null, 'no "0 up" count');
  assert.equal(view.rows.length, 0);
  // Even with another note beside it, the failed probe is not turned into "no servers".
  assert.equal(viewOf(report({ models: [], endpointsConfigured: 0, notes: [{ code: 'NO_ENDPOINTS', text: 'x' }, { code: 'PROBE_FAILED', text: sentence }] })).kind, 'probe-failed');
});

test('no servers set up is the empty state, with a count, and not a failed probe', () => {
  const view = viewOf(report({ models: [], endpointsConfigured: 0, notes: [{ code: 'NO_ENDPOINTS', text: 'No local model server answered. Add a port to the local models file.' }] }));
  assert.equal(view.kind, 'empty'); assert.equal(view.summary, '0 up'); assert.deepEqual(view.sentences, [], 'the empty state says it once');
  assert.match(LOCAL_WORDS.empty, /No local model servers are set up/);
});

test('the notes of a row are read when present and ignored when not', () => {
  assert.deepEqual(rowNotes(model()), []);
  assert.deepEqual(rowNotes({ ...model(), notes: [{ code: 'PARTIAL_READ', text: 'Some figures could not be read.' }, { code: 'METRICS_OFF' }, { code: 'METRICS_UNREADABLE' }, { code: 'NEW_CODE' }, 'METRICS_OFF', 7, null] } as unknown as LocalModel),
    ['Some figures could not be read.', 'This server runs without metrics, so speed and request figures are not reported.', 'The metrics of this server could not be read.', 'A note about this server has no words yet. Code: NEW_CODE.']);
  assert.deepEqual(rowNotes({ ...model(), notes: 'PARTIAL_READ' } as unknown as LocalModel), []);
  assert.deepEqual(rowOf({ ...model(), notes: [{ code: 'METRICS_OFF' }] } as unknown as LocalModel).notes.length, 1);
});

test('a report that carries extra fields, such as a path or a prompt, shows none of them', () => {
  const dirty = { ...model(), prompt: 'SENTINEL-PROMPT', modelPath: '/home/someone/x.gguf' } as unknown as LocalModel;
  assert.doesNotMatch(JSON.stringify(viewOf(report({ models: [dirty] }))), /SENTINEL|someone/);
});

test('stale: a failed read, or a good read older than 10 seconds', () => {
  assert.equal(STALE_AFTER_MS, 10_000); assert.equal(REFRESH_MS, 3_000);
  assert.equal(isStale(false, 1000, 5000), false); assert.equal(isStale(false, 1000, 11_001), true); assert.equal(isStale(true, 1000, 1001), true); assert.equal(isStale(false, null, 99_999), false);
});

test('the sample: two up, one down, made-up names, no memory, and a sample bridge that answers both calls', async () => {
  const sample = sampleLocalReport('2026-11-11T10:00:00Z');
  assert.deepEqual(sample.models.map(m => m.state), ['up', 'up', 'down']);
  assert.ok(sample.models.every(m => m.processMemoryBytes === null && m.uptimeSeconds === null));
  assert.doesNotMatch(JSON.stringify(sample), /\/Users|\/home|C:\\/);
  const bridge = createSampleLocal(() => '2026-11-11T10:00:00Z');
  assert.deepEqual(await bridge.localModels(), sample);
  assert.deepEqual((await bridge.listExtensions()).extensions, [LOCAL_MODELS_MANIFEST]);
});


test('a note with no text, or with a code this app does not know, is never blank: a generic sentence names the code and the reason', () => {
  const blank = noteSentence({ code: 'NEW_THING', text: '', reason: 'PARSE' });
  assert.match(blank, /NEW_THING/); assert.match(blank, /PARSE/); assert.ok(blank.trim().length > 20);
  assert.match(noteSentence({ code: 'NEW_THING', text: '   ' }), /NEW_THING/);
  assert.match(noteSentence({ code: '', text: '' } as never), /none/i);
  assert.equal(noteSentence({ code: 'PARTIAL_READ', text: 'Some figures could not be read.' }), 'Some figures could not be read.');
  assert.equal(noteSentence({ code: 'CONFIG_UNREADABLE', text: 'The file could not be read.', reason: 'PARSE' }), 'The file could not be read. Reason: PARSE.');
  assert.deepEqual(viewOf(report({ notes: [{ code: 'X1', text: '' }] })).sentences.map(t => t.includes('X1')), [true]);
});

test('CONFIG_UNREADABLE with no servers shows the config note with its reason, and no empty sentence and no count', () => {
  const text = 'The local models file could not be read, so no server was probed.';
  const view = viewOf(report({ models: [], endpointsConfigured: 0, notes: [{ code: 'CONFIG_UNREADABLE', text, reason: 'PARSE' }] }));
  assert.equal(view.kind, 'config-unreadable');
  assert.deepEqual(view.sentences, [`${text} Reason: PARSE.`]);
  assert.match(view.sentences[0]!, /PARSE/);
  assert.equal(view.summary, null); assert.equal(view.rows.length, 0);
  // With servers in the report the note sits above the rows and the view is still rows.
  assert.equal(viewOf(report({ notes: [{ code: 'CONFIG_UNREADABLE', text, reason: 'PARSE' }] })).kind, 'rows');
});

test('an unknown state has words, a tone and a fixed rank after the known states; an unknown reason has a sentence', () => {
  const odd = model({ state: 'sleeping' as never, stateReason: 'WEIRD' });
  const row = rowOf(odd);
  assert.match(row.stateText, /sleeping/); assert.equal(row.tone, 'warn'); assert.equal(stateTone('sleeping' as never), 'warn');
  assert.match(row.why ?? '', /WEIRD/);
  assert.doesNotMatch(JSON.stringify(row), /undefined|NaN/);
  const sorted = sortModels([model({ id: 'x', state: 'sleeping' as never, modelName: 'A' }), model({ id: 'd', state: 'down', modelName: 'A' }), model({ id: 'u', modelName: 'B' }), model({ id: 'y', state: undefined as never, modelName: 'A' })]);
  assert.deepEqual(sorted.map(m => m.id), ['u', 'd', 'x', 'y']);
  assert.equal(rowOf(model({ state: 'unreachable', stateReason: null })).why, null);
});

test('a report with two notes of one code gives each its own key', () => {
  const view = viewOf(report({ notes: [{ code: 'PARTIAL_READ', text: 'Same.' }, { code: 'PARTIAL_READ', text: 'Same.' }, { code: 'OTHER', text: 'Same.' }] }));
  assert.equal(view.sentenceKeys.length, 3); assert.equal(new Set(view.sentenceKeys).size, 3);
});

test('the sample bridge takes its clock from the caller', async () => {
  let at = '2026-11-11T10:00:00Z';
  const bridge = createSampleLocal(() => at);
  assert.equal((await bridge.localModels()).sampledAt, at);
  at = '2026-11-11T10:00:03Z';
  assert.equal((await bridge.localModels()).sampledAt, at);
});
