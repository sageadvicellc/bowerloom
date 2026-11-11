// Context items (beta.2 Context page): the pages of a notes folder the person linked to a harness. They run on small homes made here and never read the real HOME.
// The harness package stores a linked folder as `.` (the harness folder), a path below it, or `~/` and a path below the home folder; those are the forms the reader takes.
// Cause 1: the automatic notes walk never runs for the home folder and stops at any subfolder with a tool folder, and a linked folder (knowledge.json) was never walked at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { TestContext } from 'node:test';
import { createScanner } from '../main/real-scan.js';
import { buildRealResult } from '../shared/real/map-world.js';
import type { RealPlace, RealResult } from '../shared/real/types.js';
import { tempDir } from './support.js';

const NOW_MS = Date.UTC(2026, 10, 11);
const put = (file: string, text: string): void => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const harness = (id: string): string => json({ format: 'bowerloom/harness/v1beta1', id, description: 'A harness.', engines: [{ id: 'claude-code' }], parts: { skills: 'skills/', subagents: 'agents/' } });
const page = (title: string): string => `# ${title}\n\nA page about ${title}.\n`;
const link = (path: string, name = 'journal'): string => json({ sources: [{ name, kind: 'wiki-folder', path }] });

async function read(home: string): Promise<{ result: RealResult; places: readonly RealPlace[] }> {
  const scanner = createScanner({ home });
  const found = await scanner.discover();
  const places: RealPlace[] = [...found.places, ...(await scanner.addFolder(join(home, 'work'))).places];
  const batch = await scanner.read(places.map(p => p.id));
  return { result: buildRealResult(batch.reads, batch.tally, { nowMs: NOW_MS, foldExtraApps: true }), places };
}
const titles = (r: RealResult): string[] => r.world.wikiPages.map(p => p.title).sort();
const sliceNames = (r: RealResult): string[] => r.world.items.filter(i => i.kind === 'context-slice').map(i => i.name);
const setup = (t: TestContext, make: (home: string) => void): string => { const home = tempDir(t, 'bowerloom-ctx-'); make(home); return home; };

test('a wiki under the home folder that a harness links shows its pages as context items', async t => {
  const home = setup(t, h => {
    put(join(h, 'work', 'proj', '.bowerloom', 'harness.json'), harness('proj'));
    put(join(h, 'work', 'proj', '.bowerloom', 'knowledge.json'), link('~/journal'));
    put(join(h, 'journal', 'one.md'), page('One'));
    put(join(h, 'journal', 'deep', 'two.md'), page('Two'));
  });
  const { result } = await read(home);
  assert.deepEqual(titles(result), ['One', 'Two']);
  assert.ok(sliceNames(result).length > 0, `a context item: ${sliceNames(result).join(', ')}`);
  assert.equal(result.counts.notes, 2);
});

test('a notes folder in the home folder that nothing links is never read on its own', async t => {
  const home = setup(t, h => {
    put(join(h, 'work', 'proj', '.bowerloom', 'harness.json'), harness('proj'));
    put(join(h, 'journal', 'one.md'), page('One'));
    put(join(h, 'Documents', 'two.md'), page('Two'));
  });
  const { result } = await read(home);
  assert.deepEqual(titles(result), []);
  assert.deepEqual(sliceNames(result), []);
});

test('a linked folder is read even when a subfolder holds a tool folder', async t => {
  const home = setup(t, h => {
    put(join(h, 'work', 'proj', '.bowerloom', 'harness.json'), harness('proj'));
    put(join(h, 'work', 'proj', '.bowerloom', 'knowledge.json'), link('~/journal'));
    put(join(h, 'journal', 'top.md'), page('Top'));
    put(join(h, 'journal', 'sub', '.claude', 'settings.json'), '{}\n');
    put(join(h, 'journal', 'sub', 'inside.md'), page('Inside'));
  });
  const { result } = await read(home);
  assert.deepEqual(titles(result), ['Inside', 'Top']);
});

test('a link that is not a stored form, is gone, has no path, is hidden, or is not a wiki folder is left out and harms nothing', async t => {
  const home = setup(t, h => {
    put(join(h, 'work', 'proj', '.bowerloom', 'harness.json'), harness('proj'));
    put(join(h, 'work', 'proj', '.bowerloom', 'knowledge.json'), json({ sources: [
      { name: 'a', kind: 'wiki-folder', path: join(h, 'journal') }, { name: 'b', kind: 'wiki-folder', path: '~/missing' }, { name: 'c', kind: 'wiki-folder', path: 42 }, { name: 'd', kind: 'wiki', path: '~/journal' },
      { name: 'e', kind: 'wiki-folder', path: '~/.hidden' }, { name: 'f', kind: 'wiki-folder', path: '~/../outside' }, { name: 'g', kind: 'wiki-folder', path: '../../journal' }, { name: 'h', kind: 'wiki-folder' },
    ] }));
    put(join(h, 'journal', 'one.md'), page('One'));
    put(join(h, '.hidden', 'secret.md'), page('Secret'));
    put(join(h, 'work', 'proj', 'own.md'), page('Own'));
  });
  const { result } = await read(home);
  assert.deepEqual(titles(result), ['Own'], 'only the place\'s own notes; no link of these shapes is read');
});

test('a linked folder with the same pages as the place is counted once, and the cap on pages holds', async t => {
  const home = setup(t, h => {
    put(join(h, 'work', 'proj', '.bowerloom', 'harness.json'), harness('proj'));
    put(join(h, 'work', 'proj', '.bowerloom', 'knowledge.json'), json({ sources: [
      { name: 'self', kind: 'wiki-folder', path: '.' }, { name: 'j', kind: 'wiki-folder', path: '~/journal' }, { name: 'again', kind: 'wiki-folder', path: '~/journal' },
    ] }));
    put(join(h, 'work', 'proj', 'own.md'), page('Own'));
    put(join(h, 'journal', 'one.md'), page('One'));
  });
  const { result } = await read(home);
  assert.deepEqual(titles(result), ['One', 'Own']);
});

test('a shortcut inside a linked folder that leads out of it is not followed', async t => {
  const home = setup(t, h => {
    put(join(h, 'work', 'proj', '.bowerloom', 'harness.json'), harness('proj'));
    put(join(h, 'work', 'proj', '.bowerloom', 'knowledge.json'), link('~/journal'));
    put(join(h, 'journal', 'one.md'), page('One'));
    put(join(h, 'secret', 'out.md'), page('Out'));
    symlinkSync(join(h, 'secret'), join(h, 'journal', 'leak'));
  });
  const { result } = await read(home);
  assert.deepEqual(titles(result), ['One']);
});

test('a folder that holds its own harness and is linked to itself is read whole, below a subfolder with a tool folder too', async t => {
  const home = setup(t, h => {
    put(join(h, 'work', 'wiki', '.bowerloom', 'harness.json'), harness('wiki'));
    put(join(h, 'work', 'wiki', '.bowerloom', 'knowledge.json'), link('.', 'wiki'));
    put(join(h, 'work', 'wiki', 'index.md'), page('Index'));
    put(join(h, 'work', 'wiki', 'deep', '.claude', 'settings.json'), '{}\n');
    put(join(h, 'work', 'wiki', 'deep', 'inside.md'), page('Inside'));
  });
  const { result } = await read(home);
  // `deep` is a place of its own too, so the page is told apart by the set it belongs to: the wiki's, not the work folder's.
  assert.ok(result.world.wikiPages.some(p => p.title === 'Inside' && p.folder === 'wiki/deep'), result.world.wikiPages.map(p => `${p.folder}:${p.title}`).join(', '));
  assert.ok(titles(result).includes('Index'));
});
