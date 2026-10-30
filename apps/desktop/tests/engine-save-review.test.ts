// Review fixes of the save step in main (0.8.0-beta.1, option C): large harnesses keep their save points, add-skill stays bounded, a failed save point is
// told and logged, a recovery says when the harness does not load, a damaged save point record can be set aside, and the small fixes beside them. Run with
// the real packages on synthetic folders.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createEngineService } from '../main/engine-service.js';
import type { EngineService } from '../main/engine-service.js';
import type { Ask } from '../main/engine-consent.js';
import { ASK } from '../main/engine-consent.js';
import { afterSaveWarnings, currentDefinition, keepBefore, targetOf, versionViews } from '../main/engine-save.js';
import { applySave, applySaveWith, planSave as packagePlanSave } from '../../../packages/adoption/src/save.js';
import { loadDefinition } from '../../../packages/harness-definition/src/index.js';
import { harnessStateDirs } from '../../../packages/project-sync/src/harness-state.js';
import type { Answer, FolderInfo, SaveEdit } from '../shared/engine/types.js';
import { ENGINE_ARITY, ENGINE_CALLS, SAVE_MAIN_WORDS } from '../shared/engine/types.js';
import * as types from '../shared/engine/types.js';
import { tempDir } from './support.js';
import { filesOf, homeFolder, sourceFolder, teamFolder } from './helpers-engine/folders.js';

const WHEN = new Date('2026-10-30T12:00:00Z');
const value = <T>(a: Answer<T> | null): T => { assert.ok(a !== null, 'an answer'); if (!a.ok) assert.fail(`refused: ${a.refusal.code} ${a.refusal.message}`); return a.value; };
const refusal = <T>(a: Answer<T>): { code: string; message: string; paths: readonly string[] } => { assert.equal(a.ok, false, 'a refusal'); return (a as Extract<Answer<T>, { ok: false }>).refusal; };
const stateRootOf = (home: string): string => join(home, '.local', 'state', 'bowerloom');
const put = (dir: string, rel: string, text: string | Buffer): void => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };

interface Setup { home: string; service: EngineService; asks: Ask[]; events: Record<string, unknown>[]; pick(dir: string | null): void }
function setup(t: test.TestContext): Setup {
  const home = homeFolder(tempDir(t, 'bowerloom-save-review-'));
  let next: string | null = null;
  const asks: Ask[] = [], events: Record<string, unknown>[] = [];
  const service = createEngineService({
    home, stateRoot: stateRootOf(home), chooseFolder: async () => next, confirm: async ask => { asks.push(ask); return true; }, who: 'tester', now: () => WHEN,
    record: input => { events.push({ ...input }); return true; },
  });
  return { home, service, asks, events, pick: dir => { next = dir; } };
}
async function choose(s: Setup, dir: string): Promise<FolderInfo> { s.pick(dir); return value(await s.service.chooseFolder()); }
const LINK: SaveEdit[] = [{ kind: 'set-agent', id: 'reader', skills: ['outline'] }];
const UNLINK: SaveEdit[] = [{ kind: 'set-agent', id: 'reader', skills: [] }];
async function save(s: Setup, id: string, edits: readonly SaveEdit[]): Promise<types.SaveWritten> {
  const plan = value(await s.service.planSave(id, edits));
  return value(await s.service.runSave(id, plan.revision, edits));
}
/** The team folder with `n` more reference files in the skill `outline`, each of `size` bytes of short text lines. */
function bigTeam(home: string, n: number, size: number, folder = 'p'): string {
  const dir = teamFolder(home, 'big');
  const line = 'a'.repeat(79) + '\n';
  const text = (i: number): string => (line.repeat(Math.ceil(size / line.length)).slice(0, size - 6) + `${String(i).padStart(5, '0')}\n`);
  for (let i = 0; i < n; i++) put(dir, `.bowerloom/skills/outline/references/${folder}/${String(i).padStart(4, '0')}.md`, text(i));
  return dir;
}

// ---- finding 2: large harnesses ---------------------------------------------------------------------------------------------

test('a harness of more than 200 files saves twice and goes back, with every save point kept', async t => {
  const s = setup(t);
  const dir = bigTeam(s.home, 205, 40), before = filesOf(dir);
  const f = await choose(s, dir);
  const first = await save(s, f.id, LINK);
  assert.equal(first.warnings, undefined, JSON.stringify(first.warnings));
  const second = await save(s, f.id, UNLINK);
  assert.equal(second.warnings, undefined, JSON.stringify(second.warnings));
  assert.deepEqual(value(await s.service.listVersions(f.id)).map(v => v.id), ['v3', 'v2', 'v1']);
  const back = value(await s.service.planRestore(f.id, 'v1'));
  value(await s.service.runRestore(f.id, back.revision, 'v1'));
  assert.deepEqual(filesOf(dir), before);
});

test('a harness of more than 8 MiB saves twice and goes back, with every save point kept', async t => {
  const s = setup(t);
  const dir = bigTeam(s.home, 9, 1_000_000), before = filesOf(dir);
  const f = await choose(s, dir);
  assert.equal((await save(s, f.id, LINK)).warnings, undefined);
  assert.equal((await save(s, f.id, UNLINK)).warnings, undefined);
  const back = value(await s.service.planRestore(f.id, 'v2'));
  value(await s.service.runRestore(f.id, back.revision, 'v2'));
  assert.match(readFileSync(join(dir, '.bowerloom/agents/reader.md'), 'utf8'), /outline/);
  const first = value(await s.service.planRestore(f.id, 'v1'));
  value(await s.service.runRestore(f.id, first.revision, 'v1'));
  assert.deepEqual(filesOf(dir), before);
});

test('a save whose save points cannot both be kept is refused up front, with words, and nothing is written', async t => {
  const s = setup(t);
  // Long paths: each save point alone fits the 1 MiB index, the one before and the one after together do not.
  const dir = bigTeam(s.home, 1500, 2, 'd'.repeat(240)), before = filesOf(dir);
  const f = await choose(s, dir);
  const r = refusal(await s.service.planSave(f.id, LINK));
  assert.equal(r.code, 'SAVE_POINT_TOO_LARGE');
  assert.equal(r.message, SAVE_MAIN_WORDS.SAVE_POINT_TOO_LARGE);
  assert.match(r.message, /Go back/);
  assert.equal(value(await s.service.planSave(f.id, [])).noop, true, 'reading the harness still works');
  assert.deepEqual(filesOf(dir), before);
  assert.deepEqual(value(await s.service.listVersions(f.id)), []);
});

// ---- finding 3: add-skill stays bounded ---------------------------------------------------------------------------------------

test('add-skill: at most 16 copies in one save, and the same skill from the same folder once', async t => {
  const s = setup(t);
  const f = await choose(s, teamFolder(s.home)), src = await choose(s, sourceFolder(s.home));
  const many = Array.from({ length: 17 }, (_, i): SaveEdit => ({ kind: 'add-skill', id: `copy-${i}`, from: src.id }));
  await assert.rejects(s.service.planSave(f.id, many), /BAD_ARGUMENT/);
  await assert.rejects(s.service.planSave(f.id, [{ kind: 'add-skill', id: 'summarize', from: src.id }, { kind: 'remove-skill', id: 'summarize' }, { kind: 'add-skill', id: 'summarize', from: src.id }]), /BAD_ARGUMENT/);
  // Sixteen is allowed: the ones the source lacks are refused by the package with words, not by the gate.
  assert.equal(refusal(await s.service.planSave(f.id, many.slice(0, 16))).code, 'SAVE_SOURCE_MISSING');
});

test('add-skill loads each source folder once per call, and only the last copy of a skill id brings its other files', t => {
  const home = homeFolder(tempDir(t, 'bowerloom-save-review-'));
  const team = teamFolder(home), withScript = sourceFolder(home, 'with-script'), plain = join(home, 'Projects', 'plain');
  put(plain, '.bowerloom/harness.json', JSON.stringify({ format: 'bowerloom/harness/v1beta1', id: 'plain', description: 'Plain.', engines: [{ id: 'claude-code' }], parts: { skills: 'skills/' } }, null, 2) + '\n');
  put(plain, '.bowerloom/skills/summarize/SKILL.md', '---\nname: summarize\ndescription: Summarizes, with no script.\n---\n\nSummarize.\n');
  put(withScript, '.bowerloom/skills/outline-two/SKILL.md', '---\nname: outline-two\ndescription: Another.\n---\n\nOutline.\n');
  const asked: string[] = [];
  const from = (id: string): string => { asked.push(id); return id === 'a' ? withScript : plain; };
  const def = currentDefinition(team);
  const two = targetOf(def, [{ kind: 'add-skill', id: 'summarize', from: 'a' }, { kind: 'add-skill', id: 'outline-two', from: 'a' }], from);
  assert.deepEqual(asked, ['a'], 'one folder, asked and loaded once');
  assert.ok(two.some(x => x.path === 'skills/summarize/scripts/count.sh'));
  asked.length = 0;
  const swapped = targetOf(def, [{ kind: 'add-skill', id: 'summarize', from: 'a' }, { kind: 'remove-skill', id: 'summarize' }, { kind: 'add-skill', id: 'summarize', from: 'b' }], from);
  assert.deepEqual(asked, ['a', 'b']);
  assert.equal(swapped.some(x => x.path === 'skills/summarize/scripts/count.sh'), false, 'the removed copy\'s script does not come back');
  assert.match(Buffer.from(swapped.find(x => x.path === 'skills/summarize/SKILL.md')!.bytes).toString('utf8'), /no script/);
});

// ---- finding 5: a save point that could not be kept -------------------------------------------------------------------------

test('a save point that cannot be kept after a save is a warning in words that Go back has no entry for it, and is logged', async t => {
  const s = setup(t);
  const dir = teamFolder(s.home);
  const f = await choose(s, dir);
  await save(s, f.id, LINK);
  const blobs = join(harnessStateDirs(stateRootOf(s.home), dir).base, 'versions', 'blobs');
  chmodSync(blobs, 0o500);
  t.after(() => { try { chmodSync(blobs, 0o700); } catch { /* removed with the temporary folder */ } });
  const done = await save(s, f.id, UNLINK);
  chmodSync(blobs, 0o700);
  assert.deepEqual(done.written, ['.bowerloom/agents/reader.md'], 'the save is done');
  assert.equal(done.version, null);
  assert.equal(done.warnings?.length, 1);
  assert.match(done.warnings![0]!, /^The save is done\./);
  assert.match(done.warnings![0]!, /Go back has no entry for this save/);
  const logged = s.events.find(e => e.step === 'save-point');
  assert.ok(logged, JSON.stringify(s.events));
  assert.equal(logged.kind, 'scenario'); assert.equal(logged.outcome, 'refused');
  assert.match(String(logged.code), /^[A-Z][A-Z0-9_]{2,63}$/);
  assert.deepEqual(value(await s.service.listVersions(f.id)).map(v => v.id), ['v2', 'v1']);
});

test('the words after a save: a journal left and a save point not kept each say the save is done and what is left to do', () => {
  assert.deepEqual(afterSaveWarnings(false, null), []);
  const [journal] = afterSaveWarnings(true, null);
  assert.match(journal!, /^The save is done\./);
  assert.match(journal!, /Finish a stopped harness/);
  const [point] = afterSaveWarnings(false, Object.assign(new Error('x'), { code: 'VERSION_CORRUPT' }));
  assert.match(point!, /^The save is done\./);
  assert.match(point!, /Go back has no entry for this save/);
  assert.match(point!, /VERSION_CORRUPT/);
  assert.match(afterSaveWarnings(false, new Error('no code'))[0]!, /FAILED/);
  assert.match(afterSaveWarnings(false, { code: 'lower case, not a code' })[0]!, /FAILED/);
  assert.equal(afterSaveWarnings(true, new Error('x')).length, 2);
});

// ---- finding 6: a recovery over a harness that does not load ------------------------------------------------------------------

test('a recovery of a damaged save journal reports the revision when the harness loads, and null with the files to check when it does not', async t => {
  const s = setup(t);
  const dir = teamFolder(s.home);
  const f = await choose(s, dir);
  const adoption = harnessStateDirs(stateRootOf(s.home), dir).adoption;
  mkdirSync(adoption, { recursive: true, mode: 0o700 });
  writeFileSync(join(adoption, 'save-pending.json'), '{ damaged', { mode: 0o600 });
  const plan = value(await s.service.planAdoptionRecovery(f.id));
  assert.equal(plan.journal, 'damaged');
  const ok = value(await s.service.runAdoptionRecovery(f.id, plan.revision));
  assert.equal(ok.revision, loadDefinition(join(dir, '.bowerloom')).ok ? (loadDefinition(join(dir, '.bowerloom')) as { definition: { revision: string } }).definition.revision : null);
  assert.match(String(ok.revision), /^sha256:/);

  writeFileSync(join(adoption, 'save-pending.json'), '{ damaged', { mode: 0o600 });
  writeFileSync(join(dir, '.bowerloom/agents/reader.md'), 'no frontmatter at all\n');
  const again = value(await s.service.planAdoptionRecovery(f.id));
  const bad = value(await s.service.runAdoptionRecovery(f.id, again.revision));
  assert.equal(bad.revision, null);
  assert.ok(bad.check.includes('.bowerloom/agents/reader.md'), JSON.stringify(bad.check));
  assert.equal(JSON.stringify(bad).includes(s.home), false);
});

test('an undo that keeps a file changed after the stop reports null when the harness does not load, and names the kept file to check', async t => {
  const s = setup(t);
  const dir = teamFolder(s.home);
  const f = await choose(s, dir);
  const dirs = harnessStateDirs(stateRootOf(s.home), dir);
  const loaded = loadDefinition(join(dir, '.bowerloom'));
  assert.ok(loaded.ok);
  const target = loaded.definition.files.map(file => (file.path === 'agents/reader.md' ? { ...file, bytes: Buffer.from(Buffer.from(file.bytes).toString('utf8').replace('Read the sources.', 'Read every source.')) } : file));
  const io = { projectDir: dir, stateDir: dirs.adoption };
  await assert.rejects(applySaveWith(io, packagePlanSave(io, target).revision, target, new AbortController().signal, { afterWrite: () => { throw Object.assign(new Error('killed'), { crash: true }); } }), /killed/);
  // After the stop, a person breaks the file the save wrote. The undo leaves it, so the harness does not load.
  writeFileSync(join(dir, '.bowerloom/agents/reader.md'), 'no frontmatter at all\n');
  const plan = value(await s.service.planAdoptionRecovery(f.id));
  assert.deepEqual(plan.kept.map(k => k.path), ['.bowerloom/agents/reader.md']);
  const r = value(await s.service.runAdoptionRecovery(f.id, plan.revision));
  assert.equal(r.revision, null);
  assert.deepEqual(r.kept, ['.bowerloom/agents/reader.md']);
  assert.ok(r.check.includes('.bowerloom/agents/reader.md'));
});

// ---- finding 7: setting a damaged save point record aside ---------------------------------------------------------------------

test('a deleted save point index with saved copies left is refused, and setting the old save points aside lets the folder save again', async t => {
  const s = setup(t);
  const dir = teamFolder(s.home);
  const f = await choose(s, dir);
  await save(s, f.id, LINK);
  const store = join(harnessStateDirs(stateRootOf(s.home), dir).base, 'versions');
  unlinkSync(join(store, 'index.json'));
  assert.equal(refusal(await s.service.listVersions(f.id)).code, 'VERSION_CORRUPT');
  const blocked = value(await s.service.planSave(f.id, UNLINK));
  assert.equal(refusal(await s.service.runSave(f.id, blocked.revision, UNLINK)).code, 'VERSION_CORRUPT');

  const plan = value(await s.service.planSetAside(f.id));
  assert.equal(plan.damaged, true);
  assert.equal(plan.folder, '~/Projects/team');
  assert.equal(refusal(await s.service.runSetAside(f.id, 'a'.repeat(64))).code, 'NOT_THE_PLAN_SHOWN');
  const shown = value(await s.service.planSetAside(f.id));
  const asksBefore = s.asks.length;
  const done = value(await s.service.runSetAside(f.id, shown.revision));
  assert.equal(s.asks.length, asksBefore + 1);
  assert.deepEqual(s.asks.at(-1), ASK.setAside('~/Projects/team', shown.revision));
  assert.match(done.name, /^versions-set-aside-\d{8}T\d{6}Z/);
  const aside = join(dirname(store), done.name);
  assert.ok(readdirSync(join(aside, 'blobs')).length > 0, 'nothing was deleted');
  assert.deepEqual(value(await s.service.listVersions(f.id)), []);
  await save(s, f.id, UNLINK);
  assert.deepEqual(value(await s.service.listVersions(f.id)).map(v => v.id), ['v2', 'v1']);
});

test('a corrupt save point index uses the same set-aside action; with no record, there is nothing to set aside', async t => {
  const s = setup(t);
  const dir = teamFolder(s.home);
  const f = await choose(s, dir);
  assert.equal(refusal(await s.service.planSetAside(f.id)).code, 'VERSION_NOTHING');
  await save(s, f.id, LINK);
  const store = join(harnessStateDirs(stateRootOf(s.home), dir).base, 'versions');
  writeFileSync(join(store, 'index.json'), '{ not json', { mode: 0o600 });
  const plan = value(await s.service.planSetAside(f.id));
  value(await s.service.runSetAside(f.id, plan.revision));
  assert.equal(existsSync(store), false);
  assert.deepEqual(value(await s.service.listVersions(f.id)), []);
});

test('the set-aside calls are listed with their argument counts', async t => {
  assert.ok((ENGINE_CALLS as readonly string[]).includes('planSetAside'));
  assert.ok((ENGINE_CALLS as readonly string[]).includes('runSetAside'));
  assert.deepEqual([ENGINE_ARITY.planSetAside, ENGINE_ARITY.runSetAside], [1, 2]);
  const s = setup(t);
  await assert.rejects(s.service.runSetAside('folder-1', 'not-a-revision'), /BAD_ARGUMENT|UNKNOWN_FOLDER/);
  await assert.rejects(s.service.planSetAside('../x'), /BAD_ARGUMENT/);
});

// ---- the small fixes ---------------------------------------------------------------------------------------------------------

test('a save point is current only when the execute bit of each file matches too, and a changed bit gets its own "as it was" save point', async t => {
  const s = setup(t);
  const dir = teamFolder(s.home);
  const f = await choose(s, dir), src = await choose(s, sourceFolder(s.home));
  await save(s, f.id, [{ kind: 'add-skill', id: 'summarize', from: src.id }]);
  assert.deepEqual(value(await s.service.listVersions(f.id)).map(v => [v.id, v.current]), [['v2', true], ['v1', false]]);
  chmodSync(join(dir, '.bowerloom/skills/summarize/scripts/count.sh'), 0o644);
  assert.deepEqual(value(await s.service.listVersions(f.id)).map(v => [v.id, v.current]), [['v2', false], ['v1', false]]);
  await save(s, f.id, LINK);
  const list = value(await s.service.listVersions(f.id));
  assert.deepEqual(list.map(v => v.id), ['v4', 'v3', 'v2', 'v1']);
  assert.match(list[1]!.label, /as it was/i);
  assert.equal(versionViews(harnessStateDirs(stateRootOf(s.home), dir), currentDefinition(dir))[0]!.current, true);
});

test('the harness view of a save plan passes through the folder\'s scrub: no home path reaches the window', async t => {
  const s = setup(t);
  const dir = teamFolder(s.home);
  const h = JSON.parse(readFileSync(join(dir, '.bowerloom/harness.json'), 'utf8')) as Record<string, unknown>;
  writeFileSync(join(dir, '.bowerloom/harness.json'), JSON.stringify({ ...h, description: `Kept in ${s.home}/Projects/team for now.` }, null, 2) + '\n');
  writeFileSync(join(dir, '.bowerloom/skills/outline/SKILL.md'), `---\nname: outline\ndescription: Outlines drafts from ${s.home}/notes.\n---\n\nOutline it.\n`);
  const f = await choose(s, dir);
  const view = value(await s.service.planSave(f.id, LINK));
  assert.equal(JSON.stringify(view).includes(s.home), false, JSON.stringify(view.definition));
  assert.match(view.definition.description, /~\/Projects\/team|Projects\/team/);
});

test('only a missing harness.json is "no harness yet"; a harness.json the folder cannot read as a plain file is a path problem', async t => {
  const s = setup(t);
  const fileDir = join(s.home, 'Projects', 'file-not-folder');
  mkdirSync(fileDir, { recursive: true });
  writeFileSync(join(fileDir, '.bowerloom'), 'a file where the folder goes\n');
  const a = await choose(s, fileDir);
  assert.equal(refusal(await s.service.planSave(a.id, [])).code, 'SAVE_PATH_UNSAFE');
  const linkDir = teamFolder(s.home, 'linked');
  const real = join(s.home, 'elsewhere.json');
  writeFileSync(real, readFileSync(join(linkDir, '.bowerloom/harness.json')));
  rmSync(join(linkDir, '.bowerloom/harness.json'));
  symlinkSync(real, join(linkDir, '.bowerloom/harness.json'));
  const b = await choose(s, linkDir);
  assert.equal(refusal(await s.service.planSave(b.id, [])).code, 'SAVE_PATH_UNSAFE');
  const none = join(s.home, 'Projects', 'none');
  mkdirSync(none, { recursive: true });
  const c = await choose(s, none);
  assert.equal(refusal(await s.service.planSave(c.id, [])).code, 'SAVE_NO_DEFINITION');
});

test('a folder that changes between the save point kept before a save and the save itself is refused as stale, and the save point stays', async t => {
  const home = homeFolder(tempDir(t, 'bowerloom-save-review-'));
  const dir = teamFolder(home);
  const dirs = harnessStateDirs(stateRootOf(home), dir);
  const io = { projectDir: dir, stateDir: dirs.adoption };
  const target = targetOf(currentDefinition(dir), LINK, () => dir);
  const plan = packagePlanSave(io, target);
  await keepBefore(dir, dirs, WHEN);
  writeFileSync(join(dir, '.bowerloom/instructions/AGENTS.md'), '# Team\n\nUse pnpm.\n');
  const before = filesOf(dir);
  await assert.rejects(applySave(io, plan.revision, target), (e: { code?: string }) => e.code === 'SAVE_STALE');
  assert.deepEqual(filesOf(dir), before, 'the hand change stays, and nothing was saved over it');
  const views = versionViews(dirs, currentDefinition(dir));
  assert.deepEqual(views.map(v => [v.id, v.current]), [['v1', false]], 'the save point kept before is the harness before the hand change');
});

test('SAVE_EDIT_KINDS is gone: the edit kinds are the SaveEdit union alone', () => {
  assert.equal((types as Record<string, unknown>).SAVE_EDIT_KINDS, undefined);
});

// ---- verification review, finding 1: a finished save whose journal was left -----------------------------------------------

const EVERY_SOURCE = (dir: string): { path: string; bytes: Uint8Array; executable?: boolean }[] => {
  const loaded = loadDefinition(join(dir, '.bowerloom'));
  assert.ok(loaded.ok);
  return loaded.definition.files.map(file => (file.path === 'agents/reader.md' ? { ...file, bytes: Buffer.from(Buffer.from(file.bytes).toString('utf8').replace('Read the sources.', 'Read every source.')) } : file));
};
const readDef = (dir: string, rel: string): string => readFileSync(join(dir, '.bowerloom', rel), 'utf8');

/**
 * Saves through the package so that the journal cannot be removed at the end, as a full disk or a changed permission would: the save finishes, every file
 * is the target, and the journal stays (`journalLeft`). No save point is kept for it, as when the "Saved" save point fails too.
 */
async function finishASaveAndLeaveItsJournal(s: Setup, dir: string): Promise<void> {
  const dirs = harnessStateDirs(stateRootOf(s.home), dir);
  const target = EVERY_SOURCE(dir);
  const io = { projectDir: dir, stateDir: dirs.adoption };
  try {
    const r = await applySaveWith(io, packagePlanSave(io, target).revision, target, new AbortController().signal, { afterWrite: () => { chmodSync(dirs.adoption, 0o500); } });
    assert.equal(r.journalLeft, true);
  } finally { chmodSync(dirs.adoption, 0o700); }
  assert.ok(existsSync(join(dirs.adoption, 'save-pending.json')));
}

test('a save that finished but left its journal is kept by the recovery: every file stays, the note is cleared, and the save points do not change', async t => {
  const s = setup(t);
  const dir = teamFolder(s.home);
  const f = await choose(s, dir);
  await save(s, f.id, LINK);
  await finishASaveAndLeaveItsJournal(s, dir);
  const saved = filesOf(dir), points = value(await s.service.listVersions(f.id));
  assert.match(readDef(dir, 'agents/reader.md'), /Read every source\./);
  assert.equal((await s.service.folders()).find(x => x.id === f.id)!.unfinished.adoption, true);

  const plan = value(await s.service.planAdoptionRecovery(f.id));
  assert.equal(plan.kind, 'save');
  assert.equal(plan.journal, 'ok');
  assert.equal(plan.done, true);
  assert.deepEqual([plan.remove, plan.restore, plan.kept], [[], [], []], 'the plan takes nothing back');
  const asksBefore = s.asks.length;
  const r = value(await s.service.runAdoptionRecovery(f.id, plan.revision));
  assert.equal(s.asks.length, asksBefore + 1);
  const ask = s.asks.at(-1)!;
  assert.deepEqual(ask, ASK.saveRecovery('~/Projects/team', 0, plan.revision, true));
  assert.match(`${ask.message} ${ask.detail}`, /the save stays, and Bowerloom clears its note/i);
  assert.doesNotMatch(`${ask.message} ${ask.detail}`, /put back/i);

  assert.deepEqual(filesOf(dir), saved, 'every file is the finished save');
  assert.deepEqual([r.removed, r.restored, r.kept, r.check], [[], [], [], []]);
  const now = loadDefinition(join(dir, '.bowerloom'));
  assert.ok(now.ok);
  assert.equal(r.revision, now.definition.revision);
  assert.equal(existsSync(join(harnessStateDirs(stateRootOf(s.home), dir).adoption, 'save-pending.json')), false, 'the note is cleared');
  assert.equal((await s.service.folders()).find(x => x.id === f.id)!.unfinished.adoption, false);
  assert.deepEqual(value(await s.service.listVersions(f.id)), points, 'the save points are unchanged');
  value(await s.service.planSave(f.id, []));
});

test('a save stopped part way is still taken back: its plan is not done, it asks to put the files back, and every file returns', async t => {
  const s = setup(t);
  const dir = teamFolder(s.home), before = filesOf(dir);
  const f = await choose(s, dir);
  // Two files change; the process is killed after the first is written, so the second is still to do.
  const target = EVERY_SOURCE(dir).map(file => (file.path === 'agents/writer.md' ? { ...file, bytes: Buffer.from(Buffer.from(file.bytes).toString('utf8').replace('Write the draft.', 'Write every draft.')) } : file));
  const io = { projectDir: dir, stateDir: harnessStateDirs(stateRootOf(s.home), dir).adoption };
  await assert.rejects(applySaveWith(io, packagePlanSave(io, target).revision, target, new AbortController().signal, { afterWrite: rel => { if (rel === 'agents/reader.md') throw Object.assign(new Error('killed'), { crash: true }); } }), /killed/);
  assert.match(readDef(dir, 'agents/reader.md'), /Read every source\./);
  assert.doesNotMatch(readDef(dir, 'agents/writer.md'), /Write every draft\./);
  const plan = value(await s.service.planAdoptionRecovery(f.id));
  assert.equal(plan.done, false);
  assert.deepEqual(plan.restore, ['.bowerloom/agents/reader.md']);
  const r = value(await s.service.runAdoptionRecovery(f.id, plan.revision));
  assert.deepEqual(s.asks.at(-1), ASK.saveRecovery('~/Projects/team', 1, plan.revision, false));
  assert.match(s.asks.at(-1)!.message, /^Put back 1 file/);
  assert.deepEqual(r.restored, ['.bowerloom/agents/reader.md']);
  assert.deepEqual(filesOf(dir), before);
});

test('a save whose files are all written is taken back, not finished, when a file outside it changed since, so the recovery can never refuse for good', async t => {
  const s = setup(t);
  const dir = teamFolder(s.home);
  const f = await choose(s, dir);
  await finishASaveAndLeaveItsJournal(s, dir);
  // A file the save did not touch changes by hand: the harness is no longer the save's target, so finishing it would refuse every time.
  writeFileSync(join(dir, '.bowerloom/instructions/AGENTS.md'), '# Team\n\nUse pnpm.\n');
  const plan = value(await s.service.planAdoptionRecovery(f.id));
  assert.equal(plan.done, false);
  assert.deepEqual(plan.restore, ['.bowerloom/agents/reader.md']);
  value(await s.service.runAdoptionRecovery(f.id, plan.revision));
  assert.doesNotMatch(readDef(dir, 'agents/reader.md'), /Read every source\./);
  assert.match(readDef(dir, 'instructions/AGENTS.md'), /pnpm/);
  assert.equal((await s.service.folders()).find(x => x.id === f.id)!.unfinished.adoption, false);
});

test('the warning of a left journal says the save stays when the note is cleared, and never that the recovery takes the save back', () => {
  const [journal] = afterSaveWarnings(true, null);
  assert.match(journal!, /^The save is done\./);
  assert.match(journal!, /Finish a stopped harness/);
  assert.match(journal!, /the save stays, and Bowerloom clears its note/);
  assert.doesNotMatch(journal!, /takes this save back/);
});
