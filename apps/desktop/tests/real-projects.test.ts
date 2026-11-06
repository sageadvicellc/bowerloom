// The Projects list on the person's own folders (beta.2): each row comes from a project the read found or a folder main knows, and its button follows the folder's real state.
// These tests hold the rules apart from the screen: which rows exist, what each row says, which button it gets, and what the sheet it opens is told.
import test from 'node:test';
import assert from 'node:assert/strict';
import { planInput, planStatus, projectRows, sameFolder } from '../shared/harness/real-projects.js';
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

test('sameFolder: a path under home matches only the same label; a cut label matches a folder outside home by its last name', () => {
  assert.equal(sameFolder('~/Projects/alpha', '~/Projects/alpha'), true);
  assert.equal(sameFolder('~/Projects/alpha', '~/Projects/beta'), false);
  assert.equal(sameFolder('…/shared', '…/shared'), true);
  assert.equal(sameFolder('…/shared', '~/shared'), false);
  assert.equal(sameFolder('…/shared', '/Volumes/disk/shared'), true);
  assert.equal(sameFolder('…/shared', '/Volumes/disk/other'), false);
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
  // Before the plan has answered, the receipt is all that is known.
  assert.deepEqual([rows(undefined)[0]?.state, rows(undefined)[0]?.action], ['installed', null]);
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
