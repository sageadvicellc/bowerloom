// Spec 07, section 10: the Authorization header of the public transport. https.request and dns.lookup are stubbed as in
// public-get.test.mjs, so no request leaves this process.
import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import dns from 'node:dns/promises';
import util from 'node:util';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { denyNetwork } from './support/fixtures.mjs';
import { createPublicTransport } from '../../../dist/packages/skill-manifest/src/public-get.js';
import { GithubToken } from '../../../dist/packages/skill-manifest/src/github-token.js';

const denied = denyNetwork();
test.after(() => assert.deepEqual(denied, [], 'every request in this file goes to the fake'));
const CANARY = 'ghp_' + ('ghijklmnopqrstuvwxyz' + 'zyxwvutsrqponmlkjh').slice(0, 36);
const token = () => GithubToken.fromEnv({ BOWERLOOM_GITHUB_TOKEN: CANARY });
const SHA = 'c'.repeat(40);
const signal = () => new AbortController().signal;
const auth = (repositories = ['owner/repo']) => ({ githubAuth: { token: token(), repositories } });
const parts = (value, n = 8) => Array.from({ length: value.length - n + 1 }, (_, i) => value.slice(i, i + n));
/** True when nothing in the error, its stack, or its inspection holds any 8 characters of the canary. */
const clean = error => { const all = `${error?.code} ${error?.message} ${error?.stack} ${util.inspect(error, { showHidden: true, depth: 8 })} ${JSON.stringify(error)}`; return !parts(CANARY).some(p => all.includes(p)) && !all.includes('ghp_'); };
const code = expected => error => error?.code === expected && clean(error);

/** A fake https.request and dns.lookup; `respond(count, url)` picks each response, the default a 200. */
function network(t, respond = () => ({}), address = '104.16.25.34') {
  const calls = [];
  t.mock.method(dns, 'lookup', async () => (Array.isArray(address) ? address : [{ address, family: address.includes(':') ? 6 : 4 }]));
  t.mock.method(https, 'request', (url, options, callback) => {
    const req = new EventEmitter(); req.destroyed = false; req.destroy = () => { req.destroyed = true; return req; };
    const set = {};
    req.setHeader = (name, value) => { set[name] = value; };
    req.end = () => {
      calls.push({ url, options, set });
      const chosen = respond(calls.length, url) ?? {};
      options.lookup(new URL(url).hostname, { all: true }, () => {});
      queueMicrotask(() => {
        if (req.destroyed) return;
        const body = chosen.body ?? Buffer.from('{"ok":true}');
        const res = new EventEmitter(); res.destroyed = false; res.destroy = () => { res.destroyed = true; return res; };
        res.statusCode = chosen.status ?? 200; res.complete = chosen.complete ?? true; res.rawHeaders = chosen.headers ?? ['Content-Length', String(body.length)];
        res.headers = Object.fromEntries((chosen.headers ?? []).reduce((pairs, v, i, all) => i % 2 ? pairs : [...pairs, [all[i].toLowerCase(), all[i + 1]]], []));
        callback(res);
        for (const chunk of chosen.chunks ?? [chosen.chunk ?? body]) if (!res.destroyed) res.emit('data', chunk);
        if (!res.destroyed && !chosen.noEnd) res.emit('end');
      });
      return req;
    };
    return req;
  });
  syncBuiltinESMExports();
  return { calls };
}
// Review H1 of PR 97: the header is set on the request with setHeader, never in the request options, because Node's
// https debug output prints the options. `header` reads where it was set; `inOptions` must stay undefined.
const header = call => Object.entries(call.set).find(([k]) => k.toLowerCase() === 'authorization')?.[1];
const inOptions = call => Object.keys(call.options.headers).find(k => k.toLowerCase() === 'authorization');

test('1. with no githubAuth, no request has an Authorization header', async t => {
  for (const options of [{}, { githubAuth: null }, undefined]) {
    const n = network(t), transport = createPublicTransport(options);
    await transport.get(`https://api.github.com/repos/owner/repo/git/commits/${SHA}`, 1024, signal());
    await transport.get('https://registry.npmjs.org/@synthetic/pkg', 1024, signal());
    for (const call of n.calls) assert.equal(header(call), undefined);
    transport.close(); t.mock.restoreAll();
  }
});

test('2, 3, 4, 5, 6 and 6a. the header goes only to the git endpoints of an approved repository, compared in lower case', async t => {
  const n = network(t), transport = createPublicTransport(auth(['owner/repo'])); t.after(() => transport.close());
  const cases = [
    [`https://api.github.com/repos/owner/repo/git/commits/${SHA}`, true],
    [`https://api.github.com/repos/owner/repo/git/trees/${SHA}`, true],
    [`https://api.github.com/repos/owner/repo/git/trees/${SHA}?recursive=1`, true],
    [`https://api.github.com/repos/owner/repo/git/blobs/${SHA}`, true],
    [`https://api.github.com/repos/Owner/Repo/git/trees/${SHA}`, true],
    [`https://api.github.com/repos/other/repo/git/commits/${SHA}`, false],
    ['https://registry.npmjs.org/@synthetic/pkg', false],
    ['https://registry.npmjs.org/@synthetic/pkg/-/pkg-1.0.0.tgz', false],
    [`https://api.github.com/repos/owner/repo-two/git/commits/${SHA}`, false],
    [`https://api.github.com/repos/owner/repox/git/commits/${SHA}`, false],
    ['https://api.github.com/repos/owner/repo/contents/x', false],
    [`https://api.github.com/repos/owner/repo/git/commits/${'c'.repeat(39)}`, false],
    [`https://api.github.com/repos/owner/repo/git/commits/${'C'.repeat(40)}`, false],
    [`https://api.github.com/repos/owner/repo/git/refs/${SHA}`, false],
    [`https://api.github.com/repos/owner/repo/git/commits/${SHA}/x`, false],
    [`https://api.github.com/repos/owner/repo/tarball/${SHA}`, false],
    [`https://api.github.com/repos/owner/repo/git/commits/${SHA}?recursive=1`, true],
    [`https://api.github.com/repos/owner/repo/git/blobs/${SHA}?recursive=1`, true],
    [`https://api.github.com/repos/owner/repo/../other/git/commits/${SHA}`, null],
    [`https://api.github.com/repos/owner%2Frepo/x/git/commits/${SHA}`, false],
    [`https://api.github.com/repos/owner/repo%2Fx/git/commits/${SHA}`, false],
  ];
  for (const [url, expected] of cases) {
    const before = n.calls.length;
    if (expected === null) { await assert.rejects(transport.get(url, 1024, signal()), code('SKILLS_ADD_HOST_REFUSED'), url); assert.equal(n.calls.length, before); continue; }
    await transport.get(url, 1024, signal());
    const call = n.calls.at(-1);
    assert.equal(call.url, url);
    if (expected) assert.equal(header(call), `Bearer ${CANARY}`, url); else assert.equal(header(call), undefined, url);
    assert.equal(inOptions(call), undefined, url); assert.equal(JSON.stringify(call.options).includes(CANARY), false, url);
    // The other headers are the ones of spec 06, unchanged.
    const names = Object.keys(call.options.headers).sort();
    assert.deepEqual(names, url.startsWith('https://api.github.com/') ? ['Accept', 'Accept-Encoding', 'User-Agent', 'X-GitHub-Api-Version'] : ['Accept', 'Accept-Encoding', 'User-Agent'], url);
    assert.equal(call.options.auth, undefined);
  }
});

test('two approved repositories each get the header; a third does not', async t => {
  const n = network(t), transport = createPublicTransport(auth(['a-org/one', 'b-org/two.x'])); t.after(() => transport.close());
  for (const [repo, expected] of [['a-org/one', true], ['b-org/two.x', true], ['c-org/three', false], ['a-org/two.x', false]]) {
    await transport.get(`https://api.github.com/repos/${repo}/git/commits/${SHA}`, 1024, signal());
    assert.equal(header(n.calls.at(-1)) !== undefined, expected, repo);
  }
});

test('7 and 7a. a 401 or a 403 that is not the rate limit, with the header, is STORE_REMOTE_AUTH_FAILED; without it, spec 06 holds', async t => {
  const approved = `https://api.github.com/repos/owner/repo/git/commits/${SHA}`, other = `https://api.github.com/repos/other/repo/git/commits/${SHA}`;
  const cases = [
    [auth(), approved, { status: 401 }, 'STORE_REMOTE_AUTH_FAILED'],
    [auth(), approved, { status: 403, headers: ['x-ratelimit-remaining', '4999', 'Content-Length', '2'] }, 'STORE_REMOTE_AUTH_FAILED'],
    [auth(), approved, { status: 403, headers: ['x-ratelimit-remaining', '0', 'Content-Length', '2'] }, 'GITHUB_RATE_LIMITED'],
    [auth(), approved, { status: 403, headers: ['retry-after', '60', 'Content-Length', '2'] }, 'GITHUB_RATE_LIMITED'],
    [auth(), approved, { status: 429 }, 'GITHUB_RATE_LIMITED'],
    [auth(), approved, { status: 500 }, 'GITHUB_REQUEST_FAILED'],
    // No header on this request, so spec 06 decides, as it does with no token at all.
    [auth(), other, { status: 401 }, 'GITHUB_REQUEST_FAILED'],
    [auth(), other, { status: 403, headers: ['x-ratelimit-remaining', '4999', 'Content-Length', '2'] }, 'GITHUB_REQUEST_FAILED'],
    [{}, approved, { status: 401 }, 'GITHUB_REQUEST_FAILED'],
    [{}, approved, { status: 403, headers: ['x-ratelimit-remaining', '4999', 'Content-Length', '2'] }, 'GITHUB_REQUEST_FAILED'],
    [{}, approved, { status: 403, headers: ['x-ratelimit-remaining', '0', 'Content-Length', '2'] }, 'GITHUB_RATE_LIMITED'],
  ];
  for (const [options, url, response, expected] of cases) {
    const n = network(t, () => response), transport = createPublicTransport(options);
    await assert.rejects(transport.get(url, 1024, signal()), code(expected), `${JSON.stringify(response)} ${url}`);
    assert.equal(n.calls.length, 1); transport.close(); t.mock.restoreAll();
  }
});

test('8. a response with a Location header is refused, and no second request is made, with or without the header', async t => {
  for (const response of [{ status: 301, headers: ['Location', 'https://evil.example/', 'Content-Length', '0'] }, { status: 302, headers: ['Location', 'https://api.github.com/repos/other/repo/git/commits/' + SHA, 'Content-Length', '0'] }, { status: 307 }, { status: 200, headers: ['Location', 'https://evil.example/', 'Content-Length', '11'] }]) {
    const n = network(t, () => response), transport = createPublicTransport(auth());
    await assert.rejects(transport.get(`https://api.github.com/repos/owner/repo/git/commits/${SHA}`, 1024, signal()), code('SKILLS_ADD_NETWORK'), JSON.stringify(response));
    assert.equal(n.calls.length, 1); transport.close(); t.mock.restoreAll();
  }
});

test('9. a 404 is SKILLS_ADD_NOT_FOUND, with and without the header', async t => {
  for (const options of [auth(), {}]) {
    const n = network(t, () => ({ status: 404 })), transport = createPublicTransport(options);
    await assert.rejects(transport.get(`https://api.github.com/repos/owner/repo/git/commits/${SHA}`, 1024, signal()), code('SKILLS_ADD_NOT_FOUND'));
    assert.equal(n.calls.length, 1); transport.close(); t.mock.restoreAll();
  }
});

test('10. createPublicTransport refuses a githubAuth that is not a GithubToken, or that names 0, more than 8, or a malformed repository', () => {
  const bad = [
    { token: 'ghp_' + 'g'.repeat(36), repositories: ['owner/repo'] },
    { token: { authorization: () => `Bearer ${CANARY}` }, repositories: ['owner/repo'] },
    { token: Object.create(GithubToken.prototype), repositories: ['owner/repo'] },
    { token: token(), repositories: [] },
    { token: token(), repositories: Array.from({ length: 9 }, (_, i) => `owner/repo${i}`) },
    { token: token(), repositories: ['Owner/repo'] }, { token: token(), repositories: ['owner'] }, { token: token(), repositories: ['owner/repo/x'] },
    { token: token(), repositories: ['-owner/repo'] }, { token: token(), repositories: ['owner/re po'] }, { token: token(), repositories: ['owner/'] },
    { token: token(), repositories: [`${'a'.repeat(40)}/repo`] }, { token: token(), repositories: [`owner/${'a'.repeat(101)}`] }, { token: token(), repositories: [1] },
    { token: token(), repositories: 'owner/repo' }, { token: token() }, { repositories: ['owner/repo'] },
    { token: token(), repositories: ['owner/repo'], extra: true }, 'githubAuth', 1,
  ];
  // Review F4 of PR 97: a malformed githubAuth is a fault of the caller, not a refusal a person can act on.
  for (const githubAuth of bad) assert.throws(() => createPublicTransport({ githubAuth }), e => e instanceof TypeError && clean(e), util.inspect(githubAuth).slice(0, 80));
  const eight = createPublicTransport({ githubAuth: { token: token(), repositories: Array.from({ length: 8 }, (_, i) => `owner/repo.${i}`) } }); eight.close();
  const one = createPublicTransport({ githubAuth: { token: token(), repositories: ['a/b'] } }); one.close();
});

test('11. the error of any failed request carries no part of the token', async t => {
  const url = `https://api.github.com/repos/owner/repo/git/commits/${SHA}`;
  for (const response of [{ status: 401 }, { status: 403 }, { status: 429 }, { status: 404 }, { status: 500 }, { status: 301, headers: ['Location', 'https://evil.example/'] }, { status: 200, headers: ['Content-Encoding', 'gzip', 'Content-Length', '11'] }, { status: 200, body: Buffer.alloc(4096) }]) {
    network(t, () => response); const transport = createPublicTransport(auth());
    await assert.rejects(transport.get(url, 1024, signal()), clean, JSON.stringify(response).slice(0, 60)); transport.close(); t.mock.restoreAll();
  }
  // A request that throws inside https.request, carrying the header in its own text, is reported without it.
  t.mock.method(dns, 'lookup', async () => [{ address: '104.16.25.34', family: 4 }]);
  t.mock.method(https, 'request', (_url, options) => { throw new Error(`boom ${JSON.stringify(options.headers)}`); });
  syncBuiltinESMExports();
  const transport = createPublicTransport(auth());
  await assert.rejects(transport.get(url, 1024, signal()), code('SKILLS_ADD_NETWORK')); transport.close(); t.mock.restoreAll();
  // The transport object itself shows no token.
  network(t); const shown = createPublicTransport(auth());
  assert.equal(util.inspect(shown, { showHidden: true, depth: 8 }).includes(CANARY), false); assert.equal(JSON.stringify(shown).includes(CANARY), false); shown.close();
});

test('12. the old guards hold with a token: a non-public or IPv6 address, a non-200 status, an encoding, and an oversize body', async t => {
  const url = `https://api.github.com/repos/owner/repo/git/commits/${SHA}`;
  for (const address of ['10.0.0.1', '127.0.0.1', '::1', '2606:4700::1']) {
    const n = network(t, () => ({}), address), transport = createPublicTransport(auth());
    await assert.rejects(transport.get(url, 1024, signal()), code('SKILLS_ADD_HOST_REFUSED'), address); assert.equal(n.calls.length, 0); transport.close(); t.mock.restoreAll();
  }
  for (const [response, expected] of [[{ status: 204 }, 'SKILLS_ADD_NETWORK'], [{ status: 200, headers: ['Content-Encoding', 'gzip', 'Content-Length', '11'] }, 'SKILLS_ADD_NETWORK'], [{ status: 200, body: Buffer.alloc(4096) }, 'SKILLS_ADD_UNSAFE_CONTENT']]) {
    network(t, () => response); const transport = createPublicTransport(auth());
    await assert.rejects(transport.get(url, 1024, signal()), code(expected), JSON.stringify(response).slice(0, 60)); transport.close(); t.mock.restoreAll();
  }
  // TLS and agent options are the ones of spec 06.
  const n = network(t), transport = createPublicTransport(auth()); await transport.get(url, 1024, signal());
  const { options } = n.calls[0];
  assert.equal(options.rejectUnauthorized, true); assert.equal(options.minVersion, 'TLSv1.2'); assert.deepEqual(options.agent.options.proxyEnv, {}); assert.equal(options.agent.options.keepAlive, false);
  transport.close();
});

// Review F1 of PR 97. A 403 to a request that carried the token: an x-github-sso header is GITHUB_TOKEN_SSO_REQUIRED.
test('7b. a 403 with x-github-sso and the header gives GITHUB_TOKEN_SSO_REQUIRED, and no header value is shown', async t => {
  const url = `https://api.github.com/repos/owner/repo/git/commits/${SHA}`;
  for (const value of ['required; url=https://github.com/orgs/x/sso?authorization_request=SECRETVALUE', 'partial-results; organizations=1,2']) {
    const n = network(t, () => ({ status: 403, headers: ['X-GitHub-SSO', value, 'Content-Length', '2'] })), transport = createPublicTransport(auth());
    const error = await transport.get(url, 1024, signal()).then(() => null, e => e);
    assert.equal(error?.code, 'GITHUB_TOKEN_SSO_REQUIRED'); assert.equal(error.message, "GitHub needs this token authorized for the organization's single sign-on.");
    assert.ok(clean(error)); assert.equal(`${error.message} ${error.stack}`.includes('SECRETVALUE'), false);
    assert.equal(n.calls.length, 1); transport.close(); t.mock.restoreAll();
  }
  // Without the header on the request, an SSO 403 keeps the result of spec 06.
  const n = network(t, () => ({ status: 403, headers: ['X-GitHub-SSO', 'required', 'Content-Length', '2'] })), transport = createPublicTransport({});
  await assert.rejects(transport.get(url, 1024, signal()), code('GITHUB_REQUEST_FAILED')); assert.equal(n.calls.length, 1); transport.close();
});

// Review F1 of PR 97: a 403 with neither rate header whose small body names a rate limit is GITHUB_RATE_LIMITED.
test('7c. a 403 with the header and a body that names a rate limit gives GITHUB_RATE_LIMITED; any other body STORE_REMOTE_AUTH_FAILED', async t => {
  const url = `https://api.github.com/repos/owner/repo/git/commits/${SHA}`;
  const body = text => ({ status: 403, body: Buffer.from(text), headers: ['Content-Length', String(Buffer.byteLength(text))] });
  const cases = [
    [body('{"message":"You have exceeded a secondary rate limit. SECRETVALUE"}'), 'GITHUB_RATE_LIMITED'],
    [body('{"message":"API RATE LIMIT exceeded for user ID 1."}'), 'GITHUB_RATE_LIMITED'],
    [body('{"message":"Resource not accessible by personal access token SECRETVALUE"}'), 'STORE_REMOTE_AUTH_FAILED'],
    [body(''), 'STORE_REMOTE_AUTH_FAILED'],
    [body('ratelimit'), 'STORE_REMOTE_AUTH_FAILED'],
    // A body split over chunks is read whole; a body past the bound is not read past it, and the words after it do not count.
    [{ status: 403, headers: [], chunks: [Buffer.from('{"message":"secondary rate'), Buffer.from(' limit"}')] }, 'GITHUB_RATE_LIMITED'],
    [{ status: 403, headers: [], chunks: [Buffer.alloc(8192, 0x61), Buffer.from('rate limit')] }, 'STORE_REMOTE_AUTH_FAILED'],
    // A body that never ends is still settled by the request limit, as a refused token, never left open.
    [{ status: 403, headers: [], chunks: [Buffer.from('x')], noEnd: true }, 'STORE_REMOTE_AUTH_FAILED'],
  ];
  for (const [response, expected] of cases) {
    const n = network(t, () => response), transport = createPublicTransport({ ...auth(), requestMs: 200 });
    const error = await transport.get(url, 1024, signal()).then(() => null, e => e);
    assert.equal(error?.code, expected, JSON.stringify(response).slice(0, 80)); assert.ok(clean(error));
    assert.equal(`${error.message} ${error.stack}`.includes('SECRETVALUE'), false);
    assert.equal(n.calls.length, 1); transport.close(); t.mock.restoreAll();
  }
  // Without the header on the request, a rate-limit body keeps the result of spec 06.
  const n = network(t, () => body('secondary rate limit')), transport = createPublicTransport({});
  await assert.rejects(transport.get(url, 1024, signal()), code('GITHUB_REQUEST_FAILED')); assert.equal(n.calls.length, 1); transport.close();
});
