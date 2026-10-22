// Through the real binary and the fake network: apply --frozen of a locked commit that is gone from GitHub (a
// force-push or a deleted branch) refuses LOCK_COMMIT_GONE; a repository that is not readable keeps today's codes.
// One extra request, for the repository, tells the two apart. The token is a canary that never appears.
import './support/isolate-home.js';
import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { world, run, mustApprove, errorCode, errorMessage, project, pushStore, network, NETWORK, shared, EMPTY_CONFIG, STORE_COMMIT } from './support/config-cli.js';
import type { World } from './support/config-cli.js';
import { renderRefusal } from '../apps/cli/src/human.js';

const CANARY = 'ghp_' + ('ghijklmnopqrstuvwxyz' + 'zyxwvutsrqponmlkjh').slice(0, 36);
const PARTS = Array.from({ length: CANARY.length - 7 }, (_, i) => CANARY.slice(i, i + 8));
const COMMIT_URL = `https://api.github.com/repos/sageadvicellc/store/git/commits/${STORE_COMMIT}`, REPO_URL = 'https://api.github.com/repos/sageadvicellc/store';
interface Logged { name: string; target: string; authorization?: boolean }
const requests = (log: string): Logged[] => readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as Logged).filter(l => l.name === 'https.request');

/** The owner locks a store skill in a shared project; a teammate's clone has the two files and no store. */
function clone(t: TestContext): { mate: World; dir: string; routes: Record<string, string> } {
  const w = world(t), owner = project(w, 'app', EMPTY_CONFIG); shared(owner);
  mustApprove(w.home, ['skill', 'create', 'house-style', '--global'], w.env);
  const repo = pushStore(w);
  mustApprove(owner, ['use', 'skill', 'house-style'], network(w, repo.routes).env, NETWORK);
  const mate = world(t), dir = project(mate, 'app');
  for (const f of ['bowerloom.json', 'bowerloom.lock.json']) copyFileSync(join(owner, f), join(dir, f));
  return { mate, dir, routes: repo.routes };
}
/** The routes of a store whose locked commit is gone: no commit route, and the repository answer that `readable` says. */
function gone(mate: World, routes: Record<string, string>, readable: boolean): Record<string, string> {
  const { [COMMIT_URL]: _commit, ...rest } = routes;
  if (!readable) return rest;
  const file = join(mate.base, 'repository.json'); writeFileSync(file, '{"full_name":"sageadvicellc/store","private":false}');
  return { ...rest, [REPO_URL]: file };
}
/** Plans apply --frozen, then applies it. Returns the refused run, the plan's request count, and the network log. */
function frozen(dir: string, env: Record<string, string>) {
  const planned = run(dir, ['apply', '--frozen', '--json'], env, NETWORK); assert.equal(planned.status, 3, planned.stderr + planned.stdout);
  const body = JSON.parse(planned.stdout) as { revision: string; plan: { network: { requests: number } } };
  return { refused: run(dir, ['apply', '--frozen', '--json', '--approve', body.revision], env, NETWORK), requests: body.plan.network.requests };
}
function clean(label: string, text: string): void { for (const part of PARTS) assert.equal(text.includes(part), false, `${label} holds part of the token`); }

test('fix 2: a locked commit gone from a readable repository refuses LOCK_COMMIT_GONE, with and without a canary token', t => {
  const { mate, dir, routes } = clone(t);
  for (const token of [null, CANARY]) {
    const net = network(mate, gone(mate, routes, true)), env = token === null ? net.env : { ...net.env, BOWERLOOM_GITHUB_TOKEN: token };
    const { refused, requests: planned } = frozen(dir, env);
    assert.equal(refused.status, 1, refused.stderr); assert.equal(errorCode(refused.stderr), 'LOCK_COMMIT_GONE', refused.stderr);
    assert.equal(errorMessage(refused.stderr), 'The locked commit is no longer on GitHub.');
    const sent = requests(net.log);
    assert.deepEqual(sent.map(r => [r.target, r.authorization]), [[COMMIT_URL, token !== null], [REPO_URL, token !== null]]);
    assert.ok(sent.length <= planned, `${sent.length} requests, plan counted ${planned}`);
    clean('stdout', refused.stdout); clean('stderr', refused.stderr);
  }
  const words = renderRefusal('LOCK_COMMIT_GONE', 'The locked commit is no longer on GitHub.');
  const page = readFileSync(new URL('../../apps/docs/src/content/docs/reference/errors.md', import.meta.url), 'utf8');
  assert.match(page, /^\| `LOCK_COMMIT_GONE` \| A force-push or a deleted branch removes a commit that a lock still names\. .* \| Ask the author to run `bowerloom lock update` and push the store, then pull the project\. \|$/m);
  assert.match(words, /^Refused \(LOCK_COMMIT_GONE\): The locked commit is no longer on GitHub\.\nA force-push or a deleted branch removes a commit that a lock still names\.\nNext: Ask the author to run bowerloom lock update and push the store, then pull the project\.\n$/);
});

test('fix 2: a repository that is not readable keeps STORE_REMOTE_PRIVATE without a token and STORE_REMOTE_AUTH_FAILED with one', t => {
  const { mate, dir, routes } = clone(t);
  for (const [token, expected] of [[null, 'STORE_REMOTE_PRIVATE'], [CANARY, 'STORE_REMOTE_AUTH_FAILED']] as const) {
    const net = network(mate, gone(mate, routes, false)), env = token === null ? net.env : { ...net.env, BOWERLOOM_GITHUB_TOKEN: token };
    const { refused } = frozen(dir, env);
    assert.equal(errorCode(refused.stderr), expected, refused.stderr);
    assert.deepEqual(requests(net.log).map(r => [r.target, r.authorization]), [[COMMIT_URL, token !== null], [REPO_URL, token !== null]]);
    clean('stdout', refused.stdout); clean('stderr', refused.stderr);
  }
  // A token GitHub refuses (401) on both requests stays STORE_REMOTE_AUTH_FAILED.
  const { [COMMIT_URL]: _c, ...rest } = routes;
  const net = network(mate, { ...rest, [COMMIT_URL]: { status: 401, file: null }, [REPO_URL]: { status: 401, file: null } } as never);
  const { refused } = frozen(dir, { ...net.env, BOWERLOOM_GITHUB_TOKEN: CANARY });
  assert.equal(errorCode(refused.stderr), 'STORE_REMOTE_AUTH_FAILED', refused.stderr);
  assert.deepEqual(requests(net.log).map(r => r.target), [COMMIT_URL, REPO_URL]);
});
