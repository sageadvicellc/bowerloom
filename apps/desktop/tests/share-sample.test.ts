// The six share calls of the sample bridge (Task 1 lane D): export and import answered in memory, with the same gates as main. The made-up bundle is held under
// ids, at most two at once; a write names the plan shown last; the acknowledgement is the plan's own; a folder with parts refuses an import; Go back returns the
// folder to the empty harness. Nothing is read and nothing is written.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_FOLDERS, SAMPLE_NOTES, createSampleEngine } from '../shared/engine/sample.js';
import { SHARE_HELD_BUNDLES, SHARE_LIST_LIMIT, SHARE_MAIN_WORDS } from '../shared/engine/types.js';
import type { Answer, BundleView, EngineBridge, ImportNoteChoices, ImportView } from '../shared/engine/types.js';

const value = <T>(a: Answer<T> | null): T => { assert.ok(a !== null); if (!a.ok) assert.fail(`${a.refusal.code}`); return a.value; };
const refusal = <T>(a: Answer<T> | null): { code: string; message: string } => { assert.ok(a !== null && !a.ok, 'a refusal'); return { code: a.refusal.code, message: a.refusal.message }; };
const NONE: ImportNoteChoices = { link: {}, leave: ['yard-wiki'] };
const LINK: ImportNoteChoices = { link: { 'yard-wiki': SAMPLE_NOTES.use }, leave: [] };

async function bundleOf(e: EngineBridge): Promise<BundleView> { return value(await e.chooseBundle()); }

test('the six share calls answer in memory; none is a stub', async () => {
  const e = createSampleEngine();
  for (const call of ['planExport', 'runExport', 'chooseBundle', 'planImport', 'runImport', 'discardBundle'] as const) assert.equal(typeof e[call], 'function', call);
  const b = await bundleOf(e);
  assert.match(b.bundleId, /^bundle-[0-9]+$/);
  assert.equal(b.name, 'rope-yard.bowerloom.json');
  assert.equal(value(await e.planExport(SAMPLE_FOLDERS.defined)).file, 'weekly-report.bowerloom.json');
});

test('export: counts, the notes names that stay home, the files that can run, and the tick for a path of this computer', async () => {
  const e = createSampleEngine();
  const plain = value(await e.planExport(SAMPLE_FOLDERS.defined));
  assert.deepEqual([plain.summary.counts.skills, plain.summary.counts.agents, plain.summary.counts.scripts], [2, 2, 0]);
  assert.equal(plain.acknowledge, null, 'no path of this computer, no tick');
  assert.equal(plain.revision.length, 64);
  assert.equal(JSON.stringify(plain).includes('/home/'), false);
  const withScript = value(await e.planExport(SAMPLE_FOLDERS.stopped));
  assert.deepEqual(withScript.summary.codeFiles.rows, [{ path: 'skills/shelf-check/scripts/shelf-check.sh', why: 'executable' }]);
  assert.equal(withScript.summary.foreignPaths.rows.length, 1);
  assert.equal(withScript.acknowledge?.length, 64);
  assert.equal(JSON.stringify(withScript).includes('knowledge.json'), false, 'knowledge.json never travels');
});

test('export: a folder with no harness is refused in main\'s words, an unknown folder throws, and a write needs the plan and the tick', async () => {
  const e = createSampleEngine();
  const none = refusal(await e.planExport(SAMPLE_FOLDERS.adopt));
  assert.deepEqual(none, { code: 'EXPORT_NO_DEFINITION', message: SHARE_MAIN_WORDS.EXPORT_NO_DEFINITION });
  assert.throws(() => e.planExport('folder-nope'), /UNKNOWN_FOLDER/);
  const plan = value(await e.planExport(SAMPLE_FOLDERS.stopped));
  assert.equal(refusal(await e.runExport(SAMPLE_FOLDERS.stopped, 'f'.repeat(64), plan.acknowledge)).code, 'NOT_THE_PLAN_SHOWN');
  assert.equal(refusal(await e.runExport(SAMPLE_FOLDERS.stopped, plan.revision, null)).code, 'EXPORT_NEEDS_ACKNOWLEDGEMENT');
  assert.equal(refusal(await e.runExport(SAMPLE_FOLDERS.stopped, plan.revision, 'a'.repeat(64))).message, SHARE_MAIN_WORDS.EXPORT_NEEDS_ACKNOWLEDGEMENT);
  const written = value(await e.runExport(SAMPLE_FOLDERS.stopped, plan.revision, plan.acknowledge));
  assert.deepEqual(written, { name: 'reading.bowerloom.json', bytes: plan.bytes });
  // A folder without a path of this computer needs no tick.
  const free = value(await e.planExport(SAMPLE_FOLDERS.defined));
  assert.deepEqual(value(await e.runExport(SAMPLE_FOLDERS.defined, free.revision, null)), { name: free.file, bytes: free.bytes });
});

test('chooseBundle holds at most two bundles, the oldest goes first, and an id that is gone is UNKNOWN_BUNDLE', async () => {
  const e = createSampleEngine();
  const ids: string[] = [];
  for (let i = 0; i < SHARE_HELD_BUNDLES + 1; i += 1) ids.push((await bundleOf(e)).bundleId);
  assert.throws(() => e.planImport(SAMPLE_FOLDERS.adopt, ids[0]!, NONE), /UNKNOWN_BUNDLE/);
  value(await e.planImport(SAMPLE_FOLDERS.adopt, ids[2]!, NONE));
  assert.equal(await e.discardBundle(ids[2]!), true);
  assert.equal(await e.discardBundle(ids[2]!), false);
  assert.throws(() => e.planImport(SAMPLE_FOLDERS.adopt, ids[2]!, NONE), /UNKNOWN_BUNDLE/);
  for (const bad of ['bundle-', 'folder-1', '../bundle-1', 'bundle-1\n', 'bundle-1234567']) {
    assert.throws(() => e.planImport(SAMPLE_FOLDERS.adopt, bad, NONE), /BAD_ARGUMENT/, bad);
    assert.throws(() => e.discardBundle(bad), /BAD_ARGUMENT/, bad);
  }
});

test('import plan: every file is a create, the files that run are marked, the summary comes from the bundle, and the lists stay inside the window limit', async () => {
  const e = createSampleEngine();
  const b = await bundleOf(e);
  const plan = value(await e.planImport(SAMPLE_FOLDERS.adopt, b.bundleId, NONE));
  assert.equal(plan.bundleId, b.bundleId);
  assert.equal(plan.changes.length, b.summary.counts.files);
  assert.ok(plan.changes.every(c => c.action === 'create' && c.path.startsWith('.bowerloom/')));
  assert.equal(plan.changes.at(-1)!.path, '.bowerloom/harness.json', 'harness.json is written last');
  assert.deepEqual(plan.changes.filter(c => c.executable === true).map(c => c.path), ['.bowerloom/scripts/format-check.sh', '.bowerloom/skills/tally-stock/scripts/tally.sh']);
  assert.deepEqual(plan.copiedExecutables.map(c => c.from), [b.name, b.name]);
  assert.equal(plan.removedSources.length, 0);
  assert.equal(plan.noop, false);
  assert.equal(plan.acknowledge?.length, 64, 'tools that run code, files that can run, values and a foreign path all ask for the tick');
  assert.deepEqual(plan.summary.secrets.rows.map(s => s.name), ['ORDERS_KEY', 'YARD_REGION']);
  assert.deepEqual(plan.summary.tools.rows.map(t => [t.name, t.runsCode, t.host]), [['stock-db', true, null], ['orders-api', false, 'orders.example.test'], ['format-check', true, null]]);
  for (const list of [plan.summary.tools, plan.summary.codeFiles, plan.summary.secrets, plan.summary.notes, plan.summary.borrowed, plan.summary.foreignPaths]) assert.ok(list.rows.length <= SHARE_LIST_LIMIT);
  assert.equal(JSON.stringify(plan).includes('"after"'), false, 'the sample\'s own bookkeeping never reaches the window');
});

test('import: notes names are left out unless linked; a link makes the source and keeps the name on the agent', async () => {
  const e = createSampleEngine();
  const b = await bundleOf(e);
  const left = value(await e.planImport(SAMPLE_FOLDERS.adopt, b.bundleId, NONE));
  assert.deepEqual(left.notes, [{ name: 'yard-wiki', choice: 'leave', label: null, readBy: ['clerk'] }]);
  assert.deepEqual(left.definition.sources, []);
  assert.deepEqual(left.definition.agents[0]!.notes, []);
  const defaulted = value(await e.planImport(SAMPLE_FOLDERS.adopt, b.bundleId, { link: {}, leave: [] }));
  assert.equal(defaulted.revision, left.revision, 'a name in neither list is left out');
  const linked = value(await e.planImport(SAMPLE_FOLDERS.adopt, b.bundleId, LINK));
  assert.deepEqual(linked.notes.map(n => [n.choice, n.label]), [['link', '~/Documents/Reading list']]);
  assert.deepEqual(linked.definition.sources.map(s => s.name), ['yard-wiki']);
  assert.deepEqual(linked.definition.agents[0]!.notes, ['yard-wiki']);
  assert.notEqual(linked.revision, left.revision);
});

test('import: choices that do not fit the bundle are BAD_ARGUMENT before anything is planned', async () => {
  const e = createSampleEngine();
  const b = await bundleOf(e);
  const bad: unknown[] = [
    { link: { nope: SAMPLE_NOTES.use }, leave: [] }, { link: {}, leave: ['nope'] }, { link: { 'yard-wiki': SAMPLE_NOTES.use }, leave: ['yard-wiki'] },
    { link: { 'yard-wiki': 'notes-unknown' }, leave: [] }, { link: { 'yard-wiki': 3 }, leave: [] }, { link: null, leave: [] }, { link: {}, leave: 'yard-wiki' }, null, 'x',
    JSON.parse('{"link":{"__proto__":"sample-notes"},"leave":[]}'), { link: {}, leave: Array.from({ length: 201 }, (_, i) => `n${i}`) },
  ];
  for (const choices of bad) assert.throws(() => e.planImport(SAMPLE_FOLDERS.adopt, b.bundleId, choices as ImportNoteChoices), /BAD_ARGUMENT|UNKNOWN_FOLDER/, JSON.stringify(choices));
});

test('import: a folder with parts in its harness is refused in the code\'s words', async () => {
  const e = createSampleEngine();
  const b = await bundleOf(e);
  for (const id of [SAMPLE_FOLDERS.defined, SAMPLE_FOLDERS.stopped]) assert.deepEqual(refusal(await e.planImport(id, b.bundleId, NONE)), { code: 'IMPORT_FOLDER_HAS_HARNESS', message: SHARE_MAIN_WORDS.IMPORT_FOLDER_HAS_HARNESS });
  assert.throws(() => e.planImport('folder-nope', b.bundleId, NONE), /UNKNOWN_FOLDER/);
});

test('import: the write names the plan shown last and the acknowledgement; then the folder holds the harness, two save points, and Go back returns it to empty', async () => {
  const e = createSampleEngine();
  const b = await bundleOf(e);
  const id = SAMPLE_FOLDERS.adopt, plan = value(await e.planImport(id, b.bundleId, LINK)) as ImportView;
  assert.equal(refusal(await e.runImport(id, 'f'.repeat(64), b.bundleId, LINK, plan.acknowledge)).code, 'NOT_THE_PLAN_SHOWN');
  assert.equal(refusal(await e.runImport(id, plan.revision, b.bundleId, NONE, plan.acknowledge)).code, 'NOT_THE_PLAN_SHOWN', 'other choices are another plan');
  assert.equal(refusal(await e.runImport(id, plan.revision, b.bundleId, LINK, null)).code, 'IMPORT_NEEDS_ACKNOWLEDGEMENT');
  assert.equal(refusal(await e.runImport(id, plan.revision, b.bundleId, LINK, 'c'.repeat(64))).message, SHARE_MAIN_WORDS.IMPORT_NEEDS_ACKNOWLEDGEMENT);
  assert.equal((await e.folders()).find(f => f.id === id)!.hasDefinition, false, 'nothing was written by a refused write');
  const written = value(await e.runImport(id, plan.revision, b.bundleId, LINK, plan.acknowledge));
  assert.deepEqual(written.written, plan.changes.map(c => c.path));
  assert.equal(written.version, 'v2');
  const info = (await e.folders()).find(f => f.id === id)!;
  assert.equal(info.hasDefinition, true);
  const versions = value(await e.listVersions(id));
  assert.deepEqual(versions.map(v => [v.id, v.label, v.current]), [['v2', 'Imported 10 files', true], ['v1', 'As it was before the first save', false]]);
  // The folder now has parts, so a second import is refused.
  assert.equal(refusal(await e.planImport(id, b.bundleId, NONE)).code, 'IMPORT_FOLDER_HAS_HARNESS');
  // Go back to the first save point: the harness is empty again, and an import fits.
  const back = value(await e.planRestore(id, 'v1'));
  value(await e.runRestore(id, back.revision, 'v1'));
  value(await e.planImport(id, b.bundleId, NONE));
});
