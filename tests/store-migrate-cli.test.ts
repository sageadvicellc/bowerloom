// Spec 08, through the real binary: `store migrate` and `receipt clean`. Every run gets its own HOME and XDG_STATE_HOME
// under a temporary folder, and the GitHub token variables are unset. Nothing here touches the real home folder.
import './support/isolate-home.js';
import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { world, run, approve, mustApprove, errorCode, errorMessage, project } from './support/config-cli.js';
import type { World } from './support/config-cli.js';
import { TOPICS } from '../apps/cli/src/human.js';
import { readInstalledRelease } from '../apps/cli/src/release.js';

const heading = `Bowerloom ${readInstalledRelease().version}: open beta\n${readInstalledRelease().execution}\n\n`;
/** A project with `.bowerloom` (the marker of a beta.2 project). */
function bowerloomProject(w: World, name = 'app'): string { const dir = project(w, name); mkdirSync(join(dir, '.bowerloom'), { mode: 0o755 }); return dir; }

test('5 (receipt clean alone). a deleted skill is held; receipt clean shows its plan, exits 3, applies, and status no longer names it', t => {
  const w = world(t), dir = bowerloomProject(w);
  mustApprove(dir, ['skill', 'create', 'notes'], w.env);
  mustApprove(dir, ['prompt', 'create', 'brief'], w.env);
  rmSync(join(dir, '.bowerloom', 'skills', 'notes'), { recursive: true });
  assert.match(run(dir, ['status'], w.env).stdout, /^ {2}skill notes: held \(AUTHORING_ITEM_MISSING\)\./m);
  const planned = run(dir, ['receipt', 'clean'], w.env);
  assert.equal(planned.status, 3, planned.stderr);
  assert.match(planned.stdout, /^Remove 1 entry from the record of created items \(\.bowerloom\/authoring\/receipt\.json\)\n {2}skill notes {4}its files are gone\nskills\.json: removes the local entry for skill notes\nThis deletes no file and no installed copy\. Copies of these items stay where they are\.\nRevision: [a-f0-9]{64}\n/);
  const { applied } = approve(dir, ['receipt', 'clean'], w.env);
  assert.equal(applied.status, 0, applied.stderr);
  const words = run(dir, ['receipt', 'clean', '--approve', 'f'.repeat(64)], w.env);
  assert.equal(words.status, 0, 'a second run has nothing to clean and asks for nothing');
  assert.equal(words.stdout, 'Nothing to clean.\n');
  assert.doesNotMatch(run(dir, ['status'], w.env).stdout, /AUTHORING_ITEM_MISSING/);
  assert.equal(JSON.parse(readFileSync(join(dir, '.bowerloom', 'skills.json'), 'utf8')).skills.length, 0);
  assert.ok(existsSync(join(dir, '.bowerloom', 'prompts', 'brief.md')), 'the prompt that is there stays');
  // The plain result words.
  const again = bowerloomProject(w, 'again');
  mustApprove(again, ['prompt', 'create', 'brief'], w.env); rmSync(join(again, '.bowerloom', 'prompts', 'brief.md'));
  const plan = approve(again, ['receipt', 'clean'], w.env);
  assert.equal(plan.applied.status, 0); assert.equal(plan.applied.stdout, `Applied plan ${plan.body.revision}.\nRemoved 1 entry from the record of created items.\n`);
});

test('9. receipt clean --global works outside a project; with no store it refuses STORE_NOT_FOUND', t => {
  const w = world(t), outside = join(w.base, 'outside'); mkdirSync(outside);
  const none = run(outside, ['receipt', 'clean', '--global'], w.env);
  assert.equal(none.status, 1); assert.equal(errorCode(none.stderr), 'STORE_NOT_FOUND');
  assert.equal(existsSync(w.store), false, 'the check makes no store');
  mustApprove(outside, ['skill', 'create', 'house-style', '--global'], w.env);
  mustApprove(outside, ['prompt', 'create', 'weekly', '--global'], w.env);
  assert.equal(run(outside, ['receipt', 'clean', '--global'], w.env).stdout, 'Nothing to clean.\n');
  rmSync(join(w.store, 'skills', 'house-style'), { recursive: true });
  const planned = run(outside, ['receipt', 'clean', '--global'], w.env);
  assert.equal(planned.status, 3);
  assert.match(planned.stdout, /^Remove 1 entry from the record of created items \(~\/\.bowerloom\/authoring\/receipt\.json\)$/m);
  mustApprove(outside, ['receipt', 'clean', '--global'], w.env);
  assert.deepEqual(JSON.parse(readFileSync(join(w.store, 'skills.json'), 'utf8')).skills, []);
  assert.equal(run(outside, ['receipt', 'clean', '--global', '--json'], w.env).stdout.includes('"nothingToDo":true'), true);
});

test('7 and 8 (receipt). help receipt, receipt --help and receipt clean --help print the topic; bare receipt and unknown flags are USAGE', t => {
  const w = world(t);
  for (const args of [['help', 'receipt'], ['receipt', '--help'], ['receipt', 'clean', '--help']]) {
    const r = run(w.base, args, w.env); assert.equal(r.status, 0, args.join(' ')); assert.equal(r.stdout, heading + TOPICS.receipt, args.join(' '));
  }
  for (const args of [['receipt'], ['receipt', 'purge'], ['receipt', 'clean', '--global', '--global'], ['receipt', 'clean', '--all']]) {
    const r = run(w.base, args, w.env); assert.equal(r.status, 2, args.join(' ')); assert.equal(errorCode(r.stderr), 'USAGE');
    assert.equal(errorMessage(r.stderr), 'Use bowerloom receipt clean [--global] [--approve <revision>] [--json].');
  }
});
