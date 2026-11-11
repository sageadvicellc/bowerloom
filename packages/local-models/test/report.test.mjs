// The report: configured endpoints, defaults, the provider seam, and every way a server can fail. No socket is opened: a fake `makeGet` answers from fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CONFIG_FILE_NAME } from '../../../dist/packages/local-models/src/config.js';
import { collectReport, createLocalModels } from '../../../dist/packages/local-models/src/report.js';
import { llamaServer } from '../../../dist/packages/local-models/src/providers/llama-server.js';
import { failAll, fakeGet, fixture, ok, recorded } from './support.mjs';

const NOW = Date.parse('2026-11-11T10:00:00.000Z');

function stateRoot(t, config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-local-models-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  if (config !== undefined) fs.writeFileSync(path.join(dir, CONFIG_FILE_NAME), typeof config === 'string' ? config : JSON.stringify(config));
  return dir;
}

/** A `makeGet` that answers by port from a table of tables. A port that is not in it is refused. It keeps every port it was asked for. */
function world(table) {
  const asked = [];
  const makeGet = port => { asked.push(port); return Object.hasOwn(table, port) ? fakeGet(table[port]) : failAll('CONNECTION_REFUSED'); };
  return { makeGet, asked };
}
const endpoints = (...ports) => ({ endpoints: ports.map(port => ({ provider: 'llama-server', port })) });
const base = (t, config, w, extra = {}) => ({ stateRoot: stateRoot(t, config), now: () => NOW, makeGet: w.makeGet, ...extra });

test('two configured servers give two up rows, in the order of the file, with the figures of their fixtures', async t => {
  const w = world({ 8091: recorded('example-9b'), 8092: recorded('gpt-oss-20b') });
  const report = await collectReport(base(t, endpoints(8091, 8092), w));
  assert.equal(report.sampledAt, '2026-11-11T10:00:00.000Z');
  assert.equal(report.endpointsConfigured, 2);
  assert.deepEqual(report.notes, []);
  assert.deepEqual(report.models.map(m => m.id), ['llama-server:8091', 'llama-server:8092']);
  const [a, b] = report.models;
  assert.deepEqual({ ...a }, {
    id: 'llama-server:8091', provider: 'llama-server', port: 8091, state: 'up', stateReason: null, modelName: 'example-9b/Example-9B-Q8_0.gguf', modelFile: 'Example-9B-Q8_0.gguf', quantization: 'Q8_0',
    parameterCount: 8955900928, fileBytes: 9518764032, contextSize: 8192, contextTrain: 262144, contextUsedPeak: 0, slotsTotal: 4, activeRequests: 0, deferredRequests: 0, promptTokensPerSecond: 0,
    generationTokensPerSecond: 0, processMemoryBytes: null, uptimeSeconds: null, build: 'b12110-cd959bae9', sampledAt: '2026-11-11T10:00:00.000Z',
  });
  assert.equal(b.quantization, 'MXFP4 MoE');
  assert.equal(b.fileBytes, 12096558336);
});

test('memory and uptime are null on every row: no process is read in this version', async t => {
  const report = await collectReport(base(t, endpoints(8091), world({ 8091: recorded('example-9b') })));
  for (const m of report.models) { assert.equal(m.processMemoryBytes, null); assert.equal(m.uptimeSeconds, null); }
});

test('every row has every field, a missing figure is null and never 0, and the report is frozen', async t => {
  const table = { '/health': ok({ status: 'ok' }) };
  const report = await collectReport(base(t, endpoints(8091), world({ 8091: table })));
  const [m] = report.models;
  assert.equal(m.state, 'up');
  for (const key of ['modelName', 'modelFile', 'quantization', 'parameterCount', 'fileBytes', 'contextSize', 'contextTrain', 'contextUsedPeak', 'slotsTotal', 'activeRequests', 'deferredRequests', 'promptTokensPerSecond', 'generationTokensPerSecond', 'build', 'stateReason']) {
    assert.ok(Object.hasOwn(m, key) && m[key] === null, key);
  }
  assert.ok(Object.isFrozen(report) && Object.isFrozen(report.models) && Object.isFrozen(m) && Object.isFrozen(report.notes));
});

test('a configured server that is down, unreachable or sends nonsense is a row with a state and a reason, never a throw', async t => {
  const w = world({
    8091: { '/health': { ok: false, code: 'CONNECTION_REFUSED' } },
    8092: { '/health': { ok: false, code: 'TIMEOUT' } },
    8093: { '/health': ok('<html>', 200) },
  });
  const report = await collectReport(base(t, endpoints(8091, 8092, 8093, 8094), w));
  const by = id => report.models.find(m => m.id === `llama-server:${id}`);
  assert.deepEqual([by(8091).state, by(8091).stateReason], ['down', 'CONNECTION_REFUSED']);
  assert.deepEqual([by(8092).state, by(8092).stateReason], ['unreachable', 'TIMEOUT']);
  assert.deepEqual([by(8093).state, by(8093).stateReason], ['unsupported', 'BAD_RESPONSE']);
  assert.deepEqual([by(8094).state, by(8094).stateReason], ['down', 'CONNECTION_REFUSED'], 'a port nobody serves');
  assert.equal(by(8091).modelName, null);
  assert.equal(by(8091).slotsTotal, null);
});

test('a server that is still loading is starting', async t => {
  const w = world({ 8091: { '/health': ok(fixture('derived/health-loading.json'), 503) } });
  const [m] = (await collectReport(base(t, endpoints(8091), w))).models;
  assert.deepEqual([m.state, m.stateReason], ['starting', 'LOADING']);
});

test('a server with metrics off is up, its request and speed figures are null, and METRICS_OFF is noted once', async t => {
  const off = { ...recorded('example-9b'), '/metrics': ok('off', 501) };
  const report = await collectReport(base(t, endpoints(8091, 8092), world({ 8091: off, 8092: off })));
  assert.deepEqual(report.notes.map(n => n.code), ['METRICS_OFF']);
  for (const m of report.models) { assert.equal(m.state, 'up'); assert.equal(m.activeRequests, null); assert.equal(m.generationTokensPerSecond, null); assert.equal(m.slotsTotal, 4); }
});

test('with no file, a default that answers is shown and one that does not is left out', async t => {
  const w = world({ 8080: recorded('gpt-oss-20b') });
  const report = await collectReport(base(t, undefined, w));
  assert.deepEqual(report.models.map(m => m.id), ['llama-server:8080']);
  assert.equal(report.endpointsConfigured, 0);
  assert.deepEqual(report.notes, []);
});

test('a default that answers with nonsense or times out is left out, and one that is loading properly is shown', async t => {
  assert.deepEqual((await collectReport(base(t, undefined, world({ 8080: { '/health': ok('<html>') } })))).models, []);
  assert.deepEqual((await collectReport(base(t, undefined, world({ 8080: { '/health': { ok: false, code: 'TIMEOUT' } } })))).models, []);
  const loading = (await collectReport(base(t, undefined, world({ 8080: { '/health': ok(fixture('derived/health-loading.json'), 503) } })))).models;
  assert.deepEqual(loading.map(m => m.state), ['starting']);
});

test('with no file and nothing answering, there are no models and the note NO_ENDPOINTS', async t => {
  const report = await collectReport(base(t, undefined, world({})));
  assert.deepEqual(report.models, []);
  assert.deepEqual(report.notes.map(n => n.code), ['NO_ENDPOINTS']);
  assert.ok(!/[\\/]/.test(report.notes[0].text), 'no path in the note');
});

test('an unreadable file gives no models, the note CONFIG_UNREADABLE, and no probe at all', async t => {
  const w = world({ 8080: recorded('example-9b') });
  const report = await collectReport(base(t, '{ not json', w));
  assert.deepEqual(report.models, []);
  assert.deepEqual(report.notes.map(n => n.code), ['CONFIG_UNREADABLE']);
  assert.deepEqual(w.asked, []);
});

test('an endpoint with a host that is not 127.0.0.1 is noted and never probed', async t => {
  const w = world({ 8091: recorded('example-9b'), 8092: recorded('gpt-oss-20b') });
  const config = { endpoints: [{ provider: 'llama-server', port: 8091, host: '10.0.0.9' }, { provider: 'llama-server', port: 8092, host: '127.0.0.1' }] };
  const report = await collectReport(base(t, config, w));
  assert.deepEqual(report.notes.map(n => n.code), ['ENDPOINT_REFUSED_NOT_LOOPBACK']);
  assert.deepEqual(report.models.map(m => m.port), [8092]);
  assert.ok(!w.asked.includes(8091));
  assert.ok(!JSON.stringify(report).includes('10.0.0.9'));
});

test('a configured endpoint of a provider that has no reader yet is unsupported with PROVIDER_NOT_AVAILABLE, and is not probed; the same default is left out', async t => {
  const w = world({});
  const report = await collectReport(base(t, { endpoints: [{ provider: 'ollama', port: 11500 }] }, w));
  const m = report.models.find(x => x.port === 11500);
  assert.deepEqual([m.state, m.stateReason, m.provider], ['unsupported', 'PROVIDER_NOT_AVAILABLE', 'ollama']);
  assert.ok(!w.asked.includes(11500));
  assert.ok(!w.asked.includes(11434) && !w.asked.includes(1234), 'a default with no reader is never probed');
  assert.deepEqual(report.models.map(x => x.port), [11500]);
});

test('a third provider plugs into the same engine: several rows from one endpoint, with stable ids', async t => {
  const fake = { id: 'ollama', defaultPort: 11434, probe: async () => ({ ok: true, rows: [{ state: 'up', modelName: 'one' }, { state: 'up', modelName: 'two' }, { state: 'up', modelName: 'three' }], notes: [] }) };
  const report = await collectReport(base(t, { endpoints: [{ provider: 'ollama', port: 11434 }] }, world({}), { providers: [llamaServer, fake] }));
  assert.deepEqual(report.models.map(m => [m.id, m.modelName]), [['ollama:11434', 'one'], ['ollama:11434#2', 'two'], ['ollama:11434#3', 'three']]);
  assert.equal(report.endpointsConfigured, 1);
});

test('a provider with no rows is one up row with nothing else', async t => {
  const fake = { id: 'ollama', defaultPort: 11434, probe: async () => ({ ok: true, rows: [], notes: [] }) };
  const [m] = (await collectReport(base(t, { endpoints: [{ provider: 'ollama', port: 11434 }] }, world({}), { providers: [fake] }))).models;
  assert.deepEqual([m.state, m.stateReason, m.modelName], ['up', null, null]);
});

test('a provider that throws, rejects, or returns the wrong shape becomes unsupported with PROVIDER_ERROR; the other endpoints are not affected', async t => {
  const bad = [
    async () => { throw new Error('boom'); }, () => { throw new Error('boom'); }, async () => null, async () => 'text', async () => undefined,
  ];
  for (const probe of bad) {
    const fake = { id: 'ollama', defaultPort: 11434, probe };
    const config = { endpoints: [{ provider: 'ollama', port: 11434 }, { provider: 'llama-server', port: 8091 }] };
    const report = await collectReport(base(t, config, world({ 8091: recorded('example-9b') }), { providers: [llamaServer, fake] }));
    const [first, second] = report.models;
    assert.deepEqual([first.state, first.stateReason], ['unsupported', 'PROVIDER_ERROR']);
    assert.equal(second.state, 'up');
    assert.ok(!JSON.stringify(report).includes('boom'));
  }
});

test('a row is built field by field: a field the report does not name, a bad number, a path and a hostile state never pass through', async t => {
  const probe = async () => ({
    ok: true, notes: ['not a code', 'ok_lower', 5, 'GOOD_NOTE'],
    rows: [
      { state: 'up', modelName: 'name', modelFile: '/home/someone/models/f.gguf', prompt: 'SENTINEL_PROMPT', slots: [{ text: 'SENTINEL_SLOT' }], parameterCount: -5, fileBytes: NaN, contextSize: '8192', slotsTotal: Infinity, activeRequests: 2, build: 'b1‮' },
      { state: 'weird', modelName: 'x' }, null, { state: 'up', modelName: 5, modelFile: '' },
    ],
  });
  const fake = { id: 'ollama', defaultPort: 11434, probe };
  const report = await collectReport(base(t, { endpoints: [{ provider: 'ollama', port: 11434 }] }, world({}), { providers: [fake] }));
  const text = JSON.stringify(report);
  assert.ok(!text.includes('SENTINEL') && !text.includes('someone'));
  const [a, b, c, d] = report.models;
  assert.deepEqual([a.modelFile, a.parameterCount, a.fileBytes, a.contextSize, a.slotsTotal, a.activeRequests, a.build], ['f.gguf', null, null, null, null, 2, 'b1?']);
  assert.deepEqual([b.state, b.stateReason], ['unsupported', 'BAD_RESPONSE']);
  assert.deepEqual([c.state, c.stateReason], ['unsupported', 'BAD_RESPONSE']);
  assert.deepEqual([d.modelName, d.modelFile], [null, null]);
  assert.deepEqual(report.notes.map(n => n.code), ['GOOD_NOTE']);
  assert.ok(Object.keys(a).every(k => !['prompt', 'slots'].includes(k)));
});

test('a failure reason that is not a short code is replaced, so text with a path cannot reach the report', async t => {
  const fake = { id: 'ollama', defaultPort: 11434, probe: async () => ({ ok: false, state: 'down', reason: '/home/someone/secret failed' }) };
  const [m] = (await collectReport(base(t, { endpoints: [{ provider: 'ollama', port: 11434 }] }, world({}), { providers: [fake] }))).models;
  assert.deepEqual([m.state, m.stateReason], ['down', 'BAD_RESPONSE']);
  const odd = { id: 'ollama', defaultPort: 11434, probe: async () => ({ ok: false, state: 'exploded', reason: 'X' }) };
  const [n] = (await collectReport(base(t, { endpoints: [{ provider: 'ollama', port: 11434 }] }, world({}), { providers: [odd] }))).models;
  assert.equal(n.state, 'unsupported');
});

test('endpoints are probed in parallel, not one after another', async t => {
  let active = 0, peak = 0;
  const fake = { id: 'ollama', defaultPort: 11434, probe: async () => {
    active += 1; peak = Math.max(peak, active);
    await new Promise(resolve => { const timer = setTimeout(resolve, 400); const poll = setInterval(() => { if (peak >= 4) { clearTimeout(timer); clearInterval(poll); resolve(); } }, 5); setTimeout(() => clearInterval(poll), 450); });
    active -= 1;
    return { ok: true, rows: [{ state: 'up' }], notes: [] };
  } };
  const config = { endpoints: [1, 2, 3, 4].map(n => ({ provider: 'ollama', port: 11500 + n })) };
  await collectReport(base(t, config, world({}), { providers: [fake] }));
  assert.ok(peak >= 4, `peak ${peak}`);
});

test('a busy server whose slots carry a sentinel: the sentinel is nowhere in the report, the cached copy, or a file in the state folder', async t => {
  const busy = { ...recorded('example-9b'), '/slots': ok(fixture('derived/slots-busy-sentinel.json')), '/metrics': ok(fixture('derived/metrics-busy.txt')) };
  const root = stateRoot(t, endpoints(8091));
  const service = createLocalModels({ stateRoot: root, now: () => NOW, makeGet: world({ 8091: busy }).makeGet });
  const first = await service.localModels();
  const again = await service.localModels();
  assert.equal(first.models[0].activeRequests, 1);
  assert.equal(first.models[0].contextUsedPeak, 2362);
  for (const r of [first, again]) assert.ok(!JSON.stringify(r).includes('SENTINEL'));
  for (const name of fs.readdirSync(root)) assert.ok(!fs.readFileSync(path.join(root, name), 'utf8').includes('SENTINEL'));
  assert.deepEqual(fs.readdirSync(root), [CONFIG_FILE_NAME], 'nothing was written to the state folder');
});

test('createLocalModels: a second call under 2 seconds reuses the report, and the call is the one report shape', async t => {
  let clock = NOW, made = 0;
  const w = world({ 8091: recorded('example-9b') });
  const service = createLocalModels({ stateRoot: stateRoot(t, endpoints(8091)), now: () => clock, makeGet: port => { made += 1; return w.makeGet(port); } });
  const a = await service.localModels();
  const afterFirst = made;
  clock += 1999;
  assert.equal(await service.localModels(), a);
  assert.equal(made, afterFirst);
  clock += 1;
  const b = await service.localModels();
  assert.notEqual(b, a);
  assert.ok(made > afterFirst);
  assert.equal(b.sampledAt, new Date(NOW + 2000).toISOString());
});

test('createLocalModels: five callers at once share one probe, and a provider that throws never makes the call reject', async t => {
  let probes = 0;
  const fake = { id: 'ollama', defaultPort: 11434, probe: async () => { probes += 1; throw new Error('boom'); } };
  const service = createLocalModels({ stateRoot: stateRoot(t, { endpoints: [{ provider: 'ollama', port: 11434 }] }), now: () => NOW, providers: [fake], makeGet: world({}).makeGet });
  const reports = await Promise.all(Array.from({ length: 5 }, () => service.localModels()));
  assert.equal(probes, 1);
  for (const r of reports) assert.equal(r, reports[0]);
  assert.equal(reports[0].models[0].stateReason, 'PROVIDER_ERROR');
});

test('createLocalModels: a state folder that is not a path never makes the call reject', async () => {
  const service = createLocalModels({ stateRoot: '', now: () => NOW, makeGet: world({}).makeGet });
  assert.deepEqual((await service.localModels()).notes.map(n => n.code), ['CONFIG_UNREADABLE']);
});
