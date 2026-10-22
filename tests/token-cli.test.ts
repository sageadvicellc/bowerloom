// Spec 07, section 10, through the real binary: the opt-in GitHub token of a private store remote. Every request goes to
// tests/support/fake-network.ts, whose log records whether a request had an Authorization header, never its value.
// The token is a canary, ghp_ and 36 letters from g to z, so no hex digit of a hash or a revision can match a part of it.
import './support/isolate-home.js';
import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'node:test';
import { world, run, approve, mustApprove, errorCode, project, pushStore, network, NETWORK, shared, EMPTY_CONFIG, STORE_COMMIT } from './support/config-cli.js';
import type { World } from './support/config-cli.js';

const CANARY = 'ghp_' + ('ghijklmnopqrstuvwxyz' + 'zyxwvutsrqponmlkjh').slice(0, 36);
const TOKEN = (value: string): Record<string, string> => ({ BOWERLOOM_GITHUB_TOKEN: value });
const PARTS = Array.from({ length: CANARY.length - 7 }, (_, i) => CANARY.slice(i, i + 8));
const fixtures = fileURLToPath(new URL('../../packages/skill-manifest/test/fixtures/', import.meta.url));
const NPM_SPEC = 'npm:@synthetic/db-skills@0.0.1:skills/synthetic-db/collections', NPM_ID = 'synthetic-db-collections';
const NPM_ROUTES: Record<string, string> = {
  'https://registry.npmjs.org/@synthetic/db-skills/0.0.1': join(fixtures, 'npm-db-skills', 'metadata.json'),
  'https://registry.npmjs.org/@synthetic/db-skills/-/db-skills-0.0.1.tgz': join(fixtures, 'npm-db-skills', 'archive.tgz'),
};
const GIT_COMMIT = 'c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00', GIT_SPEC = `github:synthetic-owner/skills-repo@${GIT_COMMIT}:skills/verification-loop`;
const COMMIT_URL = `https://api.github.com/repos/sageadvicellc/store/git/commits/${STORE_COMMIT}`;
const CREDENTIALS_LINE = /^Credentials: BOWERLOOM_GITHUB_TOKEN is set\. It is sent to api\.github\.com for github\.com\/sageadvicellc\/store only\.$/m;
const TAIL = 'Store items use your GitHub token for the repositories above.';

interface Logged { name: string; target: string; authorization?: boolean }
const logOf = (log: string): Logged[] => readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as Logged);
const requests = (log: string): Logged[] => logOf(log).filter(l => l.name === 'https.request');
/** No 8-character part of the canary is in the text. */
function clean(label: string, text: string): void { for (const part of PARTS) assert.equal(text.includes(part), false, `${label} holds part of the token`); }
/** No file under `root` holds an 8-character part of the canary. Links are not followed. Returns the number of files read. */
function cleanTree(root: string): number {
  let files = 0;
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name), s = lstatSync(path);
      if (s.isSymbolicLink()) continue;
      if (s.isDirectory()) { walk(path); continue; }
      if (!s.isFile()) continue;
      const bytes = readFileSync(path); files++;
      for (const part of PARTS) assert.equal(bytes.includes(part), false, `${path} holds part of the token`);
    }
  };
  walk(root); return files;
}

/** The owner: a store team, skill, and prompt, a pinned npm skill, pushed; a shared project that uses all four. */
function owner(t: TestContext, env: Record<string, string> = {}): { w: World; dir: string; routes: Record<string, string> } {
  const w = world(t), dir = project(w, 'app', EMPTY_CONFIG); shared(dir);
  mustApprove(w.home, ['team', 'create', 'research', '--global'], w.env);
  mustApprove(w.home, ['skill', 'create', 'house-style', '--global'], w.env);
  mustApprove(w.home, ['prompt', 'create', 'weekly-update', '--global'], w.env);
  mustApprove(w.work, ['skills', 'add', NPM_SPEC, '--global'], network(w, NPM_ROUTES).env, NETWORK);
  const repo = pushStore(w), net = { ...network(w, repo.routes).env, ...env };
  for (const [kind, id] of [['skill', 'house-style'], ['team', 'research'], ['prompt', 'weekly-update'], ['skill', NPM_ID]]) mustApprove(dir, ['use', kind!, id!], net, NETWORK);
  return { w, dir, routes: repo.routes };
}
/** A teammate's clone: bowerloom.json and bowerloom.lock.json, and no store. */
function clone(t: TestContext): { mate: World; dir: string; routes: Record<string, string> } {
  const o = owner(t), mate = world(t), dir = project(mate, 'app');
  for (const f of ['bowerloom.json', 'bowerloom.lock.json']) copyFileSync(join(o.dir, f), join(dir, f));
  return { mate, dir, routes: o.routes };
}

test('1. apply --frozen with the variable set shows the Credentials and Network lines, exits 3, and with --approve installs; only store requests carry the header', t => {
  const { mate, dir, routes } = clone(t), net = network(mate, { ...routes, ...NPM_ROUTES }), env = { ...net.env, ...TOKEN(CANARY) };
  const plan = run(dir, ['apply', '--frozen'], env, NETWORK);
  assert.equal(plan.status, 3, plan.stderr + plan.stdout);
  assert.match(plan.stdout, CREDENTIALS_LINE);
  assert.match(plan.stdout, new RegExp(`^Network: reads api\\.github\\.com and registry\\.npmjs\\.org for \\d+ items\\. Pins are fetched without credentials\\. ${TAIL.replace(/\./g, '\\.')} Bytes must match their pins or bowerloom\\.lock\\.json\\.$`, 'm'));
  // The Credentials line comes before the Network line, which points at it.
  assert.ok(plan.stdout.indexOf('Credentials:') < plan.stdout.indexOf('Network:'));
  const { applied, body } = approve(dir, ['apply', '--frozen'], env, NETWORK);
  assert.equal(applied.status, 0, applied.stderr + applied.stdout);
  assert.deepEqual((body.plan as { network: { credentials: unknown } }).network.credentials, { variable: 'BOWERLOOM_GITHUB_TOKEN', host: 'api.github.com', repositories: ['sageadvicellc/store'] });
  for (const f of ['.claude/skills/house-style/SKILL.md', `.claude/skills/${NPM_ID}/SKILL.md`, '.claude/commands/weekly-update.md']) assert.ok(existsSync(join(dir, f)), f);
  const sent = requests(net.log), store = sent.filter(r => r.target.startsWith('https://api.github.com/repos/')), npm = sent.filter(r => r.target.startsWith('https://registry.npmjs.org/'));
  assert.ok(store.length > 0 && npm.length > 0, JSON.stringify(sent));
  assert.ok(store.every(r => r.authorization === true), JSON.stringify(store));
  assert.ok(npm.every(r => r.authorization === false), JSON.stringify(npm));
  assert.equal(store.length + npm.length, sent.length);
  clean('apply output', plan.stdout + plan.stderr + applied.stdout + applied.stderr);
});

test('1. skills sync --frozen with the variable set shows the sync form of the lines', t => {
  const { mate, dir, routes } = clone(t), net = network(mate, { ...routes, ...NPM_ROUTES });
  const plan = run(dir, ['skills', 'sync', '--frozen'], { ...net.env, ...TOKEN(CANARY) }, NETWORK);
  assert.equal(plan.status, 3, plan.stderr + plan.stdout);
  assert.match(plan.stdout, CREDENTIALS_LINE);
  assert.match(plan.stdout, new RegExp(`^Network: reads api\\.github\\.com and registry\\.npmjs\\.org for \\d+ items\\. Pins are fetched without credentials\\. ${TAIL.replace(/\./g, '\\.')}$`, 'm'));
});

test('2. without the variable the lines are absent and no request carries the header; a private repository gives STORE_REMOTE_PRIVATE', t => {
  const { mate, dir, routes } = clone(t), net = network(mate, { ...routes, ...NPM_ROUTES });
  const plan = run(dir, ['apply', '--frozen'], net.env, NETWORK);
  assert.equal(plan.status, 3, plan.stderr); assert.doesNotMatch(plan.stdout, /Credentials:/); assert.doesNotMatch(plan.stdout, /GitHub token/);
  assert.match(plan.stdout, /^Network: reads api\.github\.com and registry\.npmjs\.org for \d+ items, public and without credentials\./m);
  assert.equal(approve(dir, ['apply', '--frozen'], net.env, NETWORK).applied.status, 0);
  const sent = requests(net.log); assert.ok(sent.length > 0); assert.ok(sent.every(r => r.authorization === false), JSON.stringify(sent));
  const other = clone(t), hidden = network(other.mate, NPM_ROUTES);
  const { applied } = approve(other.dir, ['apply', '--frozen'], hidden.env, NETWORK);
  assert.equal(errorCode(applied.stderr), 'STORE_REMOTE_PRIVATE');
});

test('3. an invalid value refuses GITHUB_TOKEN_INVALID with no network call, in every command that reads it', t => {
  const { mate, dir, routes } = clone(t), bad = `${CANARY}!`;
  for (const args of [['apply', '--frozen', '--json'], ['skills', 'sync', '--json'], ['skills', 'sync', '--frozen', '--json']]) {
    const net = network(mate, { ...routes, ...NPM_ROUTES }), r = run(dir, args, { ...net.env, ...TOKEN(bad) }, NETWORK);
    assert.equal(errorCode(r.stderr), 'GITHUB_TOKEN_INVALID', args.join(' ')); assert.deepEqual(logOf(net.log), [], args.join(' '));
    clean(args.join(' '), r.stdout + r.stderr);
  }
  // The text form names the refusal and its next step, and never the value.
  const text = run(dir, ['apply', '--frozen'], { ...network(mate, {}).env, ...TOKEN(bad) }, NETWORK);
  assert.match(text.stderr, /GITHUB_TOKEN_INVALID/); clean('text refusal', text.stdout + text.stderr);
  const o = owner(t);
  mustApprove(o.w.home, ['skill', 'create', 'second', '--global'], o.w.env);
  const repo = pushStore(o.w);
  for (const args of [['use', 'skill', 'second', '--json'], ['lock', 'update', '--json']]) {
    if (args[0] === 'lock') writeFileSync(join(o.w.store, 'skills/house-style/SKILL.md'), '---\nname: house-style\ndescription: Changed.\n---\nx\n');
    const net = network(o.w, repo.routes), r = run(o.dir, args, { ...net.env, ...TOKEN('abc') }, NETWORK);
    assert.equal(errorCode(r.stderr), 'GITHUB_TOKEN_INVALID', args.join(' ')); assert.deepEqual(logOf(net.log), [], args.join(' '));
  }
  // A plain apply never reads the variable.
  const plain = run(dir, ['apply', '--json'], { ...network(mate, {}).env, ...TOKEN(bad) }, NETWORK);
  assert.equal(plain.stderr.includes('GITHUB_TOKEN_INVALID'), false, plain.stderr);
});

test('4. a 401 from GitHub with the token gives STORE_REMOTE_AUTH_FAILED and installs nothing; the variable removed after the plan gives STALE_APPROVAL', t => {
  const { mate, dir, routes } = clone(t), net = network(mate, { ...routes, ...NPM_ROUTES, [COMMIT_URL]: { status: 401, file: null } }), env = { ...net.env, ...TOKEN(CANARY) };
  const { applied } = approve(dir, ['apply', '--frozen'], env, NETWORK);
  assert.equal(errorCode(applied.stderr), 'STORE_REMOTE_AUTH_FAILED'); clean('401', applied.stdout + applied.stderr);
  assert.equal(existsSync(join(dir, '.claude/skills/house-style')), false);
  const fresh = network(mate, { ...routes, ...NPM_ROUTES });
  const planned = run(dir, ['apply', '--frozen', '--json'], { ...fresh.env, ...TOKEN(CANARY) }, NETWORK);
  assert.equal(planned.status, 3, planned.stderr);
  const revision = (JSON.parse(planned.stdout) as { revision: string }).revision;
  assert.equal(errorCode(run(dir, ['apply', '--frozen', '--approve', revision], fresh.env, NETWORK).stderr), 'STALE_APPROVAL');
  const bare = JSON.parse(run(dir, ['apply', '--frozen', '--json'], fresh.env, NETWORK).stdout) as { revision: string };
  assert.equal(errorCode(run(dir, ['apply', '--frozen', '--approve', bare.revision], { ...fresh.env, ...TOKEN(CANARY) }, NETWORK).stderr), 'STALE_APPROVAL');
  assert.deepEqual(requests(fresh.log), [], 'a stale approval fetches nothing');
});

test('5. use skill in a shared project with the variable set proves the item with the header, and shows the token lines', t => {
  const o = owner(t);
  mustApprove(o.w.home, ['skill', 'create', 'second', '--global'], o.w.env);
  const repo = pushStore(o.w), net = network(o.w, repo.routes), env = { ...net.env, ...TOKEN(CANARY) };
  const plan = run(o.dir, ['use', 'skill', 'second'], env, NETWORK);
  assert.equal(plan.status, 3, plan.stderr + plan.stdout);
  assert.match(plan.stdout, CREDENTIALS_LINE);
  assert.match(plan.stdout, new RegExp(`^Network: reads api\\.github\\.com, to check the pushed copy of 1 item, about \\d+ requests to api\\.github\\.com\\. ${TAIL.replace(/\./g, '\\.')}$`, 'm'));
  assert.doesNotMatch(plan.stdout, /Without a token/);
  const { applied } = approve(o.dir, ['use', 'skill', 'second'], env, NETWORK);
  assert.equal(applied.status, 0, applied.stderr);
  const sent = requests(net.log); assert.ok(sent.length > 0); assert.ok(sent.every(r => r.authorization === true && r.target.startsWith('https://api.github.com/repos/sageadvicellc/store/git/')), JSON.stringify(sent));
  clean('use output', plan.stdout + applied.stdout + applied.stderr); clean('lock', readFileSync(join(o.dir, 'bowerloom.lock.json'), 'utf8'));
  // lock update shows the same lines.
  writeFileSync(join(o.w.store, 'skills/second/SKILL.md'), '---\nname: second\ndescription: Changed.\n---\nx\n');
  const repo2 = pushStore(o.w), lock = run(o.dir, ['lock', 'update'], { ...network(o.w, repo2.routes).env, ...TOKEN(CANARY) }, NETWORK);
  assert.equal(lock.status, 3, lock.stderr + lock.stdout); assert.match(lock.stdout, CREDENTIALS_LINE); assert.match(lock.stdout, new RegExp(`${TAIL.replace(/\./g, '\\.')}$`, 'm'));
});

test('6. store status prints each of the three token lines and the JSON git.token values, and sends nothing', t => {
  const w = world(t);
  mustApprove(w.home, ['skill', 'create', 'house-style', '--global'], w.env);
  // A store with no git remote has no token line.
  const none = run(w.home, ['store', 'status'], { ...w.env, ...TOKEN(CANARY) });
  assert.doesNotMatch(none.stdout, /GitHub token:/);
  pushStore(w);
  const cases: [Record<string, string>, string, string][] = [
    [{}, '  GitHub token: BOWERLOOM_GITHUB_TOKEN is not set', 'not-set'],
    [TOKEN(''), '  GitHub token: BOWERLOOM_GITHUB_TOKEN is not set', 'not-set'],
    [TOKEN(CANARY), '  GitHub token: BOWERLOOM_GITHUB_TOKEN is set', 'set'],
    [TOKEN(`${CANARY} x`), '  GitHub token: BOWERLOOM_GITHUB_TOKEN is set but is not a valid token', 'invalid'],
  ];
  for (const [extra, line, value] of cases) {
    const net = network(w, {}), env = { ...net.env, ...extra };
    const text = run(w.home, ['store', 'status'], env, NETWORK);
    assert.equal(text.status, 0, text.stderr);
    const lines = text.stdout.split('\n'), at = lines.findIndex(l => l.startsWith('  Git: '));
    assert.equal(lines[at + 1], line, text.stdout);
    const json = run(w.home, ['store', 'status', '--json'], env, NETWORK);
    assert.equal(json.status, 0, json.stderr); assert.equal((JSON.parse(json.stdout) as { git: { token: string } }).git.token, value);
    assert.deepEqual(logOf(net.log), [], 'store status sends nothing');
    clean('store status', text.stdout + text.stderr + json.stdout + json.stderr);
  }
});

test('7. the leak scan: a full flow with a canary token leaves no part of it in any output or file, also under NODE_DEBUG', t => {
  for (const debug of [false, true]) {
    const extra: Record<string, string> = { ...TOKEN(CANARY), ...(debug ? { NODE_DEBUG: 'http,https,net,tls' } : {}) };
    const outputs: string[] = [];
    /** Runs a command as text, then as --json, then approves it when it asks; every output is kept for the scan. */
    const exercise = (cwd: string, args: string[], env: Record<string, string>): void => {
      const text = run(cwd, args, env, NETWORK); outputs.push(text.stdout, text.stderr);
      const json = run(cwd, [...args, '--json'], env, NETWORK); outputs.push(json.stdout, json.stderr);
      if (json.status !== 3) { assert.ok([0, 4].includes(json.status ?? -1), `${args.join(' ')}: ${json.stderr}`); return; }
      const first = JSON.parse(json.stdout.split('\n').filter(Boolean)[0]!) as { revision: string };
      const applied = run(cwd, [...args, '--approve', first.revision], env, NETWORK); outputs.push(applied.stdout, applied.stderr);
      assert.ok([0, 4].includes(applied.status ?? -1), `${args.join(' ')}: ${applied.stderr}${applied.stdout}`);
    };
    const o = world(t), dir = project(o, 'app', EMPTY_CONFIG); shared(dir);
    const tmp = (w: World) => { const d = join(w.base, 'tmp'); mkdirSync(d, { recursive: true, mode: 0o700 }); return { TMPDIR: d }; };
    const oEnv = { ...o.env, ...tmp(o), ...network(o, {}).env, ...extra };
    for (const args of [['team', 'create', 'research', '--global'], ['skill', 'create', 'house-style', '--global'], ['prompt', 'create', 'weekly-update', '--global']]) exercise(o.home, args, oEnv);
    exercise(o.work, ['skills', 'add', NPM_SPEC, '--global'], { ...oEnv, ...network(o, NPM_ROUTES).env });
    let repo = pushStore(o);
    for (const [kind, id] of [['skill', 'house-style'], ['team', 'research'], ['prompt', 'weekly-update'], ['skill', NPM_ID]]) exercise(dir, ['use', kind!, id!], { ...oEnv, ...network(o, repo.routes).env });
    writeFileSync(join(o.store, 'skills/house-style/SKILL.md'), '---\nname: house-style\ndescription: Changed.\n---\nx\n');
    repo = pushStore(o);
    exercise(dir, ['lock', 'update'], { ...oEnv, ...network(o, repo.routes).env });
    exercise(dir, ['store', 'status'], { ...oEnv, ...network(o, {}).env });
    // The teammate's clone.
    const mate = world(t), copy = project(mate, 'app');
    for (const f of ['bowerloom.json', 'bowerloom.lock.json']) copyFileSync(join(dir, f), join(copy, f));
    const net = network(mate, { ...repo.routes, ...NPM_ROUTES }), mEnv = { ...mate.env, ...tmp(mate), ...net.env, ...extra };
    exercise(copy, ['apply', '--frozen'], mEnv);
    assert.ok(requests(net.log).some(r => r.authorization === true), 'the store fetch used the token');
    const before = logOf(net.log).length;
    exercise(copy, ['team', 'adopt', 'research'], mEnv);
    assert.equal(logOf(net.log).length, before, 'team adopt makes no request');
    exercise(copy, ['up', '--team', 'research'], mEnv);
    exercise(copy, ['skills', 'sync', '--frozen'], mEnv);
    exercise(copy, ['ls'], mEnv); exercise(copy, ['status'], mEnv);
    for (const [i, text] of outputs.entries()) clean(`output ${i}${debug ? ' (NODE_DEBUG)' : ''}`, text);
    // NODE_DEBUG is live in these runs: the project lock's listener writes NET debug lines.
    if (debug) assert.ok(outputs.some(o2 => /^NET \d+:/m.test(o2)), 'NODE_DEBUG printed nothing');
    const read = cleanTree(o.base) + cleanTree(mate.base);
    assert.ok(read > 20, `the scan read ${read} files`);
  }
});

test('8. skills add and skills sync of a pinned GitHub skill with the variable set send no header', t => {
  const w = world(t), dir = project(w, 'app', EMPTY_CONFIG);
  const recorded = JSON.parse(readFileSync(join(fixtures, 'github-skills-repo.json'), 'utf8')) as { responses: Record<string, string> };
  const responses = join(w.base, 'responses'); mkdirSync(responses);
  const routes: Record<string, string> = {};
  Object.entries(recorded.responses).forEach(([url, body], i) => { const file = join(responses, `${i}.json`); writeFileSync(file, Buffer.from(body, 'base64')); routes[url] = file; });
  const net = network(w, routes), env = { ...net.env, ...TOKEN(CANARY) };
  const { applied } = approve(dir, ['skills', 'add', GIT_SPEC], env, NETWORK);
  assert.equal(applied.status, 0, applied.stderr + applied.stdout);
  rmSync(join(w.state, 'bowerloom', 'cache'), { recursive: true, force: true });
  const sync = approve(dir, ['skills', 'sync'], env, NETWORK);
  assert.equal(sync.applied.status, 0, sync.applied.stderr + sync.applied.stdout);
  assert.doesNotMatch(sync.planned.stdout, /Credentials:/);
  const sent = requests(net.log);
  assert.ok(sent.length > 0 && sent.every(r => r.target.startsWith('https://api.github.com/repos/synthetic-owner/')), JSON.stringify(sent));
  assert.ok(sent.every(r => r.authorization === false), JSON.stringify(sent));
});
