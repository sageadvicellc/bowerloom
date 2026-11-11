// The approval of a linked notes folder in the home folder (review rounds 1 and 2, issue 143), through the save step of main. A `~/` link is read only after the person approved the save
// that names it; the approval-only save (the folder is linked already, nothing in `knowledge.json` changes) must still record it; and a record that cannot be kept or read is told, never hidden.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LINK_APPROVALS_DAMAGED, LINK_APPROVALS_DAMAGED_WORDS, LINK_APPROVAL_NOT_KEPT, createEngineService } from '../main/engine-service.js';
import type { Ask } from '../main/engine-consent.js';
import { approvalsFileOf, isApproved } from '../main/linked-approvals.js';
import type { Answer, FolderInfo, NotesView, SaveEdit } from '../shared/engine/types.js';
import { DESKTOP, tempDir } from './support.js';
import { filesOf, homeFolder, teamFolder } from './helpers-engine/folders.js';

const WHEN = new Date('2026-11-11T12:00:00Z');
const KITS = join(DESKTOP, '..', '..', 'kits');
const value = <T>(a: Answer<T> | null): T => { assert.ok(a !== null, 'an answer'); if (!a.ok) assert.fail(`refused: ${a.refusal.code} ${a.refusal.message}`); return a.value; };

function setup(t: test.TestContext): { home: string; state: string; service: ReturnType<typeof createEngineService>; asks: Ask[]; team: string; pickFolder(d: string): void; pickNotes(d: string): void } {
  const base = tempDir(t, 'bowerloom-linkapp-'), home = homeFolder(base), state = join(home, '.local', 'state', 'bowerloom');
  let folder: string | null = null, notes: string | null = null;
  const asks: Ask[] = [];
  const service = createEngineService({
    home, stateRoot: state, who: 'tester', now: () => WHEN,
    chooseFolder: async () => folder, confirm: async ask => { asks.push(ask); return true; }, chooseNotesFolder: async () => notes, kitsDir: () => KITS,
  });
  return { home, state, service, asks, team: teamFolder(home), pickFolder: d => { folder = d; }, pickNotes: d => { notes = d; } };
}
async function link(s: ReturnType<typeof setup>): Promise<{ f: FolderInfo; n: NotesView; edits: SaveEdit[]; notesDir: string }> {
  const notesDir = join(s.home, 'Documents', 'field-notes');
  mkdirSync(notesDir, { recursive: true }); writeFileSync(join(notesDir, 'index.md'), '# Index\n');
  s.pickFolder(s.team); const f = value(await s.service.chooseFolder());
  s.pickNotes(notesDir); const n = value(await s.service.chooseNotesFolder('use'));
  return { f, n, edits: [{ kind: 'set-source', name: 'field-notes', notesId: n.id }], notesDir };
}
const knowledge = (team: string): string => readFileSync(join(team, '.bowerloom', 'knowledge.json'), 'utf8');

test('the first link is a save that also approves reading the folder, and the approval is recorded with the write', async t => {
  const s = setup(t), { f, edits, notesDir } = await link(s);
  const plan = value(await s.service.planSave(f.id, edits));
  assert.equal(plan.noop, false);
  assert.deepEqual(plan.approves, ['~/Documents/field-notes']);
  assert.equal(isApproved(s.state, s.team, { stored: '~/Documents/field-notes', target: realpathSync(notesDir) }), false, 'planning records nothing');
  const done = value(await s.service.runSave(f.id, plan.revision, edits));
  assert.deepEqual(done.warnings ?? [], []);
  assert.equal(isApproved(s.state, s.team, { stored: '~/Documents/field-notes', target: realpathSync(notesDir) }), true);
  const again = value(await s.service.planSave(f.id, edits));
  assert.equal(again.noop, true, 'an approved link is a plain noop');
  assert.equal(again.approves, undefined);
});

test('the approval-only save: the link is in knowledge.json already, nothing in it changes, and Approve and link ends with the approval recorded', async t => {
  const s = setup(t), { f, edits, notesDir } = await link(s);
  value(await s.service.runSave(f.id, value(await s.service.planSave(f.id, edits)).revision, edits));
  const before = knowledge(s.team), tree = filesOf(s.team);
  // The record is lost (a new machine state, or removed): the link is there, and no approval stands for it.
  rmSync(approvalsFileOf(s.state), { force: true });
  const plan = value(await s.service.planSave(f.id, edits));
  assert.equal(plan.noop, false, 'pending approvals force a write step');
  assert.deepEqual(plan.changes, [], 'no file changes');
  assert.deepEqual(plan.approves, ['~/Documents/field-notes']);
  const done = value(await s.service.runSave(f.id, plan.revision, edits));
  assert.deepEqual(done.written, []);
  assert.deepEqual(done.warnings ?? [], []);
  assert.equal(knowledge(s.team), before, 'knowledge.json is unchanged');
  assert.deepEqual(filesOf(s.team), tree, 'no file of the harness changed');
  assert.equal(isApproved(s.state, s.team, { stored: '~/Documents/field-notes', target: realpathSync(notesDir) }), true);
});

test('a record that cannot be kept is told in the warnings of the save, and the files of the save stand', async t => {
  const s = setup(t), { f, edits } = await link(s);
  // A plain file stands where the folder of the record should be, so it cannot be made.
  mkdirSync(s.state, { recursive: true }); writeFileSync(join(s.state, 'linked-notes'), 'x');
  const plan = value(await s.service.planSave(f.id, edits));
  const done = value(await s.service.runSave(f.id, plan.revision, edits));
  assert.deepEqual(done.warnings, [LINK_APPROVAL_NOT_KEPT]);
  assert.match(knowledge(s.team), /field-notes/, 'the link itself was written');
});

test('a record that is a link is not written through, and the save says so', async t => {
  const s = setup(t), { f, edits } = await link(s);
  const elsewhere = join(s.home, 'elsewhere');
  mkdirSync(elsewhere, { recursive: true }); mkdirSync(s.state, { recursive: true }); symlinkSync(elsewhere, join(s.state, 'linked-notes'));
  const done = value(await s.service.runSave(f.id, value(await s.service.planSave(f.id, edits)).revision, edits));
  assert.deepEqual(done.warnings, [LINK_APPROVAL_NOT_KEPT]);
  assert.deepEqual(filesOf(elsewhere), {}, 'nothing was written through the link');
});

test('a damaged record refuses the plan and the write before anything is written, and is never written over', async t => {
  const s = setup(t), { f, edits } = await link(s);
  mkdirSync(join(s.state, 'linked-notes'), { recursive: true });
  const file = approvalsFileOf(s.state);
  writeFileSync(file, '{ damaged');
  const tree = filesOf(s.team);
  const plan = await s.service.planSave(f.id, edits);
  assert.equal(plan.ok, false);
  assert.deepEqual(plan.ok ? null : [plan.refusal.code, plan.refusal.message], [LINK_APPROVALS_DAMAGED, LINK_APPROVALS_DAMAGED_WORDS]);
  assert.equal(LINK_APPROVALS_DAMAGED_WORDS, 'Bowerloom could not read its saved approvals, so it changed nothing.');
  const run = await s.service.runSave(f.id, 'a'.repeat(64), edits);
  assert.equal(run.ok, false);
  assert.deepEqual(run.ok ? null : run.refusal.code, LINK_APPROVALS_DAMAGED);
  assert.deepEqual(filesOf(s.team), tree, 'nothing was written');
  assert.equal(readFileSync(file, 'utf8'), '{ damaged', 'the record was not written over');
  assert.deepEqual(s.asks, [], 'main asked nothing');
});
