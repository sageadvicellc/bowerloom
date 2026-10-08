// Review M6 (REVIEW-M6-01) findings 3 to 6, through the real CLI with the network denied.
import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { TestContext } from 'node:test';

const cli = fileURLToPath(new URL('../apps/cli/src/main.js', import.meta.url));
const preload = pathToFileURL(fileURLToPath(new URL('./support/fake-network.js', import.meta.url))).href;
const GOAL = 'Prepare a fictional onboarding kit for an independent design studio.';

function fresh(t: TestContext) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-m6-fixes-'))); t.after(() => rmSync(home, { recursive: true, force: true }));
  const dir = join(home, 'studio'); mkdirSync(dir);
  const log = join(home, 'network.log'), plan = join(home, 'network.json'); writeFileSync(log, ''); writeFileSync(plan, JSON.stringify({ log }));
  return { home, dir, env: { HOME: home, XDG_STATE_HOME: join(home, 'state'), TEST_FAKE_NETWORK_PLAN: plan }, network: () => readFileSync(log, 'utf8').split('\n').filter(Boolean) };
}
type Fresh = ReturnType<typeof fresh>;
function run(p: Fresh, args: string[]) {
  const r = spawnSync(process.execPath, ['--import', preload, cli, ...args], { cwd: p.dir, encoding: 'utf8', timeout: 120000, env: { ...process.env, ...p.env } });
  assert.equal(r.error, undefined); return r;
}
const errorOf = (stderr: string) => (JSON.parse(stderr) as { error: { code: string; message: string } }).error;
const revisionIn = (stdout: string): string => { const m = /^Revision: ([a-f0-9]{64})$/m.exec(stdout); assert.ok(m, stdout); return m[1]!; };
function create(p: Fresh, args: string[]) {
  const planned = run(p, [...args, '--json']); assert.equal(planned.status, 3, planned.stderr);
  const applied = run(p, [...args, '--approve', JSON.parse(planned.stdout).revision]); assert.equal(applied.status, 0, applied.stderr);
}
/** Runs `up` with the given team through init, so first-team's display name is `team`. */
function initWith(p: Fresh, team: string) {
  const up = ['up', '--team', team, '--goal', GOAL], shown = run(p, up); assert.equal(shown.status, 3, shown.stderr);
  const applied = run(p, [...up, '--approve', revisionIn(shown.stdout)]); assert.equal(applied.status, 4, applied.stderr + applied.stdout);
}

test('finding 3: team create refuses an id equal to first-team\'s display name, so up --team keeps one meaning', t => {
  const p = fresh(t); initWith(p, 'writers');
  const refused = run(p, ['team', 'create', 'writers']); assert.equal(refused.status, 1, refused.stderr);
  assert.equal(errorOf(refused.stderr).code, 'TEAM_NAME_TAKEN');
  assert.match(errorOf(refused.stderr).message, /display name of first-team/);
  create(p, ['team', 'create', 'editors']);
  const ls = run(p, ['ls', 'teams']); assert.equal(ls.status, 0, ls.stderr); assert.match(ls.stdout, /editors/); assert.match(ls.stdout, /first-team/);
  const up = run(p, ['up', '--team', 'writers']); assert.equal(up.status, 4, up.stderr + up.stdout); assert.match(up.stdout, /first-team/);
  assert.deepEqual(p.network(), []);
});

/** First-team with one prompt and one skill, and `up` showing the sync step. Returns the up words and the sync revision. */
function atSync(p: Fresh) {
  const up = ['up', '--team', 'Studio crew', '--goal', GOAL]; initWith(p, 'Studio crew');
  create(p, ['prompt', 'create', 'weekly-update']); create(p, ['skill', 'create', 'house-style']);
  const shown = run(p, up); assert.equal(shown.status, 3, shown.stderr); assert.match(shown.stdout, /^Next step: sync\./m);
  return { up, revision: revisionIn(shown.stdout) };
}
/** Breaks the authoring receipt so the apply step's plan refuses, while the sync step does not read it. */
const breakReceipt = (p: Fresh) => writeFileSync(join(p.dir, '.bowerloom', 'authoring', 'receipt.json'), `${readFileSync(join(p.dir, '.bowerloom', 'authoring', 'receipt.json'), 'utf8')} `);

test('finding 4: when up applies a step and the next plan refuses, the refusal says the step was applied', t => {
  const p = fresh(t), { up, revision } = atSync(p); breakReceipt(p);
  const r = run(p, [...up, '--approve', revision]);
  assert.equal(r.status, 1, r.stderr + r.stdout); assert.match(r.stdout, new RegExp(`^Applied plan ${revision}\\.$`, 'm'));
  const error = errorOf(r.stderr);
  assert.equal(error.code, 'AUTHORING_RECEIPT_INVALID', 'the code stays the refusal\'s own');
  assert.match(error.message, /^The sync step was applied\. The next step was then refused: The record of created items/);
  assert.ok(readFileSync(join(p.dir, '.claude', 'skills', 'house-style', 'SKILL.md')), 'the sync step is in place');
});

test('finding 4: with --json, up prints one JSON document per line, and an applied step then a refusal still say so', t => {
  const p = fresh(t), { up, revision } = atSync(p);
  const json = run(p, [...up, '--approve', revision, '--json']); assert.equal(json.status, 3, json.stderr);
  const lines = json.stdout.split('\n').filter(Boolean);
  assert.equal(lines.length, 2, json.stdout); const docs = lines.map(l => JSON.parse(l) as { code?: string; revision?: string; plan?: { step?: string } });
  assert.equal(docs[1]!.code, 'APPROVAL_REQUIRED'); assert.equal(docs[1]!.plan?.step, 'apply');
  breakReceipt(p);
  const refused = run(p, [...up, '--approve', docs[1]!.revision!, '--json']); assert.equal(refused.status, 1);
  assert.equal(errorOf(refused.stderr).code, 'AUTHORING_RECEIPT_INVALID');
  const help = run(p, ['help', 'up']); assert.equal(help.status, 0);
  assert.match(help.stdout, /With --json, every line is one JSON document: an --approve run prints the result of the step it applied,\n.*then the next plan\./);
  assert.match(help.stdout, /If the next plan then refuses, the refusal says\nthat the step was applied\./);
});
