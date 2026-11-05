// Hermes and Bowerloom folders are programs of their own: an item found in two programs has a place in each, and the world stays valid with them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createScanner } from '../main/real-scan.js';
import { validateWorld } from '../shared/world/sample.js';
import { buildRealResult } from '../shared/real/map-world.js';
import type { RealResult } from '../shared/real/types.js';

const NOW = Date.UTC(2026, 9, 26);
const put = (file: string, text: string): void => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };

/** Reads the home places and the given folders, the way the main process does (the other programs fold into the world). */
async function readFrom(home: string, folders: readonly string[] = [], fold = true): Promise<RealResult> {
  const scanner = createScanner({ home });
  const found = await scanner.discover(), places = [...found.places];
  for (const folder of folders) places.push(...(await scanner.addFolder(folder)).places);
  const batch = await scanner.read(places.map(p => p.id));
  return buildRealResult(batch.reads, batch.tally, { nowMs: NOW, foldExtraApps: fold });
}

test('an item found in Claude Code and in Hermes has a place in each, a Bowerloom folder is a program, and the world is valid with them', async t => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-hermes-test-'))); t.after(() => rmSync(dir, { recursive: true, force: true }));
  put(join(dir, '.claude', 'skills', 'lamp-check', 'SKILL.md'), '---\nname: Lamp check\ndescription: Checks the lamps.\n---\nLook at each lamp.\n');
  put(join(dir, '.hermes', 'skills', 'general', 'lamp-check', 'SKILL.md'), '---\nname: Lamp check\ndescription: Checks the lamps.\n---\nLook at each lamp, twice.\n');
  put(join(dir, '.hermes', 'skills', 'general', 'dusk-only', 'SKILL.md'), '---\nname: Dusk only\ndescription: Only at dusk.\n---\nWait for dusk.\n');
  put(join(dir, 'proj', '.bowerloom', 'skills', 'ledger-note', 'SKILL.md'), '---\nname: Ledger note\ndescription: Notes on the ledger.\n---\nWrite it.\n');
  const folded = await readFrom(dir, [join(dir)]);
  const lamp = folded.world.items.find(i => i.name === 'Lamp check')!;
  assert.deepEqual(lamp.foundAt.map(f => f.interface), ['claude-code', 'hermes']);
  assert.equal(new Set(lamp.foundAt.map(f => f.contentHash)).size, 2, 'two different texts: the existing different-copies case');
  assert.deepEqual(folded.world.items.find(i => i.name === 'Dusk only')!.foundAt.map(f => f.interface), ['hermes']);
  assert.deepEqual(folded.world.items.find(i => i.name === 'Ledger note')!.foundAt.map(f => f.interface), ['bowerloom']);
  assert.deepEqual(folded.world.interfaces.map(i => [i.id, i.installed]), [['claude-code', 'installed'], ['codex', 'unknown'], ['opencode', 'unknown'], ['hermes', 'installed'], ['bowerloom', 'installed']]);
  assert.deepEqual(folded.others, []);
  assert.deepEqual(validateWorld(folded.world), []);
  assert.deepEqual(folded.ages[lamp.id]!.length, 2, 'one age for each place, in the order of the places');
  // Without the option, a program beyond the three is listed apart and the world holds only the three.
  const apart = await readFrom(dir, [join(dir)], false);
  assert.deepEqual(apart.world.interfaces.map(i => i.id), ['claude-code', 'codex', 'opencode']);
  assert.deepEqual(apart.world.items.find(i => i.name === 'Lamp check')!.foundAt.map(f => f.interface), ['claude-code']);
  assert.ok(apart.others.some(o => o.app === 'Hermes' && o.name === 'Lamp check'));
});

// ---------------------------------------------------------------------------------------------------- the made-up home reads to what we expect
