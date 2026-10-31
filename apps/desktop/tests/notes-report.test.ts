// The tidy-up report opener (main/notes-report.ts): the path check, and the private copy main opens instead of the report itself. The copy closes the gap
// between the check and the open: main opens the report once without following a link, checks what it opened, and copies its bytes from that one open
// file into a private folder of its own. Another process that swaps the report after the check gets nothing opened outside the copy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, linkSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { DefinitionError } from '../../../packages/contracts/src/index.js';
import { REPORT_BYTE_LIMIT, checkedReport, createReportCopies } from '../main/notes-report.js';
import { tempDir } from './support.js';

const NAME = '2026-10-27-refine.md';
/** A notes folder with one report, a folder elsewhere with an executable and a private page, and an empty folder for the copies. */
function world(t: test.TestContext): { notes: string; report: string; other: string; copies: string } {
  const base = tempDir(t, 'bowerloom-report-');
  const notes = join(base, 'notes'), other = join(base, 'elsewhere'), copies = join(base, 'copies');
  mkdirSync(join(notes, 'reports'), { recursive: true }); mkdirSync(other); mkdirSync(copies);
  writeFileSync(join(notes, 'reports', NAME), '# Report\n');
  writeFileSync(join(other, 'run.md'), '#!/bin/sh\necho ran\n', { mode: 0o755 });
  writeFileSync(join(other, 'secret.md'), '# Not a report\n');
  return { notes, report: join(notes, 'reports', NAME), other, copies };
}
const unsafe = (e: unknown): boolean => e instanceof DefinitionError && e.code === 'REPORT_UNSAFE';
/** Every file under a folder, as paths relative to it. */
const filesUnder = (dir: string): string[] => (readdirSync(dir, { recursive: true }) as string[]).filter(rel => statSync(join(dir, rel)).isFile()).sort();

test('the opener copies the checked report into a private folder (0700) as report.md (0600), with the same bytes, outside the notes folder', t => {
  const w = world(t);
  const copies = createReportCopies(() => w.copies);
  const copy = copies.copy(checkedReport(w.notes, `reports/${NAME}`));
  assert.equal(readFileSync(copy, 'utf8'), '# Report\n');
  assert.equal(copy.endsWith(`${sep}report.md`), true);
  assert.equal(copy.startsWith(`${w.copies}${sep}`), true);
  assert.equal(statSync(copy).mode & 0o777, 0o600);
  assert.equal(statSync(dirname(copy)).mode & 0o777, 0o700);
  assert.equal(copy.startsWith(w.notes), false);
});

test('a swap to a link after the check opens nothing outside the copy: the report, or its reports folder, swapped after the check is refused', t => {
  const w = world(t);
  const copies = createReportCopies(() => w.copies);

  // The report itself swapped for a link to an executable elsewhere, after the check.
  let place = checkedReport(w.notes, `reports/${NAME}`);
  rmSync(w.report); symlinkSync(join(w.other, 'run.md'), w.report);
  assert.throws(() => copies.copy(place), unsafe);
  assert.deepEqual(filesUnder(w.copies), [], 'no copy is made');

  // The reports folder swapped for a link to a folder that holds a plain file of the same name.
  rmSync(w.report); writeFileSync(w.report, '# Report\n');
  place = checkedReport(w.notes, `reports/${NAME}`);
  mkdirSync(join(w.other, 'reports')); writeFileSync(join(w.other, 'reports', NAME), '# Elsewhere\n');
  renameSync(join(w.notes, 'reports'), join(w.notes, 'reports-old'));
  symlinkSync(join(w.other, 'reports'), join(w.notes, 'reports'));
  assert.throws(() => copies.copy(place), unsafe);
  assert.deepEqual(filesUnder(w.copies), [], 'no copy is made');
});

test('a report made executable, given a second link, or grown past the size cap after the check is refused by what the one open file says', t => {
  const w = world(t);
  const copies = createReportCopies(() => w.copies);
  let place = checkedReport(w.notes, `reports/${NAME}`);
  chmodSync(w.report, 0o744);
  assert.throws(() => copies.copy(place), unsafe, 'an execute bit');
  chmodSync(w.report, 0o644);

  place = checkedReport(w.notes, `reports/${NAME}`);
  linkSync(w.report, join(w.other, 'hard.md'));
  assert.throws(() => copies.copy(place), unsafe, 'a second link');
  rmSync(join(w.other, 'hard.md'));

  place = checkedReport(w.notes, `reports/${NAME}`);
  writeFileSync(w.report, Buffer.alloc(REPORT_BYTE_LIMIT + 1, 0x61));
  assert.throws(() => copies.copy(place), unsafe, 'over the size cap');
  assert.deepEqual(filesUnder(w.copies), []);
});

test('an executable .md is refused at check time', t => {
  const w = world(t);
  for (const mode of [0o755, 0o744, 0o654, 0o645]) {
    chmodSync(w.report, mode);
    assert.throws(() => checkedReport(w.notes, `reports/${NAME}`), unsafe, mode.toString(8));
  }
  chmodSync(w.report, 0o644);
  assert.equal(checkedReport(w.notes, `reports/${NAME}`).rel, `reports/${NAME}`);
});

test('a report over the size cap is refused at check time', t => {
  const w = world(t);
  writeFileSync(w.report, Buffer.alloc(REPORT_BYTE_LIMIT + 1, 0x61));
  assert.throws(() => checkedReport(w.notes, `reports/${NAME}`), unsafe);
});

test('a right-to-left override, or any other format character, in the report name is refused', t => {
  const w = world(t);
  for (const name of ['2026-10-28-‮dm.etoN.md', '2026-10-28-a​b.md', '2026-10-28-⁦x⁩.md', '2026-10-28-﻿x.md']) {
    writeFileSync(join(w.notes, 'reports', name), '# Report\n');
    assert.throws(() => checkedReport(w.notes, `reports/${name}`), unsafe, JSON.stringify(name));
  }
});

test('the copies are removed on the next copy, and all of them on clear; nothing else in the folder is touched', t => {
  const w = world(t);
  writeFileSync(join(w.copies, 'keep.txt'), 'not ours\n');
  const copies = createReportCopies(() => w.copies);
  const first = copies.copy(checkedReport(w.notes, `reports/${NAME}`));
  const second = copies.copy(checkedReport(w.notes, `reports/${NAME}`));
  assert.equal(existsSync(dirname(first)), false, 'the older copy went on the next open');
  assert.equal(existsSync(second), true);
  copies.clear();
  assert.equal(existsSync(dirname(second)), false, 'clear removes the last copy');
  assert.deepEqual(readdirSync(w.copies), ['keep.txt']);
});
