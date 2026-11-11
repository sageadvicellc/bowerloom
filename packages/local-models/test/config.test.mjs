// The local models file: `local-models.json` in the state folder. Configured ports, plus the three well-known defaults. Loopback only, and no scan.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CONFIG_FILE_NAME, MAX_ENDPOINTS, WELL_KNOWN_ENDPOINTS, readEndpointConfig } from '../../../dist/packages/local-models/src/config.js';

function stateRoot(t, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-local-models-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  if (content !== undefined) fs.writeFileSync(path.join(dir, CONFIG_FILE_NAME), typeof content === 'string' ? content : JSON.stringify(content));
  return dir;
}
const ports = result => result.endpoints.map(e => `${e.provider}:${e.port}${e.configured ? '' : '?'}`);
const codes = result => result.notes.map(n => n.code);

test('the file is local-models.json, and the three well-known defaults are 8080, 11434 and 1234', () => {
  assert.equal(CONFIG_FILE_NAME, 'local-models.json');
  assert.deepEqual(WELL_KNOWN_ENDPOINTS.map(e => [e.provider, e.port]), [['llama-server', 8080], ['ollama', 11434], ['lm-studio', 1234]]);
  assert.ok(Object.isFrozen(WELL_KNOWN_ENDPOINTS));
  assert.equal(MAX_ENDPOINTS, 8);
});

test('no file: the three defaults only, none of them configured, and no note', t => {
  const result = readEndpointConfig(stateRoot(t));
  assert.deepEqual(ports(result), ['llama-server:8080?', 'ollama:11434?', 'lm-studio:1234?']);
  assert.equal(result.endpointsConfigured, 0);
  assert.deepEqual(result.notes, []);
  assert.equal(result.unreadable, false);
});

test('a file with two ports: the two come first and are configured, then the defaults that are not among them', t => {
  const result = readEndpointConfig(stateRoot(t, { endpoints: [{ provider: 'llama-server', port: 8091 }, { provider: 'llama-server', port: 8092 }] }));
  assert.deepEqual(ports(result), ['llama-server:8091', 'llama-server:8092', 'llama-server:8080?', 'ollama:11434?', 'lm-studio:1234?']);
  assert.equal(result.endpointsConfigured, 2);
  assert.deepEqual(result.notes, []);
});

test('a configured default port is one endpoint, configured, and is not listed twice', t => {
  const result = readEndpointConfig(stateRoot(t, { endpoints: [{ provider: 'llama-server', port: 8080 }] }));
  assert.deepEqual(ports(result), ['llama-server:8080', 'ollama:11434?', 'lm-studio:1234?']);
  assert.equal(result.endpointsConfigured, 1);
});

test('an empty list is valid: the defaults only, and zero configured', t => {
  const result = readEndpointConfig(stateRoot(t, { endpoints: [] }));
  assert.deepEqual(ports(result), ['llama-server:8080?', 'ollama:11434?', 'lm-studio:1234?']);
  assert.equal(result.endpointsConfigured, 0);
  assert.equal(result.unreadable, false);
});

test('the same endpoint written twice is read once', t => {
  const result = readEndpointConfig(stateRoot(t, { endpoints: [{ provider: 'llama-server', port: 8091 }, { provider: 'llama-server', port: 8091, host: '127.0.0.1' }] }));
  assert.equal(result.endpoints.filter(e => e.port === 8091).length, 1);
  assert.equal(result.endpointsConfigured, 1);
});

test('an endpoint with a host that is not 127.0.0.1 is refused with ENDPOINT_REFUSED_NOT_LOOPBACK, and the others are kept', t => {
  const result = readEndpointConfig(stateRoot(t, { endpoints: [
    { provider: 'llama-server', port: 8091, host: 'localhost' }, { provider: 'llama-server', port: 8092, host: '192.168.1.5' }, { provider: 'llama-server', port: 8093, url: 'http://10.0.0.2:8093' }, { provider: 'llama-server', port: 8094 },
  ] }));
  assert.deepEqual(result.endpoints.filter(e => e.configured).map(e => e.port), [8094]);
  assert.equal(result.endpointsConfigured, 1);
  assert.deepEqual(codes(result), ['ENDPOINT_REFUSED_NOT_LOOPBACK']);
  const [note] = result.notes;
  assert.ok(note.text.length > 0 && note.text.length < 200);
  assert.ok(!note.text.includes('192.168') && !note.text.includes('10.0.0.2'), 'the refused address is not repeated');
});

test('a bad port, an unknown provider and a bad entry each give their own note, once per code', t => {
  const result = readEndpointConfig(stateRoot(t, { endpoints: [
    { provider: 'llama-server', port: 0 }, { provider: 'llama-server', port: 70000 }, { provider: 'llama-server', port: '8091' }, { provider: 'vllm', port: 8000 }, 'x', null, [], { provider: 'llama-server', port: 8091, nope: 1 },
  ] }));
  assert.deepEqual([...codes(result)].sort(), ['ENDPOINT_REFUSED_BAD_ENDPOINT', 'ENDPOINT_REFUSED_BAD_PORT', 'ENDPOINT_REFUSED_UNKNOWN_PROVIDER']);
  assert.equal(result.endpointsConfigured, 0);
  assert.equal(result.unreadable, false);
});

test('more than 8 endpoints: the first 8 are kept, TOO_MANY_ENDPOINTS is noted, and no default is added', t => {
  const endpoints = Array.from({ length: 12 }, (_, i) => ({ provider: 'llama-server', port: 9000 + i }));
  const result = readEndpointConfig(stateRoot(t, { endpoints }));
  assert.equal(result.endpoints.length, 8);
  assert.deepEqual(result.endpoints.map(e => e.port), [9000, 9001, 9002, 9003, 9004, 9005, 9006, 9007]);
  assert.ok(result.endpoints.every(e => e.configured));
  assert.equal(result.endpointsConfigured, 8);
  assert.deepEqual(codes(result), ['TOO_MANY_ENDPOINTS']);
});

test('the defaults fill only the room that is left under the limit of 8', t => {
  const endpoints = Array.from({ length: 6 }, (_, i) => ({ provider: 'llama-server', port: 9000 + i }));
  const result = readEndpointConfig(stateRoot(t, { endpoints }));
  assert.equal(result.endpoints.length, 8);
  assert.deepEqual(ports(result).slice(6), ['llama-server:8080?', 'ollama:11434?']);
});

test('a file that cannot be read gives no endpoint at all and CONFIG_UNREADABLE: bad JSON, wrong shape, too large, empty', t => {
  const bad = ['{', '', 'null', '[]', '42', '"x"', '{}', '{"endpoints":5}', '{"endpoints":{"provider":"llama-server","port":1}}', `{"endpoints":[],"pad":"${'x'.repeat(20000)}"}`];
  for (const content of bad) {
    const result = readEndpointConfig(stateRoot(t, content));
    assert.deepEqual(result.endpoints, [], content.slice(0, 30));
    assert.deepEqual(codes(result), ['CONFIG_UNREADABLE'], content.slice(0, 30));
    assert.equal(result.unreadable, true);
    assert.equal(result.endpointsConfigured, 0);
  }
});

test('a byte order mark in front of good JSON is accepted', t => {
  const result = readEndpointConfig(stateRoot(t, `﻿${JSON.stringify({ endpoints: [{ provider: 'llama-server', port: 8091 }] })}`));
  assert.equal(result.unreadable, false);
  assert.equal(result.endpointsConfigured, 1);
});

test('a folder, a link and a missing state folder: a folder or a link is CONFIG_UNREADABLE, a missing folder is just no file', t => {
  const dir = stateRoot(t);
  fs.mkdirSync(path.join(dir, CONFIG_FILE_NAME));
  assert.deepEqual(codes(readEndpointConfig(dir)), ['CONFIG_UNREADABLE']);
  const linked = stateRoot(t);
  fs.writeFileSync(path.join(linked, 'real.json'), '{"endpoints":[]}');
  fs.symlinkSync(path.join(linked, 'real.json'), path.join(linked, CONFIG_FILE_NAME));
  assert.deepEqual(codes(readEndpointConfig(linked)), ['CONFIG_UNREADABLE']);
  const missing = readEndpointConfig(path.join(dir, 'does', 'not', 'exist'));
  assert.equal(missing.unreadable, false);
  assert.equal(missing.endpoints.length, 3);
});

test('a state root that is not a path is CONFIG_UNREADABLE and never throws', () => {
  for (const root of ['', null, undefined, 5, {}]) {
    const result = readEndpointConfig(root);
    assert.deepEqual(codes(result), ['CONFIG_UNREADABLE']);
    assert.deepEqual(result.endpoints, []);
  }
});

test('no note text holds a path, and the result is frozen', t => {
  const dir = stateRoot(t, '{');
  const result = readEndpointConfig(dir);
  assert.ok(!JSON.stringify(result).includes(dir));
  assert.ok(!JSON.stringify(result).includes(os.tmpdir()));
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.endpoints) && Object.isFrozen(result.notes));
});

test('the file is read again on every call, so an edit shows at the next probe', t => {
  const dir = stateRoot(t, { endpoints: [{ provider: 'llama-server', port: 8091 }] });
  assert.equal(readEndpointConfig(dir).endpointsConfigured, 1);
  fs.writeFileSync(path.join(dir, CONFIG_FILE_NAME), JSON.stringify({ endpoints: [] }));
  assert.equal(readEndpointConfig(dir).endpointsConfigured, 0);
});
