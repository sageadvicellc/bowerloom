// Round 3 of the reviews of PR 101, item 1, through the real binary: SKILLS_OFFLINE sorted by its real cause. Every
// refusal prints one Next: line whose first step, if followed, can lift the refusal, and no Next: line repeats the
// command that just failed in the same conditions. Every run gets its own HOME and XDG_STATE_HOME under a temporary
// folder, the GitHub token variables are unset, and the only network is the fake one of tests/support/fake-network.ts.
import './support/isolate-home.js';
import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'node:test';
import { world, run, mustApprove, errorCode, errorMessage, project, EMPTY_CONFIG, NETWORK } from './support/config-cli.js';
import type { World } from './support/config-cli.js';
import { renderRefusal, reportFailure } from '../apps/cli/src/human.js';
import { acquisitionRefusal } from '../packages/project-sync/src/apply.js';
import { NpmAcquisitionError } from '../packages/skill-sources/src/npm.js';

const fixtures = fileURLToPath(new URL('../../packages/skill-manifest/test/fixtures/', import.meta.url));
const NPM_SPEC = 'npm:@synthetic/db-skills@0.0.1:skills/synthetic-db/collections';
const META = 'https://registry.npmjs.org/@synthetic/db-skills/0.0.1', TGZ = 'https://registry.npmjs.org/@synthetic/db-skills/-/db-skills-0.0.1.tgz';
const NPM_ROUTES = { [META]: join(fixtures, 'npm-db-skills', 'metadata.json'), [TGZ]: join(fixtures, 'npm-db-skills', 'archive.tgz') };
const FIXED = "This item is not in this machine's cache yet. Nothing in the project changed.";
const SENTENCE = 'A pin or a lock item needs a fetch, and this run did not fetch it. The message says why.';
const NEXT = {
  network: 'Connect to the network and run the command again.',
  response: 'Run the command again later. If it fails again, check that the version or commit of the pin still exists on its registry.',
  nonpublic: 'Check the DNS or proxy configuration of this machine.',
  other: 'Run bowerloom skills check, then bowerloom skills sync again.',
  offline: 'Run the command again without --offline.',
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

test('the fallback of a fetch: a known code is named, never called offline; an error with no code is passed on as it is', () => {
  const signal = new AbortController().signal;
  const known = acquisitionRefusal(new NpmAcquisitionError('NPM_PLAN_REFUSED'), signal, 'x') as Error & { code: string; next?: string };
  assert.equal(known.code, 'SKILLS_OFFLINE');
  assert.equal(known.message, `${FIXED} Bowerloom could not fetch x (NPM_PLAN_REFUSED).`);
  assert.doesNotMatch(known.message, /offline|network/i);
  assert.equal(known.next, NEXT.other);
  const plain = new TypeError('a bug');
  assert.equal(acquisitionRefusal(plain, signal, 'x'), plain, 'an error with no code is passed on');
  // A transport code through the same function.
  const down = acquisitionRefusal(new NpmAcquisitionError('NPM_NETWORK'), signal, 'x') as Error & { next?: string };
  assert.equal(down.next, NEXT.network);
});

test('the words of the code: a neutral sentence, and a table next step that names each case', () => {
  const words = renderRefusal('SKILLS_OFFLINE', FIXED).split('\n');
  assert.equal(words[1], SENTENCE);
  assert.equal(words[2], 'Next: After --offline, run the command again without --offline. After plain apply, run bowerloom skills sync, or bowerloom apply --frozen.');
  void reportFailure;
});
