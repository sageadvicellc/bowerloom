// Round 3 of the reviews of PR 101, item 1, through the real binary: SKILLS_OFFLINE sorted by its real cause. Every
// refusal prints one Next: line whose first step, if followed, can lift the refusal, and no Next: line repeats the
// command that just failed in the same conditions. Every run gets its own HOME and XDG_STATE_HOME under a temporary
// folder, the GitHub token variables are unset, and the only network is the fake one of tests/support/fake-network.ts.
import './support/isolate-home.js';
import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'node:test';
import { world, run, mustApprove, errorCode, errorMessage, project, EMPTY_CONFIG, NETWORK } from './support/config-cli.js';
import type { World } from './support/config-cli.js';
import { renderRefusal, reportFailure } from '../apps/cli/src/human.js';
import { runSyncCommand } from '../apps/cli/src/sync.js';
import { acquisitionRefusal, fetchPin } from '../packages/project-sync/src/apply.js';
import { fetchStoreGit } from '../packages/project-sync/src/store-git.js';
import { partialRefusal, syncError } from '../packages/project-sync/src/refusal.js';
import { notShareable } from '../packages/project-config/src/index.js';
import { GitAcquisitionError } from '../packages/skill-sources/src/git.js';
import { NpmAcquisitionError } from '../packages/skill-sources/src/npm.js';

const fixtures = fileURLToPath(new URL('../../packages/skill-manifest/test/fixtures/', import.meta.url));
const NPM_SPEC = 'npm:@synthetic/db-skills@0.0.1:skills/synthetic-db/collections';
const META = 'https://registry.npmjs.org/@synthetic/db-skills/0.0.1', TGZ = 'https://registry.npmjs.org/@synthetic/db-skills/-/db-skills-0.0.1.tgz';
const NPM_ROUTES = { [META]: join(fixtures, 'npm-db-skills', 'metadata.json'), [TGZ]: join(fixtures, 'npm-db-skills', 'archive.tgz') };
const FIXED = "This run could not get bytes that it needs. Nothing in the project changed.";
const SENTENCE = 'A pin or a lock item needs bytes that this run could not get. The message says why.';
const NEXT = {
  network: 'Connect to the network, then run the command again without --approve to see a new plan.',
  response: 'Run the command again later, without --approve, to see a new plan. If it fails again, check that the version or commit of the pin still exists on its registry.',
  nonpublic: 'Check the DNS or proxy configuration of this machine. Then run the command again without --approve to see a new plan.',
  other: 'Run the command again without --approve to see a new plan. If it fails again, report the code and the output of bowerloom --version.',
  nocode: 'Run the command again without --approve to see a new plan. If it fails again, report the error name above and the output of bowerloom --version.',
  requests: 'Check with bowerloom skills check that the pin names the package or commit you expect. If it does, report the code and the output of bowerloom --version.',
  approved: 'Run the command again without --offline and without --approve, to see a plan that fetches it.',
  offline: 'Run the command again without --offline and without --approve.',
  apply: 'Run bowerloom skills sync, then bowerloom apply.',
};
const nextOf = (stderr: string): string | undefined => (JSON.parse(stderr) as { error: { next?: string } }).error.next;

/** A fake network: `routes` served, or none at all (every request fails as a transport failure), and an address. */
function net(w: World, plan: { routes?: Record<string, string | { status: number; file: string | null }>; address?: string }): Record<string, string> {
  const log = join(w.base, `net-${Date.now()}-${Math.random().toString(16).slice(2)}.log`);
  writeFileSync(`${log}.json`, JSON.stringify({ log, ...plan })); writeFileSync(log, '');
  return { ...w.env, TEST_FAKE_NETWORK_PLAN: `${log}.json` };
}
/** A project that pins the npm skill, with the machine cache emptied, so the pin needs a fetch. */
function pinned(t: TestContext): { w: World; dir: string } {
  const w = world(t), dir = project(w, 'app', EMPTY_CONFIG);
  mustApprove(dir, ['skills', 'add', NPM_SPEC], net(w, { routes: NPM_ROUTES }), NETWORK);
  rmSync(join(w.state, 'bowerloom', 'cache'), { recursive: true, force: true });
  return { w, dir };
}
/** Plans skills sync online, then approves it with `env` as the network. Returns the refused run. */
function syncWith(dir: string, w: World, env: Record<string, string>) {
  const plan = run(dir, ['skills', 'sync', '--json'], net(w, { routes: NPM_ROUTES }), NETWORK);
  assert.equal(plan.status, 3, plan.stderr + plan.stdout);
  return run(dir, ['skills', 'sync', '--json', '--approve', (JSON.parse(plan.stdout) as { revision: string }).revision], env, NETWORK);
}
const refused = (r: { status: number | null; stderr: string }, label: string): void => { assert.equal(r.status, 1, `${label}: ${r.stderr}`); assert.equal(errorCode(r.stderr), 'SKILLS_OFFLINE', `${label}: ${r.stderr}`); };

test('a transport failure says the network was not reachable, and its step is to connect', t => {
  const { w, dir } = pinned(t), r = syncWith(dir, w, net(w, {}));
  refused(r, 'no route');
  assert.equal(errorMessage(r.stderr), `${FIXED} Bowerloom could not fetch synthetic-db-collections, because the network was not reachable (NPM_DNS). Pins that are already cached also sync with --offline.`);
  assert.equal(nextOf(r.stderr), NEXT.network);
});

test('a registry that answers 500, or 404 for the tarball, is not called offline', t => {
  const { w, dir } = pinned(t);
  for (const [label, routes] of [['500 on the metadata', { ...NPM_ROUTES, [META]: { status: 500, file: null } }], ['404 on the tarball', { ...NPM_ROUTES, [TGZ]: { status: 404, file: null } }]] as const) {
    const r = syncWith(dir, w, net(w, { routes }));
    refused(r, label);
    assert.equal(errorMessage(r.stderr), `${FIXED} The registry answered, but not with the bytes of the pin (NPM_RESPONSE). The skill is synthetic-db-collections.`, label);
    assert.doesNotMatch(errorMessage(r.stderr), /network was not reachable/, label);
    assert.equal(nextOf(r.stderr), NEXT.response, label);
  }
});

test('a registry name that resolves to an address that is not public says so, and points at DNS', t => {
  const { w, dir } = pinned(t), r = syncWith(dir, w, net(w, { routes: NPM_ROUTES, address: '10.0.0.7' }));
  refused(r, 'nonpublic');
  assert.equal(errorMessage(r.stderr), `${FIXED} The name of the registry resolved to an address that is not public, so Bowerloom did not connect (NPM_NONPUBLIC_ADDRESS). The skill is synthetic-db-collections.`);
  assert.equal(nextOf(r.stderr), NEXT.nonpublic);
});

test('--offline with an uncached pin says to run without --offline; plain apply says to sync first', t => {
  const { w, dir } = pinned(t);
  const offline = run(dir, ['skills', 'sync', '--offline', '--json'], net(w, {}), NETWORK);
  refused(offline, '--offline');
  assert.equal(errorMessage(offline.stderr), `${FIXED} --offline was set. The skill is synthetic-db-collections.`);
  assert.equal(nextOf(offline.stderr), NEXT.offline);
  const apply = run(dir, ['apply', '--json'], net(w, {}), NETWORK);
  refused(apply, 'plain apply');
  assert.equal(errorMessage(apply.stderr), `${FIXED} bowerloom apply never fetches. The skill is synthetic-db-collections.`);
  assert.equal(nextOf(apply.stderr), NEXT.apply);
});

test('the fallback of a fetch: a known code is named, never called offline; an error with no code is wrapped, never shown', () => {
  const signal = new AbortController().signal;
  const known = acquisitionRefusal(new NpmAcquisitionError('NPM_PLAN_REFUSED'), signal, 'x') as Error & { code: string; next?: string };
  assert.equal(known.code, 'SKILLS_OFFLINE');
  assert.equal(known.message, `${FIXED} Bowerloom could not fetch x (NPM_PLAN_REFUSED).`);
  assert.doesNotMatch(known.message, /offline|network/i);
  assert.equal(known.next, NEXT.other);
  // Round 4: an error with no code keeps SKILLS_OFFLINE, names the kind of error, never its message, and keeps the cause.
  const plain = new TypeError('a secret detail of someone');
  const wrapped = acquisitionRefusal(plain, signal, 'x') as Error & { code: string; next?: string; cause?: unknown };
  assert.equal(wrapped.code, 'SKILLS_OFFLINE'); assert.equal(wrapped.message, `${FIXED} The fetch of x failed with an error that has no Bowerloom code (TypeError).`);
  assert.equal(wrapped.next, NEXT.nocode); assert.equal(wrapped.cause, plain);
  assert.ok(!Object.keys(wrapped).includes('cause'), 'the cause is not enumerable');
  const terminal = reportFailure(wrapped, true).text + reportFailure(wrapped, false).text;
  assert.doesNotMatch(terminal, /secret|someone/, 'no output prints the message of the cause');
  assert.ok(reportFailure(wrapped, true).text.endsWith(`Next: ${NEXT.nocode}\n`));
  // Round 5: a fixed code keeps the original too, and a name getter that throws cannot escape.
  const coded = new NpmAcquisitionError('NPM_PLAN_REFUSED');
  assert.equal((acquisitionRefusal(coded, signal, 'x') as Error & { cause?: unknown }).cause, coded);
  const hostile = Object.defineProperty(new Error('x'), 'name', { get() { throw new Error('boom'); } });
  assert.equal(acquisitionRefusal(hostile, signal, 'x').message, `${FIXED} The fetch of x failed with an error that has no Bowerloom code (Error).`);
  const odd = acquisitionRefusal({ name: 'bad name\u001b' }, signal, 'x') as Error;
  assert.equal(odd.message, `${FIXED} The fetch of x failed with an error that has no Bowerloom code (Error).`);
});

test('each fetch code goes to its cause, for npm and for GitHub alike', () => {
  const signal = new AbortController().signal;
  const cases: [string, string, RegExp | null][] = [
    ['NETWORK', NEXT.network, /because the network was not reachable/], ['DNS', NEXT.network, null], ['TIMEOUT', NEXT.network, null],
    ['RESPONSE', NEXT.response, /The registry answered, but not with the bytes of the pin/], ['RESPONSE_BOUND', NEXT.response, null],
    ['REQUEST_BOUND', NEXT.requests, /needs more requests than Bowerloom makes for one pin: 2 for npm and 130 for GitHub/],
    ['NONPUBLIC_ADDRESS', NEXT.nonpublic, /address that is not public/], ['APPROVAL', NEXT.other, /Bowerloom could not fetch x/],
  ];
  for (const [suffix, next, words] of cases) for (const make of [(c: string) => new NpmAcquisitionError(`NPM_${c}`), (c: string) => new GitAcquisitionError(`GIT_${c}`)]) {
    const e = acquisitionRefusal(make(suffix), signal, 'x') as Error & { code: string; next?: string };
    assert.equal(e.code, 'SKILLS_OFFLINE', suffix); assert.equal(e.next, next, suffix);
    if (words) assert.match(e.message, words, suffix);
    if (suffix === 'REQUEST_BOUND') assert.doesNotMatch(e.message, /registry answered/);
  }
  // A plan that changed under the fetch is a stale approval.
  for (const e of [new NpmAcquisitionError('NPM_PLAN_CHANGED'), new GitAcquisitionError('GIT_PLAN_CHANGED')]) assert.equal((acquisitionRefusal(e, signal, 'x') as Error & { code: string }).code, 'STALE_APPROVAL');
});

// Round 4: no CLI run reaches these two checks, because a plan names the host of every fetch it holds. A fetch whose
// approved plan names no host refuses before any request, and its step re-plans without --offline.
test('an approved plan that names no host for a fetch refuses with the step to re-plan', async () => {
  const pin = { digest: 'd', kind: 'npm' } as unknown as Parameters<typeof fetchPin>[1];
  const item = { id: 'x', requestDigest: 'd', cacheOperationId: 'a'.repeat(32) } as unknown as Parameters<typeof fetchPin>[0];
  await assert.rejects(fetchPin(item, pin, { cacheRoot: '/nonexistent', legacyCacheRoot: null } as never, [], { signal: new AbortController().signal } as never),
    (e: Error & { code?: string; next?: string }) => e.code === 'SKILLS_OFFLINE' && e.next === NEXT.approved && e.message.endsWith('The approved plan allows no fetch of x.'));
  const lockPin = { remote: 'https://github.com/o/s', commit: 'c'.repeat(40), path: 'skills/x', tree: 't'.repeat(40), files: [], hash: 'h' };
  await assert.rejects(fetchStoreGit({ kind: 'skill', id: 'x', requestDigest: 'h', lockPin } as never, { cacheRoot: '/nonexistent', storeCacheRoot: '/nonexistent' }, [], { signal: new AbortController().signal }),
    (e: Error & { code?: string; next?: string }) => e.code === 'SKILLS_OFFLINE' && e.next === NEXT.approved);
});

test('a refusal after a partial write keeps the step of its cause, then the command that finishes the run', () => {
  const network = Object.defineProperty(syncError('SKILLS_OFFLINE', 'x.'), 'next', { value: NEXT.network, enumerable: false });
  const partial = partialRefusal(network, ['one item'], 'bowerloom store migrate --all') as Error & { next?: string };
  assert.equal(partial.next, `${NEXT.network} Then run bowerloom store migrate --all.`);
  // Round 5: a cause whose step ends with "Then run the command again." says run once.
  const fault = notShareable('file', { problem: 'mode', path: 'skills/x/run.md', item: 'skills/x' });
  const faulted = partialRefusal(fault, ['one item'], 'bowerloom store migrate --all') as Error & { next?: string };
  assert.equal(faulted.next, 'Run chmod a-x ~/.bowerloom/skills/x/run.md. A lock records no file with an execute bit. Then run bowerloom store migrate --all.');
  assert.doesNotMatch(partial.message, /Nothing in the project changed|Nothing was applied/);
  assert.equal((partialRefusal(syncError('STALE_APPROVAL'), ['one item'], 'bowerloom receipt clean') as Error & { next?: string }).next, 'bowerloom receipt clean');
});

test('a GitHub pin whose repository answers 500 is not called offline', t => {
  const w = world(t), dir = project(w, 'app', EMPTY_CONFIG);
  const recorded = JSON.parse(readFileSync(join(fixtures, 'github-skills-repo.json'), 'utf8')) as { responses: Record<string, string> };
  const routes: Record<string, string | { status: number; file: string | null }> = {};
  Object.entries(recorded.responses).forEach(([url, body], i) => { const file = join(w.base, `gh-${i}.json`); writeFileSync(file, Buffer.from(body, 'base64')); routes[url] = file; });
  mustApprove(dir, ['skills', 'add', `github:synthetic-owner/skills-repo@${'c0ffee00'.repeat(5)}:skills/verification-loop`], net(w, { routes }), NETWORK);
  rmSync(join(w.state, 'bowerloom', 'cache'), { recursive: true, force: true });
  const failing = Object.fromEntries(Object.keys(routes).map(url => [url, { status: 500, file: null }]));
  const plan = run(dir, ['skills', 'sync', '--json'], net(w, { routes }), NETWORK);
  assert.equal(plan.status, 3, plan.stderr);
  const r = run(dir, ['skills', 'sync', '--json', '--approve', (JSON.parse(plan.stdout) as { revision: string }).revision], net(w, { routes: failing }), NETWORK);
  refused(r, 'git 500');
  assert.match(errorMessage(r.stderr), /The registry answered, but not with the bytes of the pin \(GIT_RESPONSE\)\./);
  assert.equal(nextOf(r.stderr), NEXT.response);
});

test('the words of the code: a neutral sentence, and a table next step that names each case', () => {
  const words = renderRefusal('SKILLS_OFFLINE', FIXED).split('\n');
  assert.equal(words[1], SENTENCE);
  assert.equal(words[2], 'Next: After --offline, run the command again without --offline and without --approve. After plain apply, run bowerloom skills sync, or bowerloom apply --frozen.');
});

// Round 4: an acquirer that throws an error with no Bowerloom code, through the skills sync command. No network failure
// of the real transport reaches this, because the acquirer gives every such failure an NPM_ or GIT_ code (a lookup that
// throws a TypeError is NPM_DNS), so the command is called in process with a throwing acquirer.
test('skills sync with an acquirer that throws a TypeError refuses SKILLS_OFFLINE with the other step, and never prints the message', async t => {
  const { w, dir } = pinned(t);
  const plan = run(dir, ['skills', 'sync', '--json'], net(w, { routes: NPM_ROUTES }), NETWORK);
  const revision = (JSON.parse(plan.stdout) as { revision: string }).revision;
  const throwing = { npm: async () => { throw new TypeError('a private detail'); }, git: async () => { throw new TypeError('a private detail'); } };
  let caught: unknown = null;
  try { await runSyncCommand(['skills', 'sync', '--approve', revision], dir, w.home, () => {}, { interactive: false, ask: async () => 'n' }, { ...process.env, ...w.env }, throwing as never); }
  catch (error) { caught = error; }
  const e = caught as Error & { code?: string; next?: string; cause?: unknown };
  assert.equal(e?.code, 'SKILLS_OFFLINE', String(caught)); assert.equal(e.next, NEXT.nocode); assert.ok(e.cause instanceof TypeError);
  const words = reportFailure(e, true).text;
  assert.match(words, /The fetch of synthetic-db-collections failed with an error that has no Bowerloom code \(TypeError\)\./); assert.doesNotMatch(words, /private detail/);
});

// Round 5 of the reviews of PR 101, item 1: a failed fetch keeps its cache operation (the cache keeps every operation it
// opened until cache prune deletes it), so the next plan names a new one. The step says to leave out --approve, and
// following it lifts the refusal once the registry or the network is back.
test('after a failed fetch, the step leaves out --approve, and a new plan then installs, for npm and for git', t => {
  const { w, dir } = pinned(t);
  const first = JSON.parse(run(dir, ['skills', 'sync', '--json'], net(w, { routes: NPM_ROUTES }), NETWORK).stdout) as { revision: string };
  const failed = run(dir, ['skills', 'sync', '--json', '--approve', first.revision], net(w, { routes: { ...NPM_ROUTES, [META]: { status: 500, file: null } } }), NETWORK);
  assert.equal(nextOf(failed.stderr), NEXT.response);
  assert.equal(errorCode(run(dir, ['skills', 'sync', '--json', '--approve', first.revision], net(w, { routes: NPM_ROUTES }), NETWORK).stderr), 'STALE_APPROVAL', 'the same --approve is stale, as the step says');
  const again = JSON.parse(run(dir, ['skills', 'sync', '--json'], net(w, { routes: NPM_ROUTES }), NETWORK).stdout) as { revision: string };
  assert.equal(run(dir, ['skills', 'sync', '--approve', again.revision], net(w, { routes: NPM_ROUTES }), NETWORK).status, 0, 'a new plan installs');
  // git: a DNS failure, then the step.
  const g = world(t), gd = project(g, 'app', EMPTY_CONFIG);
  const recorded = JSON.parse(readFileSync(join(fixtures, 'github-skills-repo.json'), 'utf8')) as { responses: Record<string, string> };
  const routes: Record<string, string> = {};
  Object.entries(recorded.responses).forEach(([url, body], i) => { const file = join(g.base, `gh-${i}.json`); writeFileSync(file, Buffer.from(body, 'base64')); routes[url] = file; });
  mustApprove(gd, ['skills', 'add', `github:synthetic-owner/skills-repo@${'c0ffee00'.repeat(5)}:skills/verification-loop`], net(g, { routes }), NETWORK);
  rmSync(join(g.state, 'bowerloom', 'cache'), { recursive: true, force: true });
  const gp = JSON.parse(run(gd, ['skills', 'sync', '--json'], net(g, { routes }), NETWORK).stdout) as { revision: string };
  const down = run(gd, ['skills', 'sync', '--json', '--approve', gp.revision], net(g, {}), NETWORK);
  assert.equal(nextOf(down.stderr), NEXT.network);
  const gp2 = JSON.parse(run(gd, ['skills', 'sync', '--json'], net(g, { routes }), NETWORK).stdout) as { revision: string };
  assert.equal(run(gd, ['skills', 'sync', '--approve', gp2.revision], net(g, { routes }), NETWORK).status, 0, 'a new plan installs');
});
