// The sample twin of the window items: the same shapes and gates as main, on made-up folders in memory. Nothing is read, written or opened.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { SAMPLE_FOLDERS, SAMPLE_MESSAGES, SAMPLE_NOTES, createSampleEngine } from '../shared/engine/sample.js';
import { createEngineService } from '../main/engine-service.js';
import { REPORT_MAIN_WORDS, SAVE_MAIN_WORDS } from '../shared/engine/types.js';
import type { Answer, SaveEdit } from '../shared/engine/types.js';
import { tempDir } from './support.js';
import { homeFolder, sourceFolder, teamFolder } from './helpers-engine/folders.js';

const value = <T>(a: Answer<T> | null): T => { assert.ok(a !== null); if (!a.ok) assert.fail(`${a.refusal.code} ${a.refusal.message}`); return a.value; };
const refusal = <T>(a: Answer<T>): { code: string; message: string } => { assert.equal(a.ok, false, 'a refusal'); return (a as Extract<Answer<T>, { ok: false }>).refusal; };
const ID = SAMPLE_FOLDERS.defined;

test('the sample opens no file: a notes folder with no report says so in main\'s words; an unknown id is refused as main refuses it', async () => {
  const e = createSampleEngine();
  const r = refusal(await e.openNotesReport(SAMPLE_NOTES.use));
  assert.equal(r.code, 'REPORT_NONE');
  assert.equal(r.message, REPORT_MAIN_WORDS.REPORT_NONE);
  await assert.rejects(async () => e.openNotesReport('notes-99'), /UNKNOWN_FOLDER/);
  assert.equal(SAMPLE_MESSAGES.REPORT_NONE, REPORT_MAIN_WORDS.REPORT_NONE);
});

test('the sample stops using notes as main does: the review names the agents that lose them', async () => {
  const e = createSampleEngine();
  const n = value(await e.chooseNotesFolder('use'));
  const attach: SaveEdit[] = [{ kind: 'set-source', name: n.suggestedName, notesId: n.id }, { kind: 'set-agent', id: 'writer', notes: [n.suggestedName] }];
  value(await e.runSave(ID, value(await e.planSave(ID, attach)).revision, attach));
  const plan = value(await e.planSave(ID, [{ kind: 'remove-source', name: n.suggestedName }]));
  assert.deepEqual(plan.removedSources, [{ name: n.suggestedName, label: n.label, agents: ['writer'] }]);
  assert.deepEqual(plan.definition.sources, []);
  assert.deepEqual(value(await e.planSave(ID, [])).removedSources, []);
});

test('the sample copy of a skill with a script from another folder: marked files, the folder named, and Save waits for the acknowledgement', async () => {
  const e = createSampleEngine();
  const edits: SaveEdit[] = [{ kind: 'add-skill', id: 'soil-check', from: SAMPLE_FOLDERS.stopped }];
  const plan = value(await e.planSave(ID, edits));
  assert.deepEqual(plan.changes, [
    { path: '.bowerloom/skills/soil-check/SKILL.md', action: 'create', from: '~/Projects/garden' },
    { path: '.bowerloom/skills/soil-check/scripts/soil-check.sh', action: 'create', executable: true, from: '~/Projects/garden' },
  ]);
  assert.deepEqual(plan.copiedExecutables, [{ path: '.bowerloom/skills/soil-check/scripts/soil-check.sh', from: '~/Projects/garden' }]);
  assert.match(plan.acknowledge ?? '', /^[a-f0-9]{64}$/);
  const bare = refusal(await e.runSave(ID, plan.revision, edits));
  assert.equal(bare.code, 'SAVE_EXECUTABLE_UNACKNOWLEDGED');
  assert.equal(bare.message, SAVE_MAIN_WORDS.SAVE_EXECUTABLE_UNACKNOWLEDGED);
  const done = value(await e.runSave(ID, plan.revision, { edits, acknowledged: plan.acknowledge }));
  assert.deepEqual(done.written, plan.changes.map(c => c.path));
  // The copy of a skill with no script asks nothing.
  const plain = value(await e.planSave(ID, [{ kind: 'add-skill', id: 'water-plants', from: SAMPLE_FOLDERS.stopped }]));
  assert.equal(plain.acknowledge, null);
});

test('the sample save plan has every field of main\'s, the new ones too', async t => {
  const home = homeFolder(tempDir(t, 'bowerloom-sample-items-'));
  let next = teamFolder(home);
  const service = createEngineService({ home, stateRoot: join(home, '.local', 'state', 'bowerloom'), chooseFolder: async () => next, confirm: async () => true, who: 't' });
  const f = value(await service.chooseFolder());
  next = sourceFolder(home);
  const src = value(await service.chooseFolder());
  const real = value(await service.planSave(f.id, [{ kind: 'add-skill', id: 'summarize', from: src.id }]));
  const sample = value(await createSampleEngine().planSave(ID, [{ kind: 'add-skill', id: 'soil-check', from: SAMPLE_FOLDERS.stopped }]));
  assert.deepEqual(Object.keys(sample).sort(), Object.keys(real).sort());
  assert.deepEqual(Object.keys(sample.copiedExecutables[0]!).sort(), Object.keys(real.copiedExecutables[0]!).sort());
});
