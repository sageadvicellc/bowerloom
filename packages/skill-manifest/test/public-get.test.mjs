import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import dns from 'node:dns/promises';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { denyNetwork } from './support/fixtures.mjs';
import { createPublicTransport, PUBLIC_HOSTS, PUBLIC_GET_LIMITS } from '../../../dist/packages/skill-manifest/src/public-get.js';

const denied = denyNetwork();
test.after(() => assert.deepEqual(denied, [], 'every request in this file goes to the fake'));
const code = expected => error => error?.code === expected && !/PRIVATE/.test(error.message);
const signal = () => new AbortController().signal;
const URL_NPM = 'https://registry.npmjs.org/@synthetic/db-skills/0.0.1';
const URL_GIT = 'https://api.github.com/repos/synthetic-owner/skills-repo/git/commits/' + 'c'.repeat(40);

/** A fake https.request and dns.lookup. `respond(count, url)` picks each response; the default is a 200 with `body`. */
function network(t, respond = () => ({}), address = '104.16.25.34') {
  const calls = [], lookups = [];
  t.mock.method(dns, 'lookup', async (host, options) => { lookups.push({ host, options }); return Array.isArray(address) ? address : [{ address, family: address.includes(':') ? 6 : 4 }]; });
  t.mock.method(https, 'request', (url, options, callback) => {
    const req = new EventEmitter(); req.destroyed = false; req.destroy = () => { req.destroyed = true; return req; };
    req.end = () => {
      calls.push({ url, options });
      const chosen = respond(calls.length, url) ?? {};
      // The pinned lookup is the only resolver the request may use.
      options.lookup(new URL(url).hostname, { all: true }, (error, addresses) => { calls.at(-1).pinned = error ? null : addresses; });
      queueMicrotask(() => {
        if (req.destroyed) return;
        if (chosen.error) { req.emit('error', chosen.error); return; }
        if (chosen.stall) return;
        const body = chosen.body ?? Buffer.from('{"ok":true}');
        const res = new EventEmitter(); res.destroyed = false; res.destroy = () => { res.destroyed = true; return res; };
        res.statusCode = chosen.status ?? 200; res.complete = chosen.complete ?? true; res.rawHeaders = chosen.headers ?? ['Content-Length', String(body.length)];
        callback(res);
        if (!res.destroyed) { for (const chunk of chosen.chunks ?? [body]) { if (res.destroyed) break; res.emit('data', chunk); } if (!chosen.noEnd && !res.destroyed) res.emit('end'); }
      });
      return req;
    };
    return req;
  });
  syncBuiltinESMExports();
  return { calls, lookups };
}

test('a GET to an allowed host returns the body, over TLS 1.2 or later, through a pinned public address', async t => {
  const n = network(t, () => ({ body: Buffer.from('{"name":"x"}') })), transport = createPublicTransport();
  t.after(() => transport.close());
  assert.deepEqual([...PUBLIC_HOSTS], ['registry.npmjs.org', 'api.github.com']);
  assert.equal((await transport.get(URL_NPM, 1024, signal())).toString(), '{"name":"x"}');
  const { options, pinned } = n.calls[0];
  assert.equal(options.method, 'GET'); assert.equal(options.rejectUnauthorized, true); assert.equal(options.minVersion, 'TLSv1.2');
  assert.equal(options.maxHeaderSize, 16384); assert.deepEqual(pinned, [{ address: '104.16.25.34', family: 4 }]);
  assert.equal(options.agent.options.keepAlive, false); assert.deepEqual(options.agent.options.proxyEnv, {});
  assert.deepEqual(Object.keys(options.headers).sort(), ['Accept', 'Accept-Encoding', 'User-Agent']);
  assert.equal(options.headers['Accept-Encoding'], 'identity');
  assert.deepEqual(n.lookups.map(l => [l.host, l.options.all]), [['registry.npmjs.org', true]]);
  // GitHub gets its JSON media type and API version. Each host is looked up once per transport.
  await transport.get(URL_GIT, 1024, signal()); await transport.get(URL_GIT, 1024, signal());
  assert.equal(n.calls[1].options.headers.Accept, 'application/vnd.github+json'); assert.equal(n.calls[1].options.headers['X-GitHub-Api-Version'], '2026-03-10');
  assert.deepEqual(n.lookups.map(l => l.host), ['registry.npmjs.org', 'api.github.com']);
});

test('no Authorization header is sent, and proxy settings and credentials in the environment are ignored', async t => {
  const saved = { ...process.env };
  t.after(() => { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); });
  Object.assign(process.env, { HTTPS_PROXY: 'http://proxy.invalid:3128', https_proxy: 'http://proxy.invalid:3128', HTTP_PROXY: 'http://proxy.invalid:3128', NODE_USE_ENV_PROXY: '1', NPM_TOKEN: 'PRIVATE_TOKEN', GITHUB_TOKEN: 'PRIVATE_TOKEN', GH_TOKEN: 'PRIVATE_TOKEN', NODE_EXTRA_CA_CERTS: '/tmp/PRIVATE.pem' });
  const n = network(t), transport = createPublicTransport(); t.after(() => transport.close());
  await transport.get(URL_NPM, 1024, signal()); await transport.get(URL_GIT, 1024, signal());
  for (const { url, options } of n.calls) {
    assert.ok(url === URL_NPM || url === URL_GIT); assert.deepEqual(options.agent.options.proxyEnv, {});
    const names = Object.keys(options.headers).map(k => k.toLowerCase());
    for (const name of ['authorization', 'proxy-authorization', 'cookie']) assert.equal(names.includes(name), false);
    assert.doesNotMatch(JSON.stringify(options.headers), /PRIVATE/);
    assert.equal(options.auth, undefined);
  }
});

test('an unlisted host, another scheme or port, credentials in the URL or an odd path are refused before any lookup', async t => {
  const n = network(t), transport = createPublicTransport(); t.after(() => transport.close());
  for (const url of ['https://example.com/x', 'http://registry.npmjs.org/x', 'https://registry.npmjs.org:8443/x', 'https://user:pw@registry.npmjs.org/x', 'https://registry.npmjs.org.evil.example/x', 'https://REGISTRY.npmjs.org/x', 'https://registry.npmjs.org/a/../b', 'https://registry.npmjs.org/x#y', 'https://registry.npmjs.org/x?y=1', 'https://api.github.com/x?recursive=2', 'https://github.com/o/r', 'https://raw.githubusercontent.com/o/r/x', 'https://registry.npmjs.org/x y', 'https://104.16.25.34/x', 'file:///etc/passwd', 'not a url']) {
    await assert.rejects(transport.get(url, 1024, signal()), code('SKILLS_ADD_HOST_REFUSED'), url);
  }
  assert.equal(n.lookups.length, 0); assert.equal(n.calls.length, 0);
});

test('private, loopback, link-local, special-use and IPv6 answers are refused before any request', async t => {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '192.0.0.8', '198.18.0.1', '::1', '::ffff:127.0.0.1', '2606:4700::1', 'fe80::1']) {
    const n = network(t, () => ({}), address), transport = createPublicTransport();
    await assert.rejects(transport.get(URL_NPM, 1024, signal()), code('SKILLS_ADD_HOST_REFUSED'), address);
    assert.equal(n.calls.length, 0, address); transport.close(); t.mock.restoreAll();
  }
  // One private answer among public ones refuses too, as does an empty or oversized answer.
  for (const address of [[{ address: '104.16.25.34', family: 4 }, { address: '10.0.0.1', family: 4 }], [], Array.from({ length: 17 }, () => ({ address: '104.16.25.34', family: 4 }))]) {
    const n = network(t, () => ({}), address), transport = createPublicTransport();
    await assert.rejects(transport.get(URL_NPM, 1024, signal()), e => ['SKILLS_ADD_HOST_REFUSED', 'SKILLS_ADD_NETWORK'].includes(e.code)); assert.equal(n.calls.length, 0); transport.close(); t.mock.restoreAll();
  }
  network(t); t.mock.method(dns, 'lookup', async () => { throw new Error('PRIVATE_DNS'); });
  const transport = createPublicTransport(); await assert.rejects(transport.get(URL_NPM, 1024, signal()), code('SKILLS_ADD_NETWORK')); transport.close();
});

test('a 3xx is never followed, and other statuses refuse; a 404 is not found', async t => {
  for (const [response, expected] of [[{ status: 301, headers: ['Location', 'https://evil.example/', 'Content-Length', '0'] }, 'SKILLS_ADD_NETWORK'], [{ status: 302, headers: ['Location', 'https://registry.npmjs.org/y'] }, 'SKILLS_ADD_NETWORK'], [{ status: 307 }, 'SKILLS_ADD_NETWORK'], [{ status: 308 }, 'SKILLS_ADD_NETWORK'], [{ status: 200, headers: ['Location', 'https://registry.npmjs.org/y', 'Content-Length', '11'] }, 'SKILLS_ADD_NETWORK'], [{ status: 401 }, 'SKILLS_ADD_NETWORK'], [{ status: 500 }, 'SKILLS_ADD_NETWORK'], [{ status: 404 }, 'SKILLS_ADD_NOT_FOUND'], [{ status: 422 }, 'SKILLS_ADD_NOT_FOUND']]) {
    const n = network(t, () => response), transport = createPublicTransport();
    await assert.rejects(transport.get(URL_GIT, 1024, signal()), code(expected), JSON.stringify(response)); assert.equal(n.calls.length, 1); transport.close(); t.mock.restoreAll();
  }
});

test('an oversize body is refused by its declared length and by its bytes', async t => {
  for (const response of [{ body: Buffer.alloc(2048) }, { headers: ['Content-Length', '4096'], body: Buffer.alloc(10) }, { headers: [], chunks: [Buffer.alloc(600), Buffer.alloc(600)] }]) {
    network(t, () => response); const transport = createPublicTransport();
    await assert.rejects(transport.get(URL_NPM, 1024, signal()), code('SKILLS_ADD_UNSAFE_CONTENT')); transport.close(); t.mock.restoreAll();
  }
  network(t); const transport = createPublicTransport();
  for (const max of [0, -1, 1.5, PUBLIC_GET_LIMITS.responseBytes + 1, '1024']) await assert.rejects(transport.get(URL_NPM, max, signal()), code('SKILLS_ADD_UNSAFE_CONTENT'));
  transport.close();
});

test('header gates: encodings, repeated guarded headers, too many pairs, odd framing and an incomplete body refuse', async t => {
  const many = Array.from({ length: 129 }, (_, i) => [`X-H${i}`, 'v']).flat();
  for (const response of [{ headers: ['Content-Encoding', 'gzip', 'Content-Length', '11'] }, { headers: ['Content-Length', '11', 'Content-Length', '11'] }, { headers: ['Content-Type', 'a', 'content-type', 'b', 'Content-Length', '11'] }, { headers: [...many, 'Content-Length', '11'] }, { headers: ['Transfer-Encoding', 'gzip, chunked'] }, { headers: ['Content-Length', '11x'] }, { headers: ['Content-Length', '20'] }, { complete: false }, { error: new Error('PRIVATE_SOCKET') }]) {
    network(t, () => response); const transport = createPublicTransport();
    await assert.rejects(transport.get(URL_NPM, 1024, signal()), code('SKILLS_ADD_NETWORK'), JSON.stringify(response.headers ?? response).slice(0, 60)); transport.close(); t.mock.restoreAll();
  }
  // Repeats of a header nothing reads are ignored (D11).
  network(t, () => ({ headers: ['Set-Cookie', 'a=1', 'Set-Cookie', 'b=2', 'Content-Length', '11'] })); const transport = createPublicTransport();
  assert.equal((await transport.get(URL_NPM, 1024, signal())).length, 11); transport.close();
});

test('time and request bounds: a stalled response times out, an abort stops it, and the request budget holds', async t => {
  network(t, () => ({ stall: true }));
  const slow = createPublicTransport({ requestMs: 30 }); await assert.rejects(slow.get(URL_NPM, 1024, signal()), code('SKILLS_ADD_NETWORK')); slow.close();
  const whole = createPublicTransport({ durationMs: 40 }); await assert.rejects(whole.get(URL_NPM, 1024, signal()), code('SKILLS_ADD_NETWORK')); whole.close();
  const controller = new AbortController(), aborted = createPublicTransport();
  const pending = aborted.get(URL_NPM, 1024, controller.signal); setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, code('SKILLS_ADD_NETWORK')); aborted.close();
  const before = new AbortController(); before.abort(); const early = createPublicTransport();
  await assert.rejects(early.get(URL_NPM, 1024, before.signal), code('SKILLS_ADD_NETWORK')); early.close();
  t.mock.restoreAll();
  const n = network(t), budget = createPublicTransport({ requests: 2 });
  await budget.get(URL_NPM, 1024, signal()); await budget.get(URL_NPM, 1024, signal());
  await assert.rejects(budget.get(URL_NPM, 1024, signal()), code('SKILLS_ADD_UNSAFE_CONTENT')); assert.equal(n.calls.length, 2); budget.close();
  const closed = createPublicTransport(); closed.close(); await assert.rejects(closed.get(URL_NPM, 1024, signal()), code('SKILLS_ADD_NETWORK'));
  for (const options of [{ requests: 0 }, { requests: PUBLIC_GET_LIMITS.requests + 1 }, { durationMs: PUBLIC_GET_LIMITS.durationMs + 1 }, { requestMs: -1 }, { other: 1 }]) assert.throws(() => createPublicTransport(options), code('SKILLS_ADD_NETWORK'));
});
