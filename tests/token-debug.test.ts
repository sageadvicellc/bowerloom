// Spec 07, property 9, against Node's own debug output (security review H1 of PR 97). The fake network of
// tests/support/fake-network.ts replaces https.request, so Node's https and http code never runs there and its
// NODE_DEBUG lines are not exercised. This test runs the real transport in a child, with only DNS and tls.connect
// stubbed (tests/support/debug-transport.ts), under each NODE_DEBUG setting, and checks two things: the canary is in
// no output, and the Authorization header still reaches the server.
import './support/isolate-home.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run } from './support/config-cli.js';

const CANARY = 'ghp_' + ('ghijklmnopqrstuvwxyz' + 'zyxwvutsrqponmlkjh').slice(0, 36);
const PARTS = Array.from({ length: CANARY.length - 7 }, (_, i) => CANARY.slice(i, i + 8));
const preload = pathToFileURL(fileURLToPath(new URL('./support/debug-transport.js', import.meta.url))).href;
const URL_OK = `https://api.github.com/repos/owner/repo/git/commits/${'c'.repeat(40)}`;

for (const debug of ['https', 'http', 'http,https,net,tls', '*']) {
  test(`NODE_DEBUG=${debug}: the token is in no output, and the header still reaches the server`, t => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-token-debug-')));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const out = join(dir, 'result.json'), planFile = join(dir, 'plan.json');
    writeFileSync(planFile, JSON.stringify({ out, token: CANARY, url: URL_OK, repository: 'owner/repo' }));
    const r = run(dir, ['--version'], { HOME: dir, NODE_DEBUG: debug, TEST_DEBUG_TRANSPORT_PLAN: planFile }, ['--import', preload]);
    assert.equal(r.status, 0, r.stderr.slice(0, 2000));
    const result = JSON.parse(readFileSync(out, 'utf8')) as { ok: boolean; failure: string | null; connects: number; requests: number; authorized: boolean; otherAuthorization: boolean };
    assert.deepEqual(result, { ok: true, failure: null, connects: 1, requests: 1, authorized: true, otherAuthorization: false });
    // NODE_DEBUG is live: Node's https or http module wrote its lines.
    assert.match(r.stderr, /^(HTTPS|HTTP|NET|TLS) \d+:/m, 'NODE_DEBUG printed nothing');
    for (const part of PARTS) assert.equal(`${r.stdout}${r.stderr}`.includes(part), false, `NODE_DEBUG=${debug} printed part of the token`);
    assert.equal(readFileSync(out, 'utf8').includes('ghp_'), false);
  });
}
