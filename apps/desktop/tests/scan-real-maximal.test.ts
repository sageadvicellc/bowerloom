// A read made by the REAL reader at its largest (many pages, no other files) must be saved and loaded again: the caps of the saved read are held against the reader's own answer,
// not against a guess. Folders here are made up in temporary folders; a few thousand small files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createScanner } from '../main/real-scan.js';
import { cachePath, createScanCache } from '../main/scan-cache.js';
import { createScanSession } from '../main/scan-session.js';
import { buildRealResult } from '../shared/real/map-world.js';
import { SAVED_SCAN_VERSION } from '../shared/real/saved-scan.js';
import { REAL_LIMITS } from '../shared/real/types.js';
import { tempDir } from './support.js';

/** `places` projects, each marked by an empty `.claude` folder and holding `notes` small notes pages, and nothing else. */
function tree(root: string, places: number, notes: number): string {
  const work = join(root, 'work');
  for (let p = 0; p < places; p += 1) {
    mkdirSync(join(work, `proj-${p}`, '.claude'), { recursive: true });
    mkdirSync(join(work, `proj-${p}`, 'notes'), { recursive: true });
    for (let n = 0; n < notes; n += 1) writeFileSync(join(work, `proj-${p}`, 'notes', `n${n}.md`), `# Note ${n}\n\nA line.\n`);
  }
  return work;
}

test('7 projects with 2000 notes each, and nothing else: the reader hands over one page past the per-call cap, and the read is kept and loads again', async t => {
  const root = tempDir(t), state = tempDir(t), work = tree(root, 7, 2_000);
  const scanner = createScanner({ home: root }), found = await scanner.addFolder(work), projects = found.places.filter(p => p.kind === 'project');
  assert.equal(projects.length, 7);
  const batch = await scanner.read(projects.map(p => p.id));
  const result = buildRealResult(batch.reads, batch.tally, { nowMs: 1, foldExtraApps: true });
  console.log(`the reader handed over ${result.world.wikiPages.length} pages (per-call cap ${REAL_LIMITS.itemsPerCall})`);
  assert.ok(result.world.wikiPages.length >= REAL_LIMITS.itemsPerCall, 'the probe reaches the cap');
  const session = createScanSession({ home: root, stateRoot: state, now: () => 5 });
  const told: unknown[][] = [], log = console.error;
  console.error = (...a: unknown[]): void => { told.push(a); };
  try { await session.keepRead(projects, async () => result); } finally { console.error = log; }
  assert.deepEqual(told, [], 'nothing was told: the read was kept');
  const back = createScanCache({ stateRoot: state }).load();
  assert.equal(back.status, 'ok', back.status === 'damaged' ? back.why : '');
});

test('a save refuses a result the loader would refuse, so a cap that does not fit shows when the read is made, and is told', async t => {
  const root = tempDir(t), state = tempDir(t);
  const items = Array.from({ length: 30_000 }, (_, i) => ({ id: `i${i}`, kind: 'skill' as const, name: 'n', scopeId: 's', foundAt: [], library: null, description: '' }));
  const scanner = createScanner({ home: root }), reads = await (async () => { mkdirSync(join(root, '.claude', 'skills', 'a'), { recursive: true }); writeFileSync(join(root, '.claude', 'skills', 'a', 'SKILL.md'), '---\nname: A\n---\n'); const d = await scanner.discover(); return { d, b: await scanner.read(d.places.map(p => p.id)) }; })();
  const small = buildRealResult(reads.b.reads, reads.b.tally, { nowMs: 1, foldExtraApps: true });
  const over = { ...small, world: { ...small.world, items } };
  const cache = createScanCache({ stateRoot: state });
  assert.equal(cache.save({ version: SAVED_SCAN_VERSION, savedAtMs: 1, fingerprint: 'e'.repeat(64), chosen: reads.d.places, result: over }), false, 'refused at the save');
  assert.equal(cache.load().status, 'none', 'nothing was written');
  const told: unknown[][] = [], log = console.error;
  console.error = (...a: unknown[]): void => { told.push(a); };
  try { await createScanSession({ home: root, stateRoot: state }).keepRead(reads.d.places, async () => over); } finally { console.error = log; }
  assert.deepEqual(told, [['Bowerloom could not keep its last read.']]);
  assert.equal(cache.load().status, 'none');
  void cachePath;
});
