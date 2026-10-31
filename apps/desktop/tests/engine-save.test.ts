// The save step in main (0.8.0-beta.1, option C): one folder saves its own harness. Edits come from the window as a closed list of ids, the plan is the one
// main showed last, main asks in its own dialog, a save point is kept before the first save and after each one, "Go back" is a save whose target is a stored
// save point, and all of it survives a new start of the app. Run with the real packages on synthetic folders.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createEngineService } from '../main/engine-service.js';
import type { EngineService } from '../main/engine-service.js';
import type { Ask } from '../main/engine-consent.js';
import { applySaveWith, planSave as packagePlanSave } from '../../../packages/adoption/src/save.js';
import { loadDefinition } from '../../../packages/harness-definition/src/index.js';
import { harnessStateDirs } from '../../../packages/project-sync/src/harness-state.js';
import type { Answer, FolderInfo, ProjectAnswer, ProjectInput, SaveEdit } from '../shared/engine/types.js';
import { ENGINE_ARITY, ENGINE_CALLS } from '../shared/engine/types.js';
import { tempDir } from './support.js';
import { definedFolder, engineFolder, filesOf, homeFolder, sourceFolder, teamFolder } from './helpers-engine/folders.js';

const WHEN = new Date('2026-10-30T12:00:00Z');
const value = <T>(a: Answer<T> | null): T => { assert.ok(a !== null, 'an answer'); if (!a.ok) assert.fail(`refused: ${a.refusal.code} ${a.refusal.message}`); return a.value; };
const refusal = <T>(a: Answer<T>): { code: string; message: string; paths: readonly string[] } => { assert.equal(a.ok, false, 'a refusal'); return (a as Extract<Answer<T>, { ok: false }>).refusal; };
const stateRootOf = (home: string): string => join(home, '.local', 'state', 'bowerloom');

interface Setup { home: string; service: EngineService; asks: Ask[]; say(yes: boolean): void; pick(dir: string | null): void; restart(): void }
function setup(t: test.TestContext): Setup {
  const home = homeFolder(tempDir(t, 'bowerloom-save-'));
  let next: string | null = null, yes = true;
  const asks: Ask[] = [];
  const make = (): EngineService => createEngineService({ home, stateRoot: stateRootOf(home), chooseFolder: async () => next, confirm: async ask => { asks.push(ask); return yes; }, who: 'tester', now: () => WHEN });
  const s: Setup = { home, service: make(), asks, say: v => { yes = v; }, pick: dir => { next = dir; }, restart: () => { s.service = make(); } };
  return s;
}
async function choose(s: Setup, dir: string): Promise<FolderInfo> { s.pick(dir); return value(await s.service.chooseFolder()); }
const LINK: SaveEdit[] = [{ kind: 'set-agent', id: 'reader', skills: ['outline'] }];
const read = (dir: string, rel: string): string => readFileSync(join(dir, '.bowerloom', rel), 'utf8');

test('the calls of the save step are listed with their argument counts, so the preload and the handler register them', () => {
  for (const call of ['planSave', 'runSave', 'listVersions', 'planRestore', 'runRestore'] as const) assert.ok((ENGINE_CALLS as readonly string[]).includes(call), call);
  assert.deepEqual([ENGINE_ARITY.planSave, ENGINE_ARITY.runSave, ENGINE_ARITY.listVersions, ENGINE_ARITY.planRestore, ENGINE_ARITY.runRestore], [2, 3, 1, 2, 3]);
});

test('a save plan with no edits reads the folder\'s harness for the editor: skills, agents and the skills each uses; it writes nothing and names no absolute path', async t => {
  const s = setup(t);
  const dir = teamFolder(s.home), before = filesOf(dir);
  const f = await choose(s, dir);
  const view = value(await s.service.planSave(f.id, []));
  assert.equal(view.noop, true);
  assert.deepEqual(view.changes, []);
  assert.equal(view.folder, '~/Projects/team');
  assert.deepEqual(view.definition.engines, ['claude-code', 'codex']);
  assert.deepEqual(view.definition.skills.map(x => x.id), ['outline', 'review']);
  assert.deepEqual(view.definition.agents.map(a => [a.id, a.skills]), [['reader', []], ['writer', ['review']]]);
  assert.equal(view.definition.instructions, true);
  assert.match(view.revision, /^[a-f0-9]{64}$/);
  assert.deepEqual(filesOf(dir), before);
  assert.equal(JSON.stringify(view).includes(s.home), false);
});

test('linking a skill to an agent is a set-agent edit: the plan lists the one agent file, the write asks in main\'s own words, saves, and keeps two save points', async t => {
  const s = setup(t);
  const dir = teamFolder(s.home);
  const f = await choose(s, dir);
  const plan = value(await s.service.planSave(f.id, LINK));
  assert.deepEqual(plan.changes, [{ path: '.bowerloom/agents/reader.md', action: 'update' }]);
  assert.equal(plan.noop, false);
  assert.deepEqual(plan.definition.agents.find(a => a.id === 'reader')!.skills, ['outline']);
  // Planning wrote nothing, and kept no save point.
  assert.doesNotMatch(read(dir, 'agents/reader.md'), /outline/);
  assert.deepEqual(value(await s.service.listVersions(f.id)), []);

  const done = value(await s.service.runSave(f.id, plan.revision, LINK));
  assert.deepEqual(done.written, ['.bowerloom/agents/reader.md']);
  assert.match(read(dir, 'agents/reader.md'), /skills:\n {2}- outline\n/);
  assert.equal(s.asks.length, 1);
  assert.equal(s.asks[0]!.title, 'Save the harness');
  assert.match(s.asks[0]!.message, /1 file in ~\/Projects\/team\/\.bowerloom/);
  assert.match(s.asks[0]!.detail, new RegExp(plan.revision.slice(0, 8)));
  assert.equal(JSON.stringify(s.asks).includes(s.home), false);

  const versions = value(await s.service.listVersions(f.id));
  assert.deepEqual(versions.map(v => [v.id, v.current]), [['v2', true], ['v1', false]]);
  assert.equal(done.version, 'v2');
  assert.match(versions[1]!.label, /as it was/i);
  assert.equal(versions[0]!.created, '2026-10-30T12:00:00Z');
  // A second save adds one save point: the first one already holds the state before it.
  const again: SaveEdit[] = [{ kind: 'set-agent', id: 'writer', skills: [] }];
  const plan2 = value(await s.service.planSave(f.id, again));
  value(await s.service.runSave(f.id, plan2.revision, again));
  assert.deepEqual(value(await s.service.listVersions(f.id)).map(v => v.id), ['v3', 'v2', 'v1']);
});

test('a save writes only the plan shown last with the same edits; a "no" in main\'s dialog writes nothing and keeps no save point', async t => {
  const s = setup(t);
  const dir = teamFolder(s.home), before = filesOf(dir);
  const f = await choose(s, dir);
  // No plan shown yet.
  assert.equal(refusal(await s.service.runSave(f.id, 'a'.repeat(64), LINK)).code, 'NOT_THE_PLAN_SHOWN');
  const plan = value(await s.service.planSave(f.id, LINK));
  // Other edits, another revision, and an earlier plan replaced by a later one are all refused.
  assert.equal(refusal(await s.service.runSave(f.id, plan.revision, [{ kind: 'set-agent', id: 'reader', skills: ['review'] }])).code, 'NOT_THE_PLAN_SHOWN');
  assert.equal(refusal(await s.service.runSave(f.id, 'b'.repeat(64), LINK)).code, 'NOT_THE_PLAN_SHOWN');
  value(await s.service.planSave(f.id, []));
  assert.equal(refusal(await s.service.runSave(f.id, plan.revision, LINK)).code, 'NOT_THE_PLAN_SHOWN');
  assert.equal(s.asks.length, 0);
  // Cancel: the person said no.
  const shown = value(await s.service.planSave(f.id, LINK));
  s.say(false);
  assert.equal(refusal(await s.service.runSave(f.id, shown.revision, LINK)).code, 'CANCELLED');
  assert.deepEqual(filesOf(dir), before);
  assert.deepEqual(value(await s.service.listVersions(f.id)), []);
  // As for every other write, the plan stays the one shown: a second try asks again in main's dialog, and only a yes writes.
  s.say(true);
  value(await s.service.runSave(f.id, shown.revision, LINK));
  assert.equal(s.asks.length, 2);
  assert.equal(refusal(await s.service.runSave(f.id, shown.revision, LINK)).code, 'NOT_THE_PLAN_SHOWN');
});

test('edits are a closed list of ids: a path, file text, bytes, an unknown kind or key, a bad id, and too many edits are refused before anything runs', async t => {
  const s = setup(t);
  const f = await choose(s, teamFolder(s.home));
  const bad: unknown[] = [
    null, 'edits', {}, [null], [{}], [{ kind: 'set-skill', id: 'review', text: 'x' }], [{ kind: 'set-instructions', text: 'x' }],
    [{ kind: 'set-agent', id: 'reader', skills: ['outline'], path: '../x' }], [{ kind: 'set-agent', id: '../reader', skills: [] }], [{ kind: 'set-agent', id: 'reader', skills: ['a/b'] }],
    [{ kind: 'set-agent', id: 'reader', skills: ['outline', 'outline'] }], [{ kind: 'set-agent', id: 'reader', skills: 'outline' }], [{ kind: 'set-agent', id: 'reader', skills: [], tools: ['read'] }],
    [{ kind: 'remove-skill', id: 'review', bytes: [1, 2] }], [{ kind: 'add-skill', id: 'review', from: '/etc' }], [{ kind: 'add-skill', id: 'review', from: 'folder-1', text: 'x' }],
    [{ kind: 'set-engines', engines: [] }], [{ kind: 'set-engines', engines: ['claude-code', 'claude-code'] }], [{ kind: 'set-engines', engines: ['hermes'] }],
    [{ kind: 'set-engines', engines: [{ id: 'codex', version: '1' }] }],
    Array.from({ length: 201 }, () => ({ kind: 'remove-skill', id: 'review' })),
  ];
  for (const edits of bad) await assert.rejects(s.service.planSave(f.id, edits), /BAD_ARGUMENT/, JSON.stringify(edits)?.slice(0, 80));
  await assert.rejects(s.service.runSave(f.id, 'not-a-revision', LINK), /BAD_ARGUMENT/);
  await assert.rejects(s.service.runSave(f.id, 'a'.repeat(64), [{ kind: 'nope' }]), /BAD_ARGUMENT/);
  await assert.rejects(s.service.planSave('folder-99', []), /UNKNOWN_FOLDER/);
  await assert.rejects(s.service.planSave(s.home, []), /BAD_ARGUMENT/);
  await assert.rejects(s.service.listVersions('../x'), /BAD_ARGUMENT/);
  await assert.rejects(s.service.planRestore(f.id, '../v1'), /BAD_ARGUMENT/);
  await assert.rejects(s.service.runRestore(f.id, 'a'.repeat(64), 'v0'), /BAD_ARGUMENT/);
});

test('an edit the harness refuses comes back as a refusal with the package\'s words, and a folder with no harness yet is refused with words', async t => {
  const s = setup(t);
  const f = await choose(s, teamFolder(s.home));
  const unknown = refusal(await s.service.planSave(f.id, [{ kind: 'set-agent', id: 'nobody', skills: [] }]));
  assert.equal(unknown.code, 'EDIT_UNKNOWN_ID');
  assert.match(unknown.message, /no agent/);
  const missingSkill = refusal(await s.service.planSave(f.id, [{ kind: 'set-agent', id: 'reader', skills: ['ghost'] }]));
  assert.equal(missingSkill.code, 'EDIT_UNKNOWN_ID');
  const empty = await choose(s, engineFolder(s.home));
  const none = refusal(await s.service.planSave(empty.id, []));
  assert.equal(none.code, 'SAVE_NO_DEFINITION');
  assert.match(none.message, /no harness yet/);
  assert.match(none.message, /Nothing was written/);
  assert.equal(refusal(await s.service.listVersions(empty.id)).code, 'SAVE_NO_DEFINITION');
});

test('add-skill copies a whole skill from another chosen folder: main reads it there again, with its script and execute bit; an unknown source is refused', async t => {
  const s = setup(t);
  const dir = teamFolder(s.home);
  const f = await choose(s, dir), src = await choose(s, sourceFolder(s.home));
  const edits: SaveEdit[] = [{ kind: 'add-skill', id: 'summarize', from: src.id }, { kind: 'set-agent', id: 'reader', skills: ['summarize'] }];
  const plan = value(await s.service.planSave(f.id, edits));
  assert.deepEqual(plan.changes.map(c => [c.path, c.action]), [
    ['.bowerloom/agents/reader.md', 'update'], ['.bowerloom/skills/summarize/SKILL.md', 'create'], ['.bowerloom/skills/summarize/scripts/count.sh', 'create'],
  ]);
  value(await s.service.runSave(f.id, plan.revision, edits));
  assert.match(read(dir, 'skills/summarize/SKILL.md'), /Summarizes a page/);
  const loaded = loadDefinition(join(dir, '.bowerloom'));
  assert.ok(loaded.ok);
  assert.deepEqual(loaded.definition.entries.skills.find(x => x.id === 'summarize')!.executable, ['scripts/count.sh']);
  const ghost = refusal(await s.service.planSave(f.id, [{ kind: 'add-skill', id: 'ghost', from: src.id }]));
  assert.equal(ghost.code, 'SAVE_SOURCE_MISSING');
  await assert.rejects(s.service.planSave(f.id, [{ kind: 'add-skill', id: 'summarize', from: 'folder-99' }]), /UNKNOWN_FOLDER/);
});

test('a skill copied from another folder is scanned for secrets in main: a secret value is refused, and nothing is written', async t => {
  const s = setup(t);
  const dir = teamFolder(s.home), before = filesOf(dir);
  const f = await choose(s, dir);
  const srcDir = sourceFolder(s.home);
  const src = await choose(s, srcDir);
  // The source changes after it was chosen: its skill now holds a key. Main reads it again at plan time and finds it.
  writeFileSync(join(srcDir, '.bowerloom/skills/summarize/SKILL.md'), '---\nname: summarize\ndescription: Summarizes a page.\n---\n\nUse the key ' + 'sk-' + 'ant-' + 'A1b2C3d4'.repeat(10) + ' to call.\n');
  const r = refusal(await s.service.planSave(f.id, [{ kind: 'add-skill', id: 'summarize', from: src.id }]));
  assert.equal(r.code, 'SAVE_SECRET_FOUND');
  assert.match(r.message, /secret/);
  assert.equal(JSON.stringify(r).includes('A1b2C3d4'), false);
  assert.deepEqual(filesOf(dir), before);
});

test('set-engines keeps the version of an engine that stays, and drops an engine that goes', async t => {
  const s = setup(t);
  const dir = teamFolder(s.home);
  const f = await choose(s, dir);
  const edits: SaveEdit[] = [{ kind: 'set-engines', engines: ['claude-code'] }];
  const plan = value(await s.service.planSave(f.id, edits));
  assert.deepEqual(plan.changes, [{ path: '.bowerloom/harness.json', action: 'update' }]);
  value(await s.service.runSave(f.id, plan.revision, edits));
  assert.deepEqual(JSON.parse(read(dir, 'harness.json')).engines, [{ id: 'claude-code', version: '2.1.310' }]);
});

test('Go back: a save whose target is a stored save point; it is planned, shown, confirmed in its own words, and recorded as a new save point', async t => {
  const s = setup(t);
  const dir = teamFolder(s.home), before = filesOf(dir);
  const f = await choose(s, dir);
  const plan = value(await s.service.planSave(f.id, LINK));
  value(await s.service.runSave(f.id, plan.revision, LINK));
  assert.notDeepEqual(filesOf(dir), before);

  const back = value(await s.service.planRestore(f.id, 'v1'));
  assert.equal(back.version.id, 'v1');
  assert.deepEqual(back.changes, [{ path: '.bowerloom/agents/reader.md', action: 'update' }]);
  assert.deepEqual(back.definition.agents.find(a => a.id === 'reader')!.skills, []);
  // Only the plan shown last, for the same save point.
  assert.equal(refusal(await s.service.runRestore(f.id, back.revision, 'v2')).code, 'NOT_THE_PLAN_SHOWN');
  const shown = value(await s.service.planRestore(f.id, 'v1'));
  s.say(false);
  assert.equal(refusal(await s.service.runRestore(f.id, shown.revision, 'v1')).code, 'CANCELLED');
  s.say(true);
  const again = value(await s.service.planRestore(f.id, 'v1'));
  const done = value(await s.service.runRestore(f.id, again.revision, 'v1'));
  assert.deepEqual(done.written, ['.bowerloom/agents/reader.md']);
  assert.deepEqual(filesOf(dir), before);
  const last = s.asks[s.asks.length - 1]!;
  assert.equal(last.title, 'Go back to a save point');
  assert.match(last.message, /v1/);
  const versions = value(await s.service.listVersions(f.id));
  assert.deepEqual(versions.map(v => [v.id, v.current]), [['v3', true], ['v2', false], ['v1', true]]);
  assert.match(versions[0]!.label, /v1/);
  // An unknown save point is a refusal with words.
  const unknown = refusal(await s.service.planRestore(f.id, 'v9'));
  assert.equal(unknown.code, 'VERSION_UNKNOWN');
  assert.ok(unknown.message.length > 10);
});

test('save points survive a new start of the app: a new service lists them and can go back', async t => {
  const s = setup(t);
  const dir = teamFolder(s.home), before = filesOf(dir);
  const f = await choose(s, dir);
  const plan = value(await s.service.planSave(f.id, LINK));
  value(await s.service.runSave(f.id, plan.revision, LINK));
  s.restart();
  const again = await choose(s, dir);
  assert.deepEqual(value(await s.service.listVersions(again.id)).map(v => v.id), ['v2', 'v1']);
  const back = value(await s.service.planRestore(again.id, 'v1'));
  value(await s.service.runRestore(again.id, back.revision, 'v1'));
  assert.deepEqual(filesOf(dir), before);
});

test('a damaged save point record is a refusal with words, never an empty list, and a save does not run without a way back', async t => {
  const s = setup(t);
  const dir = teamFolder(s.home), before = filesOf(dir);
  const f = await choose(s, dir);
  const dirs = harnessStateDirs(stateRootOf(s.home), dir);
  mkdirSync(join(dirs.base, 'versions'), { recursive: true, mode: 0o700 });
  chmodSync(dirs.base, 0o700);
  writeFileSync(join(dirs.base, 'versions', 'index.json'), '{ not json', { mode: 0o600 });
  const r = refusal(await s.service.listVersions(f.id));
  assert.equal(r.code, 'VERSION_CORRUPT');
  assert.match(r.message, /damaged/);
  const plan = value(await s.service.planSave(f.id, LINK));
  assert.equal(refusal(await s.service.runSave(f.id, plan.revision, LINK)).code, 'VERSION_CORRUPT');
  assert.deepEqual(filesOf(dir), before);
});

test('a folder changed by hand between saves gets a new "as it was" save point first, so Go back reaches the hand-made state too', async t => {
  const s = setup(t);
  const dir = teamFolder(s.home);
  const f = await choose(s, dir);
  const plan = value(await s.service.planSave(f.id, LINK));
  value(await s.service.runSave(f.id, plan.revision, LINK));
  writeFileSync(join(dir, '.bowerloom/instructions/AGENTS.md'), '# Team\n\nUse pnpm.\n');
  const edits: SaveEdit[] = [{ kind: 'set-agent', id: 'writer', skills: [] }];
  const next = value(await s.service.planSave(f.id, edits));
  value(await s.service.runSave(f.id, next.revision, edits));
  const versions = value(await s.service.listVersions(f.id));
  assert.deepEqual(versions.map(v => v.id), ['v4', 'v3', 'v2', 'v1']);
  assert.match(versions[1]!.label, /as it was/i);
});

test('after a save the install plan shown before is gone, and the save itself writes no interface file; install stays its own step', async t => {
  const s = setup(t);
  const dir = teamFolder(s.home);
  const f = await choose(s, dir);
  const input: ProjectInput = { engines: ['claude-code', 'codex'], reconcile: 'accept-agents', writeClaudeMd: false, approve: [] };
  const install = value(await s.service.planProjection(f.id, input)) as Extract<ProjectAnswer, { kind: 'plan' }>;
  assert.equal(install.kind, 'plan');
  const plan = value(await s.service.planSave(f.id, LINK));
  value(await s.service.runSave(f.id, plan.revision, LINK));
  assert.equal(existsSync(join(dir, 'AGENTS.md')), false);
  assert.equal(existsSync(join(dir, '.claude')), false);
  assert.equal(refusal(await s.service.runProjection(f.id, install.plan.revision, input)).code, 'NOT_THE_PLAN_SHOWN');
  // A new install plan carries the saved link.
  const fresh = value(await s.service.planProjection(f.id, input)) as Extract<ProjectAnswer, { kind: 'plan' }>;
  value(await s.service.runProjection(f.id, fresh.plan.revision, input));
  assert.match(readFileSync(join(dir, '.claude/agents/reader.md'), 'utf8'), /outline/);
});

/**
 * Leaves a save stopped part way: the package's own journal, as a killed process would leave it. The save changes two files and stops after the first, so
 * the recovery takes it back. (A save that wrote every file is kept by the recovery instead: engine-save-review.test.ts.)
 */
async function stopASave(s: Setup, dir: string): Promise<void> {
  const dirs = harnessStateDirs(stateRootOf(s.home), dir);
  const loaded = loadDefinition(join(dir, '.bowerloom'));
  assert.ok(loaded.ok);
  const edit = (file: { path: string; bytes: Uint8Array }, from: string, to: string): Buffer => Buffer.from(Buffer.from(file.bytes).toString('utf8').replace(from, to));
  const target = loaded.definition.files.map(file => (file.path === 'agents/reader.md' ? { ...file, bytes: edit(file, 'Read the sources.', 'Read every source.') }
    : file.path === 'agents/writer.md' ? { ...file, bytes: edit(file, 'Write the draft.', 'Write every draft.') } : file));
  const io = { projectDir: dir, stateDir: dirs.adoption };
  const plan = packagePlanSave(io, target);
  await assert.rejects(applySaveWith(io, plan.revision, target, new AbortController().signal, { afterWrite: rel => { if (rel === 'agents/reader.md') throw Object.assign(new Error('killed'), { crash: true }); } }), /killed/);
}

test('while a save is stopped, install, removal, adoption, merge and save are refused with words, and the folder offers its recovery, which takes the save back', async t => {
  const s = setup(t);
  const dir = teamFolder(s.home), before = filesOf(dir);
  const f = await choose(s, dir);
  await stopASave(s, dir);
  assert.notDeepEqual(filesOf(dir), before);
  const info = (await s.service.folders()).find(x => x.id === f.id)!;
  assert.equal(info.unfinished.adoption, true);
  const input: ProjectInput = { engines: ['claude-code'], reconcile: 'accept-agents', writeClaudeMd: false, approve: [] };
  for (const a of [
    await s.service.planProjection(f.id, input), await s.service.runProjection(f.id, 'a'.repeat(64), input), await s.service.planRemoval(f.id), await s.service.runRemoval(f.id, 'a'.repeat(64)),
    await s.service.planMerge(f.id), await s.service.runMerge(f.id, 'a'.repeat(64)), await s.service.planSave(f.id, []), await s.service.planRestore(f.id, 'v1'),
  ]) {
    const r = refusal(a as Answer<unknown>);
    assert.equal(r.code, 'SAVE_RECOVERY_REQUIRED', r.message);
    assert.match(r.message, /Recover it first/);
  }
  const other = await choose(s, engineFolder(s.home));
  assert.equal(value(await s.service.planAdoption(other.id, { picks: {}, acknowledged: [] })).folder, '~/Projects/adopt-me');
  // The recovery of the stopped harness is the save's: it puts the files back.
  const recovery = value(await s.service.planAdoptionRecovery(f.id));
  assert.equal(recovery.kind, 'save');
  assert.equal(recovery.journal, 'ok');
  assert.deepEqual(recovery.restore, ['.bowerloom/agents/reader.md']);
  value(await s.service.runAdoptionRecovery(f.id, recovery.revision));
  assert.deepEqual(filesOf(dir), before);
  assert.equal((await s.service.folders()).find(x => x.id === f.id)!.unfinished.adoption, false);
  value(await s.service.planSave(f.id, []));
});

test('an adoption is refused while a save of the same folder is stopped', async t => {
  const s = setup(t);
  const dir = definedFolder(s.home);
  const f = await choose(s, dir);
  const dirs = harnessStateDirs(stateRootOf(s.home), dir);
  mkdirSync(dirs.adoption, { recursive: true, mode: 0o700 });
  writeFileSync(join(dirs.adoption, 'save-pending.json'), '{}', { mode: 0o600 });
  const adopt = refusal(await s.service.planAdoption(f.id, { picks: {}, acknowledged: [] }));
  assert.equal(adopt.code, 'SAVE_RECOVERY_REQUIRED');
  assert.equal(refusal(await s.service.runAdoption(f.id, 'a'.repeat(64), { picks: {}, acknowledged: [] }, [])).code, 'SAVE_RECOVERY_REQUIRED');
});
