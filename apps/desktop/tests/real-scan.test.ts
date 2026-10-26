// The reader of a real setup, run against a made-up home folder (tests/fixtures-real/build.ts). Nothing here reads a real folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RealRefusal, createScanner, findHomePlaces } from '../main/real-scan.js';
import type { Scanner } from '../main/real-scan.js';
import { REAL_LIMITS } from '../shared/real/types.js';
import type { RealDiscovery, RealPlace } from '../shared/real/types.js';
import { FAKE_SECRET, FAKE_TOKEN_IN_TEXT, buildFixture } from './fixtures-real/build.js';
import { tempDir } from './support.js';
import type { TestContext } from 'node:test';

function fixture(t: TestContext): ReturnType<typeof buildFixture> {
  const f = buildFixture();
  t.after(() => f.cleanup());
  return f;
}

/** A fingerprint of a whole folder: every name, kind, size, change time and file content. If a read changed anything, this changes. */
function fingerprint(dir: string): string {
  const hash = createHash('sha256');
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name), s = lstatSync(p);
      hash.update(`${p}|${s.isDirectory() ? 'd' : s.isSymbolicLink() ? 'l' : 'f'}|${s.size}|${s.mtimeMs}|${(s.mode & 0o777).toString(8)}\n`);
      if (s.isDirectory()) { if ((s.mode & 0o400) !== 0) walk(p); } else if (s.isFile()) hash.update(readFileSync(p));
    }
  };
  walk(dir);
  return hash.digest('hex');
}

const byLabel = (d: RealDiscovery, label: string): RealPlace => { const p = d.places.find(x => x.label === label); assert.ok(p, `a place called ${label}: ${d.places.map(x => x.label).join(' | ')}`); return p; };

test('an empty home folder has no places, and a home that is not there is refused', async t => {
  const dir = tempDir(t);
  assert.deepEqual(findHomePlaces(dir), []);
  const scanner = createScanner({ home: dir });
  const d = await scanner.discover();
  assert.deepEqual([d.places, d.stoppedEarly, d.couldNotRead, d.readOnly], [[], false, 0, true]);
});

test('step one finds one place for each program under the home folder, and counts by structure', async t => {
  const f = fixture(t), scanner = createScanner({ home: f.home });
  const d = await scanner.discover();
  assert.deepEqual(d.places.map(p => p.label), ['Claude Code at home', 'Codex at home', 'OpenCode at home', 'Hermes at home']);
  assert.ok(d.places.every(p => p.kind === 'home'));
  // Skills are counted by path, so the huge and the binary file are counted here and skipped in step two.
  assert.deepEqual(byLabel(d, 'Claude Code at home').counts, { agents: 2, skills: 6, tools: 3, hooks: 1, notes: 0 });
  assert.deepEqual(byLabel(d, 'Codex at home').counts, { agents: 1, skills: 1, tools: 3, hooks: 0, notes: 0 });
  assert.deepEqual(byLabel(d, 'OpenCode at home').counts, { agents: 2, skills: 1, tools: 1, hooks: 0, notes: 0 });
  assert.deepEqual(byLabel(d, 'Hermes at home').counts, { agents: 1, skills: 1, tools: 1, hooks: 0, notes: 1 });
  assert.ok(d.couldNotRead >= 3, 'a shortcut that leads out, a name with a direction mark and a folder that will not open are counted');
  const claude = byLabel(d, 'Claude Code at home');
  assert.equal(claude.details.path, '~');
  assert.deepEqual(claude.details.folders, ['.claude', '.claude.json']);
  assert.ok(claude.details.notes.some(n => /shortcut/.test(n)), claude.details.notes.join(' | '));
  assert.equal(claude.appLabel, 'Claude Code');
});

test('step one gives no file name, no text and no key value; the only paths are in the details field', async t => {
  const f = fixture(t), d = await createScanner({ home: f.home }).discover();
  const text = JSON.stringify(d);
  assert.doesNotMatch(text, new RegExp(`${FAKE_SECRET}|write-reply|reviewer|SKILL\\.md|${f.home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), 'no file name, no key value, no full path');
  for (const p of d.places) assert.deepEqual(Object.keys(p).sort(), ['appLabel', 'apps', 'counts', 'details', 'empty', 'id', 'kind', 'label']);
});

test('a folder the person picks gives the folder itself and every work folder below it, to the depth cap', async t => {
  const f = fixture(t), scanner = createScanner({ home: f.home });
  const d = await scanner.addFolder(f.work);
  assert.deepEqual(d.places.map(p => [p.label, p.kind]), [['work', 'picked'], ['alpha', 'project']]);
  assert.deepEqual(byLabel(d, 'alpha').counts, { agents: 0, skills: 2, tools: 1, hooks: 0, notes: 3 });
  // The notes of the picked folder are the ones outside every work folder inside it.
  assert.deepEqual(byLabel(d, 'work').counts, { agents: 0, skills: 0, tools: 0, hooks: 0, notes: 2 });
  assert.deepEqual(byLabel(d, 'alpha').details.topics, [{ name: 'notes', count: 2 }, { name: 'Top level', count: 1 }]);
  assert.ok(!d.places.some(p => /dep|deep/.test(p.label)), 'a dependency folder and a folder past the depth cap are not places');
  assert.ok(d.couldNotRead >= 1, 'the shortcut that leads outside the picked folder is counted');
});

test('a picked folder that is the home folder does not take the home tool folders a second time', async t => {
  const f = fixture(t), scanner = createScanner({ home: f.home });
  const d = await scanner.addFolder(f.home);
  assert.equal(d.places[0]!.kind, 'picked');
  assert.deepEqual(d.places[0]!.apps, []);
  assert.ok(d.places.some(p => p.label === 'alpha'));
});

test('step two reads text only for the places that were chosen, and hides what looks like a key', async t => {
  const f = fixture(t), scanner = createScanner({ home: f.home });
  const home = await scanner.discover();
  const picked = await scanner.addFolder(f.work);
  const claude = byLabel(home, 'Claude Code at home'), alpha = byLabel(picked, 'alpha');
  const batch = await scanner.read([claude.id, alpha.id]);
  assert.equal(batch.reads.length, 2);
  const [c, a] = batch.reads;
  const names = c!.records.map(r => `${r.kind}:${r.name}`).sort();
  assert.deepEqual(names, ['agent:helper', 'agent:reviewer', 'hook:PostToolUse: Edit|Write', 'mcp:remote', 'mcp:tracker', 'prompt:ship', 'skill:Check the totals', 'skill:Tidy notes', 'skill:Write a reply', 'skill:Broken one'].sort());
  assert.equal(c!.partlyRead, 1, 'the broken front matter is counted as partly read');
  assert.equal(c!.tally.tooBig, 1); assert.equal(c!.tally.binary, 1);
  assert.deepEqual(a!.records.map(r => `${r.kind}:${r.name}`).sort(), ['mcp:alphadb', 'skill:Alpha skill', 'skill:Check the totals']);
  assert.equal(a!.notes.length, 3);
  assert.deepEqual(a!.notes.map(n => n.title).sort(), ['Alpha', 'Alpha plan', 'An idea']);
  assert.deepEqual(a!.notes.find(n => n.title === 'Alpha plan')!.tags, ['alpha', 'planning']);
  // The text of a skill is kept, but a key in it is hidden.
  const hostile = c!.records.find(r => r.name === 'Tidy notes')!;
  assert.match(hostile.text, /<script>/, 'the text is kept as text');
  assert.doesNotMatch(hostile.text, new RegExp(FAKE_TOKEN_IN_TEXT));
  assert.match(hostile.text, /\[hidden key\]/);
  const all = JSON.stringify(batch);
  assert.doesNotMatch(all, new RegExp(FAKE_SECRET), 'a key value is nowhere in the result');
  assert.doesNotMatch(all, /Must never be read|outside-skill|dep skill|too deep|plugin skill/, 'nothing from outside the places, from a dependency folder or from a plug-in store');
  assert.doesNotMatch(all, /someone@example/, 'the account details in the home config are not read');
});

test('reading changes nothing: the fixture is the same before and after every call', async t => {
  const f = fixture(t), before = fingerprint(f.root);
  const scanner = createScanner({ home: f.home });
  const home = await scanner.discover(), picked = await scanner.addFolder(f.work);
  await scanner.read([...home.places, ...picked.places].map(p => p.id));
  assert.equal(fingerprint(f.root), before);
});

test('step two refuses an id that was not listed, a bad argument, and too many places', async t => {
  const f = fixture(t), scanner = createScanner({ home: f.home });
  const d = await scanner.discover();
  const code = async (ids: unknown): Promise<string> => { try { await scanner.read(ids); return 'accepted'; } catch (e) { assert.ok(e instanceof RealRefusal); return e.code; } };
  assert.equal(await code(undefined), 'BAD_ARGUMENT'); assert.equal(await code(null), 'BAD_ARGUMENT'); assert.equal(await code('place-1'), 'BAD_ARGUMENT'); assert.equal(await code({ length: 1, 0: d.places[0]!.id }), 'BAD_ARGUMENT');
  assert.equal(await code([]), 'BAD_ARGUMENT'); assert.equal(await code([5]), 'BAD_ARGUMENT'); assert.equal(await code([{}]), 'BAD_ARGUMENT'); assert.equal(await code(['x'.repeat(100)]), 'BAD_ARGUMENT');
  assert.equal(await code(['place-000000000000']), 'UNKNOWN_PLACE'); assert.equal(await code(['../../etc', d.places[0]!.id]), 'UNKNOWN_PLACE'); assert.equal(await code(['/etc/passwd']), 'UNKNOWN_PLACE'); assert.equal(await code([f.home]), 'BAD_ARGUMENT', 'a long path is not an id'); assert.equal(await code(['__proto__']), 'UNKNOWN_PLACE');
  assert.equal(await code(Array.from({ length: REAL_LIMITS.places + 1 }, () => d.places[0]!.id)), 'TOO_MANY');
  assert.equal(await code([d.places[0]!.id, d.places[0]!.id]), 'accepted', 'a repeated id is read once');
  // A second look forgets the first list.
  const old = d.places[0]!.id;
  await scanner.discover();
  assert.equal(await code([old]), 'accepted', 'the same folder gives the same id, so it is still listed');
  const other = createScanner({ home: f.home });
  assert.equal((await other.read([old]).catch((e: unknown) => (e as RealRefusal).code)), 'UNKNOWN_PLACE', 'a scanner that never listed it refuses it');
});

test('a folder to add must be a folder that is there', async t => {
  const f = fixture(t), scanner = createScanner({ home: f.home });
  for (const bad of ['', '\u0000', join(f.home, 'nothing-here'), join(f.home, '.claude.json'), 5, null, undefined]) {
    await assert.rejects(scanner.addFolder(bad as string), (e: unknown) => e instanceof RealRefusal && e.code === 'BAD_ARGUMENT', String(bad));
  }
});

test('one call at a time: a second call while the first runs is refused', async t => {
  const f = fixture(t), scanner = createScanner({ home: f.home });
  const first = scanner.discover();
  await assert.rejects(scanner.discover(), (e: unknown) => e instanceof RealRefusal && e.code === 'BUSY');
  await first;
  await scanner.discover();
});

test('the time budget stops a call early and says so', async t => {
  const f = fixture(t);
  let clock = 0;
  const scanner = createScanner({ home: f.home, now: () => { clock += REAL_LIMITS.budgetMs; return clock; } });
  const d = await scanner.discover();
  assert.equal(d.stoppedEarly, true);
  assert.match(d.notes.join(' '), /stopped early/);
  assert.equal(d.places.length, 0);
});

test('a place with more than the file cap of notes is cut at the cap and says so', async t => {
  const dir = tempDir(t), many = join(dir, 'many');
  mkdirSync(many);
  for (let i = 0; i < REAL_LIMITS.filesPerPlace + 20; i += 1) writeFileSync(join(many, `n${i}.md`), `# N${i}\n`);
  const scanner = createScanner({ home: dir });
  const d = await scanner.addFolder(many);
  assert.equal(d.places[0]!.counts.notes, REAL_LIMITS.filesPerPlace);
  assert.match(d.notes.join(' '), /only part/);
  const batch = await scanner.read([d.places[0]!.id]);
  assert.equal(batch.reads[0]!.notes.length, REAL_LIMITS.pagesPerPlace);
  assert.equal(batch.reads[0]!.notesLeftOut, REAL_LIMITS.filesPerPlace - REAL_LIMITS.pagesPerPlace);
});

test('no more than the place cap are listed', async t => {
  const dir = tempDir(t), root = join(dir, 'root');
  for (let i = 0; i < REAL_LIMITS.places + 10; i += 1) mkdirSync(join(root, `p${String(i).padStart(3, '0')}`, '.claude'), { recursive: true });
  const d = await createScanner({ home: dir }).addFolder(root);
  assert.equal(d.places.length, REAL_LIMITS.places);
  assert.match(d.notes.join(' '), /only part/);
});

test('a loop of shortcuts inside a folder does not hang the reader', async t => {
  const dir = tempDir(t), root = join(dir, 'root'), { symlinkSync } = await import('node:fs');
  mkdirSync(join(root, 'a', 'b'), { recursive: true });
  symlinkSync(join(root, 'a'), join(root, 'a', 'b', 'back'));
  writeFileSync(join(root, 'a', 'note.md'), '# Note\n');
  const d = await createScanner({ home: dir }).addFolder(root);
  assert.equal(d.places[0]!.counts.notes, 1);
});

test('names with odd characters are skipped and counted, never thrown', async t => {
  const dir = tempDir(t), root = join(dir, 'root');
  mkdirSync(root);
  writeFileSync(join(root, 'bad\nname.md'), '# x\n'); writeFileSync(join(root, 'tab\there.md'), '# y\n'); writeFileSync(join(root, 'fine é 😀.md'), '# z\n');
  const d = await createScanner({ home: dir }).addFolder(root);
  assert.equal(d.places[0]!.counts.notes, 1);
  assert.ok(d.couldNotRead >= 2);
});

test('the scanner as typed has the three calls and nothing that writes', () => {
  const s: Scanner = createScanner({ home: '/nonexistent-home-for-a-type-check' });
  assert.deepEqual(Object.keys(s).sort(), ['addFolder', 'discover', 'knownIds', 'read']);
});
