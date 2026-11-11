// The llama-server provider, read against recorded fixtures and hand-made answers. No socket is opened: the provider only gets a `get` function.
import test from 'node:test';
import assert from 'node:assert/strict';
import { llamaServer } from '../../../dist/packages/local-models/src/providers/llama-server.js';
import { failAll, failed, fakeGet, fixture, ok, recorded } from './support.mjs';

const rowOf = result => { assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.rows.length, 1); return result.rows[0]; };

test('the provider is llama-server, with the default port 8080', () => {
  assert.equal(llamaServer.id, 'llama-server');
  assert.equal(llamaServer.defaultPort, 8080);
});

test('it asks for the five paths once each, and nothing else', async () => {
  const get = fakeGet(recorded('example-9b'));
  await llamaServer.probe(get);
  assert.deepEqual([...get.calls].sort(), ['/health', '/metrics', '/props', '/slots', '/v1/models']);
});

test('the recorded idle server of the first model gives every field', async () => {
  const result = await llamaServer.probe(fakeGet(recorded('example-9b')));
  assert.deepEqual(result.notes, []);
  assert.deepEqual(rowOf(result), {
    state: 'up', modelName: 'Example-9B-Q8_0.gguf', modelFile: 'Example-9B-Q8_0.gguf', quantization: 'Q8_0', parameterCount: 8955900928, fileBytes: 9518764032,
    contextSize: 8192, contextTrain: 262144, contextUsedPeak: 0, slotsTotal: 4, activeRequests: 0, deferredRequests: 0, promptTokensPerSecond: 0, generationTokensPerSecond: 0,
    build: 'b12110-cd959bae9',
  });
});

test('the recorded idle server of the second model gives its own quantization, size and context', async () => {
  const row = rowOf(await llamaServer.probe(fakeGet(recorded('gpt-oss-20b'))));
  assert.equal(row.modelName, 'gpt-oss-20b-MXFP4.gguf');
  assert.equal(row.modelFile, 'gpt-oss-20b-MXFP4.gguf');
  assert.equal(row.quantization, 'MXFP4 MoE');
  assert.equal(row.parameterCount, 20914757184);
  assert.equal(row.fileBytes, 12096558336);
  assert.equal(row.contextTrain, 131072);
  assert.equal(row.slotsTotal, 4);
});

test('a busy server: the counters come from /metrics, and no slot text reaches the result', async () => {
  const table = recorded('example-9b');
  table['/metrics'] = ok(fixture('derived/metrics-busy.txt'));
  table['/slots'] = ok(fixture('derived/slots-busy-sentinel.json'));
  const result = await llamaServer.probe(fakeGet(table));
  const row = rowOf(result);
  assert.equal(row.activeRequests, 1);
  assert.equal(row.deferredRequests, 2);
  assert.equal(row.contextUsedPeak, 2362);
  assert.equal(row.promptTokensPerSecond, 500);
  assert.equal(row.generationTokensPerSecond, 40);
  assert.equal(row.slotsTotal, 4);
  assert.ok(!JSON.stringify(result).includes('SENTINEL'), 'the sentinel text is nowhere in the result');
});

test('only allow-listed fields reach the result: a template, token text and generation settings in /props are never read', async () => {
  const table = recorded('example-9b');
  const props = JSON.parse(fixture('example-9b/props.json'));
  Object.assign(props, { chat_template: 'SECRET_TEMPLATE', bos_token: 'SECRET_TOKEN', default_generation_settings: { prompt: 'SECRET_PROMPT' }, media_marker: 'SECRET_MARKER' });
  table['/props'] = ok(props);
  const models = JSON.parse(fixture('example-9b/models.json'));
  models.data[0].meta.secret = 'SECRET_META';
  models.data[0].extra = 'SECRET_EXTRA';
  table['/v1/models'] = ok(models);
  const result = await llamaServer.probe(fakeGet(table));
  assert.ok(!JSON.stringify(result).includes('SECRET'));
  assert.deepEqual(Object.keys(rowOf(result)).sort(), Object.keys(rowOf(await llamaServer.probe(fakeGet(recorded('example-9b'))))).sort());
});

test('a refused connection is down, a timeout or a broken connection is unreachable, and any other failed read is unsupported', async () => {
  assert.deepEqual(await llamaServer.probe(failAll('CONNECTION_REFUSED')), { ok: false, state: 'down', reason: 'CONNECTION_REFUSED' });
  assert.deepEqual(await llamaServer.probe(failAll('TIMEOUT')), { ok: false, state: 'unreachable', reason: 'TIMEOUT' });
  assert.deepEqual(await llamaServer.probe(failAll('CONNECTION_FAILED')), { ok: false, state: 'unreachable', reason: 'CONNECTION_FAILED' });
  for (const code of ['TOO_LARGE', 'REDIRECT', 'BAD_PATH', 'BAD_PORT']) assert.deepEqual(await llamaServer.probe(failAll(code)), { ok: false, state: 'unsupported', reason: 'BAD_RESPONSE' }, code);
});

test('the failure is judged on /health alone: the other paths failing does not make a healthy server down', async () => {
  const table = { '/health': ok({ status: 'ok' }), '/props': failed('TIMEOUT'), '/slots': failed('TIMEOUT'), '/metrics': failed('TIMEOUT'), '/v1/models': failed('TIMEOUT') };
  const result = await llamaServer.probe(fakeGet(table));
  assert.deepEqual(rowOf(result), { state: 'up' });
  assert.deepEqual(result.notes, ['PARTIAL_READ']);
});

test('a 503 with the loading body is starting, with nothing else filled in', async () => {
  const table = { '/health': ok(fixture('derived/health-loading.json'), 503), '/props': ok('x', 503), '/slots': ok('x', 503), '/metrics': ok('x', 503), '/v1/models': ok('x', 503) };
  assert.deepEqual(await llamaServer.probe(fakeGet(table)), { ok: true, rows: [{ state: 'starting', reason: 'LOADING' }], notes: [] });
});

test('a 503 that is not the loading body, or any other bad /health, is unsupported', async () => {
  const unsupported = { ok: false, state: 'unsupported', reason: 'BAD_RESPONSE' };
  for (const health of [ok('Service Unavailable', 503), ok({ error: { code: 500 } }, 503), ok('{}', 503), ok({ status: 'ok' }, 404), ok({ status: 'ok' }, 500), ok('<html>', 200), ok('', 200), ok('null', 200), ok('[]', 200), ok({ status: 'error' }, 200), ok({ nope: 1 }, 200), ok({ status: 1 }, 200)]) {
    assert.deepEqual(await llamaServer.probe(fakeGet({ ...recorded('example-9b'), '/health': health })), unsupported, JSON.stringify(health));
  }
});

test('a /metrics that is off (404 or 501) leaves the rate and request fields out and says METRICS_OFF', async () => {
  for (const status of [404, 501]) {
    const result = await llamaServer.probe(fakeGet({ ...recorded('example-9b'), '/metrics': ok('metrics off', status) }));
    assert.deepEqual(result.notes, ['METRICS_OFF']);
    const row = rowOf(result);
    for (const key of ['activeRequests', 'deferredRequests', 'promptTokensPerSecond', 'generationTokensPerSecond', 'contextUsedPeak']) assert.ok(!(key in row), key);
    assert.equal(row.slotsTotal, 4);
    assert.equal(row.state, 'up');
  }
});

test('a /metrics that fails or holds nothing known leaves its fields out, without the METRICS_OFF note', async () => {
  for (const metrics of [ok('garbage\nmore garbage\n'), ok('')]) {
    const result = await llamaServer.probe(fakeGet({ ...recorded('example-9b'), '/metrics': metrics }));
    assert.deepEqual(result.notes, []);
    assert.ok(!('activeRequests' in rowOf(result)));
  }
});

test('a /slots that is off still leaves the slot count from /props, and the count of slots when /props is missing', async () => {
  const off = rowOf(await llamaServer.probe(fakeGet({ ...recorded('example-9b'), '/slots': ok('off', 501) })));
  assert.equal(off.slotsTotal, 4);
  const noProps = rowOf(await llamaServer.probe(fakeGet({ ...recorded('example-9b'), '/props': ok('nope', 404) })));
  assert.equal(noProps.slotsTotal, 4, 'counted from the four slots');
  const neither = rowOf(await llamaServer.probe(fakeGet({ ...recorded('example-9b'), '/props': ok('nope', 404), '/slots': ok('off', 501) })));
  assert.ok(!('slotsTotal' in neither));
});

test('without /v1/models, the context comes from the first slot and the quantization from /props', async () => {
  const row = rowOf(await llamaServer.probe(fakeGet({ ...recorded('example-9b'), '/v1/models': ok('nope', 404) })));
  assert.equal(row.contextSize, 8192);
  assert.equal(row.quantization, 'Q8_0');
  for (const key of ['parameterCount', 'fileBytes', 'contextTrain']) assert.ok(!(key in row), key);
});

test('without /props, the name comes from the model list and the file, build and slots-from-props are left out', async () => {
  const row = rowOf(await llamaServer.probe(fakeGet({ ...recorded('example-9b'), '/props': ok('nope', 404) })));
  assert.equal(row.modelName, 'Example-9B-Q8_0.gguf', 'a model id that holds a folder is cut to its last part');
  assert.equal(row.quantization, 'Q8_0', 'from the model list');
  assert.ok(!('modelFile' in row));
  assert.ok(!('build' in row));
});

test('a model file is a base name only: a folder, an absolute path, a Windows path and a home path never appear', async () => {
  const cases = [
    ['/home/someone/models/x.gguf', 'x.gguf', 'x.gguf'], ['/Users/someone/models/y.gguf', 'y.gguf', 'y.gguf'], ['C:\\Users\\someone\\models\\z.gguf', 'z.gguf', 'z.gguf'],
    ['~/models/w.gguf', 'w.gguf', 'w.gguf'], ['models/sub/v.gguf', 'v.gguf', 'v.gguf'], ['../secret/t.gguf', 't.gguf', 't.gguf'], ['u.gguf', 'u.gguf', 'u.gguf'],
  ];
  for (const [path, file, name] of cases) {
    const table = recorded('example-9b');
    table['/props'] = ok({ ...JSON.parse(fixture('example-9b/props.json')), model_path: path, model_alias: path });
    const result = await llamaServer.probe(fakeGet(table));
    const row = rowOf(result);
    assert.equal(row.modelFile, file, path);
    assert.equal(row.modelName, name, `an alias that is a path, absolute or relative, is shown as its base name: ${path}`);
    assert.ok(!/someone|Users|home|\\|~/.test(JSON.stringify(result)), path);
  }
});

test('a model name that is not a path is kept as written, with control and format characters replaced and a long one cut', async () => {
  const table = recorded('example-9b');
  const props = JSON.parse(fixture('example-9b/props.json'));
  table['/props'] = ok({ ...props, model_alias: 'model\u202e\n\u0000name', build_info: `b1${'9'.repeat(200)}` });
  const row = rowOf(await llamaServer.probe(fakeGet(table)));
  assert.equal(row.modelName, 'model???name');
  assert.ok(row.build.length <= 121 && row.build.endsWith('…'));
});

test('a number that is negative, not finite, fractional where a whole count is needed, or a string is left out', async () => {
  const table = recorded('example-9b');
  table['/props'] = ok({ ...JSON.parse(fixture('example-9b/props.json')), total_slots: '4' });
  table['/slots'] = ok('[]');
  table['/v1/models'] = ok({ data: [{ id: 'm', meta: { n_ctx: -1, n_ctx_train: '262144', n_params: null, size: 1.5, ftype: 7 } }] });
  table['/metrics'] = ok('llamacpp:n_tokens_max -4\nllamacpp:requests_processing NaN\nllamacpp:requests_deferred 1.5\nllamacpp:predicted_tokens_seconds 12.5\n');
  const row = rowOf(await llamaServer.probe(fakeGet(table)));
  assert.deepEqual(row, { state: 'up', modelName: 'Example-9B-Q8_0.gguf', modelFile: 'Example-9B-Q8_0.gguf', quantization: 'Q8_0', generationTokensPerSecond: 12.5, build: 'b12110-cd959bae9' });
});

test('a counted field must be a whole number: slots, requests and tokens', async () => {
  const table = recorded('example-9b');
  table['/props'] = ok({ ...JSON.parse(fixture('example-9b/props.json')), total_slots: 2.5 });
  table['/metrics'] = ok('llamacpp:requests_processing 0.5\nllamacpp:requests_deferred 1\nllamacpp:n_tokens_max 3.5\n');
  const row = rowOf(await llamaServer.probe(fakeGet(table)));
  assert.equal(row.slotsTotal, 4, 'falls back to the four slots');
  assert.ok(!('activeRequests' in row));
  assert.ok(!('contextUsedPeak' in row));
  assert.equal(row.deferredRequests, 1);
});

test('a size that is the wrong shape in any answer never throws', async () => {
  const shapes = [ok('null'), ok('[]'), ok('{}'), ok('42'), ok('"x"'), ok('{"data":5}'), ok('{"data":[null]}'), ok('{"data":[{"meta":5}]}'), ok('[1,null,"a",{"id":"x"}]'), ok('{', 200), failed('TIMEOUT')];
  for (const shape of shapes) {
    for (const path of ['/props', '/slots', '/v1/models']) {
      const result = await llamaServer.probe(fakeGet({ ...recorded('example-9b'), [path]: shape }));
      assert.equal(result.ok, true, `${path} ${JSON.stringify(shape)}`);
      assert.equal(rowOf(result).state, 'up');
    }
  }
});

test('the result is plain data with no undefined value, so it survives a copy through JSON', async () => {
  const result = await llamaServer.probe(fakeGet(recorded('gpt-oss-20b')));
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test('PARTIAL_READ: a failed or odd answer from /props, /slots, /v1/models or /metrics adds the note, and the row stays up', async () => {
  for (const path of ['/props', '/slots', '/v1/models', '/metrics']) {
    for (const answer of [failed('TIMEOUT'), failed('CONNECTION_FAILED'), ok('boom', 500), ok('busy', 503)]) {
      const result = await llamaServer.probe(fakeGet({ ...recorded('example-9b'), [path]: answer }));
      assert.deepEqual(result.notes, ['PARTIAL_READ'], `${path} ${JSON.stringify(answer)}`);
      assert.equal(rowOf(result).state, 'up');
    }
  }
});

test('PARTIAL_READ: not added for a clean read, or for an endpoint that is switched off (404 or 501)', async () => {
  assert.deepEqual((await llamaServer.probe(fakeGet(recorded('example-9b')))).notes, []);
  for (const path of ['/props', '/slots', '/v1/models']) {
    for (const status of [404, 501]) assert.deepEqual((await llamaServer.probe(fakeGet({ ...recorded('example-9b'), [path]: ok('off', status) }))).notes, [], `${path} ${status}`);
  }
  const off = await llamaServer.probe(fakeGet({ ...recorded('example-9b'), '/metrics': failed('TIMEOUT') }));
  assert.deepEqual(off.notes, ['PARTIAL_READ']);
  const both = await llamaServer.probe(fakeGet({ ...recorded('example-9b'), '/metrics': ok('off', 404), '/slots': failed('TIMEOUT') }));
  assert.deepEqual(both.notes, ['PARTIAL_READ', 'METRICS_OFF']);
});
