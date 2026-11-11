// The whole path with real sockets: servers that the test starts on 127.0.0.1 port 0 serve the recorded fixtures, and the service reads them through the real GET helper.
// The well-known default ports are never touched: the test only lets the real helper reach the ports it started.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { CONFIG_FILE_NAME } from '../../../dist/packages/local-models/src/config.js';
import { createGet } from '../../../dist/packages/local-models/src/http.js';
import { createLocalModels } from '../../../dist/packages/local-models/src/index.js';
import { failAll, fixture } from './support.mjs';

const SERVED = { '/health': 'health.json', '/props': 'props.json', '/slots': 'slots-idle.json', '/metrics': 'metrics.txt', '/v1/models': 'models.json' };

/** A llama-server that answers from a fixture folder. `override(path, res)` may answer a path itself and return true. */
async function llama(t, dir, override = () => false) {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    if (override(req.url, res)) return;
    const file = SERVED[req.url];
    if (file === undefined) { res.statusCode = 404; res.end('not found'); return; }
    res.setHeader('content-type', file.endsWith('.json') ? 'application/json' : 'text/plain');
    res.end(fixture(`${dir}/${file}`));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  return { port: server.address().port, hits };
}

async function closedPort() {
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise(resolve => server.close(() => resolve()));
  return port;
}

function service(t, ports, timeoutMs = 300) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-local-models-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, CONFIG_FILE_NAME), JSON.stringify({ endpoints: ports.map(port => ({ provider: 'llama-server', port })) }));
  const allowed = new Set(ports);
  const makeGet = port => (allowed.has(port) ? createGet(port, { timeoutMs }) : failAll('CONNECTION_REFUSED'));
  return createLocalModels({ stateRoot: root, makeGet, ttlMs: 0 });
}

test('two recorded servers over real sockets give two up rows with the recorded figures', async t => {
  const a = await llama(t, 'example-9b'), b = await llama(t, 'gpt-oss-20b');
  const report = await service(t, [a.port, b.port]).localModels();
  assert.deepEqual(report.models.map(m => m.state), ['up', 'up']);
  assert.deepEqual(report.models.map(m => m.quantization), ['Q8_0', 'MXFP4 MoE']);
  assert.deepEqual(report.models.map(m => m.slotsTotal), [4, 4]);
  assert.deepEqual(report.models.map(m => m.modelFile), ['Example-9B-Q8_0.gguf', 'gpt-oss-20b-MXFP4.gguf']);
  assert.equal(report.endpointsConfigured, 2);
  assert.deepEqual(a.hits.slice().sort(), Object.keys(SERVED).sort(), 'the five paths, once each');
});

test('a closed port is down, and the other server is not affected', async t => {
  const a = await llama(t, 'example-9b');
  const report = await service(t, [await closedPort(), a.port]).localModels();
  assert.deepEqual(report.models.map(m => [m.state, m.stateReason]), [['down', 'CONNECTION_REFUSED'], ['up', null]]);
});

test('a server that does not answer is unreachable at the limit', async t => {
  const silent = await llama(t, 'example-9b', () => true);
  const started = Date.now();
  const report = await service(t, [silent.port], 150).localModels();
  assert.deepEqual([report.models[0].state, report.models[0].stateReason], ['unreachable', 'TIMEOUT']);
  assert.ok(Date.now() - started < 2000);
});

test('a loading server (503 on /health) is starting', async t => {
  const loading = await llama(t, 'example-9b', (url, res) => { if (url !== '/health') return false; res.statusCode = 503; res.end(fixture('derived/health-loading.json')); return true; });
  const [m] = (await service(t, [loading.port]).localModels()).models;
  assert.deepEqual([m.state, m.stateReason], ['starting', 'LOADING']);
});

test('a server that started without metrics (404) is up, with METRICS_OFF', async t => {
  const noMetrics = await llama(t, 'example-9b', (url, res) => { if (url !== '/metrics') return false; res.statusCode = 404; res.end('nope'); return true; });
  const report = await service(t, [noMetrics.port]).localModels();
  assert.equal(report.models[0].state, 'up');
  assert.equal(report.models[0].activeRequests, null);
  assert.deepEqual(report.notes.map(n => n.code), ['METRICS_OFF']);
});

test('an oversize /props leaves its fields out and the server stays up', async t => {
  const big = await llama(t, 'example-9b', (url, res) => { if (url !== '/props') return false; res.end('x'.repeat(2 * 1024 * 1024)); return true; });
  const [m] = (await service(t, [big.port]).localModels()).models;
  assert.equal(m.state, 'up');
  assert.equal(m.build, null);
  assert.equal(m.modelFile, null);
  assert.equal(m.fileBytes, 9518764032, 'the model list still answers');
});

test('a redirect on /health makes the server unsupported, and the target is never called', async t => {
  const target = await llama(t, 'example-9b');
  const redirecting = await llama(t, 'example-9b', (url, res) => { res.writeHead(302, { location: `http://127.0.0.1:${target.port}${url}` }); res.end(); return true; });
  const [m] = (await service(t, [redirecting.port]).localModels()).models;
  assert.deepEqual([m.state, m.stateReason], ['unsupported', 'BAD_RESPONSE']);
  assert.deepEqual(target.hits, []);
});

test('a busy server with sentinel text in its slots: the sentinel is not in the report', async t => {
  const busy = await llama(t, 'example-9b', (url, res) => {
    if (url === '/slots') { res.setHeader('content-type', 'application/json'); res.end(fixture('derived/slots-busy-sentinel.json')); return true; }
    if (url === '/metrics') { res.end(fixture('derived/metrics-busy.txt')); return true; }
    return false;
  });
  const report = await service(t, [busy.port]).localModels();
  assert.equal(report.models[0].activeRequests, 1);
  assert.ok(!JSON.stringify(report).includes('SENTINEL'));
});
