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
import { chmodSync, copyFileSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { world, run, mustApprove, errorCode, errorMessage, project, pushStore, network, NETWORK, shared, shell, EMPTY_CONFIG } from './support/config-cli.js';
import type { World } from './support/config-cli.js';
import type { TestContext } from 'node:test';
import { renderRefusal, reportFailure } from '../apps/cli/src/human.js';
import { notShareable } from '../packages/project-config/src/index.js';
import { honestShared } from '../packages/project-config/src/refusal.js';
import { GITHUB_REQUEST_MAX, TOKEN_STALE_NOTE } from '../packages/project-sync/src/store-git.js';

const FILE_SENTENCE = 'The item holds a file that a lock cannot record.';
const SIZE_SENTENCE = 'The item is larger than a lock can record.';
const nextOf = (stderr: string): string | undefined => (JSON.parse(stderr) as { error: { next?: string } }).error.next;
const requestsIn = (log: string): string[] => readFileSync(log, 'utf8').split('\n').filter(Boolean);
const AGAIN = 'Then run the command again.';
const ITEM = '~/.bowerloom/skills/house-style';
const RECORDS = 'a lock records only md, txt, json, yaml, yml, and csv files, and LICENSE and NOTICE files.';

/** A fake network with no route at all: every request fails as a network failure, never as a 404. */
function offline(w: World): { env: Record<string, string>; log: string } {
  const log = join(w.base, `offline-${Date.now()}-${Math.random().toString(16).slice(2)}.log`), plan = `${log}.json`;
  writeFileSync(plan, JSON.stringify({ log })); writeFileSync(log, '');
  return { env: { ...w.env, TEST_FAKE_NETWORK_PLAN: plan }, log };
}

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
    assert.equal(nextOf(r.stderr), `If you do not need ~/.bowerloom/skills/${id}/.DS_Store, delete it. Otherwise rename it: ${RECORDS} ${AGAIN}`, args.join(' '));
  }
  assert.deepEqual(requestsIn(deny.log), [], 'no network call');
  // A terminal shows the file's own Next: line, never the line about a remote.
  const words = reportFailure(notShareable('file', { problem: 'name', path: 'skills/house-style/.DS_Store', item: 'skills/house-style' }), true).text;
  assert.match(words, /\nNext: If you do not need ~\/\.bowerloom\/skills\/house-style\/\.DS_Store, delete it\./);
  assert.doesNotMatch(words, /Give the store a remote/);
});

// Round 2 of the reviews of PR 101, item 2: each fault of a store item has a Next: line of its own, with its path, and
// "delete" is never the first advice for a file that can be real work.
test('round 2. each fault of a store item refuses lock update with its own Next: line, naming the file or folder', t => {
  const { w, dir } = sharedWithSkill(t);
  const item = join(w.store, 'skills', 'house-style'), deny = network(w);
  const cases: [string, (() => void), (() => void), 'file' | 'size', string][] = [
    ['execute bit', () => writeFileSync(join(item, 'run.md'), '# Run\n', { mode: 0o755 }), () => shell(item, 'rm run.md', w), 'file',
      `Run chmod a-x ${ITEM}/run.md. A lock records no file with an execute bit. ${AGAIN}`],
    ['byte order mark', () => writeFileSync(join(item, 'notes.md'), Buffer.from([0xef, 0xbb, 0xbf, 0x41, 0x0a])), () => shell(item, 'rm notes.md', w), 'file',
      `Remove the byte order mark at the start of ${ITEM}/notes.md. ${AGAIN}`],
    ['not UTF-8', () => writeFileSync(join(item, 'notes.md'), Buffer.from([0x41, 0xff, 0x0a])), () => shell(item, 'rm notes.md', w), 'file',
      `Save ${ITEM}/notes.md as UTF-8 text. ${AGAIN}`],
    ['empty file', () => writeFileSync(join(item, 'empty.md'), ''), () => shell(item, 'rm empty.md', w), 'file',
      `${ITEM}/empty.md is empty. Add content to it, or delete it if you do not need it. ${AGAIN}`],
    ['empty folder', () => mkdirSync(join(item, 'refs'), { mode: 0o755 }), () => shell(item, 'rmdir refs', w), 'file',
      `${ITEM}/refs is an empty folder. Add a file to it, or remove the folder. ${AGAIN}`],
    ['too deep', () => { mkdirSync(join(item, 'a/b/c/d/e/f/g/h'), { recursive: true, mode: 0o755 }); writeFileSync(join(item, 'a/b/c/d/e/f/g/h/x.md'), 'x\n'); }, () => shell(item, 'rm -r a', w), 'file',
      `${ITEM}/a/b/c/d/e/f/g/h sits too deep in the item. A lock records at most 7 levels of folders inside an item. Move its files up. ${AGAIN}`],
    ['symlink', () => symlinkSync('SKILL.md', join(item, 'link.md')), () => shell(item, 'rm link.md', w), 'file',
      `${ITEM}/link.md is a link, and a lock records no link. Put a copy of what it points to in its place. ${AGAIN}`],
    ['group-writable file', () => { writeFileSync(join(item, 'notes.md'), 'x\n'); chmodSync(join(item, 'notes.md'), 0o664); }, () => shell(item, 'rm notes.md', w), 'file',
      `Bowerloom could not read ${ITEM}/notes.md safely. It must be a plain file that you own, with one link, closed to other users. Run ls -l ${ITEM}/notes.md. If the store was made under umask 002, run chmod -R go-w ~/.bowerloom. ${AGAIN}`],
    ['a name a lock cannot record, not plain', () => writeFileSync(join(item, 'my notes.png'), 'x'), () => shell(item, "rm 'my notes.png'", w), 'file',
      `A file in ${ITEM} has a name that a lock cannot record. If you do not need it, delete it. Otherwise rename it: ${RECORDS} ${AGAIN}`],
    ['a large file', () => writeFileSync(join(item, 'big.md'), 'a'.repeat(70000)), () => shell(item, 'rm big.md', w), 'size',
      `${ITEM}/big.md is larger than 65536 bytes, the most a lock records for one file. Make it smaller, or split it into smaller files. ${AGAIN}`],
    ['too many files', () => { mkdirSync(join(item, 'many'), { mode: 0o755 }); for (let i = 0; i < 126; i++) writeFileSync(join(item, 'many', `f${i}.md`), `${i}\n`); }, () => shell(item, 'rm -r many', w), 'size',
      `${ITEM} holds more than 126 files, the most a lock records for one item. Remove files from it. ${AGAIN}`],
    ['too many bytes', () => { mkdirSync(join(item, 'big'), { mode: 0o755 }); for (let i = 0; i < 33; i++) writeFileSync(join(item, 'big', `f${i}.md`), `${i}`.padEnd(65000, 'a')); }, () => shell(item, 'rm -r big', w), 'size',
      `${ITEM} holds more than 2 MiB, the most a lock records for one item. Make it smaller. ${AGAIN}`],
  ];
  for (const [label, make, undo, cause, next] of cases) {
    make();
    const r = run(dir, ['lock', 'update', '--json'], deny.env, NETWORK);
    assert.equal(errorCode(r.stderr), 'STORE_ITEM_NOT_SHAREABLE', `${label}: ${r.stderr}${r.stdout}`);
    assert.ok(errorMessage(r.stderr).endsWith(cause === 'file' ? FILE_SENTENCE : SIZE_SENTENCE), `${label}: ${errorMessage(r.stderr)}`);
    assert.equal(nextOf(r.stderr), next, label);
    assert.ok(!nextOf(r.stderr)!.startsWith('Delete'), `${label}: delete is not the first advice`);
    undo();
  }
  assert.deepEqual(requestsIn(deny.log), [], 'no fault made a network call');
  // Seven levels of folders are fine: the next step is the proof, which needs the network.
  mkdirSync(join(item, 'a/b/c/d/e/f/g'), { recursive: true, mode: 0o755 }); writeFileSync(join(item, 'a/b/c/d/e/f/g/x.md'), 'x\n');
  const seven = run(dir, ['lock', 'update', '--json'], offline(w).env, NETWORK);
  assert.equal(errorCode(seven.stderr), 'SKILLS_OFFLINE', seven.stderr);
});

test('round 2. every cause of STORE_ITEM_NOT_SHAREABLE has a true Next: line, and only a plain path is named', () => {
  const adopt = 'Or adopt a team into this project with bowerloom team adopt.';
  const want: Record<string, string> = {
    none: `Make the store a git repository and push it to a github.com repository. bowerloom store status shows the commands. ${adopt}`,
    'no-origin': `Add the remote origin of a github.com repository to the store and push it. bowerloom store status shows the commands. ${adopt}`,
    'unsupported-remote': `Point the remote origin of the store at a github.com repository. bowerloom store status shows the command. ${adopt}`,
    unpushed: `Push the branch of the store, or pass --commit <sha> of a pushed commit. bowerloom store status shows the command. ${adopt}`,
    unreadable: `Bowerloom reads the git files of the store itself. If the store was made under umask 002, run chmod -R go-w ~/.bowerloom/.git. A store whose git uses reftable or SHA-256 cannot be read in this beta. ${adopt}`,
  };
  for (const [cause, next] of Object.entries(want)) {
    assert.equal((notShareable(cause as 'none') as { next?: string }).next, next, cause);
    assert.match(reportFailure(notShareable(cause as 'none'), true).text, new RegExp(`\\nNext: ${next.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n$`), cause);
  }
  // A file or size fault with no place known gets a line that names no file and says no delete.
  for (const cause of ['file', 'size'] as const) assert.ok(!(notShareable(cause) as { next?: string }).next!.startsWith('Delete'), cause);
  for (const unsafe of ['skills/x/bad\u001b[2Jname.md', 'skills/x/../../etc/a.md', 'skills/x/a b.md', '/etc/passwd', 'other/x.md', `skills/x/${'a'.repeat(300)}.md`]) {
    const next = (notShareable('file', { problem: 'mode', path: unsafe, item: 'skills/x' }) as { next?: string }).next!;
    assert.equal(next, `A file in ~/.bowerloom/skills/x has an execute bit. Run chmod a-x on it. ${AGAIN}`, JSON.stringify(unsafe));
  }
  const strange = (notShareable('file', { problem: 'mode', path: 'skills/x/a.md', item: 'skills/../x' }) as { next?: string }).next!;
  assert.ok(!strange.includes('..'), strange);
  // A refusal that only an unreadable file made shared keeps the file's Next: line.
  const honest = honestShared(notShareable('file', { problem: 'name', path: 'skills/house-style/.DS_Store', item: 'skills/house-style' }), '.git') as Error & { next?: string };
  assert.ok(honest.message.startsWith('Bowerloom could not read .git and treats this project as shared'));
  assert.ok(honest.next!.startsWith('If you do not need ~/.bowerloom/skills/house-style/.DS_Store, delete it.'));
});

test('round 2. lock update in a project that is not shared does not say the project is shared', t => {
  const w = world(t), dir = project(w, 'alone', EMPTY_CONFIG);
  mustApprove(w.home, ['skill', 'create', 'house-style', '--global'], w.env);
  mustApprove(dir, ['use', 'skill', 'house-style'], w.env);
  const r = run(dir, ['lock', 'update', '--json'], network(w).env, NETWORK);
  assert.equal(errorCode(r.stderr), 'STORE_ITEM_NOT_SHAREABLE', r.stderr);
  assert.equal(errorMessage(r.stderr), 'A lock records this item, and a teammate cannot fetch it. The store is not a git repository.');
  // In a shared project the words stay.
  shared(dir);
  assert.ok(errorMessage(run(dir, ['lock', 'update', '--json'], network(w).env, NETWORK).stderr).startsWith('This project is shared, and a teammate cannot fetch this store item.'));
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

// Round 2 of the reviews of PR 101, item 1: a fetch that fails on the network says so, with one right step.
const OFFLINE_SENTENCE = 'A pin or a lock item needs a fetch, and this run did not fetch it: --offline was set, plain apply ran, or the network was not reachable.';
const NETWORK_NEXT = 'Connect to the network and run the command again.';
test('round 2. SKILLS_OFFLINE on a network failure: apply --frozen and use print the network step; plain apply keeps its hold', t => {
  const owner = world(t), dir = project(owner, 'app', EMPTY_CONFIG); shared(dir);
  mustApprove(owner.home, ['skill', 'create', 'house-style', '--global'], owner.env);
  const repo = pushStore(owner);
  mustApprove(dir, ['use', 'skill', 'house-style'], network(owner, repo.routes).env, NETWORK);
  const mate = world(t), copy = project(mate, 'app');
  for (const f of ['bowerloom.json', 'bowerloom.lock.json']) copyFileSync(join(dir, f), join(copy, f));
  // A frozen install planned online, then approved with no route to GitHub.
  const revision = (JSON.parse(run(copy, ['apply', '--frozen', '--json'], network(mate, repo.routes).env, NETWORK).stdout) as { revision: string }).revision;
  const frozen = run(copy, ['apply', '--frozen', '--json', '--approve', revision], offline(mate).env, NETWORK);
  assert.equal(errorCode(frozen.stderr), 'SKILLS_OFFLINE', frozen.stderr);
  assert.equal(errorMessage(frozen.stderr), "A pinned skill is not in this machine's cache yet. Nothing in the project changed. Fetching house-style needs api.github.com, and the network was not reachable.");
  assert.equal(nextOf(frozen.stderr), NETWORK_NEXT);
  // use of a written item with no network.
  mustApprove(owner.home, ['skill', 'create', 'second', '--global'], owner.env);
  const used = run(dir, ['use', 'skill', 'second', '--json'], offline(owner).env, NETWORK);
  assert.equal(errorCode(used.stderr), 'SKILLS_OFFLINE', used.stderr);
  assert.equal(nextOf(used.stderr), NETWORK_NEXT);
  assert.ok(errorMessage(used.stderr).endsWith('Checking skill second needs api.github.com, and the network was not reachable.'), errorMessage(used.stderr));
  // Plain apply on the clone holds the item with its own step, and fetches nothing.
  const plain = run(copy, ['apply'], mate.env);
  assert.match(plain.stdout, /house-style +held \(SKILLS_OFFLINE\) .*\n +Next: Run bowerloom apply --frozen, or bowerloom skills sync\./);
});

test('round 2. the SKILLS_OFFLINE words: the network step when the error carries it, else the words for --offline and plain apply', async () => {
  const { syncError } = await import('../packages/project-sync/src/refusal.js');
  const { offlineNetwork } = await import('../packages/project-sync/src/refusal.js');
  const network = reportFailure(offlineNetwork('Fetching skill x needs api.github.com, and the network was not reachable.'), true).text;
  assert.equal(network.split('\n')[1], OFFLINE_SENTENCE); assert.equal(network.split('\n')[2], `Next: ${NETWORK_NEXT}`);
  const offline = reportFailure(syncError('SKILLS_OFFLINE', '--offline was set.'), true).text;
  assert.equal(offline.split('\n')[1], OFFLINE_SENTENCE);
  assert.equal(offline.split('\n')[2], 'Next: Connect to the network and run the command again. After plain apply or --offline, run bowerloom skills sync without --offline, or bowerloom apply --frozen.');
});

// Round 2 of the reviews of PR 101, item 3 (decided): use takes --max-github-requests <n>, as apply and skills sync do.
test('round 2. use --max-github-requests: the range of apply, the line in the plan, and the budget refusal with its step', t => {
  const w = world(t), dir = project(w, 'app', EMPTY_CONFIG); shared(dir);
  mustApprove(w.home, ['skill', 'create', 'house-style', '--global'], w.env);
  const repo = pushStore(w), net = network(w, repo.routes);
  for (const bad of ['0', '5001', 'x']) {
    const r = run(dir, ['use', 'skill', 'house-style', '--max-github-requests', bad, '--json'], net.env, NETWORK);
    assert.equal(r.status, 2, bad); assert.equal(errorCode(r.stderr), 'USAGE', bad);
  }
  const twice = run(dir, ['use', 'skill', 'house-style', '--max-github-requests', '9', '--max-github-requests', '9', '--json'], net.env, NETWORK);
  assert.equal(twice.status, 2);
  const plan = run(dir, ['use', 'skill', 'house-style', '--max-github-requests', '9'], net.env, NETWORK);
  assert.equal(plan.status, 3, plan.stderr);
  assert.match(plan.stdout, /^Network: reads api\.github\.com, to check the pushed copy of 1 item, about 5 requests to api\.github\.com\.\nGitHub requests: at most 5, of the 9 this run allows\.$/m);
  const low = run(dir, ['use', 'skill', 'house-style', '--max-github-requests', '4', '--json'], net.env, NETWORK);
  assert.equal(errorCode(low.stderr), 'GITHUB_REQUEST_BUDGET', low.stderr);
  assert.equal(renderRefusal('GITHUB_REQUEST_BUDGET', 'm').split('\n')[2], `Next: For apply, skills sync, and use, run it again with --max-github-requests <n>, up to ${GITHUB_REQUEST_MAX}. For lock update, lock fewer items in one run with --item <kind>:<id>. For store migrate, move fewer items in one run.`);
  const help = run(dir, ['help', 'use'], w.env);
  assert.match(help.stdout, /bowerloom use skill\|prompt\|team <id> \[--project\] \[--commit <sha>\] \[--max-github-requests <n>\] \[--approve <revision>\] \[--json\]/);
  // Approved with the same flag, it applies.
  const body = JSON.parse(run(dir, ['use', 'skill', 'house-style', '--max-github-requests', '9', '--json'], net.env, NETWORK).stdout) as { revision: string };
  assert.equal(run(dir, ['use', 'skill', 'house-style', '--max-github-requests', '9', '--approve', body.revision], net.env, NETWORK).status, 0);
});
