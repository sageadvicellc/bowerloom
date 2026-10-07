import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import http from 'node:http';
import { GUARDED_RESPONSE_HEADERS, MAX_RESPONSE_HEADER_PAIRS, guardedResponseHeaders } from '../../../dist/packages/skill-sources/src/response-headers.js';

const recorded = JSON.parse(fs.readFileSync(new URL('./fixtures/npm-registry-headers-2026-10-07.json', import.meta.url), 'utf8'));
const CANARY = 'PRIVATE_HEADER_VALUE';

test('the guarded set is a fixed allowlist of read or body-framing header names', () => {
  assert.deepEqual([...GUARDED_RESPONSE_HEADERS], ['content-encoding', 'content-length', 'content-range', 'content-type', 'location', 'transfer-encoding']);
  assert.ok(Object.isFrozen(GUARDED_RESPONSE_HEADERS));
  assert.throws(() => GUARDED_RESPONSE_HEADERS.push('set-cookie'), TypeError);
  for (const ignored of ['set-cookie', 'date', 'server', 'cf-ray', 'vary', 'etag', 'link']) assert.equal(GUARDED_RESPONSE_HEADERS.includes(ignored), false, ignored);
});

test('repeats of names nothing reads are ignored and kept out of the result', () => {
  const headers = guardedResponseHeaders(['Set-Cookie', CANARY + '-a', 'set-cookie', CANARY + '-b', 'Vary', 'Accept', 'Vary', 'Origin', 'Content-Length', '12']);
  assert.ok(headers instanceof Map);
  assert.deepEqual([...headers], [['content-length', '12']]);
  assert.equal(guardedResponseHeaders([])?.size, 0);
});

test('the recorded registry header names pass', () => {
  const raw = recorded.headerNames.flatMap(name => [name, name === 'content-length' ? String(recorded.contentLength) : name === 'content-type' ? recorded.contentType : CANARY]);
  const headers = guardedResponseHeaders(raw);
  assert.deepEqual([...headers], [['content-type', 'application/json'], ['content-length', '1926']]);
});

test('a repeated guarded name refuses in any letter case', () => {
  for (const name of GUARDED_RESPONSE_HEADERS) {
    assert.equal(guardedResponseHeaders([name, 'x', name, 'x']), null, name);
    assert.equal(guardedResponseHeaders([name.toUpperCase(), 'x', 'set-cookie', 'y', name, 'x']), null, name);
  }
});

test('a malformed raw header list refuses', () => {
  assert.equal(guardedResponseHeaders(['content-length']), null);
  assert.equal(guardedResponseHeaders(['set-cookie', 'a', 'server']), null);
  assert.equal(guardedResponseHeaders([7, '1']), null);
  assert.equal(guardedResponseHeaders(['content-length', 7]), null);
  assert.equal(guardedResponseHeaders(undefined), null);
});

// Header flood (security review of 48257d5, finding 1). Node keeps about 2000 raw entries and drops the rest without an error.
const padding = count => Array.from({ length: count }, (_, i) => ['x-pad-' + i, 'a']).flat();
test('the raw header list is capped at 128 pairs, far below the point where Node drops headers', () => {
  assert.equal(MAX_RESPONSE_HEADER_PAIRS, 128);
  const atCap = guardedResponseHeaders(['Content-Length', '12', ...padding(127)]);
  assert.deepEqual([...atCap], [['content-length', '12']]);
  assert.equal(guardedResponseHeaders(['Content-Length', '12', ...padding(128)]), null);
  assert.equal(guardedResponseHeaders(padding(129)), null);
  // The shape Node hands over after it dropped a repeat: one guarded name, then padding up to its cap.
  assert.equal(guardedResponseHeaders(['Content-Type', 'application/json', ...padding(999)]), null);
});
async function served(t, paddingCount) {
  const pad = Array.from({ length: paddingCount }, (_, i) => `p${i}: a\r\n`).join('');
  const server = net.createServer(socket => socket.once('data', () => socket.end('HTTP/1.1 200 OK\r\nContent-Length: 2\r\nContent-Type: application/json\r\n' + pad + 'Content-Type: text/html\r\nConnection: close\r\n\r\nok')));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: server.address().port, agent: false, maxHeaderSize: 16384 }, res => { res.resume(); resolve(res.rawHeaders); }).on('error', reject);
  });
}
const contentTypes = raw => raw.filter((name, i) => i % 2 === 0 && name.toLowerCase() === 'content-type').length;
test('a guarded repeat after 1000 padding headers refuses, including when Node dropped the repeat', async t => {
  // At 1000 padding headers Node 24 still keeps every pair; the 128-pair cap refuses the list.
  const kept = await served(t, 1000);
  assert.equal(kept.length, 2 * 1004); assert.equal(contentTypes(kept), 2);
  assert.equal(guardedResponseHeaders(kept), null);
  // At 1100 Node stops near 1000 pairs and drops the rest without an error, so the repeat never reaches the guard.
  const dropped = await served(t, 1100);
  assert.ok(dropped.length < 2 * 1104, String(dropped.length)); assert.equal(contentTypes(dropped), 1);
  assert.equal(guardedResponseHeaders(dropped), null);
});
