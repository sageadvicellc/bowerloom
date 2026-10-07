import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GUARDED_RESPONSE_HEADERS, guardedResponseHeaders } from '../../../dist/packages/skill-sources/src/response-headers.js';

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
