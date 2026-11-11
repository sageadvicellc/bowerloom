// The loopback guard: only the address 127.0.0.1 and a whole port from 1 to 65535 pass. Everything else is refused at parse time, before any connection.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LOOPBACK_HOST, checkEndpoint, isLoopbackHost, parsePort } from '../../../dist/packages/local-models/src/guard.js';

test('the one host is 127.0.0.1', () => {
  assert.equal(LOOPBACK_HOST, '127.0.0.1');
  assert.equal(isLoopbackHost('127.0.0.1'), true);
});

test('every other host is refused: names, IPv6, the wildcard, private ranges, other loopback forms, padding, non-strings', () => {
  const refused = [
    'localhost', 'LOCALHOST', '::1', '[::1]', '::', '0.0.0.0', '192.168.1.10', '10.0.0.5', '172.16.0.1', '8.8.8.8', 'example.com', 'my-box.local', '127.0.0.2', '127.1', '0x7f.0.0.1', '2130706433',
    '::ffff:127.0.0.1', ' 127.0.0.1', '127.0.0.1 ', '127.0.0.1\n', '127.0.0.1:8080', 'http://127.0.0.1', '127.0.0.1.evil.test', '', 'a'.repeat(5000),
    null, undefined, 127, true, {}, [], ['127.0.0.1'],
  ];
  for (const host of refused) assert.equal(isLoopbackHost(host), false, String(host));
});

test('a port is a whole number from 1 to 65535, as a number', () => {
  assert.equal(parsePort(1), 1);
  assert.equal(parsePort(8091), 8091);
  assert.equal(parsePort(65535), 65535);
  for (const bad of [0, 65536, -1, 1.5, NaN, Infinity, -Infinity, '8091', '0', '', ' 80 ', null, undefined, true, {}, [8091], 1e9, Number.MAX_SAFE_INTEGER, 8091n]) assert.equal(parsePort(bad), null, String(bad));
});

test('an endpoint of a known provider and a good port passes, with or without the host', () => {
  assert.deepEqual(checkEndpoint({ provider: 'llama-server', port: 8091 }), { ok: true, provider: 'llama-server', port: 8091 });
  assert.deepEqual(checkEndpoint({ provider: 'ollama', port: 11434, host: '127.0.0.1' }), { ok: true, provider: 'ollama', port: 11434 });
  assert.deepEqual(checkEndpoint({ provider: 'lm-studio', port: 1234 }), { ok: true, provider: 'lm-studio', port: 1234 });
});

test('an endpoint with a host other than 127.0.0.1 is refused as NOT_LOOPBACK, whatever its port', () => {
  for (const host of ['localhost', '::1', '0.0.0.0', '192.168.1.10', '10.1.2.3', 'example.com', '127.0.0.2', '', null, 7]) {
    assert.deepEqual(checkEndpoint({ provider: 'llama-server', port: 8091, host }), { ok: false, code: 'NOT_LOOPBACK' }, String(host));
  }
});

test('an endpoint written as a URL or an address is refused as NOT_LOOPBACK: an endpoint is a port, not a URL', () => {
  for (const key of ['url', 'baseUrl', 'hostname', 'address', 'origin']) {
    assert.deepEqual(checkEndpoint({ provider: 'llama-server', port: 8091, [key]: 'http://127.0.0.1:8091' }), { ok: false, code: 'NOT_LOOPBACK' }, key);
  }
});

test('a bad port is BAD_PORT: zero, too large, a string, a fraction, missing', () => {
  for (const port of [0, 65536, '8091', 1.5, -5, NaN, null, undefined]) assert.deepEqual(checkEndpoint({ provider: 'llama-server', port }), { ok: false, code: 'BAD_PORT' }, String(port));
  assert.deepEqual(checkEndpoint({ provider: 'llama-server' }), { ok: false, code: 'BAD_PORT' });
});

test('an unknown or missing provider is UNKNOWN_PROVIDER', () => {
  for (const provider of ['vllm', '', 'LLAMA-SERVER', null, undefined, 5, {}]) assert.deepEqual(checkEndpoint({ provider, port: 8091 }), { ok: false, code: 'UNKNOWN_PROVIDER' }, String(provider));
  assert.deepEqual(checkEndpoint({ provider: 'toString', port: 8091 }), { ok: false, code: 'UNKNOWN_PROVIDER' });
  assert.deepEqual(checkEndpoint({ provider: '__proto__', port: 8091 }), { ok: false, code: 'UNKNOWN_PROVIDER' });
});

test('anything that is not a plain object, or carries a key the endpoint does not have, is BAD_ENDPOINT', () => {
  for (const raw of [null, undefined, 8091, '127.0.0.1:8091', true, [], [{ provider: 'llama-server', port: 8091 }]]) assert.deepEqual(checkEndpoint(raw), { ok: false, code: 'BAD_ENDPOINT' }, String(raw));
  assert.deepEqual(checkEndpoint({ provider: 'llama-server', port: 8091, extra: 1 }), { ok: false, code: 'BAD_ENDPOINT' });
  assert.deepEqual(checkEndpoint(JSON.parse('{"provider":"llama-server","port":8091,"__proto__":{"host":"x"}}')), { ok: false, code: 'BAD_ENDPOINT' });
});

test('the host check comes first: a bad host and a bad port together give NOT_LOOPBACK', () => {
  assert.deepEqual(checkEndpoint({ provider: 'nope', port: 0, host: 'example.com' }), { ok: false, code: 'NOT_LOOPBACK' });
});

test('the check never reads a getter twice and never throws on a hostile object', () => {
  let reads = 0;
  const hostile = { provider: 'llama-server', get port() { reads += 1; return 8091; } };
  assert.equal(checkEndpoint(hostile).ok, true);
  assert.ok(reads <= 1);
  const thrower = { provider: 'llama-server', get port() { throw new Error('boom'); } };
  assert.deepEqual(checkEndpoint(thrower), { ok: false, code: 'BAD_ENDPOINT' });
});
