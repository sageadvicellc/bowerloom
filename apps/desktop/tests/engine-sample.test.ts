// The sample launch's adopt and install calls: made-up folders in memory, plans shaped like the packages' own, the packages' own words, and the same gates.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { AdoptionRefusal, SaveRefusal } from '../../../packages/adoption/src/index.js';
import { PortableRefusal, VersionRefusal } from '../../../packages/project-sync/src/index.js';
import type { AdoptionCode, SaveCode } from '../../../packages/adoption/src/index.js';
import type { PortableCode, VersionCode } from '../../../packages/project-sync/src/index.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { NotesRefusal, findGit } from '../../../packages/notes-source/src/index.js';
import type { NotesCode } from '../../../packages/notes-source/src/index.js';
import { readFrontmatter } from '../../../packages/harness-definition/src/index.js';
import { SAMPLE_FOLDERS, SAMPLE_KIT, SAMPLE_MESSAGES, SAMPLE_NOTES, createSampleEngine, sampleEngineFixtures } from '../shared/engine/sample.js';
import { createEngineService } from '../main/engine-service.js';
import { loadKit } from '../main/kit.js';
import { KIT_MAIN_WORDS, REPORT_MAIN_WORDS, SAVE_MAIN_WORDS } from '../shared/engine/types.js';
import type { Answer, ProjectAnswer, ProjectInput, SaveEdit } from '../shared/engine/types.js';
import { DESKTOP, tempDir } from './support.js';
import { definedFolder, engineFolder, homeFolder, teamFolder } from './helpers-engine/folders.js';

const value = <T>(a: Answer<T> | null): T => { assert.ok(a !== null); if (!a.ok) assert.fail(`${a.refusal.code}`); return a.value; };
const INPUT: ProjectInput = { engines: ['claude-code', 'codex', 'opencode'], reconcile: 'accept-agents', writeClaudeMd: false, approve: [] };

/** The key paths of a value: every object key, with arrays read through their first element. */
function shape(v: unknown, at = ''): string[] {
  if (Array.isArray(v)) return v.length === 0 ? [`${at}[]`] : shape(v[0], `${at}[]`);
  if (v === null || typeof v !== 'object') return [at];
  return Object.keys(v).sort().flatMap(k => shape((v as Record<string, unknown>)[k], `${at}.${k}`));
}
/**
 * The two shapes are the same when every key path of one is a key path of the other. An array that is empty on one side says nothing about its items,
 * so the items' paths under it are left out of the comparison on both sides, and only the array itself must be there.
 */
function sameShape(real: unknown, sample: unknown): string[] {
  const a = shape(real), b = shape(sample);
  const empty = [...a, ...b].filter(p => p.endsWith('[]')).map(p => p.slice(0, -2));
  const cut = (p: string): string => { for (const e of empty) if (p === `${e}[]` || p.startsWith(`${e}[].`)) return `${e}[]`; return p; };
  const left = new Set(a.map(cut)), right = new Set(b.map(cut));
  return [...[...left].filter(p => !right.has(p)).map(p => `only in the plan: ${p}`), ...[...right].filter(p => !left.has(p)).map(p => `only in the sample: ${p}`)];
}

test('the sample\'s words for each refusal are the packages\' own words', () => {
  for (const [code, words] of Object.entries(SAMPLE_MESSAGES)) {
    if (Object.hasOwn(SAVE_MAIN_WORDS, code)) { assert.equal(SAVE_MAIN_WORDS[code as keyof typeof SAVE_MAIN_WORDS], words, code); continue; }
    if (Object.hasOwn(KIT_MAIN_WORDS, code)) { assert.equal(KIT_MAIN_WORDS[code as keyof typeof KIT_MAIN_WORDS], words, code); continue; }
    if (Object.hasOwn(REPORT_MAIN_WORDS, code)) { assert.equal(REPORT_MAIN_WORDS[code as keyof typeof REPORT_MAIN_WORDS], words, code); continue; }
    if (code.startsWith('NOTES_')) { assert.equal(new NotesRefusal(code as NotesCode).message, words, code); continue; }
    const made = code.startsWith('ADOPTION_') ? new AdoptionRefusal(code as AdoptionCode) : code.startsWith('SAVE_') ? new SaveRefusal(code as SaveCode)
      : code.startsWith('VERSION_') ? new VersionRefusal(code as VersionCode) : new PortableRefusal(code as PortableCode);
    assert.equal(made.message, words, code);
  }
});

test('the sample plans have every field of the plans the packages make from a synthetic folder', async t => {
  const home = homeFolder(tempDir(t, 'bowerloom-engine-sample-'));
  let next: string | null = engineFolder(home);
  const service = createEngineService({ home, stateRoot: join(home, '.local', 'state', 'bowerloom'), chooseFolder: async () => next, confirm: async () => true, who: 't' });
  const a = value(await service.chooseFolder());
  const real = value(await service.planAdoption(a.id, { picks: {}, acknowledged: [] }));
  const sample = sampleEngineFixtures().adopt;
  assert.deepEqual(sameShape(real, sample), []);
  // The check can fail: a field the plan lacks, and a field the sample lacks, are both named.
  assert.deepEqual(sameShape(real, { ...sample, extra: 1 }), ['only in the sample: .extra']);
  const { managed: _m, ...noManaged } = sample;
  assert.deepEqual(sameShape(real, noManaged), ['only in the plan: .managed[]']);
  next = definedFolder(home);
  const d = value(await service.chooseFolder());
  const ask = value(await service.planProjection(d.id, { ...INPUT, engines: ['claude-code', 'codex'] })) as Extract<ProjectAnswer, { kind: 'approve' }>;
  const plan = (value(await service.planProjection(d.id, { ...INPUT, engines: ['claude-code', 'codex'], approve: ask.lines.map(l => l.key) })) as Extract<ProjectAnswer, { kind: 'plan' }>).plan;
  assert.deepEqual(sameShape(plan, sampleEngineFixtures().project(INPUT)), []);
  assert.deepEqual(Object.keys(sampleEngineFixtures().approveLines[0]!).sort(), Object.keys(ask.lines[0]!).sort());
});

test('sample adoption: picks, acknowledgements and approvals gate the write exactly as the package does, and the folder then holds a definition', async () => {
  const e = createSampleEngine();
  assert.equal(e.mode, 'sample');
  assert.equal(await e.chooseFolder(), null);
  const id = SAMPLE_FOLDERS.adopt;
  let plan = value(await e.planAdoption(id, { picks: {}, acknowledged: [] }));
  assert.equal(plan.ready, false);
  assert.deepEqual(plan.approvals.map(x => x.key), ['hooks/pre-tool-use-9c03e1f2', 'mcp/mail', 'mcp/search']);
  assert.deepEqual(plan.approvals.find(x => x.key === 'mcp/search')!.secrets.map(s => s.reference), ['${SEARCH_KEY}']);
  const choices = { picks: { 'system-prompt/AGENTS.md': 'AGENTS.md' }, acknowledged: plan.unmapped.filter(u => u.gate === 'acknowledge').map(u => ({ id: u.id, hash: u.hash })) };
  plan = value(await e.planAdoption(id, choices));
  assert.equal(plan.ready, true);
  assert.equal(plan.conflicts[0]!.picked, 'AGENTS.md');
  const toSend = plan.approvals.map(x => ({ key: x.key, hash: x.hash }));
  const short = await e.runAdoption(id, plan.revision, choices, toSend.filter(x => x.key === 'mcp/mail'));
  assert.ok(!short.ok); assert.equal(short.refusal.code, 'ADOPTION_APPROVAL_REQUIRED');
  const stale = await e.runAdoption(id, '0'.repeat(64), choices, toSend);
  assert.ok(!stale.ok); assert.equal(stale.refusal.code, 'ADOPTION_STALE_APPROVAL');
  const done = value(await e.runAdoption(id, plan.revision, choices, toSend));
  assert.ok(done.written.includes('.bowerloom/harness.json'));
  const info = (await e.folders()).find(f => f.id === id)!;
  assert.equal(info.hasDefinition, true);
  const again = await e.planAdoption(id, choices);
  assert.ok(!again.ok); assert.equal(again.refusal.code, 'ADOPTION_DEFINED');
});

test('sample install: approvals first, the drift report with Accept AGENTS.md as the default, then a write, a no-change plan, and a removal', async () => {
  const e = createSampleEngine(), id = SAMPLE_FOLDERS.defined;
  const ask = value(await e.planProjection(id, INPUT));
  assert.equal(ask.kind, 'approve');
  const keys = (ask as Extract<ProjectAnswer, { kind: 'approve' }>).lines.map(l => l.key);
  assert.equal(keys.length, 3);
  const merge = await e.planProjection(id, { ...INPUT, reconcile: 'merge', approve: keys });
  assert.ok(!merge.ok); assert.equal(merge.refusal.code, 'PORTABLE_MERGE_NOT_BUILT');
  const plan = (value(await e.planProjection(id, { ...INPUT, approve: keys })) as Extract<ProjectAnswer, { kind: 'plan' }>).plan;
  assert.equal(plan.drift?.defaultAction, 'accept-agents');
  assert.equal(plan.reconcile, 'accept-agents');
  assert.ok(plan.changes.some(c => c.path === 'CLAUDE.md' && c.action === 'replace'));
  const words = new Set(plan.engines.flatMap(x => x.parts.flatMap(p => p.lines.map(l => l.result))));
  assert.deepEqual([...words].sort(), ['absent', 'exact', 'translated', 'weakened'], 'every result word is in the sample');
  assert.equal(plan.partial, true);
  assert.ok(plan.review.some(r => r.kind === 'code' && r.text.includes('export const BowerloomHooks')));
  const keep = (value(await e.planProjection(id, { ...INPUT, reconcile: 'keep-both', approve: keys })) as Extract<ProjectAnswer, { kind: 'plan' }>).plan;
  assert.ok(!keep.changes.some(c => c.path === 'CLAUDE.md'));
  assert.equal(keep.engines[0]!.parts[0]!.lines[0]!.result, 'weakened');
  assert.notEqual(keep.revision, plan.revision);
  const stale = await e.runProjection(id, keep.revision, { ...INPUT, approve: keys });
  assert.ok(!stale.ok);
  value(await e.runProjection(id, plan.revision, { ...INPUT, approve: keys }));
  const after = (value(await e.planProjection(id, { ...INPUT, approve: keys })) as Extract<ProjectAnswer, { kind: 'plan' }>).plan;
  assert.equal(after.noop, true);
  const removal = value(await e.planRemoval(id));
  assert.ok(removal.changes.some(c => c.action === 'restore'));
  value(await e.runRemoval(id, removal.revision));
  assert.equal((await e.folders()).find(f => f.id === id)!.projected, false);
});

test('sample Merge: its own plan with the CLAUDE.md text, written once by its revision; a second Merge has nothing to move', async () => {
  const e = createSampleEngine(), id = SAMPLE_FOLDERS.defined;
  const plan = value(await e.planMerge(id));
  assert.deepEqual(plan.files, [{ path: '.bowerloom/instructions/AGENTS.md', action: 'update' }]);
  assert.match(plan.claude, /Draft the report on Friday\./);
  const stale = await e.runMerge(id, 'a'.repeat(64));
  assert.ok(!stale.ok); assert.equal(stale.refusal.code, 'ADOPTION_STALE_APPROVAL');
  assert.deepEqual(value(await e.runMerge(id, plan.revision)).written, ['.bowerloom/instructions/AGENTS.md']);
  const again = await e.planMerge(id);
  assert.ok(!again.ok); assert.equal(again.refusal.code, 'ADOPTION_MERGE_NOTHING');
  const stopped = await e.planMerge(SAMPLE_FOLDERS.stopped);
  assert.ok(!stopped.ok); assert.equal(stopped.refusal.code, 'PORTABLE_RECOVERY_REQUIRED');
  // The recovery calls take the full choices too.
  const rec = value(await e.planRecovery(SAMPLE_FOLDERS.stopped, { keep: [], restoreMode: [], recordMode: [] }));
  assert.deepEqual(rec.modes, []);
});

test('sample recovery: the stopped folder refuses a plan until its recovery runs', async () => {
  const e = createSampleEngine(), id = SAMPLE_FOLDERS.stopped;
  const blocked = await e.planProjection(id, { ...INPUT, engines: ['claude-code'] });
  assert.ok(!blocked.ok); assert.equal(blocked.refusal.code, 'PORTABLE_RECOVERY_REQUIRED');
  const rec = value(await e.planRecovery(id, []));
  assert.equal(rec.action, 'rollback');
  value(await e.runRecovery(id, rec.revision, []));
  assert.equal((await e.folders()).find(f => f.id === id)!.unfinished.projection, false);
  assert.equal(value(await e.planProjection(id, { ...INPUT, engines: ['claude-code'] })).kind, 'plan');
});

test('the sample save, save point and go-back answers have every field of main\'s, and its edit refusal reads as the package\'s', async t => {
  const home = homeFolder(tempDir(t, 'bowerloom-engine-sample-save-'));
  const dir = teamFolder(home);
  const service = createEngineService({ home, stateRoot: join(home, '.local', 'state', 'bowerloom'), chooseFolder: async () => dir, confirm: async () => true, who: 't' });
  const f = value(await service.chooseFolder());
  const link: SaveEdit[] = [{ kind: 'set-agent', id: 'reader', skills: ['outline'] }];
  const real = value(await service.planSave(f.id, link));
  value(await service.runSave(f.id, real.revision, link));
  const realVersions = value(await service.listVersions(f.id));
  const realBack = value(await service.planRestore(f.id, 'v1'));
  const realWritten = value(await service.runRestore(f.id, realBack.revision, 'v1'));
  const e = createSampleEngine(), id = SAMPLE_FOLDERS.defined;
  const sample = value(await e.planSave(id, [{ kind: 'set-agent', id: 'editor', skills: ['draft-outline'] }]));
  assert.deepEqual(sameShape(real, sample), []);
  value(await e.runSave(id, sample.revision, [{ kind: 'set-agent', id: 'editor', skills: ['draft-outline'] }]));
  assert.deepEqual(sameShape(realVersions, value(await e.listVersions(id))), []);
  const back = value(await e.planRestore(id, 'v1'));
  assert.deepEqual(sameShape(realBack, back), []);
  assert.deepEqual(sameShape(realWritten, value(await e.runRestore(id, back.revision, 'v1'))), []);
  const realUnknown = await service.planSave(f.id, [{ kind: 'set-agent', id: 'nobody', skills: [] }]);
  const sampleUnknown = await e.planSave(id, [{ kind: 'set-agent', id: 'nobody', skills: [] }]);
  assert.ok(!realUnknown.ok && !sampleUnknown.ok);
  assert.deepEqual([sampleUnknown.refusal.code, sampleUnknown.refusal.message], [realUnknown.refusal.code, realUnknown.refusal.message]);
});

test('sample save: a link is a set-agent edit, a stale revision is refused, a save keeps two save points, and Go back puts the harness back', async () => {
  const e = createSampleEngine(), id = SAMPLE_FOLDERS.defined;
  const now = value(await e.planSave(id, []));
  assert.equal(now.noop, true);
  assert.deepEqual(now.definition.agents.map(a => [a.id, a.skills]), [['editor', []], ['writer', ['draft-outline']]]);
  assert.deepEqual(value(await e.listVersions(id)), []);
  const edits: SaveEdit[] = [{ kind: 'set-agent', id: 'editor', skills: ['check-facts'] }];
  const plan = value(await e.planSave(id, edits));
  assert.deepEqual(plan.changes, [{ path: '.bowerloom/agents/editor.md', action: 'update' }]);
  const stale = await e.runSave(id, 'a'.repeat(64), edits);
  assert.ok(!stale.ok); assert.equal(stale.refusal.code, 'SAVE_STALE');
  const done = value(await e.runSave(id, plan.revision, edits));
  assert.deepEqual(done, { written: ['.bowerloom/agents/editor.md'], version: 'v2' });
  assert.deepEqual(value(await e.listVersions(id)).map(v => [v.id, v.current]), [['v2', true], ['v1', false]]);
  assert.deepEqual(value(await e.planSave(id, [])).definition.agents.find(a => a.id === 'editor')!.skills, ['check-facts']);
  const back = value(await e.planRestore(id, 'v1'));
  assert.deepEqual(back.changes, [{ path: '.bowerloom/agents/editor.md', action: 'update' }]);
  value(await e.runRestore(id, back.revision, 'v1'));
  assert.deepEqual(value(await e.planSave(id, [])).definition.agents.find(a => a.id === 'editor')!.skills, []);
  assert.deepEqual(value(await e.listVersions(id)).map(v => [v.id, v.current]), [['v3', true], ['v2', false], ['v1', true]]);
  const unknown = await e.planRestore(id, 'v9');
  assert.ok(!unknown.ok); assert.equal(unknown.refusal.code, 'VERSION_UNKNOWN');
  const none = await e.planSave(SAMPLE_FOLDERS.adopt, []);
  assert.ok(!none.ok); assert.equal(none.refusal.code, 'SAVE_NO_DEFINITION');
  // A skill copied from another sample folder, then removed again, and the interfaces.
  const copy = value(await e.planSave(id, [{ kind: 'add-skill', id: 'water-plants', from: SAMPLE_FOLDERS.stopped }, { kind: 'set-engines', engines: ['claude-code', 'codex'] }]));
  assert.deepEqual(copy.changes.map(c => [c.path, c.action]), [['.bowerloom/skills/water-plants/SKILL.md', 'create'], ['.bowerloom/harness.json', 'update']]);
  assert.deepEqual(copy.definition.engines, ['claude-code', 'codex']);
  const ghost = await e.planSave(id, [{ kind: 'add-skill', id: 'ghost', from: SAMPLE_FOLDERS.stopped }]);
  assert.ok(!ghost.ok); assert.equal(ghost.refusal.code, 'SAVE_SOURCE_MISSING');
  const gone = value(await e.planSave(id, [{ kind: 'remove-skill', id: 'draft-outline' }]));
  assert.deepEqual(gone.changes.map(c => [c.path, c.action]), [['.bowerloom/agents/writer.md', 'update'], ['.bowerloom/skills/draft-outline/SKILL.md', 'delete']]);
});

// ---- notes (spec 6.9) ---------------------------------------------------------------------------------------------------------

const KITS = join(DESKTOP, '..', '..', 'kits');
const gitMissing = ((): string | false => { try { findGit(); return false; } catch { return 'git is not installed at a fixed path, so the real notes writes are not compared here'; } })();
const refusalOf = <T>(a: Answer<T>): { code: string; message: string } => { assert.equal(a.ok, false, 'a refusal'); return (a as Extract<Answer<T>, { ok: false }>).refusal; };

test('the sample\'s notes keeper is the kit main ships: its version, its agent, each skill\'s description, and the starter files', () => {
  const kit = loadKit(KITS, 'wiki-keeper');
  assert.equal(SAMPLE_KIT.version, kit.version);
  assert.equal(SAMPLE_KIT.agent.id, kit.agent.id);
  const agent = readFrontmatter(kit.agent.text);
  assert.ok(agent.ok);
  assert.equal(SAMPLE_KIT.agent.description, agent.data.description);
  assert.deepEqual([...SAMPLE_KIT.agent.skills], agent.data.skills);
  assert.deepEqual(SAMPLE_KIT.skills.map(k => k.id), kit.skills.map(k => k.id));
  for (const k of kit.skills) {
    const fm = readFrontmatter(Buffer.from(k.files[0]!.bytes).toString('utf8'));
    assert.ok(fm.ok);
    assert.equal(SAMPLE_KIT.skills.find(x => x.id === k.id)!.description, fm.data.description, k.id);
  }
  assert.deepEqual(SAMPLE_KIT.starter.map(f => [f.path, f.bytes]), kit.starter.map(f => [f.path, f.bytes.length]));
});

test('the sample notes answers have every field of main\'s: the chooser, the panel read, the save with the kit and a source, and both plans', { skip: gitMissing }, async t => {
  const home = homeFolder(tempDir(t, 'bowerloom-engine-sample-notes-'));
  const dir = teamFolder(home);
  const notesDir = join(home, 'Documents', 'Reading list');
  mkdirSync(join(notesDir, 'books'), { recursive: true });
  writeFileSync(join(notesDir, 'index.md'), '# Reading\n'); writeFileSync(join(notesDir, 'books', 'essays.md'), '# Essays\n');
  const empty = join(home, 'Documents', 'Notes'); mkdirSync(empty);
  let notes = notesDir;
  const service = createEngineService({ home, stateRoot: join(home, '.local', 'state', 'bowerloom'), chooseFolder: async () => dir, confirm: async () => true, who: 't', chooseNotesFolder: async () => notes, kitsDir: () => KITS });
  const f = value(await service.chooseFolder());
  const e = createSampleEngine();
  const realNotes = value(await service.chooseNotesFolder('use'));
  const sampleNotes = value(await e.chooseNotesFolder('use'));
  assert.deepEqual(sameShape(realNotes, sampleNotes), []);
  assert.deepEqual(Object.keys(realNotes).sort(), Object.keys(sampleNotes).sort());
  assert.deepEqual(sameShape(value(await service.notesSummary(realNotes.id)), value(await e.notesSummary(sampleNotes.id))), []);
  const realEdits: SaveEdit[] = [{ kind: 'add-from-kit', kit: 'wiki-keeper' }, { kind: 'set-source', name: 'reading', notesId: realNotes.id }, { kind: 'set-agent', id: 'notes-keeper', notes: ['reading'] }];
  const sampleEdits: SaveEdit[] = [{ kind: 'add-from-kit', kit: 'wiki-keeper' }, { kind: 'set-source', name: 'reading', notesId: sampleNotes.id }, { kind: 'set-agent', id: 'notes-keeper', notes: ['reading'] }];
  const real = value(await service.planSave(f.id, realEdits));
  const sample = value(await e.planSave(SAMPLE_FOLDERS.defined, sampleEdits));
  assert.deepEqual(sameShape(real, sample), []);
  // The change list names the same new files: the keeper, its skills, knowledge.json and sources.json; and harness.json changes.
  const added = (v: typeof real): string[] => v.changes.filter(c => c.action === 'create' || c.path === '.bowerloom/harness.json').map(c => `${c.path}:${c.action}`).sort();
  assert.deepEqual(added(sample), added(real));
  assert.deepEqual(sample.definition.agents.find(a => a.id === 'notes-keeper'), real.definition.agents.find(a => a.id === 'notes-keeper'));
  assert.deepEqual(sample.definition.kits, real.definition.kits);
  const realHistory = value(await service.planNotesHistory(realNotes.id));
  const sampleHistory = value(await e.planNotesHistory(sampleNotes.id));
  assert.deepEqual(sameShape(realHistory, sampleHistory), []);
  assert.deepEqual(sameShape(value(await service.runNotesHistory(realNotes.id, realHistory.revision)), value(await e.runNotesHistory(sampleNotes.id, sampleHistory.revision))), []);
  notes = empty;
  const realEmpty = value(await service.chooseNotesFolder('start'));
  const sampleEmpty = value(await e.chooseNotesFolder('start'));
  const realStarter = value(await service.planCreateNotes(realEmpty.id));
  const sampleStarter = value(await e.planCreateNotes(sampleEmpty.id));
  assert.deepEqual(sameShape(realStarter, sampleStarter), []);
  assert.deepEqual(sampleStarter.files, realStarter.files);
  assert.deepEqual(sampleStarter.folders, realStarter.folders);
  // The refusals the sample gives read as main's.
  const realGhost = refusalOf(await service.planSave(f.id, [{ kind: 'set-agent', id: 'reader', notes: ['ghost'] }]));
  const sampleGhost = refusalOf(await e.planSave(SAMPLE_FOLDERS.defined, [{ kind: 'set-agent', id: 'editor', notes: ['ghost'] }]));
  assert.deepEqual([sampleGhost.code, sampleGhost.message], [realGhost.code, realGhost.message]);
  const realFull = refusalOf(await service.planCreateNotes(realNotes.id));
  const sampleFull = refusalOf(await e.planCreateNotes(sampleNotes.id));
  assert.deepEqual([sampleFull.code, sampleFull.message], [realFull.code, realFull.message]);
});

test('sample notes: link shows pages and no history; history starts once by revision; Start fresh writes the starter once; the keeper attaches through a save', async () => {
  const e = createSampleEngine();
  const link = value(await e.chooseNotesFolder('use'));
  assert.equal(link.id, SAMPLE_NOTES.use);
  assert.equal(link.history, 'none');
  assert.ok(link.pages > 0);
  assert.ok(!link.label.startsWith('/'));
  const plan = value(await e.planNotesHistory(link.id));
  assert.equal(plan.count, plan.files.length);
  assert.equal(refusalOf(await e.runNotesHistory(link.id, 'a'.repeat(64))).code, 'NOTES_STALE');
  const done = value(await e.runNotesHistory(link.id, plan.revision));
  assert.equal(done.files, plan.count);
  assert.equal(value(await e.notesSummary(link.id)).history, 'git');
  assert.equal(refusalOf(await e.planNotesHistory(link.id)).code, 'NOTES_ALREADY_REPOSITORY');
  assert.equal(refusalOf(await e.planCreateNotes(link.id)).code, 'NOTES_NOT_EMPTY');
  const fresh = value(await e.chooseNotesFolder('start'));
  assert.equal(fresh.id, SAMPLE_NOTES.start);
  assert.equal(fresh.pages, 0);
  const starter = value(await e.planCreateNotes(fresh.id));
  assert.deepEqual(starter.kit, { id: 'wiki-keeper', version: SAMPLE_KIT.version });
  value(await e.runCreateNotes(fresh.id, starter.revision));
  const after = value(await e.notesSummary(fresh.id));
  assert.deepEqual([after.history, after.pages], ['git', SAMPLE_KIT.starter.length]);
  assert.equal(refusalOf(await e.planCreateNotes(fresh.id)).code, 'NOTES_NOT_EMPTY');
  // The keeper and the notes attach through the save step, and show on the next read.
  const id = SAMPLE_FOLDERS.defined;
  const edits: SaveEdit[] = [{ kind: 'add-from-kit', kit: 'wiki-keeper' }, { kind: 'set-source', name: 'notes', notesId: fresh.id }, { kind: 'set-agent', id: 'notes-keeper', notes: ['notes'] }];
  const save = value(await e.planSave(id, edits));
  value(await e.runSave(id, save.revision, edits));
  const now = value(await e.planSave(id, [])).definition;
  assert.deepEqual(now.sources, [{ name: 'notes', kind: 'wiki-folder', label: '~/Documents/Notes', notesId: fresh.id }]);
  assert.deepEqual(now.agents.find(a => a.id === 'notes-keeper')!.notes, ['notes']);
  assert.deepEqual(now.kits, [{ id: 'wiki-keeper', version: SAMPLE_KIT.version, skills: SAMPLE_KIT.skills.map(k => k.id) }]);
  const twice = refusalOf(await e.planSave(id, [{ kind: 'add-from-kit', kit: 'wiki-keeper' }]));
  assert.deepEqual([twice.code, twice.message], ['KIT_ALREADY_ADDED', KIT_MAIN_WORDS.KIT_ALREADY_ADDED]);
  const gone = value(await e.planSave(id, [{ kind: 'remove-source', name: 'notes' }]));
  assert.deepEqual(gone.definition.agents.find(a => a.id === 'notes-keeper')!.notes, []);
  assert.deepEqual(gone.changes.map(c => c.path).sort(), ['.bowerloom/agents/notes-keeper.md', '.bowerloom/knowledge.json']);
});

test('the made-up notes folder is a reading list: its name, its label, and its pages', async () => {
  const e = createSampleEngine();
  const use = await e.chooseNotesFolder('use');
  assert.ok(use !== null && use.ok);
  assert.deepEqual([use.value.name, use.value.label, use.value.suggestedName], ['Reading list', '~/Documents/Reading list', 'reading-list']);
  const plan = await e.planNotesHistory(SAMPLE_NOTES.use);
  assert.ok(plan.ok);
  const tops = [...new Set(plan.value.files.map(f => f.path.split('/')[0]!).filter(p => !p.endsWith('.md')))].sort();
  assert.deepEqual(tops, ['articles', 'books', 'notes']);
});
