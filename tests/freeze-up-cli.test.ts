// Freeze review of F (b68f557), findings 1, 2 and 12, through the CLI as an agent runs it (no terminal).
// 1: a deleted registered prompt is held with its restore step; status names it; prompt create restores it.
// 2: up says "prepared, N items held" with each item's next command, never "in place", while items are held.
// 12: the held text names a created team once, and up says when --goal or --name is not used.
import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { TestContext } from 'node:test';

const cli = fileURLToPath(new URL('../apps/cli/src/main.js', import.meta.url));
const preload = pathToFileURL(fileURLToPath(new URL('./support/fake-network.js', import.meta.url))).href;
const GOAL = 'Keep the runbook current.';

function fresh(t: TestContext) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-freeze-up-'))); t.after(() => rmSync(home, { recursive: true, force: true }));
  const dir = join(home, 'beta'), outside = join(home, 'outside'); mkdirSync(dir); mkdirSync(outside);
  const log = join(home, 'network.log'), plan = join(home, 'network.json'); writeFileSync(log, ''); writeFileSync(plan, JSON.stringify({ log }));
  const env = { HOME: home, XDG_STATE_HOME: join(home, 'state'), TEST_FAKE_NETWORK_PLAN: plan };
  return { home, dir, outside, env, network: () => readFileSync(log, 'utf8').split('\n').filter(Boolean) };
}
type Fresh = ReturnType<typeof fresh>;
function run(p: Fresh, args: string[]) {
  const r = spawnSync(process.execPath, ['--import', preload, cli, ...args], { cwd: p.dir, encoding: 'utf8', timeout: 120000, env: { ...process.env, ...p.env } });
  assert.equal(r.error, undefined); return r;
}
const errorOf = (stderr: string) => (JSON.parse(stderr) as { error: { code: string; message: string } }).error;
const revisionIn = (stdout: string): string => { const m = /^Revision: ([a-f0-9]{64})$/m.exec(stdout); assert.ok(m, stdout); return m[1]!; };
/** Plans, then applies with --approve: the way an agent runs a create command. */
function create(p: Fresh, args: string[]) {
  const planned = run(p, args); assert.equal(planned.status, 3, planned.stderr + planned.stdout);
  const applied = run(p, [...args, '--approve', revisionIn(planned.stdout)]); assert.equal(applied.status, 0, applied.stderr); return planned;
}
/** Runs up for the team, approving each step, until it exits 4. Returns the last run. */
function upAll(p: Fresh, team: string, ...extra: string[]) {
  for (let i = 0; i < 6; i++) {
    const r = run(p, ['up', '--team', team, ...extra]);
    if (r.status === 4) return r;
    assert.equal(r.status, 3, r.stderr + r.stdout);
    const applied = run(p, ['up', '--team', team, ...extra, '--approve', revisionIn(r.stdout)]);
    if (applied.status === 4) return applied;
    assert.equal(applied.status, 3, applied.stderr + applied.stdout);
  }
  assert.fail('up did not reach exit 4');
}
function prepared(r: ReturnType<typeof run>): void {
  assert.equal(r.status, 4, r.stderr + r.stdout); assert.match(r.stdout, /^prepared, workers held$/m);
  assert.match(r.stdout, /in place for Claude Code and Codex\./); assert.equal(errorOf(r.stderr).code, 'WORKERS_HELD');
}
function heldItems(r: ReturnType<typeof run>, count: number): void {
  assert.equal(r.status, 4, r.stderr + r.stdout);
  assert.match(r.stdout, new RegExp(`^prepared, ${count} ${count === 1 ? 'item' : 'items'} held$`, 'm'));
  assert.doesNotMatch(r.stdout, /in place/); assert.doesNotMatch(r.stdout, /^prepared, workers held$/m);
  // The agent's envelope on stderr is unchanged.
  assert.deepEqual(errorOf(r.stderr), { code: 'WORKERS_HELD', message: 'prepared, workers held. Read .bowerloom/START-HERE.md. No worker was started.' });
}

test('finding 1, transcript part 12: a deleted prompt is held, status names it, and prompt create restores it', t => {
  const p = fresh(t);
  prepared(upAll(p, 'ops-crew', '--goal', GOAL));
  create(p, ['prompt', 'create', 'runbook-check']);
  const file = join(p.dir, '.bowerloom/prompts/runbook-check.md'), text = readFileSync(file, 'utf8');
  prepared(upAll(p, 'docs-crew'));
  assert.equal(readFileSync(join(p.dir, '.claude/commands/runbook-check.md'), 'utf8'), text);
  renameSync(file, join(p.outside, 'runbook-check.md'));

  // status: drifted, the item is named with its restore step.
  const status = run(p, ['status']); assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /^Setup: drifted$/m);
  assert.match(status.stdout, /^ {2}owner-refused: \.bowerloom\/authoring \(AUTHORING_ITEM_MISSING\)$/m);
  assert.match(status.stdout, /^ {2}prompt runbook-check: held \(AUTHORING_ITEM_MISSING\)\. Next: \.bowerloom\/prompts\/runbook-check\.md is gone\. Run bowerloom prompt create runbook-check to restore it, then run bowerloom apply\.$/m);
  assert.doesNotMatch(status.stdout, /edited: \.bowerloom\/prompts$/m);
  const json = JSON.parse(run(p, ['status', '--json']).stdout) as { status: string; drift: { code?: string }[] };
  assert.equal(json.status, 'drifted'); assert.ok(json.drift.some(d => d.code === 'AUTHORING_ITEM_MISSING'));

  // up and apply hold it, with the restore step, and never refuse the whole plan.
  for (const team of ['docs-crew', 'ops-crew']) {
    const up = run(p, ['up', '--team', team]); heldItems(up, 1);
    assert.match(up.stdout, /^ {2}Held: prompt runbook-check \(AUTHORING_ITEM_MISSING\)$/m);
    assert.match(up.stdout, /^ {4}Next: \.bowerloom\/prompts\/runbook-check\.md is gone\. Run bowerloom prompt create runbook-check to restore it, then run bowerloom apply\.$/m);
  }
  const upJson = run(p, ['up', '--team', 'docs-crew', '--json']); assert.equal(upJson.status, 4);
  const doc = JSON.parse(upJson.stdout) as { status: string; held: { kind: string; id: string; code: string; next: string }[] };
  assert.equal(doc.status, 'prepared, workers held');
  assert.deepEqual(doc.held.map(h => [h.kind, h.id, h.code]), [['prompt', 'runbook-check', 'AUTHORING_ITEM_MISSING']]);
  const apply = run(p, ['apply']); assert.equal(apply.status, 0, apply.stderr);
  assert.match(apply.stdout, /runbook-check +held \(AUTHORING_ITEM_MISSING\)/); assert.match(apply.stdout, /bowerloom prompt create runbook-check/);
  assert.match(apply.stdout, /^Nothing to change\.$/m);

  // prompt create restores it through the normal plan and approval.
  const restore = create(p, ['prompt', 'create', 'runbook-check']);
  assert.match(restore.stdout, /^Restore prompt runbook-check in \.bowerloom\/prompts\/runbook-check\.md$/m);
  assert.match(restore.stdout, /^ {2}Its file is gone\. Create writes it again with the text it was created with\.$/m);
  assert.match(restore.stdout, /^ {2}Teams: every team$/m);
  assert.equal(readFileSync(file, 'utf8'), text);
  assert.match(run(p, ['status']).stdout, /^Setup: ready$/m);
  prepared(run(p, ['up', '--team', 'docs-crew']));
  const again = run(p, ['prompt', 'create', 'runbook-check']); assert.equal(again.status, 1); assert.equal(errorOf(again.stderr).code, 'PROMPT_EXISTS');
  assert.deepEqual(p.network(), []);
});

test('finding 1: a restore with another --team refuses and names the restore step', t => {
  const p = fresh(t);
  prepared(upAll(p, 'ops-crew', '--goal', GOAL));
  create(p, ['prompt', 'create', 'weekly-update', '--team', 'first-team']);
  rmSync(join(p.dir, '.bowerloom/prompts/weekly-update.md'));
  create(p, ['team', 'create', 'market-desk']);
  const r = run(p, ['prompt', 'create', 'weekly-update', '--team', 'market-desk']); assert.equal(r.status, 1);
  assert.equal(errorOf(r.stderr).code, 'PROMPT_RESTORE_TEAMS'); assert.match(errorOf(r.stderr).message, /without --team/);
  assert.equal(existsSync(join(p.dir, '.bowerloom/prompts/weekly-update.md')), false);
  const restored = create(p, ['prompt', 'create', 'weekly-update']);
  assert.match(restored.stdout, /^ {2}Teams: first-team$/m);
});

test('finding 2: a hand-edited copy is held; up says so and names its next command', t => {
  const p = fresh(t);
  prepared(upAll(p, 'writers', '--goal', GOAL));
  create(p, ['skill', 'create', 'tone-guide']);
  prepared(upAll(p, 'writers'));
  appendFileSync(join(p.dir, '.claude/skills/tone-guide/SKILL.md'), 'A line added by hand.\n');
  const up = run(p, ['up', '--team', 'writers']); heldItems(up, 1);
  assert.match(up.stdout, /^ {2}Held: skill tone-guide \(MANAGED_SKILL_LOCAL_DRIFT\)$/m);
  assert.match(up.stdout, /^ {4}Next: Undo your edits in \.claude\/skills\/tone-guide/m);
  // Review finding 15: tone-guide is the person's own skill, so the step never says to copy it into one.
  assert.doesNotMatch(up.stdout, /skill of your own/); assert.match(up.stdout, /\.bowerloom\/skills\/tone-guide/);
});

test('finding 2: a deleted local skill folder is held with its restore step', t => {
  const p = fresh(t);
  prepared(upAll(p, 'core', '--goal', GOAL));
  create(p, ['skill', 'create', 'scratch-notes']);
  renameSync(join(p.dir, '.bowerloom/skills/scratch-notes'), join(p.outside, 'scratch-notes'));
  const up = run(p, ['up', '--team', 'core']); heldItems(up, 1);
  assert.match(up.stdout, /^ {2}Held: skill scratch-notes \(AUTHORING_ITEM_MISSING\)$/m);
  assert.match(up.stdout, /^ {4}Next: \.bowerloom\/skills\/scratch-notes is gone\. Restore it from version control, for example with git restore \.bowerloom\/skills\/scratch-notes, then run bowerloom skills sync\.$/m);
});

test('finding 2: a deleted team folder is held; up never reports that team as in place', t => {
  const p = fresh(t);
  prepared(upAll(p, 'ops-crew', '--goal', GOAL));
  prepared(upAll(p, 'docs-crew'));
  renameSync(join(p.dir, '.bowerloom/teams/docs-crew'), join(p.outside, 'docs-crew'));
  const up = run(p, ['up', '--team', 'docs-crew']); heldItems(up, 1);
  assert.match(up.stdout, /^ {2}Held: team docs-crew \(AUTHORING_ITEM_MISSING\)$/m);
  assert.match(up.stdout, /^ {4}Next: \.bowerloom\/teams\/docs-crew is gone\. Restore it from version control, for example with git restore \.bowerloom\/teams\/docs-crew\.$/m);
  // Another team is not held by it.
  prepared(run(p, ['up', '--team', 'ops-crew']));
});

// F' code review A: with skills.json present, a deleted created team is held with its restore step before any sync
// or apply plan, so it never dead-ends in TEAM_NOT_FOUND.
test('finding 2: a deleted team folder is held with its restore step when skills.json exists', t => {
  const p = fresh(t);
  prepared(upAll(p, 'ops-crew', '--goal', GOAL));
  prepared(upAll(p, 'docs-crew'));
  create(p, ['skill', 'create', 'house-style']);
  assert.ok(existsSync(join(p.dir, '.bowerloom/skills.json')));
  renameSync(join(p.dir, '.bowerloom/teams/docs-crew'), join(p.outside, 'docs-crew'));
  const up = run(p, ['up', '--team', 'docs-crew']); heldItems(up, 1);
  assert.match(up.stdout, /^ {2}Held: team docs-crew \(AUTHORING_ITEM_MISSING\)$/m);
  assert.match(up.stdout, /^ {4}Next: \.bowerloom\/teams\/docs-crew is gone\. Restore it from version control, for example with git restore \.bowerloom\/teams\/docs-crew\.$/m);
  const json = run(p, ['up', '--team', 'docs-crew', '--json']); assert.equal(json.status, 4, json.stderr);
  assert.deepEqual((JSON.parse(json.stdout) as { held: { kind: string; id: string }[] }).held.map(h => [h.kind, h.id]), [['team', 'docs-crew']]);
  // Restored, the team gets its sync step again.
  renameSync(join(p.outside, 'docs-crew'), join(p.dir, '.bowerloom/teams/docs-crew'));
  const back = run(p, ['up', '--team', 'docs-crew']); assert.equal(back.status, 3, back.stderr); assert.match(back.stdout, /^Next step: sync\./m);
});

test('finding 12: a created team is named once, and --goal and --name on a set-up project are named as unused', t => {
  const p = fresh(t);
  const first = upAll(p, 'research-desk', '--goal', GOAL); prepared(first);
  assert.match(first.stdout, /^ {2}Team: research-desk \(first-team\), with skills and prompts in place for Claude Code and Codex\.$/m);
  const created = upAll(p, 'market-desk'); prepared(created);
  assert.match(created.stdout, /^ {2}Team: market-desk, with skills and prompts in place for Claude Code and Codex\.$/m);
  assert.doesNotMatch(created.stdout, /market-desk \(market-desk\)/);
  const unused = run(p, ['up', '--team', 'market-desk', '--goal', 'Another goal', '--name', 'other']); prepared(unused);
  assert.match(unused.stdout, /^Note: this project is set up already, so up does not use --goal or --name\. The project brief keeps its goal and name\.$/m);
  const json = run(p, ['up', '--team', 'market-desk', '--goal', 'Another goal', '--json']); assert.equal(json.status, 4);
  for (const line of json.stdout.trim().split('\n')) JSON.parse(line);
  assert.doesNotMatch(run(p, ['up', '--team', 'market-desk']).stdout, /^Note:/m);
});
