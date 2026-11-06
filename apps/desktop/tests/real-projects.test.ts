// The Projects list on the person's own folders (beta.2): each row comes from a project the read found or a folder main knows, and its button follows the folder's real state.
// These tests hold the rules apart from the screen: which rows exist, what each row says, which button it gets, and what the sheet it opens is told.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkOf, checkStatus, planInput, planStatus, projectRows, sameFolder } from '../shared/harness/real-projects.js';
import type { PlanStatus } from '../shared/harness/real-projects.js';
import type { Answer, FolderInfo, ProjectAnswer, ProjectView } from '../shared/engine/types.js';
import type { HarnessPlace, Project } from '../shared/harness/types.js';

const folder = (over: Partial<FolderInfo> = {}): FolderInfo => ({
  id: 'folder-1', label: '~/Projects/alpha', name: 'alpha', hasDefinition: true, engines: ['claude-code', 'codex'], previewEngines: false, installedEngines: [], problem: null, projected: false,
  unfinished: { projection: false, adoption: false }, ...over,
});
const project = (path: string, id = 'p1', name = 'alpha'): Project => ({ id, name, path });
const view = (over: Partial<ProjectView> = {}): ProjectView => ({
  folder: '~/Projects/alpha', harness: 'alpha', engines: [], partial: false, notice: null, trust: [], review: [], drift: null, reconcile: null, driftLines: [], approved: [], changes: [], takenOver: [],
  offers: [], ignored: [], pendingTrust: [], filterLeaks: [], skippedPreview: [], keptPreview: [], previewNotice: null, noop: true, revision: 'r', ...over,
});
const planOf = (v: ProjectView): Answer<ProjectAnswer> => ({ ok: true, value: { kind: 'plan', plan: v } });
const place = (label: string): HarnessPlace => ({ id: 'h1', name: 'alpha', label, readable: true, engines: ['Claude Code'], parts: [], links: [] });
const none = new Map<string, PlanStatus>();
const none_ = (): Map<string, PlanStatus> => new Map();

test('sameFolder: one encoding on both sides, compared exactly; a cut path matches a folder outside home by the cut form of its clean label', () => {
  assert.equal(sameFolder('~/Projects/alpha', '~/Projects/alpha'), true);
  assert.equal(sameFolder('~/Projects/alpha', '~/Projects/beta'), false);
  assert.equal(sameFolder('…/shared', '…/shared'), true);
  assert.equal(sameFolder('…/shared', '~/shared'), false);
  assert.equal(sameFolder('…/shared', '/Volumes/disk/shared'), true);
  assert.equal(sameFolder('…/shared', '/Volumes/disk/other'), false);
  assert.equal(sameFolder('~/Projects/a b', '~/Projects/a[U+200B]b'), false, 'two encodings are never translated');
});

test('planStatus: a plan with nothing to change is current; changes are an update; a changed or missing file Bowerloom wrote, a refusal and lines to approve are a review', () => {
  assert.equal(planStatus(planOf(view({ noop: true }))), 'current');
  assert.equal(planStatus(planOf(view({ noop: false, changes: [{ path: 'AGENTS.md', action: 'update', engines: ['codex'] }] }))), 'update');
  assert.equal(planStatus(planOf(view({ noop: false, driftLines: [{ path: 'AGENTS.md', reason: 'changed' }] }))), 'review');
  assert.equal(planStatus({ ok: false, refusal: { code: 'PORTABLE_DRIFT', message: 'A file changed.', paths: [] } }), 'review');
  assert.equal(planStatus({ ok: true, value: { kind: 'approve', lines: [], approvedSoFar: [] } }), 'update');
});

test('planInput: plans the installed engines without the locked preview ones, keeps the files of the person, and asks for no approval', () => {
  const both = planInput(folder({ installedEngines: ['claude-code', 'codex'] }));
  assert.deepEqual(both, { engines: ['claude-code', 'codex'], reconcile: 'keep-both', writeClaudeMd: false, approve: [] });
  assert.deepEqual(planInput(folder({ engines: ['claude-code', 'pi'], installedEngines: ['pi'] }))?.engines, ['claude-code']);
  assert.deepEqual(planInput(folder({ engines: ['claude-code', 'pi'], installedEngines: ['pi'], previewEngines: true }))?.engines, ['pi']);
  assert.equal(planInput(folder({ engines: [], installedEngines: [] })), null);
});

test('an installed folder with no engine to plan for reads Not checked, never installed', () => {
  const [row] = projectRows({ projects: [project('~/Projects/alpha')] }, [folder({ projected: true, engines: [], installedEngines: [] })], none);
  assert.deepEqual([row?.status, row?.state, row?.action], ['not-checked', null, null]);
});

test('checkStatus: an answer is its status; a plan that never answers, throws (at once or later) or answers badly is a failed check, never a thrown error', async () => {
  assert.deepEqual(await checkStatus(async () => planOf(view({ noop: true })), 1000), { status: 'current', reason: null });
  const failed = { status: 'failed', reason: null };
  assert.deepEqual(await checkStatus(() => new Promise<never>(() => undefined), 20), failed);
  assert.deepEqual(await checkStatus(async () => { throw new Error('FAILED'); }, 1000), failed);
  assert.deepEqual(await checkStatus((() => { throw new Error('at once'); }) as () => Promise<Answer<ProjectAnswer>>, 1000), failed);
  assert.deepEqual(await checkStatus(async () => ({ ok: true, value: undefined }) as unknown as Answer<ProjectAnswer>, 1000), failed);
  assert.deepEqual(await checkStatus(async () => undefined as unknown as Answer<ProjectAnswer>, 1000), failed);
});

test('a refusal other than changed files is a failed check; changed files are a review', () => {
  assert.equal(planStatus({ ok: false, refusal: { code: 'FAILED', message: 'x', paths: [] } }), 'failed');
  assert.equal(planStatus({ ok: false, refusal: { code: 'PORTABLE_DRIFT', message: 'x', paths: [] } }), 'review');
});

test('a failed check is a Review that says it could not check; a stale folder list claims nothing about an install', () => {
  const installed = folder({ projected: true, installedEngines: ['claude-code', 'codex'] });
  const [failed] = projectRows({ projects: [project('~/Projects/alpha')] }, [installed], new Map([['folder-1', 'failed' as const]]));
  assert.deepEqual([failed?.state, failed?.action, failed?.checkFailed], ['conflict', 'review', true]);
  const [ok] = projectRows({ projects: [project('~/Projects/alpha')] }, [installed], new Map([['folder-1', 'review' as const]]));
  assert.equal(ok?.checkFailed, false);
  // The list could not be read again: what it held may be old, so the row says "Not checked" and keeps its way into the sheet, which reads the folder itself.
  const [stale] = projectRows({ projects: [project('~/Projects/alpha')] }, [installed], new Map([['folder-1', 'current' as const]]), true);
  assert.deepEqual([stale?.status, stale?.state, stale?.engines.length, stale?.action, stale?.folderId], ['not-checked', null, 0, 'install', 'folder-1']);
  const [bare] = projectRows({ projects: [project('~/Projects/alpha')] }, [folder({ hasDefinition: false })], none_(), true);
  assert.deepEqual([bare?.status, bare?.action], ['not-checked', 'assign']);
});


test('a harness that does not load, or a stopped run, carries its reason for the row to say', () => {
  const [broken] = projectRows({ projects: [project('~/Projects/alpha')] }, [folder({ problem: 'The harness file is not valid.' })], none);
  assert.deepEqual([broken?.problem, broken?.stopped], ['The harness file is not valid.', null]);
  const [stopped] = projectRows({ projects: [project('~/Projects/alpha')] }, [folder({ projected: true, unfinished: { projection: true, adoption: false } })], none);
  assert.deepEqual([stopped?.problem, stopped?.stopped], [null, 'install']);
  const [adopt] = projectRows({ projects: [project('~/Projects/alpha')] }, [folder({ unfinished: { projection: false, adoption: true } })], none);
  assert.equal(adopt?.stopped, 'make');
});

test('rows outside home pair with a folder only when no other row or folder shares the last name', () => {
  const outside = (id: string, label: string): FolderInfo => folder({ id, label, name: 'x' });
  const one = projectRows({ projects: [project('…/x', 'p1', 'x')] }, [outside('f1', '/Volumes/a/x')], none);
  assert.deepEqual(one.map(r => [r.id, r.folderId]), [['p1', 'f1']]);
  // Two folders with the name: neither is attached to the row, and each is a row of its own.
  const twoFolders = projectRows({ projects: [project('…/x', 'p1', 'x')] }, [outside('f1', '/Volumes/a/x'), outside('f2', '/Volumes/b/x')], none);
  assert.deepEqual(twoFolders.map(r => [r.id, r.folderId]), [['p1', null], ['f1', 'f1'], ['f2', 'f2']]);
  // Two rows with the name: the folder is not attached to either.
  const twoRows = projectRows({ projects: [project('…/x', 'p1', 'x'), project('…/x', 'p2', 'x')] }, [outside('f1', '/Volumes/a/x')], none);
  assert.deepEqual(twoRows.map(r => [r.id, r.folderId]), [['p1', null], ['p2', null], ['f1', 'f1']]);
  // A folder under home is never the row outside it.
  const home = projectRows({ projects: [project('…/x', 'p1', 'x')] }, [folder({ id: 'f1', label: '~/x', name: 'x' })], none);
  assert.deepEqual(home.map(r => [r.id, r.folderId]), [['p1', null], ['f1', 'f1']]);
});

test('a project with no harness gets Assign harness, and no state', () => {
  const [row] = projectRows({ projects: [project('~/Projects/alpha')] }, [], none);
  assert.equal(row?.hasHarness, false);
  assert.equal(row?.action, 'assign');
  assert.equal(row?.state, null);
  assert.deepEqual(row?.engines, []);
});

test('a project whose folder holds a harness that the read found, and main does not know yet, gets Install and says nothing about its state', () => {
  const [row] = projectRows({ projects: [project('~/Projects/alpha')], harnessPlaces: [place('~/Projects/alpha')] }, [], none);
  assert.equal(row?.hasHarness, true);
  assert.equal(row?.action, 'install');
  assert.equal(row?.state, null);
  assert.equal(row?.folderId, null);
});

test('a known folder with a harness and no earlier install is not installed: Install, with one dot for each engine', () => {
  const [row] = projectRows({ projects: [project('~/Projects/alpha')] }, [folder()], none);
  assert.equal(row?.folderId, 'folder-1');
  assert.equal(row?.state, 'not-installed');
  assert.equal(row?.action, 'install');
  assert.deepEqual(row?.engines, [{ id: 'claude-code', name: 'Claude Code', state: 'not-installed' }, { id: 'codex', name: 'Codex', state: 'not-installed' }]);
});

test('an installed folder follows its plan: current has no button, an update gets Update, a review gets Review', () => {
  const installed = folder({ projected: true, installedEngines: ['claude-code', 'codex'] });
  const rows = (s: PlanStatus | undefined) => projectRows({ projects: [project('~/Projects/alpha')] }, [installed], s === undefined ? none : new Map([['folder-1', s]]));
  assert.deepEqual([rows('current')[0]?.state, rows('current')[0]?.action], ['installed', null]);
  assert.deepEqual([rows('update')[0]?.state, rows('update')[0]?.action], ['out-of-date', 'update']);
  assert.deepEqual([rows('review')[0]?.state, rows('review')[0]?.action], ['conflict', 'review']);
  // Before the plan has answered, nothing is claimed: the row is checking, with no state, no dots and no button.
  const pending = rows(undefined)[0];
  assert.deepEqual([pending?.status, pending?.state, pending?.action, pending?.engines.length], ['checking', null, null, 0]);
  assert.equal(rows('current')[0]?.status, 'known');
  assert.deepEqual(rows('update')[0]?.engines.map(e => e.state), ['out-of-date', 'out-of-date']);
});

test('an engine the harness lists and the install never covered shows as not installed beside the ones that are', () => {
  const half = folder({ projected: true, installedEngines: ['claude-code'] });
  const [row] = projectRows({ projects: [project('~/Projects/alpha')] }, [half], new Map([['folder-1', 'update' as const]]));
  assert.deepEqual(row?.engines.map(e => [e.id, e.state]), [['claude-code', 'out-of-date'], ['codex', 'not-installed']]);
});

test('a locked preview engine that is not installed is left out of the dots', () => {
  const [row] = projectRows({ projects: [project('~/Projects/alpha')] }, [folder({ engines: ['claude-code', 'pi'] })], none);
  assert.deepEqual(row?.engines.map(e => e.id), ['claude-code']);
});

test('a stopped install is a review that opens the recovery plan; a stopped adoption opens the sheet that makes the harness', () => {
  const [stoppedInstall] = projectRows({ projects: [project('~/Projects/alpha')] }, [folder({ projected: true, unfinished: { projection: true, adoption: false } })], none);
  assert.deepEqual([stoppedInstall?.state, stoppedInstall?.action, stoppedInstall?.opens], ['conflict', 'review', 'recover']);
  const [stoppedAdopt] = projectRows({ projects: [project('~/Projects/alpha')] }, [folder({ hasDefinition: false, unfinished: { projection: false, adoption: true } })], none);
  assert.deepEqual([stoppedAdopt?.state, stoppedAdopt?.action, stoppedAdopt?.opens], ['conflict', 'review', 'make']);
});

test('a harness that does not load is a review, and the sheet says why', () => {
  const [row] = projectRows({ projects: [project('~/Projects/alpha')] }, [folder({ problem: 'The harness file is not valid.' })], none);
  assert.deepEqual([row?.state, row?.action, row?.opens], ['conflict', 'review', 'install']);
});

test('a folder main knows that no project shows is added as a row of its own, after the projects; one that a project shows is not added twice', () => {
  const rows = projectRows({ projects: [project('~/Projects/alpha')] }, [folder(), folder({ id: 'folder-2', label: '~/Projects/beta', name: 'beta', hasDefinition: false })], none);
  assert.deepEqual(rows.map(r => [r.id, r.name, r.path, r.folderId]), [['p1', 'alpha', '~/Projects/alpha', 'folder-1'], ['folder-2', 'beta', '~/Projects/beta', 'folder-2']]);
  assert.equal(rows[1]?.action, 'assign');
});

test('a folder that holds a harness is found by the read or by main, never twice, and a bad input gives no row and no throw', () => {
  assert.deepEqual(projectRows({ projects: [] }, [], none), []);
  const rows = projectRows({ projects: [project('~/Projects/alpha')], harnessPlaces: [place('~/Projects/alpha')] }, [folder()], none);
  assert.equal(rows.length, 1);
});

test('a refusal of the check keeps its own plain words as the reason, and a timeout or a throw has none (the row then uses the generic words)', () => {
  const conflict = checkOf({ ok: false, refusal: { code: 'PORTABLE_PATH_OCCUPIED', message: 'A folder stands where a file should go.', paths: [] } });
  assert.deepEqual(conflict, { status: 'failed', reason: 'A folder stands where a file should go.' });
  assert.deepEqual(checkOf({ ok: false, refusal: { code: 'PORTABLE_DRIFT', message: 'A file changed.', paths: [] } }), { status: 'review', reason: null });
  const installed = folder({ projected: true, installedEngines: ['claude-code', 'codex'] });
  const [row] = projectRows({ projects: [project('~/Projects/alpha')] }, [installed], new Map([['folder-1', conflict]]));
  assert.deepEqual([row?.checkFailed, row?.checkReason, row?.action], [true, 'A folder stands where a file should go.', 'review']);
  const [generic] = projectRows({ projects: [project('~/Projects/alpha')] }, [installed], new Map([['folder-1', { status: 'failed' as const, reason: null }]]));
  assert.deepEqual([generic?.checkFailed, generic?.checkReason], [true, null]);
});

// ---- one encoding: main sends the window's own (`cleanLabel`), so a name is compared exactly and never translated ----------------------------------------------------------------

/** A folder as main sends it: `label` written out for a person (marks), `cleanLabel` in the encoding the reader gives the window's paths. */
const marked = (id: string, label: string, cleanLabel: string): FolderInfo => folder({ id, label, name: id, cleanLabel });
const pairs = (projectPath: string, folders: readonly FolderInfo[]): [string, string | null][] => projectRows({ projects: [project(projectPath, 'p1', 'p')] }, folders, none).map(r => [r.id, r.folderId]);

test('hidden characters in a name: the row pairs with its folder by the clean label, for a middle, leading, trailing, per-part and mixed-script name', () => {
  const cases: [string, string, string][] = [
    ['~/Projects/wan ted', '~/Projects/wan[U+200B]ted', '~/Projects/wan ted'],
    ['~/Projects/wanted', '~/Projects/[U+200B]wanted', '~/Projects/wanted'],
    ['~/Projects/wanted', '~/Projects/wanted[U+200B]', '~/Projects/wanted'],
    ['~/Projects/wan/x', '~/Projects/wan[U+200B]/x', '~/Projects/wan/x'],
    ['~/Projects/pаypal', '~/Projects/[mixed scripts: Cyrillic+Latin]pаypal', '~/Projects/pаypal'],
  ];
  for (const [path, label, clean] of cases) assert.deepEqual(pairs(path, [marked('f1', label, clean)]), [['p1', 'f1']], label);
  // The cut form pairs the same way, for a leading hidden character and a mixed-script name.
  assert.deepEqual(pairs('…/wanted', [marked('f1', '/Volumes/d/[U+200B]wanted', '/Volumes/d/wanted')]), [['p1', 'f1']]);
  assert.deepEqual(pairs('…/pаypal', [marked('f1', '/Volumes/d/[mixed scripts: Cyrillic+Latin]pаypal', '/Volumes/d/pаypal')]), [['p1', 'f1']]);
  // A different name is not paired.
  assert.deepEqual(pairs('~/Projects/wanted', [marked('f1', '~/Projects/wan[U+200B]ted', '~/Projects/wan ted')]), [['p1', null], ['f1', 'f1']]);
});

test('a lookalike folder is never taken for the project: when two folders clean to one string, the row is unpaired and each folder is a row of its own', () => {
  const real = marked('real', '~/Projects/proj', '~/Projects/proj'), evil = marked('evil', '~/Projects/proj[U+200B]', '~/Projects/proj');
  assert.deepEqual(pairs('~/Projects/proj', [evil, real]), [['p1', null], ['evil', 'evil'], ['real', 'real']]);
  assert.deepEqual(pairs('~/Projects/proj', [real, evil]), [['p1', null], ['real', 'real'], ['evil', 'evil']]);
  // The same holds for a name that holds the mark as typed text.
  const typed = marked('typed', '~/Projects/a[U+200B]b', '~/Projects/a[U+200B]b'), hidden = marked('hidden', '~/Projects/a[U+200B]b', '~/Projects/a b');
  assert.deepEqual(pairs('~/Projects/a[U+200B]b', [hidden, typed]), [['p1', 'typed'], ['hidden', 'hidden']]);
  assert.deepEqual(pairs('~/Projects/a b', [typed, hidden]), [['p1', 'hidden'], ['typed', 'typed']]);
  // Two projects with one path pair with nothing.
  const rows = projectRows({ projects: [project('~/Projects/proj', 'p1'), project('~/Projects/proj', 'p2')] }, [real], none);
  assert.deepEqual(rows.map(r => [r.id, r.folderId]), [['p1', null], ['p2', null], ['real', 'real']]);
  // The harness a read found in a folder is matched the same way: exactly, and only when nothing else shares the path.
  const found = projectRows({ projects: [project('~/Projects/proj')], harnessPlaces: [place('~/Projects/proj'), place('~/Projects/proj')] }, [], none);
  assert.equal(found[0]?.hasHarness, false);
});
