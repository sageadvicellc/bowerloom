// The pick of a notes folder in main (main/notes-pick.ts): the pick is the approval, a pick that could not be approved is told at once in words of its own and the folder is handed back unchanged,
// a damaged record is moved aside by the pick, and "Start fresh" records nothing. The Library names each failed case in its own words, with a way out only where one exists.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PICK_NOTICES, pickNotesFolder } from '../main/notes-pick.js';
import type { PickNotice } from '../main/notes-pick.js';
import { APPROVALS_LIMITS, approvalKey, approvalsFileOf, readApprovals } from '../../../packages/notes-source/src/index.js';
import { addLinkedNotes } from '../main/linked-notes.js';
import { createScanner } from '../main/real-scan.js';
import { buildRealResult } from '../shared/real/map-world.js';
import type { RealPlace, RealResult } from '../shared/real/types.js';
import { linkProblemWords } from '../renderer/harness/words.js';
import { tempDir } from './support.js';
import type { TestContext } from 'node:test';

const put = (file: string, text: string): void => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, text); };
const json = (v: unknown): string => `${JSON.stringify(v)}\n`;

function setup(t: TestContext): { home: string; state: string; notes: string; told: string[]; warned: PickNotice[]; pick(purpose: 'use' | 'start', folder?: string | null): Promise<string | null> } {
  const home = tempDir(t, 'bowerloom-pick-'), state = join(home, '.made-up-state'), notes = join(home, 'journal');
  put(join(notes, 'one.md'), '# One\n');
  put(join(home, 'work', 'proj', '.bowerloom', 'harness.json'), json({ format: 'bowerloom/harness/v1beta1', id: 'proj', description: 'A harness.', engines: [{ id: 'claude-code' }], parts: { skills: 'skills/', subagents: 'agents/' } }));
  put(join(home, 'work', 'proj', '.bowerloom', 'knowledge.json'), json({ sources: [{ name: 'journal', kind: 'wiki-folder', path: '~/journal' }] }));
  const told: string[] = [], warned: PickNotice[] = [];
  return { home, state, notes, told, warned, pick: (purpose, folder = notes) => pickNotesFolder({ purpose, stateRoot: state, show: async () => folder, tell: l => { told.push(l); }, warn: async n => { warned.push(n); } }) };
}
async function problems(home: string, state: string): Promise<string[]> {
  const scanner = createScanner({ home });
  const found = await scanner.discover();
  const places: RealPlace[] = [...found.places, ...(await scanner.addFolder(join(home, 'work'))).places];
  const batch = await scanner.read(places.map(p => p.id));
  const result: RealResult = addLinkedNotes(buildRealResult(batch.reads, batch.tally, { nowMs: Date.UTC(2026, 10, 11), foldExtraApps: true }), places, { home, stateRoot: state });
  return (result.harnessPlaces ?? []).flatMap(h => (h.harness as { linkProblems?: { reason: string }[] }).linkProblems ?? []).map(p => p.reason).concat(result.world.wikiPages.map(p => `page:${p.title}`));
}

test('a pick of the notes the person has records the approval, and hands the folder back', async t => {
  const s = setup(t);
  assert.equal(await s.pick('use'), s.notes);
  assert.equal(readApprovals(s.state).status, 'ok');
  assert.deepEqual(s.told, []); assert.deepEqual(s.warned, []);
  assert.deepEqual(await problems(s.home, s.state), ['page:One']);
});

test('"Start fresh" records nothing, a closed chooser records nothing, and both hand back what the dialog said', async t => {
  const s = setup(t);
  assert.equal(await s.pick('start'), s.notes);
  assert.equal(await s.pick('use', null), null);
  assert.deepEqual(readApprovals(s.state), { status: 'none' });
  assert.deepEqual(await problems(s.home, s.state), ['approval']);
});

test('an unwritable folder of approvals is told at once, the folder is handed back unchanged, and the Library says it cannot save approvals, with no "link it again"', async t => {
  const s = setup(t);
  mkdirSync(s.state, { recursive: true }); writeFileSync(join(s.state, 'linked-notes'), 'x');
  assert.equal(await s.pick('use'), s.notes, 'the pick is handed back unchanged');
  assert.deepEqual(s.warned, [PICK_NOTICES.failed]);
  assert.deepEqual(s.told, ['Bowerloom could not keep the approval of a notes folder (failed).']);
  assert.doesNotMatch(JSON.stringify(s.told), new RegExp(s.home), 'the log line holds no path');
  assert.deepEqual(await problems(s.home, s.state), ['blocked']);
  assert.equal(linkProblemWords('~/work/proj', 'blocked', '~/journal'), '~/work/proj: Bowerloom could not save approvals on this computer: ~/journal');
  assert.doesNotMatch(linkProblemWords('x', 'blocked', ''), /again/i);
});

test('a full record is told with its own words, and the Library says the most, with no way out offered that cannot work', async t => {
  const s = setup(t);
  mkdirSync(join(s.state, 'linked-notes'), { recursive: true });
  writeFileSync(approvalsFileOf(s.state), json({ version: 1, keys: Array.from({ length: APPROVALS_LIMITS.keys }, (_, i) => approvalKey(`/made/up/${i}`)) }));
  assert.equal(await s.pick('use'), s.notes);
  assert.deepEqual(s.warned, [PICK_NOTICES.full]);
  assert.equal(PICK_NOTICES.full.message, 'Bowerloom keeps at most 2000 approved folders.');
  assert.deepEqual(await problems(s.home, s.state), ['full']);
  assert.doesNotMatch(linkProblemWords('x', 'full', ''), /again/i);
});

test('a damaged record is moved aside by the pick, a new list starts, nothing is lost, and nobody is warned', async t => {
  const s = setup(t);
  mkdirSync(join(s.state, 'linked-notes'), { recursive: true });
  writeFileSync(approvalsFileOf(s.state), '{ damaged');
  assert.deepEqual(await problems(s.home, s.state), ['damaged']);
  assert.equal(linkProblemWords('x', 'damaged', '~/journal'), 'x: Saved approvals could not be read: ~/journal. Pick the folder again to start a new list.');
  assert.equal(await s.pick('use'), s.notes);
  assert.deepEqual(s.warned, []);
  const aside = readdirSync(join(s.state, 'linked-notes')).filter(n => n.startsWith('approved.json.damaged-'));
  assert.equal(aside.length, 1);
  assert.equal(readFileSync(join(s.state, 'linked-notes', aside[0]!), 'utf8'), '{ damaged');
  assert.deepEqual(await problems(s.home, s.state), ['page:One']);
});

test('a path in another case is another folder: a pick of Journal does not approve ~/journal', async t => {
  const s = setup(t);
  put(join(s.home, 'Journal', 'two.md'), '# Two\n');
  await s.pick('use', join(s.home, 'Journal'));
  assert.deepEqual(await problems(s.home, s.state), ['approval'], 'the file system keeps the case, and so does the approval');
});

test('a failed message box never changes the pick', async t => {
  const s = setup(t);
  mkdirSync(s.state, { recursive: true }); writeFileSync(join(s.state, 'linked-notes'), 'x');
  const picked = await pickNotesFolder({ purpose: 'use', stateRoot: s.state, show: async () => s.notes, tell: () => undefined, warn: async () => { throw new Error('no box'); } });
  assert.equal(picked, s.notes);
});
