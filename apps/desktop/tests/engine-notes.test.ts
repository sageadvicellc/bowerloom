// Notes in main (0.8 spec, section 6.9; first five minutes, section 4, step 3): main's own notes chooser, the Notes panel's read, "Start fresh" (the kit's
// starter wiki), version history for linked notes, and attaching notes to an agent through the save step, with the ready-made notes keeper added from the
// kit main ships. Each write goes through the gate of the save step: the plan main showed last, main's own dialog, one call at a time. The window gets ids
// and `~` labels only. Real packages and real git on synthetic folders; a test that needs git skips with the reason when it is not installed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createEngineService, EngineCallRefusal, refusalOf } from '../main/engine-service.js';
import type { EngineService } from '../main/engine-service.js';
import type { Ask } from '../main/engine-consent.js';
import { NotesRefusal, findGit } from '../../../packages/notes-source/src/index.js';
import { loadDefinition } from '../../../packages/harness-definition/src/index.js';
import type { Answer, FolderInfo, NotesPurpose, NotesView, SaveEdit } from '../shared/engine/types.js';
import { ENGINE_ARITY, ENGINE_CALLS, KIT_MAIN_WORDS, KIT_MARKETPLACE, NOTES_PLAN_LIST_LIMIT, SOURCE_NAME_TAKEN } from '../shared/engine/types.js';
import type { KitId } from '../shared/engine/types.js';
import { currentDefinition, targetOf } from '../main/engine-save.js';
import { loadKit } from '../main/kit.js';
import { DESKTOP, tempDir } from './support.js';
import { filesOf, homeFolder, teamFolder } from './helpers-engine/folders.js';

const KITS = join(DESKTOP, '..', '..', 'kits');
const WHEN = new Date('2026-10-30T12:00:00Z');
const STARTER = ['AGENTS.md', 'index.md', 'log.md', 'pages/README.md', 'reports/README.md', 'sources/README.md'];
const KIT_SKILLS = ['add-source', 'answer-from-notes', 'check-notes', 'file-page', 'log-change', 'refine-report'];
const value = <T>(a: Answer<T> | null): T => { assert.ok(a !== null, 'an answer'); if (!a.ok) assert.fail(`refused: ${a.refusal.code} ${a.refusal.message}`); return a.value; };
const refusal = <T>(a: Answer<T>): { code: string; message: string; paths: readonly string[] } => { assert.equal(a.ok, false, 'a refusal'); return (a as Extract<Answer<T>, { ok: false }>).refusal; };
const gitMissing = ((): string | false => { try { findGit(); return false; } catch { return 'git is not installed at a fixed path (Command Line Tools or Xcode), so the notes history is not tested here'; } })();

interface Setup {
  home: string; base: string; service: EngineService; asks: Ask[]; purposes: NotesPurpose[];
  say(yes: boolean): void; pick(dir: string | null): void; pickNotes(dir: string | null): void; kits(dir: string): void;
}
function setup(t: test.TestContext): Setup {
  const base = tempDir(t, 'bowerloom-notes-');
  const home = homeFolder(base);
  let next: string | null = null, notes: string | null = null, yes = true, kitsDir = KITS;
  const asks: Ask[] = [], purposes: NotesPurpose[] = [];
  const make = (): EngineService => createEngineService({
    home, stateRoot: join(home, '.local', 'state', 'bowerloom'), who: 'tester', now: () => WHEN,
    chooseFolder: async () => next, confirm: async ask => { asks.push(ask); return yes; },
    chooseNotesFolder: async purpose => { purposes.push(purpose); return notes; },
    kitsDir: () => kitsDir,
  });
  const s: Setup = { home, base, service: make(), asks, purposes, say: v => { yes = v; }, pick: d => { next = d; }, pickNotes: d => { notes = d; }, kits: d => { kitsDir = d; } };
  return s;
}
async function choose(s: Setup, dir: string): Promise<FolderInfo> { s.pick(dir); return value(await s.service.chooseFolder()); }
async function chooseNotes(s: Setup, dir: string, purpose: NotesPurpose = 'use'): Promise<NotesView> { s.pickNotes(dir); return value(await s.service.chooseNotesFolder(purpose)); }
/** A notes folder of the person's: three pages, one in a hidden folder that is not counted, and one tidy-up report. */
function myNotes(home: string, name = 'notes'): string {
  const dir = join(home, 'Documents', name);
  for (const [rel, text] of [['index.md', '# Index\n'], ['pages/one.md', '# One\n'], ['pages/two.md', '# Two\n'], ['.trash/old.md', 'x'], ['reports/2026-10-27-refine.md', '# Report\n'], ['picture.png', 'x']] as const) {
    mkdirSync(join(dir, rel, '..'), { recursive: true }); writeFileSync(join(dir, rel), text);
  }
  return dir;
}
const noPath = (s: Setup, v: unknown): void => { const text = JSON.stringify(v); assert.equal(text.includes(s.base), false, text); assert.equal(text.includes(s.home), false, text); };
const KEEPER: SaveEdit[] = [{ kind: 'add-from-kit', kit: 'wiki-keeper' }];

test('the six notes calls are listed with their argument counts, so the preload and the handler register them', () => {
  const calls = ['chooseNotesFolder', 'notesSummary', 'planCreateNotes', 'runCreateNotes', 'planNotesHistory', 'runNotesHistory'] as const;
  for (const call of calls) assert.ok((ENGINE_CALLS as readonly string[]).includes(call), call);
  assert.deepEqual(calls.map(c => ENGINE_ARITY[c]), [1, 1, 1, 2, 1, 2]);
});

test('main\'s notes chooser: a notes id, the label in ~ form, and a page count from names only; closing it answers null; a bad purpose is refused', async t => {
  const s = setup(t);
  const dir = myNotes(s.home), before = filesOf(dir);
  const v = await chooseNotes(s, dir);
  assert.match(v.id, /^notes-[0-9]+$/);
  assert.equal(v.label, '~/Documents/notes');
  assert.equal(v.name, 'notes');
  assert.equal(v.suggestedName, 'notes');
  assert.equal(v.pages, 4, 'index, two pages and the report; the hidden folder is not counted');
  assert.equal(v.complete, true);
  assert.equal(v.history, 'none');
  assert.equal(v.lastCommitAt, null);
  assert.deepEqual(v.latestReport, { date: '2026-10-27', path: 'reports/2026-10-27-refine.md' });
  assert.deepEqual(s.purposes, ['use']);
  noPath(s, v);
  assert.deepEqual(filesOf(dir), before, 'nothing is written');
  // The same folder again is the same id.
  assert.equal((await chooseNotes(s, dir)).id, v.id);
  s.pickNotes(null);
  assert.equal(await s.service.chooseNotesFolder('start'), null);
  await assert.rejects(s.service.chooseNotesFolder('both'), (e: unknown) => e instanceof EngineCallRefusal && e.code === 'BAD_ARGUMENT');
  // A file, or a path that is not absolute, is not a folder.
  s.pickNotes(join(dir, 'index.md'));
  assert.equal(refusal((await s.service.chooseNotesFolder('use'))!).code, 'NOT_A_FOLDER');
  s.pickNotes('Documents/notes');
  assert.equal(refusal((await s.service.chooseNotesFolder('use'))!).code, 'NOT_A_FOLDER');
});

test('the Notes panel\'s read: by notes id only; an id main never gave is refused before anything runs', async t => {
  const s = setup(t);
  const v = await chooseNotes(s, myNotes(s.home));
  const again = value(await s.service.notesSummary(v.id));
  assert.deepEqual(again, v);
  await assert.rejects(s.service.notesSummary('notes-99'), (e: unknown) => e instanceof EngineCallRefusal && e.code === 'UNKNOWN_FOLDER');
  await assert.rejects(s.service.notesSummary('folder-1'), (e: unknown) => e instanceof EngineCallRefusal && e.code === 'BAD_ARGUMENT');
  await assert.rejects(s.service.notesSummary('/etc'), (e: unknown) => e instanceof EngineCallRefusal && e.code === 'BAD_ARGUMENT');
});

test('Start fresh: the kit\'s starter files into an empty folder, written only for the plan shown last, after main\'s own dialog, with one first commit', { skip: gitMissing }, async t => {
  const s = setup(t);
  const dir = join(s.home, 'Documents', 'My Notes');
  mkdirSync(dir, { recursive: true });
  const v = await chooseNotes(s, dir, 'start');
  assert.deepEqual(s.purposes, ['start']);
  assert.equal(v.suggestedName, 'my-notes');
  const plan = value(await s.service.planCreateNotes(v.id));
  assert.equal(plan.notes, '~/Documents/My Notes');
  assert.equal(plan.createsFolder, false);
  assert.deepEqual(plan.files.map(f => f.path), STARTER);
  assert.deepEqual(plan.folders, ['pages', 'reports', 'sources']);
  assert.equal(plan.files.find(f => f.path === 'AGENTS.md')!.bytes, readFileSync(join(KITS, 'wiki-keeper', 'starter', 'AGENTS.md')).length);
  assert.deepEqual(plan.kit, { id: 'wiki-keeper', version: (JSON.parse(readFileSync(join(KITS, 'wiki-keeper', 'kit.json'), 'utf8')) as { version: string }).version });
  noPath(s, plan);
  assert.deepEqual(filesOf(dir), {}, 'the plan writes nothing');
  assert.equal(refusal(await s.service.runCreateNotes(v.id, 'a'.repeat(64))).code, 'NOT_THE_PLAN_SHOWN');
  s.say(false);
  assert.equal(refusal(await s.service.runCreateNotes(v.id, plan.revision)).code, 'CANCELLED');
  assert.deepEqual(filesOf(dir), {});
  s.say(true);
  // A cancelled dialog keeps the plan: the person can say yes on a second try.
  const done = value(await s.service.runCreateNotes(v.id, plan.revision));
  assert.equal(done.files, STARTER.length);
  assert.equal(done.clean, true);
  assert.match(done.committedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.equal(s.asks.length, 2);
  assert.deepEqual(s.asks[1], { title: 'Start your notes', message: 'Write 6 files into ~/Documents/My Notes and start its history?', detail: `From plan ${plan.revision.slice(0, 8)}. Bowerloom makes one first commit with git, and changes nothing else. Bowerloom plans again first and stops if anything changed.` });
  for (const rel of STARTER) assert.ok(readFileSync(join(dir, rel)).equals(readFileSync(join(KITS, 'wiki-keeper', 'starter', rel))), rel);
  assert.ok(existsSync(join(dir, '.git')));
  // The plan was written once: a second write of it is not the plan shown.
  assert.equal(refusal(await s.service.runCreateNotes(v.id, plan.revision)).code, 'NOT_THE_PLAN_SHOWN');
  const after = value(await s.service.notesSummary(v.id));
  assert.equal(after.history, 'git');
  assert.equal(after.pages, STARTER.length);
  assert.notEqual(after.lastCommitAt, null);
  // A folder that holds anything takes no starter.
  const full = await chooseNotes(s, myNotes(s.home, 'full'), 'start');
  const no = refusal(await s.service.planCreateNotes(full.id));
  assert.equal(no.code, 'NOTES_NOT_EMPTY');
  noPath(s, no);
});

test('Use my notes with no history: the plan lists every file the first commit adds; the write starts it only for the plan shown last', { skip: gitMissing }, async t => {
  const s = setup(t);
  const dir = myNotes(s.home);
  const v = await chooseNotes(s, dir);
  const plan = value(await s.service.planNotesHistory(v.id));
  assert.equal(plan.notes, '~/Documents/notes');
  assert.deepEqual(plan.files.map(f => f.path), ['index.md', 'pages/one.md', 'pages/two.md', 'picture.png', 'reports/2026-10-27-refine.md']);
  assert.equal(plan.count, 5);
  assert.equal(plan.hidden, 1);
  assert.ok(plan.files.length <= NOTES_PLAN_LIST_LIMIT);
  assert.equal(existsSync(join(dir, '.git')), false);
  // A file changed since the plan: the package plans again and refuses.
  writeFileSync(join(dir, 'pages/three.md'), '# Three\n');
  const stale = refusal(await s.service.runNotesHistory(v.id, plan.revision));
  assert.equal(stale.code, 'NOTES_STALE');
  assert.equal(existsSync(join(dir, '.git')), false);
  const again = value(await s.service.planNotesHistory(v.id));
  const done = value(await s.service.runNotesHistory(v.id, again.revision));
  assert.equal(done.files, 6);
  assert.equal(done.clean, true);
  assert.equal(s.asks.at(-1)!.title, 'Start the history of your notes');
  assert.equal(s.asks.at(-1)!.message, 'Start version history in ~/Documents/notes with 6 files?');
  assert.equal(value(await s.service.notesSummary(v.id)).history, 'git');
  assert.equal(refusal(await s.service.planNotesHistory(v.id)).code, 'NOTES_ALREADY_REPOSITORY');
});

/** The test's own git, with no user or system config, run at a repository root; the commit time is fixed. */
function ownGit(root: string, args: readonly string[], when = '2024-03-05T12:00:00Z'): string {
  return execFileSync(findGit().path, [...args], {
    cwd: root, encoding: 'utf8', shell: false, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: '/usr/bin:/bin', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_DIR: join(root, '.git'), GIT_WORK_TREE: root, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@localhost', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@localhost', GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when },
  });
}

test('notes inside a larger repository: the read shows its history for the folder only; no history start and no starter there', { skip: gitMissing }, async t => {
  const s = setup(t);
  const root = join(s.home, 'Projects', 'big');
  const dir = join(root, 'knowledge-base');
  for (const [rel, text] of [['README.md', '# Big\n'], ['knowledge-base/index.md', '# Index\n'], ['knowledge-base/pages/one.md', '# One\n']] as const) {
    mkdirSync(join(root, rel, '..'), { recursive: true }); writeFileSync(join(root, rel), text);
  }
  ownGit(root, ['init', '-q']);
  for (const [k, v] of [['core.repositoryformatversion', '1'], ['extensions.worktreeConfig', 'true'], ['remote.origin.url', 'ssh://example.invalid/big']] as const) ownGit(root, ['config', k, v]);
  ownGit(root, ['add', '-A']); ownGit(root, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'one']);
  writeFileSync(join(root, 'README.md'), '# Big, later\n');
  ownGit(root, ['add', '-A'], '2024-06-01T12:00:00Z'); ownGit(root, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'outside'], '2024-06-01T12:00:00Z');
  const v = await chooseNotes(s, dir);
  assert.equal(v.history, 'parent');
  assert.equal(v.lastCommitAt, '2024-03-05T12:00:00Z', 'the newer commit outside the folder is not counted');
  assert.equal(v.pages, 2);
  noPath(s, v);
  assert.equal(refusal(await s.service.planNotesHistory(v.id)).code, 'NOTES_PARENT_REPOSITORY');
  const empty = join(root, 'new-notes'); mkdirSync(empty);
  const fresh = await chooseNotes(s, empty, 'start');
  assert.equal(refusal(await s.service.planCreateNotes(fresh.id)).code, 'NOTES_PARENT_REPOSITORY');
  assert.deepEqual(readdirSync(empty), [], 'no file and no nested repository');
  assert.equal(existsSync(join(dir, '.git')), false);
  assert.deepEqual(s.asks, [], 'nothing was asked, so nothing was written');
});

test('the walk for a larger repository stops at the home folder main was given', { skip: gitMissing }, async t => {
  const s = setup(t);
  ownGit(s.base, ['init', '-q']);
  const dir = myNotes(s.home);
  const v = await chooseNotes(s, dir);
  assert.equal(v.history, 'none', 'a repository above home is not the notes\' history');
  assert.equal(value(await s.service.planNotesHistory(v.id)).count, 5);
});

test('add-from-kit: the keeper and its six skills, read by main from the shipped kit, with the kit\'s pinned version in sources.json', async t => {
  const s = setup(t);
  const dir = teamFolder(s.home);
  const f = await choose(s, dir);
  const plan = value(await s.service.planSave(f.id, KEEPER));
  assert.deepEqual(plan.changes.map(c => [c.path, c.action]), [
    ['.bowerloom/agents/notes-keeper.md', 'create'],
    ...KIT_SKILLS.map(id => [`.bowerloom/skills/${id}/SKILL.md`, 'create']),
    ['.bowerloom/sources.json', 'create'],
    ['.bowerloom/harness.json', 'update'],
  ]);
  const keeper = plan.definition.agents.find(a => a.id === 'notes-keeper')!;
  assert.deepEqual(keeper.skills, ['add-source', 'file-page', 'answer-from-notes', 'check-notes', 'log-change', 'refine-report']);
  assert.deepEqual(keeper.notes, []);
  const version = (JSON.parse(readFileSync(join(KITS, 'wiki-keeper', 'kit.json'), 'utf8')) as { version: string }).version;
  assert.deepEqual(plan.definition.kits, [{ id: 'wiki-keeper', version, skills: KIT_SKILLS }], 'the skills of the kit\'s record, in its order');
  value(await s.service.runSave(f.id, plan.revision, KEEPER));
  for (const id of KIT_SKILLS) assert.ok(readFileSync(join(dir, '.bowerloom', 'skills', id, 'SKILL.md')).equals(readFileSync(join(KITS, 'wiki-keeper', 'skills', id, 'SKILL.md'))), id);
  assert.ok(readFileSync(join(dir, '.bowerloom', 'agents', 'notes-keeper.md')).equals(readFileSync(join(KITS, 'wiki-keeper', 'agents', 'notes-keeper.md'))));
  const sources = JSON.parse(readFileSync(join(dir, '.bowerloom', 'sources.json'), 'utf8')) as { sources: { name: string; marketplace: string; version: string; items: { part: string; id: string }[] }[] };
  assert.deepEqual(sources.sources.map(r => [r.name, r.marketplace, r.version]), [['wiki-keeper', 'bowerloom-kits', version]]);
  assert.deepEqual(sources.sources[0]!.items, [{ part: 'subagents', id: 'notes-keeper' }, ...KIT_SKILLS.map(id => ({ part: 'skills', id }))]);
  assert.equal(loadDefinition(join(dir, '.bowerloom')).ok, true);
  // A second add is refused with main's words.
  const twice = refusal(await s.service.planSave(f.id, KEEPER));
  assert.deepEqual([twice.code, twice.message], ['KIT_ALREADY_ADDED', KIT_MAIN_WORDS.KIT_ALREADY_ADDED]);
  // A kit skill can be removed: its item leaves the record, and the rest stays.
  const gone = value(await s.service.planSave(f.id, [{ kind: 'remove-skill', id: 'refine-report' }]));
  value(await s.service.runSave(f.id, gone.revision, [{ kind: 'remove-skill', id: 'refine-report' }]));
  const left = JSON.parse(readFileSync(join(dir, '.bowerloom', 'sources.json'), 'utf8')) as { sources: { items: { id: string }[] }[] };
  assert.equal(left.sources[0]!.items.some(i => i.id === 'refine-report'), false);
  assert.equal(left.sources[0]!.items.length, 6);
});

test('add-from-kit takes the kit by id only, at most once a save, and a broken kit is refused with words and writes nothing', async t => {
  const s = setup(t);
  const dir = teamFolder(s.home), before = filesOf(dir);
  const f = await choose(s, dir);
  for (const bad of [[{ kind: 'add-from-kit', kit: 'other' }], [{ kind: 'add-from-kit', kit: 'wiki-keeper', text: 'x' }], [{ kind: 'add-from-kit' }], [...KEEPER, ...KEEPER]]) {
    await assert.rejects(s.service.planSave(f.id, bad), (e: unknown) => e instanceof EngineCallRefusal && e.code === 'BAD_ARGUMENT', JSON.stringify(bad));
  }
  const broken = join(s.base, 'kits');
  cpSync(KITS, broken, { recursive: true });
  writeFileSync(join(broken, 'wiki-keeper', 'kit.json'), '{}');
  s.kits(broken);
  const r = refusal(await s.service.planSave(f.id, KEEPER));
  assert.equal(r.code, 'KIT_INVALID');
  assert.ok(r.message.startsWith(KIT_MAIN_WORDS.KIT_INVALID));
  noPath(s, r);
  mkdirSync(join(s.home, 'Empty'));
  const notes = await chooseNotes(s, join(s.home, 'Empty'), 'start');
  assert.equal(refusal(await s.service.planCreateNotes(notes.id)).code, 'KIT_INVALID');
  assert.deepEqual(filesOf(dir), before);
});

test('attaching notes is a save: set-source stores the path main knows, in ~ form or relative, and set-agent lists it in the keeper\'s notes', async t => {
  const s = setup(t);
  const dir = teamFolder(s.home);
  const f = await choose(s, dir);
  const notes = await chooseNotes(s, myNotes(s.home));
  const edits: SaveEdit[] = [...KEEPER, { kind: 'set-source', name: 'notes', notesId: notes.id }, { kind: 'set-agent', id: 'notes-keeper', notes: ['notes'] }];
  const plan = value(await s.service.planSave(f.id, edits));
  assert.ok(plan.changes.some(c => c.path === '.bowerloom/knowledge.json' && c.action === 'create'));
  assert.deepEqual(plan.definition.sources, [{ name: 'notes', kind: 'wiki-folder', label: '~/Documents/notes', notesId: notes.id }]);
  assert.deepEqual(plan.definition.agents.find(a => a.id === 'notes-keeper')!.notes, ['notes']);
  noPath(s, plan);
  value(await s.service.runSave(f.id, plan.revision, edits));
  assert.deepEqual(JSON.parse(readFileSync(join(dir, '.bowerloom', 'knowledge.json'), 'utf8')), { sources: [{ kind: 'wiki-folder', name: 'notes', path: '~/Documents/notes' }] });
  // A read of the harness after a new start gives the same source, with a notes id for the panel's read.
  const now = value(await s.service.planSave(f.id, []));
  const src = now.definition.sources[0]!;
  assert.equal(src.label, '~/Documents/notes');
  assert.equal(value(await s.service.notesSummary(src.notesId)).pages, 4);
  // Notes inside the harness folder are stored relative to it.
  const inside = join(dir, 'wiki'); mkdirSync(inside);
  const near = await chooseNotes(s, inside);
  const p2 = value(await s.service.planSave(f.id, [{ kind: 'set-source', name: 'team-wiki', notesId: near.id }]));
  value(await s.service.runSave(f.id, p2.revision, [{ kind: 'set-source', name: 'team-wiki', notesId: near.id }]));
  const k = JSON.parse(readFileSync(join(dir, '.bowerloom', 'knowledge.json'), 'utf8')) as { sources: { name: string; path: string }[] };
  assert.deepEqual(k.sources.map(x => [x.name, x.path]), [['notes', '~/Documents/notes'], ['team-wiki', 'wiki']]);
  assert.equal(value(await s.service.planSave(f.id, [])).definition.sources[1]!.label, '~/Projects/team/wiki');
  // remove-source takes it from the harness and from the keeper's notes.
  const p3 = value(await s.service.planSave(f.id, [{ kind: 'remove-source', name: 'notes' }]));
  assert.deepEqual(p3.definition.agents.find(a => a.id === 'notes-keeper')!.notes, []);
  assert.deepEqual(p3.definition.sources.map(x => x.name), ['team-wiki']);
});

test('the save edits for notes take ids only: a path, a missing or unknown notes id, a set-agent with neither list, and an unsafe name are refused', async t => {
  const s = setup(t);
  const dir = teamFolder(s.home);
  const f = await choose(s, dir);
  const notes = await chooseNotes(s, myNotes(s.home));
  const bad: unknown[] = [
    [{ kind: 'set-source', name: 'notes', notesId: notes.id, path: '/x' }],
    [{ kind: 'set-source', name: 'notes', path: '~/Documents/notes' }],
    [{ kind: 'set-source', name: 'notes', notesId: '/Users/x' }],
    [{ kind: 'set-source', name: '../x', notesId: notes.id }],
    [{ kind: 'set-agent', id: 'reader' }],
    [{ kind: 'set-agent', id: 'reader', notes: ['a', 'a'] }],
    [{ kind: 'remove-source', name: 'notes', extra: 1 }],
  ];
  for (const edits of bad) await assert.rejects(s.service.planSave(f.id, edits), (e: unknown) => e instanceof EngineCallRefusal && e.code === 'BAD_ARGUMENT', JSON.stringify(edits));
  await assert.rejects(s.service.planSave(f.id, [{ kind: 'set-source', name: 'notes', notesId: 'notes-77' }]), (e: unknown) => e instanceof EngineCallRefusal && e.code === 'UNKNOWN_FOLDER');
  // set-agent with notes only keeps the agent's skills.
  const p = value(await s.service.planSave(f.id, [{ kind: 'set-source', name: 'notes', notesId: notes.id }, { kind: 'set-agent', id: 'writer', notes: ['notes'] }]));
  assert.deepEqual(p.definition.agents.find(a => a.id === 'writer')!.skills, ['review']);
  // A notes folder outside the home folder and the harness folder has no stored form: refused with the package's words.
  const outside = await chooseNotes(s, s.base);
  const r = refusal(await s.service.planSave(f.id, [{ kind: 'set-source', name: 'far', notesId: outside.id }]));
  assert.equal(r.code, 'KNOWLEDGE_PATH_OUTSIDE');
  noPath(s, r);
});

// ---- a source a harness records is read only, and only where its stored path says (S2) ----------------------------------------------------------

/** Saves `dir/wiki` as the source `wiki` of the harness in `dir`, through the save step, and returns the folder. */
async function savedWiki(s: Setup, dir: string): Promise<FolderInfo> {
  const f = await choose(s, dir);
  const wiki = join(dir, 'wiki');
  mkdirSync(join(wiki, 'pages'), { recursive: true }); writeFileSync(join(wiki, 'index.md'), '# Index\n');
  const near = await chooseNotes(s, wiki);
  const edits: SaveEdit[] = [{ kind: 'set-source', name: 'wiki', notesId: near.id }];
  value(await s.service.runSave(f.id, value(await s.service.planSave(f.id, edits)).revision, edits));
  return f;
}

test('a recorded source whose folder became a link to another folder is refused, and the other folder is never read or labelled as the source', async t => {
  const s = setup(t);
  const dir = teamFolder(s.home);
  await savedWiki(s, dir);
  // The stored path is still `wiki`, but `wiki` is now a link to a folder elsewhere in home that holds pages of its own.
  const elsewhere = join(s.home, 'private-notes');
  mkdirSync(elsewhere); for (const n of ['a.md', 'b.md', 'c.md']) writeFileSync(join(elsewhere, n), '# x\n');
  renameSync(join(dir, 'wiki'), join(dir, 'wiki-old'));
  symlinkSync(elsewhere, join(dir, 'wiki'));
  // A new launch of the app reads the harness again.
  const w = createEngineService({ home: s.home, stateRoot: join(s.home, '.local', 'state', 'bowerloom'), who: 'tester', now: () => WHEN, chooseFolder: async () => dir, confirm: async () => true, kitsDir: () => KITS });
  const f = value(await w.chooseFolder());
  const src = value(await w.planSave(f.id, [])).definition.sources[0]!;
  assert.equal(src.label, '~/Projects/team/wiki');
  const read = refusal(await w.notesSummary(src.notesId));
  assert.equal(read.code, 'NOTES_PATH_UNSAFE');
  noPath(s, read);
  assert.equal(JSON.stringify(read).includes('private-notes'), false, 'the other folder is never named');
});

test('a source stored as ~/.ssh does not load, so no notes id is handed out for it and nothing reads it', async t => {
  const s = setup(t);
  const dir = teamFolder(s.home);
  await savedWiki(s, dir);
  mkdirSync(join(s.home, '.ssh')); writeFileSync(join(s.home, '.ssh', 'notes.md'), '# not notes\n');
  writeFileSync(join(dir, '.bowerloom', 'knowledge.json'), `${JSON.stringify({ sources: [{ kind: 'wiki-folder', name: 'keys', path: '~/.ssh' }] }, null, 2)}\n`);
  const w = createEngineService({ home: s.home, stateRoot: join(s.home, '.local', 'state', 'bowerloom'), who: 'tester', now: () => WHEN, chooseFolder: async () => dir, confirm: async () => true, kitsDir: () => KITS });
  const f = value(await w.chooseFolder());
  const r = refusal(await w.planSave(f.id, []));
  assert.equal(r.code, 'SAVE_DEFINITION_INVALID');
  await assert.rejects(w.notesSummary('notes-1'), (e: unknown) => e instanceof EngineCallRefusal && e.code === 'UNKNOWN_FOLDER');
});

test('a source read from knowledge.json gets a read-only id: its summary reads, and the history and starter plans are refused until the folder is chosen here', async t => {
  const s = setup(t);
  const dir = teamFolder(s.home);
  await savedWiki(s, dir);
  const w = createEngineService({
    home: s.home, stateRoot: join(s.home, '.local', 'state', 'bowerloom'), who: 'tester', now: () => WHEN, chooseFolder: async () => dir, confirm: async () => true, kitsDir: () => KITS,
    chooseNotesFolder: async () => join(dir, 'wiki'),
  });
  const f = value(await w.chooseFolder());
  const src = value(await w.planSave(f.id, [])).definition.sources[0]!;
  assert.equal(value(await w.notesSummary(src.notesId)).pages, 1, 'the summary of a recorded source reads');
  for (const r of [refusal(await w.planNotesHistory(src.notesId)), refusal(await w.planCreateNotes(src.notesId))]) {
    assert.equal(r.code, 'NOTES_NOT_CHOSEN');
    noPath(s, r);
  }
  assert.equal((await w.runNotesHistory(src.notesId, 'a'.repeat(64))).ok, false, 'no write runs for a read-only id');
  // Chosen with main's own chooser in this window, the same folder may be planned.
  const chosen = value(await w.chooseNotesFolder('use'));
  assert.equal(chosen.id, src.notesId);
  const plan = await w.planNotesHistory(chosen.id);
  assert.notEqual(plan.ok ? 'ok' : plan.refusal.code, 'NOTES_NOT_CHOSEN');
});

test('refusalOf passes the step that stopped a notes write part way through to the window', () => {
  const same = (p: string): string => p;
  const r = refusalOf(new NotesRefusal('NOTES_PARTIAL', ['.git'], 'NOTES_GIT_TIMEOUT'), same);
  assert.equal(r.code, 'NOTES_PARTIAL');
  assert.equal(r.step, 'NOTES_GIT_TIMEOUT');
  assert.equal(refusalOf(new NotesRefusal('NOTES_STALE'), same).step, undefined, 'no step, no field');
  assert.equal(refusalOf({ code: 'NOTES_PARTIAL', message: 'x', step: 'not a code' }, same).step, undefined, 'only a code passes');
});

test('set-source refuses a name the harness holds already for another folder, and takes the same name for the same folder', async t => {
  const s = setup(t);
  const dir = teamFolder(s.home);
  const f = await savedWiki(s, dir);
  const other = await chooseNotes(s, myNotes(s.home, 'other'));
  const r = refusal(await s.service.planSave(f.id, [{ kind: 'set-source', name: 'wiki', notesId: other.id }]));
  assert.equal(r.code, SOURCE_NAME_TAKEN);
  noPath(s, r);
  // Two edits of one save that give one name two folders are refused too.
  const another = await chooseNotes(s, myNotes(s.home, 'another'));
  assert.equal(refusal(await s.service.planSave(f.id, [{ kind: 'set-source', name: 'fresh', notesId: other.id }, { kind: 'set-source', name: 'fresh', notesId: another.id }])).code, SOURCE_NAME_TAKEN);
  // The same folder under its own name, and a name freed by remove-source in the same save, are taken.
  const same = value(await s.service.planSave(f.id, [])).definition.sources[0]!;
  assert.equal(value(await s.service.planSave(f.id, [{ kind: 'set-source', name: 'wiki', notesId: same.notesId }])).noop, true);
  assert.equal((await s.service.planSave(f.id, [{ kind: 'remove-source', name: 'wiki' }, { kind: 'set-source', name: 'wiki', notesId: other.id }])).ok, true);
});

test('add-from-kit says the kit is there already only for a record of the kit marketplace; a borrowed record of the same name from elsewhere is a name clash', t => {
  const dir = teamFolder(homeFolder(tempDir(t, 'bowerloom-kit-')));
  const def = currentDefinition(dir);
  const record = (marketplace: string) => ({ name: 'wiki-keeper', marketplace, version: '1.0.0', items: [{ part: 'skills' as const, id: 'review' }] });
  const deps = { sourcePath: () => 'notes', kit: (id: KitId) => loadKit(KITS, id) };
  const codeOf = (d: typeof def): string => { try { targetOf(d, [{ kind: 'add-from-kit', kit: 'wiki-keeper' }], () => dir, deps); return 'none'; } catch (e) { return (e as { code: string }).code; } };
  assert.equal(codeOf({ ...def, sources: [record(KIT_MARKETPLACE)] }), 'KIT_ALREADY_ADDED');
  assert.equal(codeOf({ ...def, sources: [record('another-marketplace')] }), 'EDIT_DUPLICATE_ID');
});

test('the notes view says whether the reports listing was whole', async t => {
  const s = setup(t);
  assert.equal((await chooseNotes(s, myNotes(s.home))).reportsComplete, true);
});
