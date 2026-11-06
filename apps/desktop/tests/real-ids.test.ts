// The ids of things read from files: long enough that two files do not meet by chance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { TestContext } from 'node:test';
import { createScanner } from '../main/real-scan.js';
import { buildRealResult } from '../shared/real/map-world.js';
import type { RealResult } from '../shared/real/types.js';

const NOW = Date.UTC(2026, 9, 26);
const put = (file: string, text: string): void => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };

async function readHome(t: TestContext): Promise<RealResult> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-ids-'))); t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home'), claude = join(home, '.claude');
  put(join(claude, 'agents', 'ledger-keeper.md'), '---\nname: Ledger keeper\ndescription: Keeps the ledger.\nskills: [pantry-check]\n---\nKeep it.\n');
  put(join(claude, 'skills', 'pantry-check', 'SKILL.md'), '---\nname: Pantry check\ndescription: Lists what is low.\n---\nLook.\n');
  put(join(home, 'proj', 'notes', 'one.md'), '---\ntitle: One\n---\nText.\n');
  const scanner = createScanner({ home }), found = await scanner.discover(), places = [...found.places, ...(await scanner.addFolder(join(home, 'proj'))).places];
  const batch = await scanner.read(places.map(p => p.id));
  return buildRealResult(batch.reads, batch.tally, { nowMs: NOW, foldExtraApps: true });
}

test('an id carries at least 16 hex digits of the hash, for an item, a page, a set of notes and a folder', async t => {
  const { world } = await readHome(t);
  for (const i of world.items.filter(x => x.kind !== 'context-slice')) assert.match(i.id, /^real-(skill|agent|tool)-[0-9a-f]{16}(-\d+)?$/, i.name);
  for (const p of world.wikiPages) assert.match(p.id, /^real-page-[0-9a-f]{16}(-\d+)?$/);
  for (const s of world.slices) assert.match(s.id, /^real-notes-[0-9a-f]{16}(-[0-9a-f]{16})?$/);
  for (const s of world.scopes.filter(x => x.kind !== 'global')) assert.match(s.id, /^scope-real-[0-9a-f]{16}$/);
});
