// Export and import in main (journey 4): the six share calls on made-up folders, with the real packages and the real worker thread. Two apps (two homes, two state
// roots) stand for two computers. Every value is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadDefinition } from '../../../packages/harness-definition/src/index.js';
import { BUNDLE_FORMAT } from '../../../packages/harness-bundle/src/index.js';
import { filesOf } from './helpers-engine/folders.js';
import { NO_CHOICES, emptyHarnessFolder, exists, plainFolder, put, quietFolder, refused, richFolder, shareSetup, value } from './helpers-engine/share.js';
import type { Share } from './helpers-engine/share.js';
import { SHARE_MAIN_WORDS } from '../shared/engine/types.js';
import type { ImportView } from '../shared/engine/types.js';

const sha = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');

/** Exports a folder of app `a` to a file in its own base folder and returns the file's path. */
async function exportTo(a: Share, dir: string, file = 'out.bowerloom.json', ack = true): Promise<string> {
  const f = await a.choose(dir);
  const plan = value(await a.service.planExport(f.id));
  a.save = join(a.base, file);
  value(await a.service.runExport(f.id, plan.revision, ack ? plan.acknowledge : null));
  return a.save;
}

test('export: the plan lists what the file holds and nothing is written; the view holds no path of this computer', async t => {
  const a = shareSetup(t, 'export-plan');
  const dir = richFolder(a.home);
  const f = await a.choose(dir);
  const before = filesOf(a.base);
  const plan = value(await a.service.planExport(f.id));
  assert.equal(plan.file, 'rope-yard.bowerloom.json');
  assert.equal(plan.summary.harness, 'rope-yard');
  assert.deepEqual([plan.summary.counts.skills, plan.summary.counts.agents, plan.summary.counts.mcp, plan.summary.counts.hooks], [2, 2, 2, 1]);
  assert.deepEqual(plan.summary.tools.rows.map(x => x.name).sort(), ['format-check', 'orders-api', 'stock-db']);
  assert.deepEqual(plan.summary.notes.rows.map(n => n.name), ['yard-wiki']);
  assert.deepEqual(plan.summary.secrets.rows.map(x => x.name).sort(), ['ORDERS_KEY', 'YARD_REGION']);
  assert.match(plan.revision, /^[a-f0-9]{64}$/);
  assert.equal(plan.acknowledge, null, 'nothing in the files names a path of this computer');
  assert.deepEqual(filesOf(a.base), before, 'planning writes nothing');
  const text = JSON.stringify(plan);
  assert.equal(text.includes(a.home), false, 'no path of this computer reaches the window');
  assert.equal(text.includes('knowledge.json'), false);
});

test('export: a folder with no harness is EXPORT_NO_DEFINITION', async t => {
  const a = shareSetup(t, 'export-none');
  const f = await a.choose(plainFolder(a.home));
  assert.equal(refused(await a.service.planExport(f.id)).code, 'EXPORT_NO_DEFINITION');
});

test('export: the save dialog and main\'s own question come first, then one new file is written; the window gets the file name and size only', async t => {
  const a = shareSetup(t, 'export-run');
  const dir = richFolder(a.home);
  const f = await a.choose(dir);
  const plan = value(await a.service.planExport(f.id));
  // A closed save dialog writes nothing.
  a.save = null;
  assert.equal(refused(await a.service.runExport(f.id, plan.revision, null)).code, 'CANCELLED');
  assert.deepEqual(a.saved, ['rope-yard.bowerloom.json'], 'the dialog was offered the file name only');
  assert.equal(a.asks.length, 0, 'no question before a file is chosen');
  // A "no" to main's question writes nothing.
  a.save = join(a.base, 'out.bowerloom.json');
  a.yes = false;
  assert.equal(refused(await a.service.runExport(f.id, plan.revision, null)).code, 'CANCELLED');
  assert.equal(exists(a.save), false);
  assert.equal(a.asks.length, 1);
  assert.match(a.asks[0]!.message, /Write the file out\.bowerloom\.json/);
  // A yes writes it.
  a.yes = true;
  const plan2 = value(await a.service.planExport(f.id));
  const written = value(await a.service.runExport(f.id, plan2.revision, null));
  assert.equal(written.name, 'out.bowerloom.json');
  const bytes = readFileSync(a.save);
  assert.equal(written.bytes, bytes.length);
  assert.equal(sha(bytes), plan2.revision, 'the revision of the plan is the hash of the file');
  assert.equal(statSync(a.save).mode & 0o777, 0o600);
  const envelope = JSON.parse(bytes.toString('utf8')) as { format: string; files: { path: string; data: string; encoding: string }[]; knowledge: { name: string }[] };
  assert.equal(envelope.format, BUNDLE_FORMAT);
  assert.equal(envelope.files.some(x => x.path === 'knowledge.json'), false, 'paths of notes stay home');
  assert.deepEqual(envelope.knowledge.map(k => k.name), ['yard-wiki']);
  assert.equal(bytes.toString('utf8').includes(a.home), false, 'no home path in the file');
  assert.equal(JSON.stringify(written).includes(a.base), false);
  // The folder itself is unchanged by an export.
  assert.equal(readdirSync(join(dir, '.bowerloom')).includes('out.bowerloom.json'), false);
});

test('export is deterministic, and a second export to the same name does not replace the first unless the person agreed in the dialog', async t => {
  const a = shareSetup(t, 'export-twice');
  const dir = richFolder(a.home);
  const first = await exportTo(a, dir, 'one.bowerloom.json');
  const second = await exportTo(a, dir, 'two.bowerloom.json');
  assert.deepEqual(readFileSync(first), readFileSync(second), 'equal harness files give equal bytes');
  // The same name again: the dialog found a file there, the person agreed, and main says it replaces.
  const f = (await a.service.folders())[0]!;
  const plan = value(await a.service.planExport(f.id));
  a.save = first;
  value(await a.service.runExport(f.id, plan.revision, null));
  assert.match(a.asks.at(-1)!.message, /^Replace the file one\.bowerloom\.json/);
});

test('export: a file swapped between the dialog and the write is not replaced', async t => {
  const a = shareSetup(t, 'export-swap');
  const dir = richFolder(a.home);
  const f = await a.choose(dir);
  const target = join(a.base, 'taken.bowerloom.json');
  put(a.base, 'taken.bowerloom.json', 'the person\'s own file\n');
  const plan = value(await a.service.planExport(f.id));
  a.save = target;
  a.beforeYes = () => { put(a.base, 'taken.bowerloom.json', 'another file, made after the dialog\n'); };
  const r = refused(await a.service.runExport(f.id, plan.revision, null));
  assert.equal(r.code, 'BUNDLE_FILE_UNSAFE');
  assert.equal(readFileSync(target, 'utf8'), 'another file, made after the dialog\n');
});

test('export: a file chosen inside the harness\'s own .bowerloom is refused, and a linked folder is written where it really is, named in the question', async t => {
  const a = shareSetup(t, 'export-where');
  const dir = richFolder(a.home);
  const f = await a.choose(dir);
  const plan = value(await a.service.planExport(f.id));
  a.save = join(dir, '.bowerloom', 'x.bowerloom.json');
  const inside = refused(await a.service.runExport(f.id, plan.revision, null));
  assert.equal(inside.code, 'EXPORT_TARGET_IN_HARNESS');
  assert.match(inside.message, /Choose a place outside it/, 'main\'s own words, not "close the sheet and open it again"');
  assert.equal(exists(a.save), false);
  assert.equal(a.asks.length, 0, 'no question for a place that is refused');
  // A folder below .bowerloom, and the same place written with other letter case (the same folder on a case-insensitive disk), are the same refusal.
  a.save = join(dir, '.bowerloom', 'skills', 'y.bowerloom.json');
  assert.equal(refused(await a.service.runExport(f.id, plan.revision, null)).code, 'EXPORT_TARGET_IN_HARNESS');
  a.save = join(dir, '.BOWERLOOM', 'z.bowerloom.json');
  const cased = refused(await a.service.runExport(f.id, plan.revision, null));
  assert.ok(['EXPORT_TARGET_IN_HARNESS', 'BUNDLE_FILE_FAILED'].includes(cased.code), cased.code);
  assert.equal(exists(join(dir, '.bowerloom', 'z.bowerloom.json')), false);
  const { symlinkSync, mkdirSync } = await import('node:fs');
  mkdirSync(join(a.base, 'real-place'));
  symlinkSync(join(a.base, 'real-place'), join(a.base, 'linked-place'));
  a.save = join(a.base, 'linked-place', 'y.bowerloom.json');
  value(await a.service.runExport(f.id, plan.revision, null));
  assert.equal(exists(join(a.base, 'real-place', 'y.bowerloom.json')), true);
  assert.match(a.asks.at(-1)!.message, /in .*real-place with the harness/);
  assert.equal(a.asks.at(-1)!.message.includes('linked-place'), false);
});

test('export: text that names a path of this computer needs the acknowledgement of the plan, asked before any dialog', async t => {
  const a = shareSetup(t, 'export-ack');
  const dir = richFolder(a.home, 'rope-yard', { '.bowerloom/scripts/format-check.sh': `#!/bin/sh\ncd ${a.home}/Projects/shelf\n` });
  const f = await a.choose(dir);
  const plan = value(await a.service.planExport(f.id));
  assert.match(plan.acknowledge ?? '', /^[a-f0-9]{64}$/);
  assert.equal(plan.summary.foreignPaths.rows.length > 0, true);
  assert.equal(JSON.stringify(plan).includes(a.home), false, 'even the quoted text shows ~ for this computer\'s home');
  a.save = join(a.base, 'ack.bowerloom.json');
  assert.equal(refused(await a.service.runExport(f.id, plan.revision, null)).code, 'EXPORT_NEEDS_ACKNOWLEDGEMENT');
  assert.equal(refused(await a.service.runExport(f.id, plan.revision, 'f'.repeat(64))).code, 'EXPORT_NEEDS_ACKNOWLEDGEMENT');
  assert.equal(a.saved.length, 0, 'no dialog opened for a write that was not acknowledged');
  value(await a.service.runExport(f.id, plan.revision, plan.acknowledge));
  assert.equal(exists(a.save), true);
});

test('export: a harness that changed since the plan is not the plan shown, and nothing is written', async t => {
  const a = shareSetup(t, 'export-stale');
  const dir = richFolder(a.home);
  const f = await a.choose(dir);
  const plan = value(await a.service.planExport(f.id));
  put(dir, '.bowerloom/instructions/AGENTS.md', '# Rope yard\n\nChanged after the plan.\n');
  a.save = join(a.base, 'stale.bowerloom.json');
  assert.equal(refused(await a.service.runExport(f.id, plan.revision, null)).code, 'NOT_THE_PLAN_SHOWN');
  assert.equal(exists(a.save), false);
  // A revision no plan named, and a plan never made, are not the plan shown either.
  assert.equal(refused(await a.service.runExport(f.id, 'a'.repeat(64), null)).code, 'NOT_THE_PLAN_SHOWN');
});

// ---- import ---------------------------------------------------------------------------------------------------------------------

/** The `.bowerloom` files of a folder with the hash of each, for a byte-for-byte comparison. */
const definitionFiles = (dir: string, skip: string[] = ['knowledge.json']): Record<string, string> => {
  const all = filesOf(dir);
  return Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith('.bowerloom/') && !skip.some(s => k === `.bowerloom/${s}`)));
};
const ack = (v: ImportView): string | null => v.acknowledge;

test('import into a folder with no harness: one plan makes the empty harness and writes the files; Go back returns the empty harness', async t => {
  const a = shareSetup(t, 'import-a'), b = shareSetup(t, 'import-b');
  const source = richFolder(a.home);
  const file = await exportTo(a, source);

  b.open = file;
  const target = plainFolder(b.home, 'new-place');
  const f = await b.choose(target);
  const bundle = value(await b.service.chooseBundle());
  assert.match(bundle.bundleId, /^bundle-[0-9]+$/);
  assert.equal(bundle.name, 'out.bowerloom.json');
  assert.equal(JSON.stringify(bundle).includes(b.base), false, 'the window gets the file name, never the path');
  assert.equal(bundle.summary.counts.files, 11, 'the files of the harness, without knowledge.json');
  const before = filesOf(b.base);

  const plan = value(await b.service.planImport(f.id, bundle.bundleId, NO_CHOICES));
  assert.equal(plan.makesHarness, true);
  assert.deepEqual(filesOf(b.base), before, 'planning writes nothing');
  assert.equal(plan.changes.every(c => c.action === 'create'), true);
  assert.equal(plan.changes.at(-1)!.path, '.bowerloom/harness.json', 'harness.json is last, as the package writes it');
  assert.equal(plan.changes.length, 11);
  assert.deepEqual(plan.copiedExecutables.map(x => x.path).sort(), ['.bowerloom/scripts/format-check.sh', '.bowerloom/skills/tally-stock/scripts/tally.sh']);
  assert.equal(plan.copiedExecutables.every(x => x.from === 'out.bowerloom.json'), true);
  assert.match(ack(plan) ?? '', /^[a-f0-9]{64}$/, 'tools that run, references, files that run');
  assert.equal(plan.notes[0]!.choice, 'leave');
  assert.equal(JSON.stringify(plan).includes(b.home), false);
  assert.equal(plan.removedSources.length, 0);

  // Without the acknowledgement: refused before any question.
  assert.equal(refused(await b.service.runImport(f.id, plan.revision, bundle.bundleId, NO_CHOICES, null)).code, 'IMPORT_NEEDS_ACKNOWLEDGEMENT');
  assert.equal(b.asks.length, 0);
  const written = value(await b.service.runImport(f.id, plan.revision, bundle.bundleId, NO_CHOICES, plan.acknowledge));
  assert.equal(b.asks.length, 1);
  assert.match(b.asks[0]!.message, /^Make an empty harness and write 11 files into /);
  assert.equal(written.written.length, 11);
  assert.equal(written.written.every(p => p.startsWith('.bowerloom/')), true);
  assert.equal(written.warnings, undefined);

  // The files are the source's, byte for byte; the notes name was left out of every agent.
  const sourceFiles = definitionFiles(source, ['knowledge.json', 'agents/clerk.md']);
  const got = definitionFiles(target, ['agents/clerk.md']);
  assert.deepEqual(got, sourceFiles);
  assert.equal(existsSync(join(target, '.bowerloom', 'knowledge.json')), false);
  assert.equal(readFileSync(join(target, '.bowerloom', 'agents', 'clerk.md'), 'utf8').includes('yard-wiki'), false);
  assert.equal(lstatSync(join(target, '.bowerloom', 'scripts', 'format-check.sh')).mode & 0o111, 0o111);
  const loaded = loadDefinition(join(target, '.bowerloom'));
  assert.equal(loaded.ok, true);
  assert.equal(readdirSync(target).sort().join(), '.bowerloom,README.md', 'nothing outside .bowerloom, nothing installed');

  // Two save points: the empty harness, then the import. Go back returns the empty harness.
  const versions = value(await b.service.listVersions(f.id));
  assert.deepEqual(versions.map(v => v.label), ['Imported 11 files', 'As it was before the first save']);
  assert.equal(versions[1]!.files, 1, 'the save point before is the empty harness alone');
  const back = value(await b.service.planRestore(f.id, versions[1]!.id));
  value(await b.service.runRestore(f.id, back.revision, versions[1]!.id));
  assert.deepEqual(readdirSync(join(target, '.bowerloom')), ['harness.json']);
  const empty = loadDefinition(join(target, '.bowerloom'));
  assert.equal(empty.ok, true);
  const again = (await b.service.folders()).find(x => x.id === f.id)!;
  assert.equal(again.holdsParts, false);
});

test('import into a folder with an empty harness: harness.json is an update, and the plan does not make a harness', async t => {
  const a = shareSetup(t, 'import-empty-a'), b = shareSetup(t, 'import-empty-b');
  const file = await exportTo(a, quietFolder(a.home));
  b.open = file;
  const target = emptyHarnessFolder(b.home);
  const f = await b.choose(target);
  assert.equal(f.holdsParts, false);
  const bundle = value(await b.service.chooseBundle());
  const plan = value(await b.service.planImport(f.id, bundle.bundleId, NO_CHOICES));
  assert.equal(plan.makesHarness, false, 'a folder with an empty harness makes none, as the sample says');
  assert.equal(plan.changes.find(c => c.path === '.bowerloom/harness.json')!.action, 'update');
  assert.equal(plan.acknowledge, null, 'nothing runs, nothing is read from this computer, no path');
  const written = value(await b.service.runImport(f.id, plan.revision, bundle.bundleId, NO_CHOICES, null));
  assert.equal(b.asks.at(-1)!.message.startsWith('Write 3 files'), true);
  assert.deepEqual(written.written.length, 3);
  assert.equal(loadDefinition(join(target, '.bowerloom')).ok, true);
  assert.equal((await b.service.folders()).find(x => x.id === f.id)!.holdsParts, true);
  // A second import into the same folder is refused: it holds parts now.
  b.open = file;
  const second = value(await b.service.chooseBundle());
  assert.equal(refused(await b.service.planImport(f.id, second.bundleId, NO_CHOICES)).code, 'IMPORT_FOLDER_HAS_HARNESS');
});

test('import: a folder whose harness has parts is refused, and says so in folders() before the person goes on', async t => {
  const a = shareSetup(t, 'import-has-a'), b = shareSetup(t, 'import-has-b');
  const file = await exportTo(a, quietFolder(a.home));
  b.open = file;
  const f = await b.choose(richFolder(b.home, 'busy'));
  assert.equal(f.holdsParts, true);
  const bundle = value(await b.service.chooseBundle());
  const r = refused(await b.service.planImport(f.id, bundle.bundleId, NO_CHOICES));
  assert.equal(r.code, 'IMPORT_FOLDER_HAS_HARNESS');
  assert.ok(r.message.startsWith(SHARE_MAIN_WORDS.IMPORT_FOLDER_HAS_HARNESS), r.message);
  assert.ok(['skills', 'agents', 'hooks', 'tools'].every(part => r.paths.includes(part)), `the refusal names what it found: ${r.paths.join(', ')}`);
  const none = (await b.choose(plainFolder(b.home)));
  assert.equal(none.holdsParts, undefined, 'left out when main read no harness');
});
