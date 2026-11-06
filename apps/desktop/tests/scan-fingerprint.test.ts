// The fingerprint of the watched places (main/scan-session.ts, fingerprintOf, with the walk in main/real-scan.ts): the names, sizes and change times of the files the reader lists for the places a person ticked, and which
// tool folders the home folder holds. No file is opened. It is the same on a quiet folder and different when a listed file is added, removed, resized or touched, and it ignores
// the folders the reader never lists (a session log, a file next to the tool folders). Every folder here is a made-up temporary one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createScanner } from '../main/real-scan.js';
import type { WatchedPlace } from '../main/real-scan.js';
import { fingerprintOf } from '../main/scan-session.js';
import type { RealPlace } from '../shared/real/types.js';
import { buildFixture } from './fixtures-real/build.js';
import type { Fixture } from './fixtures-real/build.js';
import { tempDir } from './support.js';
import type { TestContext } from 'node:test';

const fixture = (t: TestContext): Fixture => { const f = buildFixture(); t.after(() => f.cleanup()); return f; };
const watchOf = (places: readonly RealPlace[]): WatchedPlace[] => places.map(p => ({ id: p.id, kind: p.kind, path: p.details.path }));
const put = (file: string, text: string): void => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, text); };

/** The places of a home folder and of a picked folder, as the window would hold them after step one. */
async function places(f: Fixture): Promise<{ home: readonly RealPlace[]; picked: readonly RealPlace[]; all: WatchedPlace[] }> {
  const scanner = createScanner({ home: f.home });
  const home = (await scanner.discover()).places, picked = (await scanner.addFolder(f.work)).places;
  return { home, picked, all: watchOf([...home, ...picked]) };
}
const print = async (f: Fixture, watched: readonly WatchedPlace[]): Promise<string> => { const r = await fingerprintOf(f.home, watched); assert.equal(r.complete, true); return r.fingerprint; };

test('the fingerprint is 64 hex digits and is the same on a quiet folder', async t => {
  const f = fixture(t), { all } = await places(f);
  const one = await print(f, all), two = await print(f, all);
  assert.match(one, /^[0-9a-f]{64}$/);
  assert.equal(one, two);
  assert.equal(await print(f, [...all].reverse()), one, 'the order of the places does not matter');
});

test('a skill that is added, removed, resized or touched changes it', async t => {
  const f = fixture(t), { all } = await places(f), base = await print(f, all);
  const skill = join(f.home, '.claude', 'skills', 'write-reply', 'SKILL.md');
  put(join(f.home, '.claude', 'skills', 'new-one', 'SKILL.md'), '---\nname: New one\n---\n');
  const added = await print(f, all);
  assert.notEqual(added, base, 'added');
  rmSync(join(f.home, '.claude', 'skills', 'new-one'), { recursive: true });
  assert.equal(await print(f, all), base, 'and removed again: the same as at the start');
  writeFileSync(skill, '---\nname: Write a reply\ndescription: Drafts a reply in your voice for you to check, a bit longer.\n---\n\nRead the message. Write a reply.\n');
  const resized = await print(f, all);
  assert.notEqual(resized, base, 'resized');
  utimesSync(skill, new Date(1_700_000_000_000), new Date(1_700_000_000_000));
  assert.notEqual(await print(f, all), resized, 'only the change time moved');
  rmSync(skill);
  assert.notEqual(await print(f, all), base, 'removed');
});

test('a config file of the home folder and an agent file count too', async t => {
  const f = fixture(t), { all } = await places(f), base = await print(f, all);
  writeFileSync(join(f.home, '.claude.json'), JSON.stringify({ mcpServers: {} }));
  const config = await print(f, all);
  assert.notEqual(config, base);
  put(join(f.home, '.claude', 'agents', 'helper.md'), '---\nname: helper\n---\n');
  assert.notEqual(await print(f, all), config);
});

test('a folder the reader never lists does not change it', async t => {
  const f = fixture(t), { all } = await places(f), base = await print(f, all);
  put(join(f.home, '.claude', 'projects', 'session.jsonl'), 'a longer log line of a session\n'.repeat(50));
  put(join(f.home, 'notes-for-me.txt'), 'not a tool folder\n');
  put(join(f.work, 'node_modules', 'pkg', 'readme.md'), '# a dependency\n');
  assert.equal(await print(f, all), base);
});

test('a notes page or a project skill in a picked folder changes it', async t => {
  const f = fixture(t), { all } = await places(f), base = await print(f, all);
  put(join(f.work, 'alpha', 'notes', 'plan.md'), '---\ntitle: Alpha plan\n---\nA new plan for alpha.\n');
  const note = await print(f, all);
  assert.notEqual(note, base, 'a notes page');
  put(join(f.work, 'alpha', '.claude', 'skills', 'another', 'SKILL.md'), '---\nname: Another\n---\n');
  assert.notEqual(await print(f, all), note, 'a project skill');
});

test('a tool folder that appears or goes under the home folder changes it, even when it was not ticked', async t => {
  const f = fixture(t), scanner = createScanner({ home: f.home });
  const claude = (await scanner.discover()).places.filter(p => p.label === 'Claude Code at home');
  const watched = watchOf(claude), base = await print(f, watched);
  rmSync(join(f.home, '.codex'), { recursive: true, force: true });
  assert.notEqual(await print(f, watched), base, 'a tool folder went');
});

test('a ticked place that is gone changes it, and a place that cannot be placed does not crash', async t => {
  const f = fixture(t), { all, picked } = await places(f), base = await print(f, all);
  rmSync(join(f.work, 'alpha'), { recursive: true });
  assert.notEqual(await print(f, all), base, 'a project folder was removed');
  const odd: WatchedPlace[] = [{ id: picked[0]!.id, kind: 'picked', path: 'relative/nowhere' }, { id: 'place-000000000000', kind: 'home', path: '~' }, { id: 'place-111111111111', kind: 'picked', path: '/nonexistent-folder-for-the-test' }];
  assert.match(await print(f, odd), /^[0-9a-f]{64}$/);
});

test('a check that runs out of time says it is not complete, and its fingerprint never matches', async t => {
  const f = fixture(t), { all } = await places(f);
  let clock = 0;
  const slow = await fingerprintOf(f.home, all, () => { clock += 20_000; return clock; });
  assert.equal(slow.complete, false);
  const again = await fingerprintOf(f.home, all, () => { clock += 20_000; return clock; });
  assert.notEqual(slow.fingerprint, again.fingerprint);
});

test('the fingerprint holds no name, no path and no text of the folders', async t => {
  const f = fixture(t), { all } = await places(f);
  const text = await print(f, all);
  assert.equal(text.length, 64);
  assert.doesNotMatch(text, new RegExp(f.root));
  // A place in a folder with a name nobody should see: the fingerprint is a hash, so the name is nowhere in it.
  const other = tempDir(t);
  put(join(other, '.claude', 'skills', 'secret-named-skill', 'SKILL.md'), '---\nname: x\n---\n');
  const found = (await createScanner({ home: other }).discover()).places;
  assert.doesNotMatch((await fingerprintOf(other, watchOf(found))).fingerprint, /secret/);
});
