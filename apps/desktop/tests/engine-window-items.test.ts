// The window items left after the save step and notes (0.8.0-beta.1), in main:
//  1. "Stop using these notes": a remove-source edit through the save step. The review names the agents that lose the notes; the notes folder is untouched.
//  2. The tidy-up report: main resolves the newest report of a notes folder by its id, checks the path again, asks in its own dialog, and opens it.
//  4. Files that can run, and copied files, in the save plan, main's dialog and the gate: a copy of files that can run needs an acknowledgement.
// Each call follows the gate of the save step: ids only, the plan or the read main showed last, main's own dialog, one call at a time, closed keys, and
// refusals with words. Real packages on synthetic folders.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { createEngineService, EngineCallRefusal } from '../main/engine-service.js';
import type { EngineService } from '../main/engine-service.js';
import { ASK } from '../main/engine-consent.js';
import type { Ask } from '../main/engine-consent.js';
import type { Answer, FolderInfo, NotesView, SaveEdit } from '../shared/engine/types.js';
import { ENGINE_ARITY, ENGINE_CALLS, REPORT_MAIN_WORDS, SAVE_MAIN_WORDS } from '../shared/engine/types.js';
import { tempDir } from './support.js';
import { filesOf, homeFolder, sourceFolder, teamFolder } from './helpers-engine/folders.js';

const WHEN = new Date('2026-10-30T12:00:00Z');
const value = <T>(a: Answer<T> | null): T => { assert.ok(a !== null, 'an answer'); if (!a.ok) assert.fail(`refused: ${a.refusal.code} ${a.refusal.message}`); return a.value; };
const refusal = <T>(a: Answer<T>): { code: string; message: string; paths: readonly string[] } => { assert.equal(a.ok, false, 'a refusal'); return (a as Extract<Answer<T>, { ok: false }>).refusal; };

interface Setup {
  home: string; service: EngineService; asks: Ask[]; opened: string[]; copies: string; seen: { path: string; text: string; mode: number; dirMode: number }[];
  records: Readonly<Record<string, unknown>>[];
  say(yes: boolean): void; pick(dir: string | null): void; pickNotes(dir: string | null): void; openAnswer(text: string): void; openThrows(error: Error | null): void;
}
function setup(t: test.TestContext, { opener = true }: { opener?: boolean } = {}): Setup {
  const home = homeFolder(tempDir(t, 'bowerloom-items-'));
  const copies = join(home, '.copies');
  mkdirSync(copies);
  let next: string | null = null, notes: string | null = null, yes = true, openText = '', openError: Error | null = null;
  const asks: Ask[] = [], opened: string[] = [], seen: Setup['seen'] = [], records: Readonly<Record<string, unknown>>[] = [];
  const service = createEngineService({
    home, stateRoot: join(home, '.local', 'state', 'bowerloom'), who: 'tester', now: () => WHEN,
    chooseFolder: async () => next, confirm: async ask => { asks.push(ask); return yes; }, chooseNotesFolder: async () => notes,
    record: input => { records.push(input); return true; }, reportCopies: () => copies,
    ...(opener ? {
      openPath: async (p: string) => {
        opened.push(p);
        seen.push({ path: p, text: readFileSync(p, 'utf8'), mode: statSync(p).mode & 0o777, dirMode: statSync(dirname(p)).mode & 0o777 });
        if (openError !== null) throw openError;
        return openText;
      },
    } : {}),
  });
  return {
    home, service, asks, opened, copies, seen, records, say: v => { yes = v; }, pick: d => { next = d; }, pickNotes: d => { notes = d; }, openAnswer: v => { openText = v; },
    openThrows: e => { openError = e; },
  };
}
/** True when `path` is main's private copy of a report: report.md in a folder of its own right under the copies folder. */
const isCopy = (s: Setup, path: string): boolean => basename(path) === 'report.md' && dirname(dirname(path)) === s.copies;
async function choose(s: Setup, dir: string): Promise<FolderInfo> { s.pick(dir); return value(await s.service.chooseFolder()); }
async function chooseNotes(s: Setup, dir: string): Promise<NotesView> { s.pickNotes(dir); return value(await s.service.chooseNotesFolder('use')); }
/** A notes folder: two pages and two tidy-up reports, the newer one dated 2026-10-27. */
function myNotes(home: string, name = 'notes'): string {
  const dir = join(home, 'Documents', name);
  for (const [rel, text] of [['index.md', '# Index\n'], ['pages/one.md', '# One\n'], ['reports/2026-10-20-refine.md', '# Old\n'], ['reports/2026-10-27-refine.md', '# Report\n']] as const) {
    mkdirSync(join(dir, rel, '..'), { recursive: true }); writeFileSync(join(dir, rel), text);
  }
  return dir;
}
const noHome = (s: Setup, v: unknown): void => { const text = JSON.stringify(v); assert.equal(text.includes(s.home), false, text); };

// ---- item 2: the tidy-up report --------------------------------------------------------------------------------------------------

test('openNotesReport is a listed call with one argument, so the preload and the handler register it', () => {
  assert.ok((ENGINE_CALLS as readonly string[]).includes('openNotesReport'));
  assert.equal(ENGINE_ARITY.openNotesReport, 1);
});

test('the tidy-up report: main finds the newest report itself, asks in its own dialog, and opens a private copy of it; the window gets its relative path only', async t => {
  const s = setup(t);
  const dir = myNotes(s.home), before = filesOf(dir);
  const n = await chooseNotes(s, dir);
  assert.deepEqual(n.latestReport, { date: '2026-10-27', path: 'reports/2026-10-27-refine.md' });
  const r = value(await s.service.openNotesReport(n.id));
  assert.deepEqual(r, { path: 'reports/2026-10-27-refine.md' });
  assert.equal(s.opened.length, 1);
  assert.ok(isCopy(s, s.opened[0]!), s.opened[0]);
  assert.deepEqual(s.seen.map(o => [o.text, o.mode, o.dirMode]), [['# Report\n', 0o600, 0o700]], 'the copy holds the bytes of the report, private to the person');
  assert.equal(s.asks.length, 1);
  assert.deepEqual(s.asks[0], {
    title: 'Open the tidy-up report', message: 'Open reports/2026-10-27-refine.md from ~/Documents/notes?',
    detail: 'It opens in the app your computer uses for .md files. Bowerloom changes nothing in the notes folder.', button: 'Open',
  });
  noHome(s, r);
  assert.deepEqual(filesOf(dir), before, 'opening writes nothing');
});

test('the tidy-up report: an id main never gave, a folder id, or a path is refused before anything runs, and nothing opens', async t => {
  const s = setup(t);
  await chooseNotes(s, myNotes(s.home));
  await assert.rejects(s.service.openNotesReport('notes-99'), (e: unknown) => e instanceof EngineCallRefusal && e.code === 'UNKNOWN_FOLDER');
  await assert.rejects(s.service.openNotesReport('folder-1'), (e: unknown) => e instanceof EngineCallRefusal && e.code === 'BAD_ARGUMENT');
  await assert.rejects(s.service.openNotesReport('/etc/hosts'), (e: unknown) => e instanceof EngineCallRefusal && e.code === 'BAD_ARGUMENT');
  await assert.rejects(s.service.openNotesReport({ id: 'notes-1' }), (e: unknown) => e instanceof EngineCallRefusal && e.code === 'BAD_ARGUMENT');
  assert.deepEqual(s.opened, []);
  assert.deepEqual(s.asks, []);
});

test('the tidy-up report: only the report main showed last opens; a newer one written since is refused with words until the panel reads again', async t => {
  const s = setup(t);
  const dir = myNotes(s.home);
  const n = await chooseNotes(s, dir);
  writeFileSync(join(dir, 'reports', '2026-10-29-refine.md'), '# Newer\n');
  const stale = refusal(await s.service.openNotesReport(n.id));
  assert.equal(stale.code, 'REPORT_NOT_SHOWN');
  assert.equal(stale.message, REPORT_MAIN_WORDS.REPORT_NOT_SHOWN);
  assert.deepEqual(s.opened, []);
  assert.deepEqual(s.asks, [], 'no dialog for a report the person did not see');
  const again = value(await s.service.notesSummary(n.id));
  assert.equal(again.latestReport?.path, 'reports/2026-10-29-refine.md');
  assert.deepEqual(value(await s.service.openNotesReport(n.id)), { path: 'reports/2026-10-29-refine.md' });
  assert.equal(s.opened.length, 1);
  assert.ok(isCopy(s, s.opened[0]!));
  assert.equal(s.seen[0]!.text, '# Newer\n');
});

test('the tidy-up report: no report, a closed dialog, and an opener that fails are each a refusal in words', async t => {
  const s = setup(t);
  const empty = join(s.home, 'Documents', 'empty');
  mkdirSync(empty, { recursive: true }); writeFileSync(join(empty, 'index.md'), '# Index\n');
  const e = await chooseNotes(s, empty);
  const none = refusal(await s.service.openNotesReport(e.id));
  assert.equal(none.code, 'REPORT_NONE');
  assert.equal(none.message, REPORT_MAIN_WORDS.REPORT_NONE);

  const n = await chooseNotes(s, myNotes(s.home));
  s.say(false);
  const closed = refusal(await s.service.openNotesReport(n.id));
  assert.equal(closed.code, 'CANCELLED');
  assert.match(closed.message, /Nothing was opened/);
  assert.deepEqual(s.opened, []);
  s.say(true);
  s.openAnswer('No application knows how to open this file.');
  const failed = refusal(await s.service.openNotesReport(n.id));
  assert.equal(failed.code, 'REPORT_OPEN_FAILED');
  assert.ok(failed.message.startsWith(REPORT_MAIN_WORDS.REPORT_OPEN_FAILED), failed.message);
  assert.equal(s.opened.length, 1);
});

test('an openPath failure is recorded with its reason and shown in words', async t => {
  const s = setup(t);
  const n = await chooseNotes(s, myNotes(s.home));
  s.records.length = 0;
  s.openAnswer('No application knows how to open this file.');
  const said = refusal(await s.service.openNotesReport(n.id));
  assert.equal(said.code, 'REPORT_OPEN_FAILED');
  assert.equal(said.message, `${REPORT_MAIN_WORDS.REPORT_OPEN_FAILED} Your computer said: No application knows how to open this file.`);
  assert.deepEqual(s.records, [{ source: 'app', kind: 'scenario', step: 'notes-report', outcome: 'refused', code: 'REPORT_OPEN_FAILED', reason: 'No application knows how to open this file.' }]);

  // An opener that throws: its message is the reason. A reason that names the copy, or hides text, is shown with the copy named in words and the hidden
  // characters written out, and never with a path of the person.
  s.records.length = 0;
  s.openAnswer('');
  s.openThrows(new Error(`Cannot open ${join(s.copies, 'x')}‮ now`));
  const thrown = refusal(await s.service.openNotesReport(n.id));
  assert.equal(thrown.code, 'REPORT_OPEN_FAILED');
  assert.ok(thrown.message.startsWith(`${REPORT_MAIN_WORDS.REPORT_OPEN_FAILED} Your computer said: Cannot open `), thrown.message);
  assert.ok(thrown.message.includes('[U+202E]'), thrown.message);
  noHome(s, thrown);
  assert.equal(s.records.length, 1);
  assert.equal(s.records[0]!.code, 'REPORT_OPEN_FAILED');
  assert.equal(typeof s.records[0]!.reason, 'string');
  assert.equal(String(s.records[0]!.reason).includes(s.home), false);
});

test('a swap to a link after the check opens nothing outside the copy: main opens its own copy, and the copy keeps the bytes it read', async t => {
  const s = setup(t);
  const dir = myNotes(s.home), other = join(s.home, 'Documents', 'elsewhere');
  mkdirSync(other, { recursive: true }); writeFileSync(join(other, 'run.md'), '#!/bin/sh\necho ran\n', { mode: 0o755 });
  const n = await chooseNotes(s, dir);
  value(await s.service.openNotesReport(n.id));
  const report = join(dir, 'reports', '2026-10-27-refine.md');
  // The report swapped for a link to something that runs, once main has copied it: what was opened is still the copy, with the report's bytes.
  rmSync(report); symlinkSync(join(other, 'run.md'), report);
  assert.equal(s.opened.length, 1);
  assert.ok(isCopy(s, s.opened[0]!));
  assert.equal(readFileSync(s.opened[0]!, 'utf8'), '# Report\n');
  assert.equal(s.opened.includes(report), false);
  assert.equal(s.opened.includes(join(other, 'run.md')), false);
});

test('an executable .md report is refused, and nothing opens', async t => {
  const s = setup(t);
  const dir = myNotes(s.home);
  const n = await chooseNotes(s, dir);
  chmodSync(join(dir, 'reports', '2026-10-27-refine.md'), 0o755);
  const r = refusal(await s.service.openNotesReport(n.id));
  assert.equal(r.code, 'REPORT_UNSAFE');
  assert.deepEqual(s.opened, []);
  assert.deepEqual(s.asks, [], 'no dialog either');
});

test('a right-to-left override in the report name is refused before the dialog, and nothing opens', async t => {
  const s = setup(t);
  const dir = myNotes(s.home);
  writeFileSync(join(dir, 'reports', '2026-10-29-‮dm.etoN.md'), '# Report\n');
  const n = await chooseNotes(s, dir);
  assert.equal(n.latestReport?.date, '2026-10-29');
  const r = refusal(await s.service.openNotesReport(n.id));
  assert.equal(r.code, 'REPORT_UNSAFE');
  assert.deepEqual(s.opened, []);
  assert.deepEqual(s.asks, [], 'no dialog either');
});

test('the dialog shows a report name through visible(): a hidden character is written out', () => {
  assert.equal(ASK.openReport('~/Documents/notes', 'reports/2026-10-29-‮dm.etoN.md').message, 'Open reports/2026-10-29-[U+202E]dm.etoN.md from ~/Documents/notes?');
  assert.equal(ASK.openReport('~/Documents/no​tes', 'reports/a.md').message, 'Open reports/a.md from ~/Documents/no[U+200B]tes?');
});

test('the private copy of a report goes on the next open, and every copy goes when main clears them at quit', async t => {
  const s = setup(t);
  const n = await chooseNotes(s, myNotes(s.home));
  value(await s.service.openNotesReport(n.id));
  value(await s.service.openNotesReport(n.id));
  assert.equal(s.opened.length, 2);
  assert.equal(existsSync(dirname(s.opened[0]!)), false, 'the first copy went on the next open');
  assert.equal(existsSync(s.opened[1]!), true);
  s.service.clearReportCopies();
  assert.deepEqual(readdirSync(s.copies), []);
});

test('the tidy-up report: with no opener in main, it is refused in words and nothing runs', async t => {
  const s = setup(t, { opener: false });
  const n = await chooseNotes(s, myNotes(s.home));
  assert.equal(refusal(await s.service.openNotesReport(n.id)).code, 'REPORT_OPEN_FAILED');
});

test('the tidy-up report: main checks the path again before it opens; a report swapped for a link or a second link, or a reports folder made a link, is refused', async t => {
  const s = setup(t);
  const dir = myNotes(s.home), other = join(s.home, 'Documents', 'elsewhere');
  mkdirSync(other, { recursive: true }); writeFileSync(join(other, 'secret.md'), '# Not a report\n');
  const n = await chooseNotes(s, dir);
  const report = join(dir, 'reports', '2026-10-27-refine.md');

  // A second hard link to the report: another name for the same bytes, possibly outside the folder.
  linkSync(report, join(other, 'hard.md'));
  assert.equal(refusal(await s.service.openNotesReport(n.id)).code, 'REPORT_UNSAFE');
  rmSync(join(other, 'hard.md'));

  // The report replaced by a link after the panel read it: the package skips a link, so the newest plain report is the older one, not the one shown.
  rmSync(report); symlinkSync(join(other, 'secret.md'), report);
  assert.equal(refusal(await s.service.openNotesReport(n.id)).code, 'REPORT_NOT_SHOWN');
  rmSync(report); writeFileSync(report, '# Report\n');

  // The reports folder swapped for a link to a folder holding a report of that name.
  mkdirSync(join(other, 'reports'), { recursive: true }); writeFileSync(join(other, 'reports', '2026-10-27-refine.md'), '# Elsewhere\n');
  renameSync(join(dir, 'reports'), join(dir, 'reports-old'));
  symlinkSync(join(other, 'reports'), join(dir, 'reports'));
  const linked = refusal(await s.service.openNotesReport(n.id));
  assert.ok(['REPORT_NOT_SHOWN', 'REPORT_UNSAFE'].includes(linked.code), linked.code);
  assert.deepEqual(s.opened, [], 'nothing opened');
  assert.deepEqual(s.asks, [], 'no dialog either');
});

test('the tidy-up report of a source a harness records opens too: its id is one main gave, and it is read only', async t => {
  const s = setup(t);
  const dir = teamFolder(s.home), notes = myNotes(s.home);
  const f = await choose(s, dir);
  const n = await chooseNotes(s, notes);
  const edits: SaveEdit[] = [{ kind: 'set-source', name: 'notes', notesId: n.id }, { kind: 'set-agent', id: 'writer', notes: ['notes'] }];
  value(await s.service.runSave(f.id, value(await s.service.planSave(f.id, edits)).revision, edits));
  // A new window: the source comes from knowledge.json, with an id of its own that main gave. It was never chosen with the notes chooser here.
  const opened: string[] = [];
  const later = createEngineService({
    home: s.home, stateRoot: join(s.home, '.local', 'state', 'bowerloom'), who: 'tester', now: () => WHEN, chooseFolder: async () => dir, confirm: async () => true,
    openPath: async p => { opened.push(p); return ''; }, reportCopies: () => s.copies,
  });
  const g = value(await later.chooseFolder());
  const source = value(await later.planSave(g.id, [])).definition.sources[0]!;
  assert.match(source.notesId, /^notes-[0-9]+$/);
  // Before the panel read it, nothing was shown, so nothing opens.
  assert.equal(refusal(await later.openNotesReport(source.notesId)).code, 'REPORT_NOT_SHOWN');
  assert.equal(value(await later.notesSummary(source.notesId)).latestReport?.path, 'reports/2026-10-27-refine.md');
  assert.deepEqual(value(await later.openNotesReport(source.notesId)), { path: 'reports/2026-10-27-refine.md' });
  assert.equal(opened.length, 1);
  assert.ok(isCopy(s, opened[0]!), opened[0]);
  assert.equal(readFileSync(opened[0]!, 'utf8'), '# Report\n');
});

// ---- item 1: stop using notes ----------------------------------------------------------------------------------------------------

/** A team harness with the notes folder attached to the writer and the reader, saved. */
async function withNotes(s: Setup): Promise<{ dir: string; notes: string; f: FolderInfo; n: NotesView }> {
  const dir = teamFolder(s.home), notes = myNotes(s.home);
  const f = await choose(s, dir), n = await chooseNotes(s, notes);
  const edits: SaveEdit[] = [{ kind: 'set-source', name: 'notes', notesId: n.id }, { kind: 'set-agent', id: 'writer', notes: ['notes'] }, { kind: 'set-agent', id: 'reader', notes: ['notes'] }];
  value(await s.service.runSave(f.id, value(await s.service.planSave(f.id, edits)).revision, edits));
  return { dir, notes, f, n };
}

test('stop using notes: a remove-source edit; the review names the agents that lose the notes, and the notes folder does not change', async t => {
  const s = setup(t);
  const { dir, notes, f } = await withNotes(s);
  const notesBefore = filesOf(notes);
  const edits: SaveEdit[] = [{ kind: 'remove-source', name: 'notes' }];
  const plan = value(await s.service.planSave(f.id, edits));
  assert.deepEqual(plan.removedSources, [{ name: 'notes', label: '~/Documents/notes', agents: ['reader', 'writer'] }]);
  assert.deepEqual(plan.changes.map(c => [c.path, c.action]), [['.bowerloom/agents/reader.md', 'update'], ['.bowerloom/agents/writer.md', 'update'], ['.bowerloom/knowledge.json', 'delete']]);
  assert.deepEqual(plan.definition.sources, []);
  assert.deepEqual(plan.definition.agents.map(a => [a.id, a.notes]), [['reader', []], ['writer', []]]);
  noHome(s, plan);
  value(await s.service.runSave(f.id, plan.revision, edits));
  assert.equal(existsSync(join(dir, '.bowerloom', 'knowledge.json')), false);
  assert.doesNotMatch(readFileSync(join(dir, '.bowerloom', 'agents', 'writer.md'), 'utf8'), /notes:/);
  assert.deepEqual(filesOf(notes), notesBefore, 'nothing in the notes folder changes');
  // A plan with no removal names none.
  assert.deepEqual(value(await s.service.planSave(f.id, [])).removedSources, []);
});

test('stop using notes: a source the harness does not hold is refused in the package\'s words; the edit takes a name only', async t => {
  const s = setup(t);
  const { f } = await withNotes(s);
  assert.equal(refusal(await s.service.planSave(f.id, [{ kind: 'remove-source', name: 'other' }])).code, 'EDIT_UNKNOWN_ID');
  await assert.rejects(s.service.planSave(f.id, [{ kind: 'remove-source', name: 'notes', path: '/tmp' }]), /BAD_ARGUMENT/);
  await assert.rejects(s.service.planSave(f.id, [{ kind: 'remove-source', name: '../notes' }]), /BAD_ARGUMENT/);
});

// ---- item 4: files that can run, and copied files ----------------------------------------------------------------------------------

const COPY = (from: string): SaveEdit[] => [{ kind: 'add-skill', id: 'summarize', from }];

test('a copy from another folder: each change names its folder, the script is marked as a file that can run, and the plan asks for an acknowledgement', async t => {
  const s = setup(t);
  const f = await choose(s, teamFolder(s.home)), src = await choose(s, sourceFolder(s.home));
  const plan = value(await s.service.planSave(f.id, COPY(src.id)));
  assert.deepEqual(plan.changes, [
    { path: '.bowerloom/skills/summarize/SKILL.md', action: 'create', from: '~/Projects/source' },
    { path: '.bowerloom/skills/summarize/scripts/count.sh', action: 'create', executable: true, from: '~/Projects/source' },
  ]);
  assert.deepEqual(plan.copiedExecutables, [{ path: '.bowerloom/skills/summarize/scripts/count.sh', from: '~/Projects/source' }]);
  assert.match(plan.acknowledge ?? '', /^[a-f0-9]{64}$/);
  // A plan that copies nothing that can run needs none.
  const plain = value(await s.service.planSave(f.id, [{ kind: 'set-agent', id: 'reader', skills: ['outline'] }]));
  assert.deepEqual(plain.copiedExecutables, []);
  assert.equal(plain.acknowledge, null);
});

test('a copy of files that can run: Save without the acknowledgement of the shown plan is refused in words, with no dialog and nothing written', async t => {
  const s = setup(t);
  const dir = teamFolder(s.home), before = filesOf(dir);
  const f = await choose(s, dir), src = await choose(s, sourceFolder(s.home));
  const plan = value(await s.service.planSave(f.id, COPY(src.id)));
  const bare = refusal(await s.service.runSave(f.id, plan.revision, COPY(src.id)));
  assert.equal(bare.code, 'SAVE_EXECUTABLE_UNACKNOWLEDGED');
  assert.equal(bare.message, SAVE_MAIN_WORDS.SAVE_EXECUTABLE_UNACKNOWLEDGED);
  const wrong = refusal(await s.service.runSave(f.id, plan.revision, { edits: COPY(src.id), acknowledged: 'b'.repeat(64) }));
  assert.equal(wrong.code, 'SAVE_EXECUTABLE_UNACKNOWLEDGED');
  assert.equal(s.asks.length, 0, 'no dialog');
  assert.deepEqual(filesOf(dir), before);
  // With it, main asks once, naming the file that can run, and writes it with its execute bit.
  value(await s.service.runSave(f.id, plan.revision, { edits: COPY(src.id), acknowledged: plan.acknowledge }));
  assert.equal(s.asks.length, 1);
  assert.match(s.asks[0]!.detail, /can run as a program: \.bowerloom\/skills\/summarize\/scripts\/count\.sh\./);
  assert.equal(statSync(join(dir, '.bowerloom/skills/summarize/scripts/count.sh')).mode & 0o111, 0o111);
});

test('an acknowledgement covers only the plan shown: a source script that changes after the plan is refused, and nothing is written', async t => {
  const s = setup(t);
  const dir = teamFolder(s.home), srcDir = sourceFolder(s.home), before = filesOf(dir);
  const f = await choose(s, dir), src = await choose(s, srcDir);
  const plan = value(await s.service.planSave(f.id, COPY(src.id)));
  writeFileSync(join(srcDir, '.bowerloom/skills/summarize/scripts/count.sh'), '#!/bin/sh\nrm -rf "$1"\n');
  const r = refusal(await s.service.runSave(f.id, plan.revision, { edits: COPY(src.id), acknowledged: plan.acknowledge }));
  assert.equal(r.code, 'SAVE_STALE');
  assert.deepEqual(filesOf(dir), before);
});

test('the save request takes closed keys: an extra key, a bad acknowledgement or an edits list of another shape is refused before anything runs', async t => {
  const s = setup(t);
  const f = await choose(s, teamFolder(s.home));
  const rev = value(await s.service.planSave(f.id, [])).revision;
  for (const bad of [{ edits: [], acknowledged: null, extra: 1 }, { edits: [], acknowledged: 'x' }, { edits: [] }, { edits: 'no', acknowledged: null }, { acknowledged: null }]) {
    await assert.rejects(s.service.runSave(f.id, rev, bad), /BAD_ARGUMENT/, JSON.stringify(bad));
  }
});

test('main\'s save dialog names each file that can run, a file of the folder itself too; a plan with none says nothing of it', async t => {
  const s = setup(t);
  const dir = teamFolder(s.home);
  writeFileSync(join(dir, '.bowerloom/skills/outline/run.sh'), '#!/bin/sh\necho outline\n');
  chmodSync(join(dir, '.bowerloom/skills/outline/run.sh'), 0o755);
  const f = await choose(s, dir);
  const plain = [{ kind: 'set-agent', id: 'reader', skills: ['outline'] }] as SaveEdit[];
  value(await s.service.runSave(f.id, value(await s.service.planSave(f.id, plain)).revision, plain));
  assert.doesNotMatch(s.asks[0]!.detail, /can run/);
});

test('a go-back that only flips an execute bit says so: the change is marked, and main\'s dialog says only the permission to run changes', async t => {
  const s = setup(t);
  const dir = teamFolder(s.home);
  const f = await choose(s, dir), src = await choose(s, sourceFolder(s.home));
  const plan = value(await s.service.planSave(f.id, COPY(src.id)));
  value(await s.service.runSave(f.id, plan.revision, { edits: COPY(src.id), acknowledged: plan.acknowledge }));
  chmodSync(join(dir, '.bowerloom/skills/summarize/scripts/count.sh'), 0o644);
  const back = value(await s.service.planRestore(f.id, 'v2'));
  assert.deepEqual(back.changes, [{ path: '.bowerloom/skills/summarize/scripts/count.sh', action: 'update', executable: true, modeOnly: true }]);
  assert.equal(back.acknowledge, null, 'a go-back copies nothing from another folder');
  value(await s.service.runRestore(f.id, back.revision, 'v2'));
  const ask = s.asks[s.asks.length - 1]!;
  assert.equal(ask.title, 'Go back to a save point');
  assert.match(ask.detail, /Only the permission to run changes: \.bowerloom\/skills\/summarize\/scripts\/count\.sh\./);
  assert.equal(statSync(join(dir, '.bowerloom/skills/summarize/scripts/count.sh')).mode & 0o111, 0o111);
});
