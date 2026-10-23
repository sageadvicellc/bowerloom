// Round 1 of the reviews of PR 101, through the real binary: the behaviour that the page "Where your items come from"
// states. Every run gets its own HOME and XDG_STATE_HOME under a temporary folder, the GitHub token variables are unset,
// and the only network is the fake one of tests/support/fake-network.ts.
//
// - M3: a file that a lock cannot record, such as .DS_Store, refuses STORE_ITEM_NOT_SHAREABLE before any network call,
//   with a Next: line of its own that names the file.
// - M2 and D26: a clone made under umask 002 refuses a frozen install with one code at a time, in a fixed order, and
//   chmod -R go-w . clears every one. Files that disagree refuse in the order of the frozen checks.
// - M5: the note about BOWERLOOM_GITHUB_TOKEN is in the STALE_APPROVAL refusal, not in the plan.
import './support/isolate-home.js';
import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { world, run, mustApprove, errorCode, errorMessage, project, pushStore, network, NETWORK, shared, shell, EMPTY_CONFIG } from './support/config-cli.js';
import type { World } from './support/config-cli.js';
import type { TestContext } from 'node:test';
import { renderRefusal, reportFailure } from '../apps/cli/src/human.js';
import { notShareable } from '../packages/project-config/src/index.js';
import { honestShared } from '../packages/project-config/src/refusal.js';
import { TOKEN_STALE_NOTE } from '../packages/project-sync/src/store-git.js';

const FILE_SENTENCE = 'The item holds a file that a lock cannot record.';
const nextOf = (stderr: string): string | undefined => (JSON.parse(stderr) as { error: { next?: string } }).error.next;
const requestsIn = (log: string): string[] => readFileSync(log, 'utf8').split('\n').filter(Boolean);

/** A shared project that lists the written store skill house-style, synced, with the store pushed to the fake GitHub. */
function sharedWithSkill(t: TestContext): { w: World; dir: string } {
  const w = world(t), dir = project(w, 'app', EMPTY_CONFIG); shared(dir);
  mustApprove(w.home, ['skill', 'create', 'house-style', '--global'], w.env);
  const repo = pushStore(w), net = network(w, repo.routes);
  mustApprove(dir, ['use', 'skill', 'house-style'], net.env, NETWORK);
  mustApprove(dir, ['skills', 'sync'], net.env, NETWORK);
  return { w, dir };
}

test('M3. a .DS_Store in a store item refuses use, lock update, plain apply, and skills sync before any network call, and the Next: line names the file', t => {
  const { w, dir } = sharedWithSkill(t);
  writeFileSync(join(w.store, 'skills', 'house-style', '.DS_Store'), 'x');
  mustApprove(w.home, ['skill', 'create', 'second', '--global'], w.env);
  writeFileSync(join(w.store, 'skills', 'second', '.DS_Store'), 'x');
  const deny = network(w);
  const runs: [string[], string][] = [[['lock', 'update'], 'house-style'], [['apply'], 'house-style'], [['skills', 'sync'], 'house-style'], [['use', 'skill', 'second'], 'second']];
  for (const [args, id] of runs) {
    const r = run(dir, [...args, '--json'], deny.env, NETWORK);
    assert.equal(r.status, 1, `${args.join(' ')}: ${r.stderr}${r.stdout}`);
    assert.equal(errorCode(r.stderr), 'STORE_ITEM_NOT_SHAREABLE', args.join(' '));
    assert.ok(errorMessage(r.stderr).endsWith(FILE_SENTENCE), args.join(' '));
    assert.equal(nextOf(r.stderr), `Delete ~/.bowerloom/skills/${id}/.DS_Store, or make it a file that a lock records. Then run the command again.`, args.join(' '));
  }
  assert.deepEqual(requestsIn(deny.log), [], 'no network call');
  // A terminal shows the file's own Next: line, never the line about a remote.
  const words = reportFailure(notShareable('file', 'skills/house-style/.DS_Store'), true).text;
  assert.match(words, /\nNext: Delete ~\/\.bowerloom\/skills\/house-style\/\.DS_Store, or make it a file that a lock records\. Then run the command again\.\n$/);
  assert.doesNotMatch(words, /Give the store a remote/);
});

test('M3. the Next: line of the cause file names only a plain path, and every other cause keeps the line of its code', () => {
  const generic = 'Delete the file in ~/.bowerloom that a lock cannot record, or fix it. bowerloom help store lists the files a lock records. Then run the command again.';
  for (const unsafe of [undefined, 'skills/x/bad\u001b[2Jname', 'skills/x/../../etc', 'skills/x/a b', '/etc/passwd', 'other/x', `skills/${'a'.repeat(300)}`]) {
    assert.equal((notShareable('file', unsafe) as { next?: string }).next, generic, String(unsafe));
  }
  assert.equal((notShareable('file', 'prompts/weekly-update.md') as { next?: string }).next, 'Delete ~/.bowerloom/prompts/weekly-update.md, or make it a file that a lock records. Then run the command again.');
  for (const cause of ['none', 'no-origin', 'unsupported-remote', 'unreadable', 'unpushed', 'size'] as const) {
    assert.equal((notShareable(cause) as { next?: string }).next, undefined, cause);
    assert.match(renderRefusal('STORE_ITEM_NOT_SHAREABLE', notShareable(cause).message), /\nNext: Give the store a remote and push it\./, cause);
  }
  // A refusal that only an unreadable file made shared keeps the file's Next: line.
  const honest = honestShared(notShareable('file', 'skills/house-style/.DS_Store'), '.git') as Error & { next?: string };
  assert.ok(honest.message.startsWith('Bowerloom could not read .git and treats this project as shared'));
  assert.equal(honest.next, 'Delete ~/.bowerloom/skills/house-style/.DS_Store, or make it a file that a lock records. Then run the command again.');
});

/** A project with .bowerloom, bowerloom.json, and an empty bowerloom.lock.json, committed to a git repository at `src`. */
function committed(w: World, withSkill: boolean): string {
  const src = project(w, 'src', EMPTY_CONFIG);
  if (withSkill) mustApprove(src, ['skill', 'create', 'local-tool'], w.env);
  mustApprove(src, ['team', 'create', 'helpers'], w.env);
  writeFileSync(join(src, 'bowerloom.lock.json'), `${JSON.stringify({ format: 'bowerloom/lock/v1beta1', skills: [], prompts: [], teams: [] }, null, 2)}\n`);
  shell(src, 'git -c init.defaultBranch=main init -q . && git add -A && git commit -q -m init', w);
  return src;
}
const FIX: Readonly<Record<string, string>> = {
  PROJECT_UNSAFE: 'chmod go-w .bowerloom', CONFIG_UNSAFE: 'chmod go-w bowerloom.json', PROJECT_FOLDER_UNSAFE: 'chmod go-w .',
  LOCK_UNSAFE: 'chmod go-w bowerloom.lock.json', MANIFEST_UNSAFE: 'chmod go-w .bowerloom/skills.json', AUTHORING_UNSAFE_PATH: 'chmod -R go-w .bowerloom',
};
/** Runs apply --frozen, fixes only the code it names, and runs it again, until it plans or has nothing to do. Returns the codes in order. */
function refusalsInOrder(dir: string, w: World): string[] {
  const codes: string[] = [];
  for (let i = 0; i < 8; i++) {
    const r = run(dir, ['apply', '--frozen', '--json'], w.env);
    if (r.status === 3 || r.status === 0) return codes;
    assert.equal(r.status, 1, r.stderr + r.stdout);
    const code = errorCode(r.stderr); codes.push(code);
    assert.ok(FIX[code], `no fix for ${code}`);
    shell(dir, FIX[code]!, w);
  }
  assert.fail(`still refused after ${codes.join(', ')}`);
}

test('M2 and D26. a clone made under umask 002 refuses apply --frozen with one code at a time, in order, and chmod -R go-w . clears all of them', t => {
  const w = world(t);
  committed(w, false);
  shell(w.work, 'umask 002 && git clone -q src clone', w);
  assert.deepEqual(refusalsInOrder(join(w.work, 'clone'), w), ['PROJECT_UNSAFE', 'CONFIG_UNSAFE', 'PROJECT_FOLDER_UNSAFE', 'LOCK_UNSAFE', 'AUTHORING_UNSAFE_PATH']);
  shell(w.work, 'umask 002 && git clone -q src again', w);
  const again = join(w.work, 'again');
  assert.equal(errorCode(run(again, ['apply', '--frozen', '--json'], w.env).stderr), 'PROJECT_UNSAFE');
  shell(again, 'chmod -R go-w .', w);
  assert.ok([0, 3].includes(run(again, ['apply', '--frozen', '--json'], w.env).status!), 'chmod -R go-w . clears every refusal');
  assert.equal(shell(again, 'git status --porcelain', w).stdout, '', 'git records no write bits, so the change shows no diff');
});

test('M2. with a project skill, MANIFEST_UNSAFE comes after LOCK_UNSAFE and before AUTHORING_UNSAFE_PATH', t => {
  const w = world(t);
  committed(w, true);
  shell(w.work, 'umask 002 && git clone -q src clone', w);
  assert.deepEqual(refusalsInOrder(join(w.work, 'clone'), w), ['PROJECT_UNSAFE', 'CONFIG_UNSAFE', 'PROJECT_FOLDER_UNSAFE', 'LOCK_UNSAFE', 'MANIFEST_UNSAFE', 'AUTHORING_UNSAFE_PATH']);
});

test('D26. files that disagree refuse a frozen run in the order of steps 2 to 5, each fixture also failing every later step', t => {
  const w = world(t), dir = project(w, 'app');
  const STORE_SKILL = { ...EMPTY_CONFIG, skills: [{ id: 'house-style', source: 'store' }] };
  const lock = (skills: unknown[]): string => `${JSON.stringify({ format: 'bowerloom/lock/v1beta1', skills, prompts: [], teams: [] }, null, 2)}\n`;
  const frozen = (): string => errorCode(run(dir, ['apply', '--frozen', '--json'], w.env).stderr);
  // Step 2: a .bowerloom project with no bowerloom.json, and a lock that does not parse.
  mkdirSync(join(dir, '.bowerloom'), { mode: 0o755 });
  writeFileSync(join(dir, 'bowerloom.lock.json'), '<<<<<<< ours\n');
  assert.equal(frozen(), 'LOCK_CONFIG_MISSING');
  // Step 2: a bowerloom.json that does not parse comes before the broken lock.
  writeFileSync(join(dir, 'bowerloom.json'), '{');
  assert.equal(frozen(), 'CONFIG_INVALID');
  // Step 3: a lock that does not parse comes before the missing item and the mismatch.
  writeFileSync(join(dir, 'bowerloom.json'), `${JSON.stringify(STORE_SKILL, null, 2)}\n`);
  assert.equal(frozen(), 'LOCK_INVALID');
  // Step 4: no lock, with a config that lists a store item.
  shell(dir, 'rm bowerloom.lock.json', w);
  assert.equal(frozen(), 'LOCK_MISSING');
  // Step 5: a lock that lists no store item.
  writeFileSync(join(dir, 'bowerloom.lock.json'), lock([]));
  assert.equal(frozen(), 'LOCK_CONFIG_MISMATCH');
});

test('M5. a token set between the plan and --approve refuses STALE_APPROVAL, and the refusal, not the plan, carries the token note', t => {
  const owner = world(t), dir = project(owner, 'app', EMPTY_CONFIG); shared(dir);
  mustApprove(owner.home, ['skill', 'create', 'house-style', '--global'], owner.env);
  const repo = pushStore(owner);
  mustApprove(dir, ['use', 'skill', 'house-style'], network(owner, repo.routes).env, NETWORK);
  const mate = world(t), copy = project(mate, 'app');
  for (const f of ['bowerloom.json', 'bowerloom.lock.json']) copyFileSync(join(dir, f), join(copy, f));
  const net = network(mate, repo.routes);
  const plan = run(copy, ['apply', '--frozen'], net.env, NETWORK);
  assert.equal(plan.status, 3, plan.stderr);
  assert.ok(!plan.stdout.includes(TOKEN_STALE_NOTE), 'the plan holds no token note');
  const revision = (JSON.parse(run(copy, ['apply', '--frozen', '--json'], net.env, NETWORK).stdout) as { revision: string }).revision;
  const token = `ghp_${'A'.repeat(36)}`;
  const refused = run(copy, ['apply', '--frozen', '--json', '--approve', revision], { ...net.env, BOWERLOOM_GITHUB_TOKEN: token }, NETWORK);
  assert.equal(errorCode(refused.stderr), 'STALE_APPROVAL', refused.stderr);
  assert.ok(errorMessage(refused.stderr).endsWith(TOKEN_STALE_NOTE), errorMessage(refused.stderr));
  assert.ok(!refused.stderr.includes(token.slice(4, 20)), 'the token never shows');
});
