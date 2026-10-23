// Round 3 of the reviews of PR 101, item 1, through the real binary: SKILLS_OFFLINE sorted by its real cause. Every
// refusal prints one Next: line whose first step, if followed, can lift the refusal, and no Next: line repeats the
// command that just failed in the same conditions. Every run gets its own HOME and XDG_STATE_HOME under a temporary
// folder, the GitHub token variables are unset, and the only network is the fake one of tests/support/fake-network.ts.
import './support/isolate-home.js';
import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'node:test';
import { world, run, mustApprove, errorCode, errorMessage, project, EMPTY_CONFIG, NETWORK } from './support/config-cli.js';
import type { World } from './support/config-cli.js';
import { renderRefusal, reportFailure } from '../apps/cli/src/human.js';
import { runSyncCommand } from '../apps/cli/src/sync.js';
import { acquisitionRefusal, fetchPin, recoveryInFlow } from '../packages/project-sync/src/apply.js';
import { ALL_IDS_USED_NEXT, cacheOperationId } from '../packages/project-sync/src/cache-index.js';
import { fetchStoreGit } from '../packages/project-sync/src/store-git.js';
import { offlineBecause, partialRefusal, REPLAN_NEXT, shellPath, syncError, withNext } from '../packages/project-sync/src/refusal.js';
import { addDirStep, shellWord } from '../apps/cli/src/human.js';
import type { OfflineCause } from '../packages/project-sync/src/refusal.js';
import { notShareable } from '../packages/project-config/src/index.js';
import { atApproval } from '../packages/project-config/src/refusal.js';
import { GitAcquisitionError } from '../packages/skill-sources/src/git.js';
import { NpmAcquisitionError } from '../packages/skill-sources/src/npm.js';

const fixtures = fileURLToPath(new URL('../../packages/skill-manifest/test/fixtures/', import.meta.url));
const NPM_SPEC = 'npm:@synthetic/db-skills@0.0.1:skills/synthetic-db/collections';
const META = 'https://registry.npmjs.org/@synthetic/db-skills/0.0.1', TGZ = 'https://registry.npmjs.org/@synthetic/db-skills/-/db-skills-0.0.1.tgz';
const NPM_ROUTES = { [META]: join(fixtures, 'npm-db-skills', 'metadata.json'), [TGZ]: join(fixtures, 'npm-db-skills', 'archive.tgz') };
const FIXED = "This run could not get bytes that it needs. Nothing in the project changed.";
const SENTENCE = 'A pin or a lock item needs bytes that this run could not get. The message says why.';
const NEXT = {
  network: 'Connect to the network and run the command again.',
  response: 'Run the command again later. If it fails again, check that the version or commit of the pin still exists on its registry.',
  nonpublic: 'Check the DNS or proxy configuration of this machine, then run the command again.',
  other: 'Run the command again. If it fails again, report the code and the output of bowerloom --version.',
  nocode: 'Run the command again. If it fails again, report the error name above and the output of bowerloom --version.',
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
  assert.equal(partial.next, 'Connect to the network. Then run bowerloom store migrate --all.');
  // Round 5: a cause whose step ends with "Then run the command again." says run once.
  const fault = notShareable('file', { problem: 'mode', path: 'skills/x/run.md', item: 'skills/x' });
  const faulted = partialRefusal(fault, ['one item'], 'bowerloom store migrate --all') as Error & { next?: string };
  assert.equal(faulted.next, 'Run chmod a-x ~/.bowerloom/skills/x/run.md. A lock records no file with an execute bit. Then run bowerloom store migrate --all.');
  // Round 6: an error with the approval note, and a step that ends ", then run ...", say run once too.
  const noted = partialRefusal(atApproval(fault), ['one item'], 'bowerloom store migrate --all') as Error & { next?: string };
  assert.equal(noted.next, 'Run chmod a-x ~/.bowerloom/skills/x/run.md. A lock records no file with an execute bit. Then run bowerloom store migrate --all.');
  const dns = Object.defineProperty(syncError('SKILLS_OFFLINE', 'x.'), 'next', { value: NEXT.nonpublic, enumerable: false });
  assert.equal((partialRefusal(dns, ['one item'], 'bowerloom receipt clean') as Error & { next?: string }).next, 'Check the DNS or proxy configuration of this machine. Then run bowerloom receipt clean.');
  // Round 7: a step that starts by running the command again runs the command that finishes the run instead, once.
  const partialOf = (next: string): string => (partialRefusal(Object.defineProperty(syncError('SKILLS_OFFLINE', 'x.'), 'next', { value: next, enumerable: false }), ['one item'], 'bowerloom store migrate --all') as Error & { next?: string }).next!;
  assert.equal(partialOf(NEXT.other), 'Run bowerloom store migrate --all. If it fails again, report the code and the output of bowerloom --version.');
  assert.equal(partialOf(NEXT.nocode), 'Run bowerloom store migrate --all. If it fails again, report the error name above and the output of bowerloom --version.');
  assert.equal(partialOf(NEXT.response), 'Later, run bowerloom store migrate --all. If it fails again, check that the version or commit of the pin still exists on its registry.');
  // Round 8: every step that starts by running the command again does so, whatever follows it. store migrate and receipt
  // clean never fetch, so the offline and approved causes never reach partialRefusal there; these lines pin the rule only.
  // Round 9: a $ in the command is text, never a replacement pattern.
  assert.equal((partialRefusal(Object.defineProperty(syncError('SKILLS_OFFLINE', 'x.'), 'next', { value: NEXT.other, enumerable: false }), ['one item'], "bowerloom x --a '$&$1'") as Error & { next?: string }).next, "Run bowerloom x --a '$&$1'. If it fails again, report the code and the output of bowerloom --version.");
  assert.equal(partialOf(NEXT.offline), 'Run bowerloom store migrate --all without --offline and without --approve.');
  assert.equal(partialOf(NEXT.approved), 'Run bowerloom store migrate --all without --offline and without --approve, to see a plan that fetches it.');
  for (const next of [NEXT.other, NEXT.nocode, NEXT.response, NEXT.network, NEXT.nonpublic, NEXT.offline, NEXT.approved]) assert.equal((partialOf(next).match(/\brun\b/gi) ?? []).length, 1, next);
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

// Round 6 of the reviews of PR 101, item 1: this project's own state folders are made only after every fetch succeeds,
// and a failed fetch's cache operation is not bound. So after a fetch fails on a first run, the same --approve applies once
// the registry or the network is back, for npm and for git, and when the own folders exist already.
test('after a failed fetch, the same --approve applies once the registry or the network is back, for npm and for git', t => {
  const cases: [string, Record<string, unknown>][] = [['npm 500', { routes: { ...NPM_ROUTES, [META]: { status: 500, file: null } } }], ['npm 404 tarball', { routes: { ...NPM_ROUTES, [TGZ]: { status: 404, file: null } } }], ['npm DNS', {}]];
  for (const [label, failing] of cases) {
    const { w, dir } = pinned(t);
    const plan = JSON.parse(run(dir, ['skills', 'sync', '--json'], net(w, { routes: NPM_ROUTES }), NETWORK).stdout) as { revision: string };
    const failed = run(dir, ['skills', 'sync', '--json', '--approve', plan.revision], net(w, failing as never), NETWORK);
    assert.equal(errorCode(failed.stderr), 'SKILLS_OFFLINE', label);
    assert.ok(!(nextOf(failed.stderr) ?? '').includes('--approve'), `${label}: the step keeps the approval`);
    const retried = run(dir, ['skills', 'sync', '--approve', plan.revision], net(w, { routes: NPM_ROUTES }), NETWORK);
    assert.equal(retried.status, 0, `${label}: the same --approve applies: ${retried.stderr}`);
  }
  // The own folders exist already: a second project item fails, then the same --approve applies.
  const { w, dir } = pinned(t);
  const warm = JSON.parse(run(dir, ['skills', 'sync', '--json'], net(w, { routes: NPM_ROUTES }), NETWORK).stdout) as { revision: string };
  assert.equal(run(dir, ['skills', 'sync', '--approve', warm.revision], net(w, { routes: NPM_ROUTES }), NETWORK).status, 0);
  rmSync(join(w.state, 'bowerloom', 'cache'), { recursive: true, force: true }); rmSync(join(dir, '.claude'), { recursive: true, force: true }); rmSync(join(dir, '.agents'), { recursive: true, force: true });
  rmSync(join(dir, '.bowerloom', 'managed'), { recursive: true, force: true });
  const again = JSON.parse(run(dir, ['skills', 'sync', '--json'], net(w, { routes: NPM_ROUTES }), NETWORK).stdout) as { revision: string };
  assert.equal(errorCode(run(dir, ['skills', 'sync', '--json', '--approve', again.revision], net(w, {}), NETWORK).stderr), 'SKILLS_OFFLINE');
  assert.equal(run(dir, ['skills', 'sync', '--approve', again.revision], net(w, { routes: NPM_ROUTES }), NETWORK).status, 0, 'own folders already there');
  // git: a DNS failure, then the same --approve.
  const g = world(t), gd = project(g, 'app', EMPTY_CONFIG);
  const recorded = JSON.parse(readFileSync(join(fixtures, 'github-skills-repo.json'), 'utf8')) as { responses: Record<string, string> };
  const routes: Record<string, string> = {};
  Object.entries(recorded.responses).forEach(([url, body], i) => { const file = join(g.base, `gh-${i}.json`); writeFileSync(file, Buffer.from(body, 'base64')); routes[url] = file; });
  mustApprove(gd, ['skills', 'add', `github:synthetic-owner/skills-repo@${'c0ffee00'.repeat(5)}:skills/verification-loop`], net(g, { routes }), NETWORK);
  rmSync(join(g.state, 'bowerloom', 'cache'), { recursive: true, force: true });
  const gp = JSON.parse(run(gd, ['skills', 'sync', '--json'], net(g, { routes }), NETWORK).stdout) as { revision: string };
  const down = run(gd, ['skills', 'sync', '--json', '--approve', gp.revision], net(g, {}), NETWORK);
  assert.equal(nextOf(down.stderr), NEXT.network);
  assert.equal(run(gd, ['skills', 'sync', '--approve', gp.revision], net(g, { routes }), NETWORK).status, 0, 'git: the same --approve applies');
});

// Round 6, item 1: each failed npm fetch keeps one of the 8 operation ids of its pin. After 8, the step deletes them.
test('after 8 failed fetches of one pin, the step is cache prune --partial, and following it lifts the refusal', t => {
  const { w, dir } = pinned(t), bad = net(w, { routes: { ...NPM_ROUTES, [META]: { status: 500, file: null } } });
  const plan = JSON.parse(run(dir, ['skills', 'sync', '--json'], net(w, { routes: NPM_ROUTES }), NETWORK).stdout) as { revision: string };
  for (let i = 0; i < 8; i++) assert.equal(errorCode(run(dir, ['skills', 'sync', '--json', '--approve', plan.revision], bad, NETWORK).stderr), 'SKILLS_OFFLINE', `failure ${i + 1}`);
  const full = run(dir, ['skills', 'sync', '--json'], net(w, { routes: NPM_ROUTES }), NETWORK);
  assert.equal(errorCode(full.stderr), 'SKILLS_CACHE_RECOVERY_REQUIRED', full.stderr);
  assert.equal(nextOf(full.stderr), 'Run bowerloom cache prune --partial to delete the unfinished fetches, then run the command again.');
  const prune = JSON.parse(run(dir, ['cache', 'prune', '--partial', '--json'], w.env).stdout) as { revision: string };
  assert.equal(run(dir, ['cache', 'prune', '--partial', '--approve', prune.revision], w.env).status, 0);
  const after = JSON.parse(run(dir, ['skills', 'sync', '--json'], net(w, { routes: NPM_ROUTES }), NETWORK).stdout) as { revision: string };
  assert.equal(run(dir, ['skills', 'sync', '--approve', after.revision], net(w, { routes: NPM_ROUTES }), NETWORK).status, 0);
});


// Round 8 of the reviews of PR 101, item 1: skills migrate binds its cache operation, so every refusal of its fetch names
// its plan command (the flow's `replan`), and none names skills sync or --offline, which skills migrate does not have.
const PLAN_CMD = "bowerloom skills migrate plan --state '/tmp/v1 state'";
const MIGRATE = { rerun: PLAN_CMD, replan: PLAN_CMD };
test('a flow that plans again: each fetch refusal names its plan command, never skills sync or --offline', () => {
  const live = new AbortController().signal, stopped = AbortSignal.abort();
  const step = `Run ${PLAN_CMD} to see a new plan.`;
  for (const e of [acquisitionRefusal(new NpmAcquisitionError('NPM_ABORTED'), live, 'x', MIGRATE), acquisitionRefusal(new GitAcquisitionError('GIT_ABORTED'), live, 'x', MIGRATE), acquisitionRefusal(new Error('any'), stopped, 'x', MIGRATE)] as (Error & { code: string; next?: string })[]) {
    assert.equal(e.code, 'SKILLS_SYNC_INTERRUPTED');
    assert.equal(e.message, `The run stopped, as asked. Each skill it finished is complete; no skill was left half done. It stopped while fetching x, before any change to the project. ${step}`);
    assert.equal(e.next, step);
  }
  const unclear = acquisitionRefusal(new NpmAcquisitionError('NPM_NETWORK', ['NPM_CACHE_RELEASE_UNCERTAIN']), live, 'x', MIGRATE) as Error & { code: string; next?: string };
  assert.equal(unclear.code, 'SKILLS_CACHE_RECOVERY_REQUIRED');
  assert.ok(unclear.message.endsWith(`The fetch of x left the cache unclear (NPM_NETWORK, NPM_CACHE_RELEASE_UNCERTAIN). Run ${PLAN_CMD} to see a new plan: it leaves that operation as it is and fetches into a new one.`), unclear.message);
  assert.equal(unclear.next, step);
  const down = acquisitionRefusal(new NpmAcquisitionError('NPM_DNS'), live, 'x', MIGRATE) as Error & { next?: string };
  assert.equal(down.message, `${FIXED} Bowerloom could not fetch x, because the network was not reachable (NPM_DNS).`);
  assert.equal(down.next, `Connect to the network, then run ${PLAN_CMD} to see a new plan.`);
  for (const e of [unclear, down, ...[new NpmAcquisitionError('NPM_ABORTED'), new NpmAcquisitionError('NPM_RESPONSE'), new TypeError('t')].map(c => acquisitionRefusal(c, live, 'x', MIGRATE))] as (Error & { next?: string })[]) {
    assert.doesNotMatch(`${e.message} ${e.next}`, /skills sync|--offline|run the command again/i);
  }
  // skills sync keeps its own words: the same command again, and --offline for pins that are cached.
  const sync = acquisitionRefusal(new NpmAcquisitionError('NPM_ABORTED'), live, 'x') as Error & { next?: string };
  assert.ok(sync.message.endsWith('It stopped while fetching x, before any change to the project. Run bowerloom skills sync again.')); assert.equal(sync.next, 'Run bowerloom skills sync again.');
  assert.match(acquisitionRefusal(new NpmAcquisitionError('NPM_DNS'), live, 'x').message, /Pins that are already cached also sync with --offline\.$/);
});

test('the plan-again steps: one per cause that runs the command again; the requests cause and other codes pass through', () => {
  const live = new AbortController().signal;
  const table: [OfflineCause, Error, string][] = [
    ['network', new NpmAcquisitionError('NPM_TIMEOUT'), `Connect to the network, then run ${PLAN_CMD} to see a new plan.`],
    ['response', new GitAcquisitionError('GIT_RESPONSE'), `Later, run ${PLAN_CMD} to see a new plan. If the fetch fails again, check that the version or commit of the pin still exists on its registry.`],
    ['nonpublic', new NpmAcquisitionError('NPM_NONPUBLIC_ADDRESS'), `Check the DNS or proxy configuration of this machine, then run ${PLAN_CMD} to see a new plan.`],
    ['other', new NpmAcquisitionError('NPM_PLAN_REFUSED'), `Run ${PLAN_CMD} to see a new plan. If the fetch fails again, report the code and the output of bowerloom --version.`],
    ['nocode', new TypeError('a secret'), `Run ${PLAN_CMD} to see a new plan. If the fetch fails again, report the error name above and the output of bowerloom --version.`],
  ];
  for (const [cause, error, next] of table) {
    const plain = acquisitionRefusal(error, live, 'x') as Error & { code: string; next?: string; cause?: unknown };
    const replanned = acquisitionRefusal(error, live, 'x', MIGRATE) as Error & { code: string; next?: string; cause?: unknown };
    assert.equal(replanned.code, plain.code, cause); assert.equal(replanned.code, 'SKILLS_OFFLINE', cause);
    assert.equal(replanned.message, plain.message.replace(' Pins that are already cached also sync with --offline.', ''), cause);
    assert.equal(replanned.next, next, cause); assert.equal(REPLAN_NEXT[cause]!(PLAN_CMD), next, cause);
    assert.equal(replanned.cause, plain.cause, cause);
    if (cause === 'other' || cause === 'nocode') assert.equal(replanned.cause, error, `${cause} keeps the original`);
  }
  // The requests cause sends the person to skills check, which is the same in both flows.
  for (const e of [new NpmAcquisitionError('NPM_REQUEST_BOUND'), new GitAcquisitionError('GIT_REQUEST_BOUND')]) {
    const a = acquisitionRefusal(e, live, 'x') as Error & { message: string; next?: string }, b = acquisitionRefusal(e, live, 'x', MIGRATE) as Error & { next?: string };
    assert.equal(b.message, a.message); assert.equal(b.next, NEXT.requests); assert.equal(a.next, NEXT.requests);
  }
  assert.equal((acquisitionRefusal(new NpmAcquisitionError('NPM_PLAN_CHANGED'), live, 'x', MIGRATE) as Error & { code: string }).code, 'STALE_APPROVAL');
  // offlineBecause without a plan command, or for a cause with no plan-again step, keeps the step of the cause.
  assert.equal((offlineBecause('requests', 'e', PLAN_CMD) as Error & { next?: string }).next, NEXT.requests);
  assert.equal((offlineBecause('approved', 'e', PLAN_CMD) as Error & { next?: string }).next, `Run ${PLAN_CMD} to see a plan that fetches it.`);
  assert.equal((offlineBecause('approved', 'e') as Error & { next?: string }).next, NEXT.approved);
  // A refusal that is not about all ids used passes through recoveryInFlow as the very same object.
  const other = syncError('SKILLS_OFFLINE'), thrown = new Error('x');
  assert.equal(recoveryInFlow(other, MIGRATE), other); assert.equal(recoveryInFlow(thrown, MIGRATE), thrown);
  const full = Object.defineProperty(syncError('SKILLS_CACHE_RECOVERY_REQUIRED', 'm'), 'next', { value: ALL_IDS_USED_NEXT, enumerable: false });
  assert.equal(recoveryInFlow(full, { rerun: 'bowerloom skills sync' }), full, 'skills sync keeps the same --approve');
  const moved = recoveryInFlow(full, MIGRATE) as Error & { code: string; next?: string };
  assert.equal(moved.code, full.code); assert.equal(moved.message, full.message);
  assert.equal(moved.next, `Run bowerloom cache prune --partial to delete the unfinished fetches, then run ${PLAN_CMD} to see a new plan.`);
});

test('the copy of a refusal with a new step keeps the code, the message, the cause and the stack', () => {
  const cause = new TypeError('root');
  const original = Object.defineProperty(syncError('SKILLS_OFFLINE', 'e'), 'cause', { value: cause, enumerable: false });
  const copy = withNext(original, 'Do this.') as Error & { code: string; next?: string; cause?: unknown };
  assert.equal(copy.code, original.code); assert.equal(copy.message, original.message); assert.equal(copy.cause, cause);
  assert.equal(copy.stack, original.stack); assert.equal(copy.next, 'Do this.');
  assert.deepEqual(Object.keys(copy).filter(k => k === 'next' || k === 'cause' || k === 'stack'), []);
  assert.equal(reportFailure(copy, true).text.endsWith('Next: Do this.\n'), true);
});

test('a flow that plans again: an approved plan with no host, and a pin with all 8 ids used, name the plan command', async t => {
  const pin = { digest: 'd', kind: 'npm' } as unknown as Parameters<typeof fetchPin>[1];
  const item = { id: 'x', requestDigest: 'd', cacheOperationId: 'a'.repeat(32) } as unknown as Parameters<typeof fetchPin>[0];
  await assert.rejects(fetchPin(item, pin, { cacheRoot: '/nonexistent', legacyCacheRoot: null } as never, [], { signal: new AbortController().signal } as never, MIGRATE),
    (e: Error & { code?: string; next?: string }) => e.code === 'SKILLS_OFFLINE' && e.next === `Run ${PLAN_CMD} to see a plan that fetches it.`);
  // Another run used the last ids between the plan and the fetch: the step prunes, then plans again.
  const digest = 'd'.repeat(64), full = { digest, kind: 'npm' } as unknown as Parameters<typeof fetchPin>[1];
  const fullItem = { id: 'x', requestDigest: digest, cacheOperationId: 'a'.repeat(32) } as unknown as Parameters<typeof fetchPin>[0];
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-replan-'))); t.after(() => rmSync(base, { recursive: true, force: true }));
  const cacheRoot = join(base, 'cache'); mkdirSync(cacheRoot, { mode: 0o700 }); chmodSync(base, 0o700);
  for (let i = 0; i < 8; i++) mkdirSync(join(cacheRoot, `op-${cacheOperationId(digest, i)}`), { mode: 0o700 });
  const roots = { cacheRoot, legacyCacheRoot: null } as never, deps = { signal: new AbortController().signal } as never;
  await assert.rejects(fetchPin(fullItem, full, roots, ['registry.npmjs.org'], deps, MIGRATE),
    (e: Error & { code?: string; next?: string }) => e.code === 'SKILLS_CACHE_RECOVERY_REQUIRED' && e.next === `Run bowerloom cache prune --partial to delete the unfinished fetches, then run ${PLAN_CMD} to see a new plan.`);
  await assert.rejects(fetchPin(fullItem, full, roots, ['registry.npmjs.org'], deps),
    (e: Error & { code?: string; next?: string }) => e.code === 'SKILLS_CACHE_RECOVERY_REQUIRED' && e.next === ALL_IDS_USED_NEXT);
});

// Round 9 of the reviews of PR 101, item 4: a printed path is single-quoted unless it holds a character that changes what a
// terminal shows, has no UTF-8 form, or ends a single-quoted word in fish (a backslash). Those print the placeholder.
test('a printed path: ZWNJ and ZWJ are quoted; control, invisible, surrogate, backslash and leading-dash values print no command', () => {
  assert.equal(shellPath('/home/a/plain-path_1'), '/home/a/plain-path_1');
  assert.equal(shellPath('/home/a/My Notes'), "'/home/a/My Notes'");
  assert.equal(shellPath("/home/a/it's"), "'/home/a/it'\\''s'");
  assert.equal(shellPath('/home/a/\u0645\u200C\u0627'), "'/home/a/\u0645\u200C\u0627'", 'ZWNJ is quoted');
  assert.equal(shellPath('/home/a/\u{1F468}\u200D\u{1F469}'), "'/home/a/\u{1F468}\u200D\u{1F469}'", 'ZWJ is quoted');
  // Round 10: every other invisible format character too, and a tag character, which is outside the BMP.
  for (const odd of ['/a/\u202Etxt', '/a/\u2066x\u2069', '/a/\u061Cx', '/a/\u200Fx', '/a/\u200Bx', '/a/\u2060x', '/a/\uFEFFx', '/a/\u00ADx', '/a/\u{E0041}x', '/a/x\\y', '/a/x\\', '/a/\uD800x', '/a/\uDC00', '/a/x\u0007', '/a/x\u2028y', 'relative/path', ''])
    assert.equal(shellPath(odd), null, JSON.stringify(odd));
  assert.equal(shellWord('/a/x\\y'), null); assert.equal(shellWord('/a/\u202Ex'), null); assert.equal(shellWord('-rf'), null);
  assert.equal(shellWord('=cmd'), "'=cmd'", 'a leading = is quoted'); assert.equal(shellWord('a=b'), 'a=b');
  assert.equal(shellWord('/a/\u200Cx'), "'/a/\u200Cx'"); assert.equal(shellWord('/a b'), "'/a b'"); assert.equal(shellWord('/a/b'), '/a/b');
  assert.equal(addDirStep('/a/x\\y'), 'Add the folder to permissions.additionalDirectories, or start Claude Code with --add-dir and that folder.');
  assert.equal(addDirStep('/a b'), "Start Claude Code with --add-dir '/a b', or add the folder to permissions.additionalDirectories.");
});

// Round 9, item 5: skills sync and bowerloom apply keep their own command in these steps, with its flags.
test('the default flow: an unclear fetch and a stopped fetch name the command that ran', async t => {
  const live = new AbortController().signal;
  const unclear = (flow?: { rerun: string }) => acquisitionRefusal(new NpmAcquisitionError('NPM_NETWORK', ['NPM_CACHE_RELEASE_UNCERTAIN']), live, 'x', flow) as Error & { code: string; next?: string };
  assert.equal(unclear().code, 'SKILLS_CACHE_RECOVERY_REQUIRED'); assert.equal(unclear().next, 'Run bowerloom skills sync again.');
  assert.ok(unclear().message.endsWith('Run bowerloom skills sync again: it leaves that operation as it is and fetches into a new one.'));
  assert.equal(unclear({ rerun: 'bowerloom apply --frozen' }).next, 'Run bowerloom apply --frozen again.');
  // A fetch whose signal stops while it waits for the cache lock.
  const digest = 'e'.repeat(64), pin = { digest, kind: 'npm' } as unknown as Parameters<typeof fetchPin>[1];
  const item = { id: 'x', requestDigest: digest, cacheOperationId: 'a'.repeat(32) } as unknown as Parameters<typeof fetchPin>[0];
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-stop-'))); t.after(() => rmSync(base, { recursive: true, force: true }));
  const cacheRoot = join(base, 'cache'); mkdirSync(cacheRoot, { mode: 0o700 }); chmodSync(base, 0o700);
  const roots = { cacheRoot, legacyCacheRoot: null } as never, stopped = { signal: AbortSignal.abort() } as never;
  await assert.rejects(fetchPin(item, pin, roots, ['registry.npmjs.org'], stopped), (e: Error & { code?: string; next?: string }) => e.code === 'SKILLS_SYNC_INTERRUPTED' && e.next === 'Run bowerloom skills sync again.');
  await assert.rejects(fetchPin(item, pin, roots, ['registry.npmjs.org'], stopped, { rerun: 'bowerloom apply --frozen' }), (e: Error & { code?: string; next?: string }) => e.code === 'SKILLS_SYNC_INTERRUPTED' && e.next === 'Run bowerloom apply --frozen again.');
});
