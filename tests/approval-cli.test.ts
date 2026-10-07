import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../apps/cli/src/main.js', import.meta.url));
const confirm = fileURLToPath(new URL('../apps/cli/src/confirm.js', import.meta.url));
const human = fileURLToPath(new URL('../apps/cli/src/human.js', import.meta.url));
const REV = 'ab'.repeat(32);
function folder(t: test.TestContext) { const root = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-approval-cli-'))); t.after(() => rmSync(root, { recursive: true, force: true })); return root; }
/** Runs `runApprovalCommand` the way a write command in main.ts will: a real process, stdin and stdout pipes, no terminal. */
function driver(root: string) {
  const file = join(root, 'driver.mjs'), target = join(root, 'target.txt');
  writeFileSync(file, `import { writeFileSync } from 'node:fs';
import { runApprovalCommand } from ${JSON.stringify(confirm)};
import { reportFailure } from ${JSON.stringify(human)};
const REV = ${JSON.stringify(REV)};
const change = { plan: async () => ({ note: 'Write target.txt.' }), revision: () => REV, review: p => p.note, apply: async () => { writeFileSync(${JSON.stringify(target)}, 'written\\n'); return { wrote: true }; } };
try { process.exitCode = await runApprovalCommand(process.argv.slice(2), change, { interactive: false, ask: async () => '' }, text => process.stdout.write(text)); }
catch (error) { const failure = reportFailure(error, false); process.stderr.write(failure.text); process.exitCode = failure.exitCode; }
`);
  return { file, target, run: (...args: string[]) => { const r = spawnSync(process.execPath, [file, ...args], { cwd: root, encoding: 'utf8', timeout: 20000, stdio: ['pipe', 'pipe', 'pipe'] }); assert.equal(r.error, undefined); return r; } };
}

test('without a terminal and without --approve, a write command exits 3, prints the revision and changes nothing', t => {
  const root = folder(t), d = driver(root), before = readdirSync(root).sort();
  const r = d.run();
  assert.equal(r.status, 3, r.stderr); assert.equal(r.stderr, '');
  assert.equal(r.stdout, `Write target.txt.\nRevision: ${REV}\nApproval required. Run the same command again with --approve ${REV}\n`);
  assert.deepEqual(readdirSync(root).sort(), before);
  const j = d.run('--json'); assert.equal(j.status, 3);
  assert.deepEqual(JSON.parse(j.stdout), { approvalRequired: true, code: 'APPROVAL_REQUIRED', plan: { note: 'Write target.txt.' }, revision: REV });
  assert.deepEqual(readdirSync(root).sort(), before);
});

test('with the matching --approve the command applies and exits 0; a wrong revision refuses', t => {
  const root = folder(t), d = driver(root);
  const wrong = d.run('--approve', 'cd'.repeat(32)); assert.equal(wrong.status, 1); assert.equal(JSON.parse(wrong.stderr).error.code, 'STALE_APPROVAL'); assert.equal(readdirSync(root).includes('target.txt'), false);
  const ok = d.run('--approve', REV); assert.equal(ok.status, 0, ok.stderr); assert.equal(ok.stdout, `Applied plan ${REV}.\n`); assert.equal(readdirSync(root).includes('target.txt'), true);
});

test('--yes exits 2 in a write command and in the CLI, and nothing is written', t => {
  const root = folder(t), d = driver(root);
  const r = d.run('--yes'); assert.equal(r.status, 2); assert.equal(JSON.parse(r.stderr).error.code, 'USAGE'); assert.equal(readdirSync(root).includes('target.txt'), false);
  for (const args of [['--yes'], ['ls', '--yes'], ['status', '--yes'], ['init', 'apply', '--yes'], ['skills', 'plan', '--yes']]) {
    const c = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 20000 });
    assert.equal(c.status, 2, args.join(' ')); assert.equal(JSON.parse(c.stderr).error.code, 'USAGE'); assert.match(JSON.parse(c.stderr).error.message, /--approve/);
  }
});

test('a malformed --approve exits 2', t => {
  const root = folder(t), d = driver(root);
  for (const value of ['abc', 'AB'.repeat(32), 'sha256:' + REV, REV + '0', '']) { const r = d.run('--approve', value); assert.equal(r.status, 2, value); assert.equal(JSON.parse(r.stderr).error.code, 'USAGE'); }
  assert.equal(d.run('--approve').status, 2);
  assert.equal(spawnSync(process.execPath, [cli, 'ls', '--approve', 'zz'], { cwd: root, encoding: 'utf8' }).status, 2);
  assert.equal(readdirSync(root).includes('target.txt'), false);
});

test('no environment variable skips approval', t => {
  const root = folder(t), d = driver(root);
  for (const name of ['BOWERLOOM_YES', 'BOWERLOOM_APPROVE', 'BOWERLOOM_ASSUME_YES', 'CI', 'YES', 'FORCE', 'BOWERLOOM_NONINTERACTIVE', 'BOWERLOOM_APPROVE_ALL']) {
    const r = spawnSync(process.execPath, [d.file], { cwd: root, encoding: 'utf8', env: { ...process.env, [name]: '1' } });
    assert.equal(r.status, 3, name); assert.equal(readdirSync(root).includes('target.txt'), false, name);
  }
});
