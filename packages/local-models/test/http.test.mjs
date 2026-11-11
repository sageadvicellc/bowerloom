// The GET helper, against real servers that the test starts on 127.0.0.1 port 0 inside the test process. Nothing here leaves the loopback.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { DEFAULT_CAP, DEFAULT_TIMEOUT_MS, capFor, createGet } from '../../../dist/packages/local-models/src/http.js';

/** Starts a server on a free loopback port. The server and its sockets are closed when the test ends. */
async function serve(t, handler) {
  const hits = [];
  const server = http.createServer((req, res) => { hits.push({ method: req.method, url: req.url, host: req.headers.host }); handler(req, res); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  return { port: server.address().port, hits, server };
}

/** A port that nothing listens on: one that was free a moment ago. */
async function closedPort() {
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise(resolve => server.close(() => resolve()));
  return port;
}

const json = body => (req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };

test('the defaults: 800 ms, and a size limit by path that the spec names', () => {
  assert.equal(DEFAULT_TIMEOUT_MS, 800);
  assert.equal(capFor('/props'), 1024 * 1024);
  assert.equal(capFor('/slots'), 1024 * 1024);
  assert.equal(capFor('/metrics'), 256 * 1024);
  assert.equal(capFor('/v1/models'), 2 * 1024 * 1024);
  assert.equal(capFor('/health'), 16 * 1024);
  assert.equal(capFor('/other'), DEFAULT_CAP);
  assert.equal(capFor('constructor'), DEFAULT_CAP);
  assert.equal(capFor('__proto__'), DEFAULT_CAP);
});

test('a 200 answer gives its status and body, sent as a GET to 127.0.0.1 and the port', async t => {
  const { port, hits } = await serve(t, json({ status: 'ok' }));
  const result = await createGet(port)('/health');
  assert.deepEqual(result, { ok: true, status: 200, body: '{"status":"ok"}' });
  assert.deepEqual(hits, [{ method: 'GET', url: '/health', host: `127.0.0.1:${port}` }]);
});

test('a 404, a 501 and a 503 are answers, not failures', async t => {
  for (const status of [404, 501, 503]) {
    const { port } = await serve(t, (req, res) => { res.statusCode = status; res.end('no'); });
    assert.deepEqual(await createGet(port)('/metrics'), { ok: true, status, body: 'no' });
  }
});

test('a body that is not UTF-8 text still comes back as a string, and an empty body as an empty string', async t => {
  const a = await serve(t, (req, res) => { res.end(Buffer.from([0xff, 0xfe, 0x41])); });
  const got = await createGet(a.port)('/health');
  assert.equal(got.ok, true);
  assert.equal(typeof got.body, 'string');
  const b = await serve(t, (req, res) => { res.end(); });
  assert.deepEqual(await createGet(b.port)('/health'), { ok: true, status: 200, body: '' });
});

test('a closed port is CONNECTION_REFUSED', async () => {
  assert.deepEqual(await createGet(await closedPort())('/health'), { ok: false, code: 'CONNECTION_REFUSED' });
});

test('a server that never answers is TIMEOUT, at the limit and not much later', async t => {
  const { port } = await serve(t, () => {});
  const started = Date.now();
  assert.deepEqual(await createGet(port, { timeoutMs: 120 })('/health'), { ok: false, code: 'TIMEOUT' });
  assert.ok(Date.now() - started < 1500);
});

test('a server that sends a byte at a time is cut off at the total limit (slow loris)', async t => {
  const { port } = await serve(t, (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    const timer = setInterval(() => { res.write(' '); }, 15);
    res.on('close', () => { clearInterval(timer); });
  });
  const started = Date.now();
  assert.deepEqual(await createGet(port, { timeoutMs: 200 })('/props'), { ok: false, code: 'TIMEOUT' });
  assert.ok(Date.now() - started < 1500);
});

test('a body above the limit of its path is TOO_LARGE, whether or not the length was declared', async t => {
  const big = 'x'.repeat(40 * 1024);
  const declared = await serve(t, (req, res) => { res.setHeader('content-length', String(big.length)); res.end(big); });
  assert.deepEqual(await createGet(declared.port)('/health'), { ok: false, code: 'TOO_LARGE' });
  const chunked = await serve(t, (req, res) => { res.write(big); setTimeout(() => res.end(big), 10); });
  assert.deepEqual(await createGet(chunked.port)('/health'), { ok: false, code: 'TOO_LARGE' });
  // The same body is within the limit of /props.
  const props = await serve(t, (req, res) => { res.end(big); });
  const got = await createGet(props.port)('/props');
  assert.equal(got.ok && got.body.length, big.length);
});

test('a body just at the limit passes and one byte over fails', async t => {
  const cap = capFor('/metrics');
  const at = await serve(t, (req, res) => { res.end('a'.repeat(cap)); });
  assert.equal((await createGet(at.port)('/metrics')).ok, true);
  const over = await serve(t, (req, res) => { res.end('a'.repeat(cap + 1)); });
  assert.deepEqual(await createGet(over.port)('/metrics'), { ok: false, code: 'TOO_LARGE' });
});

test('a redirect is REDIRECT and is never followed, not even to another loopback port', async t => {
  const target = await serve(t, json({ followed: true }));
  for (const status of [301, 302, 307, 308]) {
    const { port } = await serve(t, (req, res) => { res.writeHead(status, { location: `http://127.0.0.1:${target.port}/health` }); res.end(); });
    assert.deepEqual(await createGet(port)('/health'), { ok: false, code: 'REDIRECT' }, String(status));
  }
  assert.equal(target.hits.length, 0);
});

test('a connection that breaks in the middle of a body is CONNECTION_FAILED', async t => {
  const { port } = await serve(t, (req, res) => { res.writeHead(200, { 'content-length': '1000' }); res.write('partial'); setTimeout(() => { req.socket.destroy(); }, 20); });
  assert.deepEqual(await createGet(port)('/health'), { ok: false, code: 'CONNECTION_FAILED' });
});

test('a path with anything but a safe character is BAD_PATH and opens no connection', async t => {
  const { port, hits } = await serve(t, json({}));
  const get = createGet(port);
  for (const path of ['', 'health', '/a b', '/a?x=1', '/a#b', 'http://127.0.0.1/health', '//evil.test/x', '/../etc/passwd', '/a/../b', '/a//b', '/a\r\nHost: evil', '/é', `/${'a'.repeat(300)}`, null, undefined, 5, {}]) {
    assert.deepEqual(await get(path), { ok: false, code: 'BAD_PATH' }, String(path));
  }
  assert.equal(hits.length, 0);
});

test('a bad port is BAD_PORT and opens no connection', async () => {
  for (const port of [0, 65536, -1, 1.5, '8091', null, undefined, NaN]) assert.deepEqual(await createGet(port)('/health'), { ok: false, code: 'BAD_PORT' }, String(port));
});

test('two reads at once are independent', async t => {
  const a = await serve(t, json({ n: 1 }));
  const b = await serve(t, json({ n: 2 }));
  const [x, y] = await Promise.all([createGet(a.port)('/health'), createGet(b.port)('/health')]);
  assert.equal(x.body, '{"n":1}');
  assert.equal(y.body, '{"n":2}');
});

test('the reads never reject', async () => {
  const results = await Promise.all([createGet(await closedPort())('/x'), createGet(0)('/x'), createGet(1)('bad')]);
  for (const r of results) assert.equal(r.ok, false);
});

test('no proxy is used, even when the proxy settings of the process name one', async t => {
  const names = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'NODE_USE_ENV_PROXY'];
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  t.after(() => { for (const name of names) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; } });
  for (const name of names) process.env[name] = name === 'NODE_USE_ENV_PROXY' ? '1' : 'http://127.0.0.1:9';
  const { port, hits } = await serve(t, json({ status: 'ok' }));
  const result = await createGet(port)('/health');
  assert.deepEqual(result, { ok: true, status: 200, body: '{"status":"ok"}' });
  assert.deepEqual(hits, [{ method: 'GET', url: '/health', host: `127.0.0.1:${port}` }], 'the request went straight to the server, as a plain path, not an absolute URL through a proxy');
});
