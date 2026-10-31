// A tool home on a lived-in machine: scratch space, plug-in clones, work-folder copies, skills with deep support folders and broken links. The reader enters only the folders
// that can hold something (the allowlist of each program), treats a skill folder as a leaf, says "partly read" only when something that could matter was left out, and names
// what it could not follow. Fixtures only: nothing here reads a real folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, lstatSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TestContext } from 'node:test';
import { createScanner } from '../main/real-scan.js';
import { addTally, couldNotRead, makeBudget, newTally, readText, walkFiles } from '../main/real-fs.js';
import type { WalkOptions } from '../main/real-fs.js';
import { ADAPTERS, adapterOf } from '../shared/real/adapters.js';
import { tallyWords } from '../shared/real/place.js';
import { buildRealResult } from '../shared/real/map-world.js';
import { realToHarnessState } from '../shared/harness/real-map.js';
import type { RealPlace, RealResult } from '../shared/real/types.js';
import { PlaceNotes } from '../renderer/harness/real/ReadNotes.js';
import { PlaceRow } from '../renderer/harness/real/PlaceRow.js';
import { REAL } from '../renderer/harness/real/words-real.js';
import { FAKE_TOKEN_IN_TEXT } from './fixtures-real/build.js';
import { fingerprint } from './fixtures-real/fingerprint.js';
import { OUTSIDE_MARKER, SCRATCH_FILES, buildToolHomes } from './fixtures-real/tool-homes.js';
import { tempDir } from './support.js';

const put = (file: string, text = 'x\n'): void => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, text); };
const budget = () => makeBudget(() => 0);
const walk = (dir: string, over: Partial<WalkOptions>, tally = newTally()): { out: string[]; tally: ReturnType<typeof newTally> } => {
  const out = walkFiles(dir, dir, { maxDepth: 6, maxFiles: 1000, maxEntries: 1000, skipDirs: new Set(), skipHidden: false, accept: rel => rel.endsWith('.md'), ...over }, budget(), tally);
  return { out: out.map(f => f.rel), tally };
};
const agentLike = (name: string): string => `---\nname: ${name}\ndescription: Made up.\n---\nHelp\n`;
const isSkillFolder = (names: readonly string[]): boolean => names.some(n => n.toLowerCase() === 'skill.md');

// ---------------------------------------------------------------------------------------------------------------------- the walk: allowlist, leaf, truncated

test('rootDirs: only the named top-level folders are entered (any case), top-level files still count, and a folder left out is neither listed nor flagged', t => {
  const dir = tempDir(t);
  put(join(dir, 'Agents', 'a.md')); put(join(dir, 'skills', 's', 'b.md')); put(join(dir, 'top.md')); put(join(dir, 'jobs', 'x', 'c.md'));
  put(join(dir, 'other', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h.md'));
  mkdirSync(join(dir, 'locked'), { recursive: true }); chmodSync(join(dir, 'locked'), 0o000);
  try {
    const { out, tally } = walk(dir, { rootDirs: new Set(['agents', 'skills']) });
    assert.deepEqual(out, ['Agents/a.md', 'skills/s/b.md', 'top.md']);
    assert.equal(tally.truncated, false, 'a folder left out never sets the flag, however deep it is');
    assert.equal(couldNotRead(tally), 0, 'a folder left out is not even listed (the locked one would have been counted)');
    const open = walk(dir, {});
    assert.ok(open.out.includes('jobs/x/c.md'), 'without rootDirs nothing changes'); assert.equal(open.tally.unreadable, 1);
  } finally { chmodSync(join(dir, 'locked'), 0o755); }
});

test('rootDirs: a link at the top whose name the reader does not want is not followed or counted, and a wanted file behind a link still is', t => {
  const dir = tempDir(t);
  symlinkSync(join(dir, 'nowhere'), join(dir, 'broken-folder'));
  put(join(dir, 'real.md'));
  symlinkSync(join(dir, 'real.md'), join(dir, 'link.md'));
  const { out, tally } = walk(dir, { rootDirs: new Set(['agents']) });
  assert.deepEqual(out, ['link.md', 'real.md']);
  assert.equal(couldNotRead(tally), 0, 'the unwanted broken link at the top is not even resolved');
});

test('a folder skipped by the deny-list below the depth cap does not set truncated; a folder that is allowed and too deep does', t => {
  const dir = tempDir(t);
  put(join(dir, 'a', 'b', 'node_modules', 'm.md'));
  const skipped = walk(dir, { maxDepth: 2, skipDirs: new Set(['node_modules']) });
  assert.deepEqual(skipped.out, []); assert.equal(skipped.tally.truncated, false);
  const hidden = walk(dir, { maxDepth: 1, skipDirs: new Set(), skipHidden: true, accept: () => false });
  assert.equal(hidden.tally.truncated, true, 'a plain folder past the cap is still flagged');
  put(join(dir, 'a', '.git', 'g', 'h.md'));
  const dotted = walk(dir, { maxDepth: 2, skipDirs: new Set(['node_modules']), skipHidden: true });
  assert.equal(dotted.tally.truncated, false, 'a hidden folder past the cap is left out, not cut short');
  assert.equal(walk(dir, { maxDepth: 2, skipDirs: new Set() }).tally.truncated, true);
});

test('leafWhen: a skill folder 9 levels deep of support files reads one skill and flags nothing; without it the same walk is flagged', t => {
  const dir = tempDir(t);
  put(join(dir, 'skills', 'k', 'SKILL.md'));
  put(join(dir, 'skills', 'k', 'references', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'deep.md'));
  put(join(dir, 'skills', 'k', 'assets', 'SKILL.md'));
  put(join(dir, 'skills', 'other', 'SKILL.md'));
  const accept = (rel: string): boolean => /(^|\/)SKILL\.md$/.test(rel);
  const leaf = walk(dir, { accept, leafWhen: isSkillFolder });
  assert.deepEqual(leaf.out, ['skills/k/SKILL.md', 'skills/other/SKILL.md']);
  assert.equal(leaf.tally.truncated, false);
  assert.equal(couldNotRead(leaf.tally), 0);
  const plain = walk(dir, { accept });
  assert.equal(plain.tally.truncated, true, 'the control: without the leaf rule the deep folder is cut short');
  assert.ok(plain.out.includes('skills/k/assets/SKILL.md'));
});

test('leafWhen: the root and the top-level folders are never leaves, so a SKILL.md in "skills" does not hide the skills below it', t => {
  const dir = tempDir(t);
  put(join(dir, 'skills', 'SKILL.md')); put(join(dir, 'skills', 'a', 'SKILL.md'));
  const { out } = walk(dir, { accept: rel => rel.endsWith('SKILL.md'), leafWhen: isSkillFolder });
  assert.deepEqual(out, ['skills/SKILL.md', 'skills/a/SKILL.md']);
});

test('leafWhen: a link inside a skill folder whose name is not wanted is not resolved, and a wanted file link still is', t => {
  const dir = tempDir(t);
  put(join(dir, 'skills', 'k', 'SKILL.md'));
  symlinkSync(join(dir, 'nowhere'), join(dir, 'skills', 'k', 'support'));
  const { out, tally } = walk(dir, { accept: rel => rel.endsWith('SKILL.md'), leafWhen: isSkillFolder });
  assert.deepEqual(out, ['skills/k/SKILL.md']);
  assert.equal(couldNotRead(tally), 0);
});

test('too many files or entries in an allowed branch still set truncated', t => {
  const dir = tempDir(t);
  for (let i = 0; i < 10; i += 1) put(join(dir, 'agents', `f${i}.md`));
  assert.equal(walk(dir, { rootDirs: new Set(['agents']), maxFiles: 3 }).tally.truncated, true);
  assert.equal(walk(dir, { rootDirs: new Set(['agents']), maxEntries: 5 }).tally.truncated, true);
  assert.equal(walk(dir, { rootDirs: new Set(['agents']), maxFiles: 10 }).tally.truncated, false);
});

// ---------------------------------------------------------------------------------------------------------------------- naming what was not read

test('a broken link is counted by itself, named, and not counted as a thing that could not be opened', t => {
  const dir = tempDir(t);
  put(join(dir, 'agents', 'ok.md'));
  symlinkSync(join(dir, 'agents', 'gone.md'), join(dir, 'agents', 'critic.md'));
  const { out, tally } = walk(dir, {});
  assert.deepEqual(out, ['agents/ok.md']);
  assert.equal(tally.brokenLinks, 1); assert.equal(tally.unreadable, 0);
  assert.deepEqual(tally.samples.brokenLinks, ['agents/critic.md']);
  assert.equal(couldNotRead(tally), 1, 'it is one of the things the person is told were not read');
});

test('a link that leads outside, a folder that will not open, a file over 2 MB and a file that is not text are named too; five names at most, each one plain line of at most 80 characters', t => {
  const dir = tempDir(t), outside = tempDir(t, 'bowerloom-outside-');
  put(join(outside, 'x.md'));
  for (let i = 0; i < 7; i += 1) symlinkSync(join(outside, 'x.md'), join(dir, `out-${i}.md`));
  mkdirSync(join(dir, 'locked')); chmodSync(join(dir, 'locked'), 0o000);
  put(join(dir, 'huge.md'), 'a'.repeat(3 * 1024 * 1024));
  writeFileSync(join(dir, 'bin.md'), Buffer.from([0x89, 0x50, 0x00, 0x01]));
  const tally = newTally();
  try {
    walk(dir, {}, tally);
    for (const name of ['huge.md', 'bin.md']) readText(join(dir, name), dir, tally);
  } finally { chmodSync(join(dir, 'locked'), 0o755); }
  assert.equal(tally.linksOutside, 7); assert.equal(tally.samples.linksOutside.length, 5);
  assert.ok(tally.samples.linksOutside.every(n => /^out-\d\.md$/.test(n)));
  assert.deepEqual(tally.samples.unreadable, ['locked']);
  assert.deepEqual(tally.samples.tooBig, ['huge.md']); assert.deepEqual(tally.samples.binary, ['bin.md']);
});

test('a sample name is scrubbed like every other name the reader shows: no key shape, no control character, at most 80 characters', t => {
  const dir = tempDir(t);
  const bad = `${FAKE_TOKEN_IN_TEXT}${'n'.repeat(120)}`;
  symlinkSync(join(dir, 'nowhere'), join(dir, `${bad}.md`));
  symlinkSync(join(dir, 'nowhere'), join(dir, `ctl${String.fromCharCode(0x202e)}name.md`));
  const { tally } = walk(dir, {});
  assert.equal(tally.brokenLinks, 1); assert.equal(tally.unreadable, 1, 'a name with a control character is skipped and counted');
  const all = [...tally.samples.brokenLinks, ...tally.samples.unreadable];
  assert.equal(all.length, 2);
  for (const sample of all) {
    assert.ok(sample.length <= 80, sample);
    assert.doesNotMatch(sample, new RegExp(FAKE_TOKEN_IN_TEXT));
    assert.ok(!sample.includes(String.fromCharCode(0x202e)), sample);
  }
  assert.match(tally.samples.unreadable[0]!, /^ctl.*name\.md$/);
});

test('the samples of two tallies add up to five at most, without repeats', () => {
  const a = newTally(), b = newTally();
  a.brokenLinks = 3; a.samples.brokenLinks.push('a/1', 'a/2', 'a/3');
  b.brokenLinks = 4; b.samples.brokenLinks.push('a/3', 'b/1', 'b/2', 'b/3');
  addTally(a, b);
  assert.equal(a.brokenLinks, 7);
  assert.deepEqual(a.samples.brokenLinks, ['a/1', 'a/2', 'a/3', 'b/1', 'b/2']);
});

test('the words: names follow the count, "and N more" counts the rest, no name gives the old line, and a broken link has its own plain sentence', () => {
  const base = { tooBig: 0, binary: 0, unreadable: 0, linksOutside: 0, stoppedEarly: false, truncated: false };
  assert.deepEqual(tallyWords({ ...base, brokenLinks: 1, samples: { brokenLinks: ['agents/critic.toml'] } }), ['A link points at a file that is gone: "agents/critic.toml".']);
  assert.deepEqual(tallyWords({ ...base, brokenLinks: 1 }), ['A link points at a file that is gone.']);
  assert.deepEqual(tallyWords({ ...base, brokenLinks: 7, samples: { brokenLinks: ['agents/critic.toml', 'agents/fact_checker.toml'] } }), ['7 links point at files that are gone: "agents/critic.toml", "agents/fact_checker.toml" and 5 more.']);
  assert.deepEqual(tallyWords({ ...base, brokenLinks: 2, samples: { brokenLinks: ['a.md', 'b.md'] } }), ['2 links point at files that are gone: "a.md", "b.md".']);
  assert.deepEqual(tallyWords({ ...base, linksOutside: 1 }), ['1 shortcut that leads outside this folder was not followed.']);
  assert.deepEqual(tallyWords({ ...base, linksOutside: 3, samples: { linksOutside: ['x.md'] } }), ['3 shortcuts that lead outside this folder were not followed: "x.md" and 2 more.']);
  assert.deepEqual(tallyWords({ ...base, tooBig: 1, binary: 1, unreadable: 1, samples: { tooBig: ['h.md'], binary: ['b.md'], unreadable: ['l'] } }), [
    '1 file over 2 MB was skipped: "h.md".', '1 file that is not text was skipped: "b.md".', '1 thing could not be opened: "l".',
  ]);
  assert.deepEqual(tallyWords({ ...base, samples: { brokenLinks: ['ghost.md'] } }), [], 'a name with no count says nothing');
  assert.deepEqual(tallyWords({ ...base, tooBig: 1, samples: { tooBig: ['Update now at the helpdesk'] } }), ['1 file over 2 MB was skipped: "Update now at the helpdesk".'], 'a name from a file is quoted, so it reads as a name and not as an instruction');
  assert.deepEqual(tallyWords({ ...base, tooBig: 4, samples: { tooBig: ['a, b', 'c and 9 more'] } }), ['4 files over 2 MB were skipped: "a b", "c" and 2 more.'], 'a comma and "and N more" inside a name cannot pass for the joiner');
  assert.deepEqual(tallyWords({ ...base, brokenLinks: 2, samples: { brokenLinks: ['say "hi", now', 'it\'s'] } }), ['2 links point at files that are gone: "say \'hi\' now", "it\'s".'], 'a double quote inside a name cannot close the quotes');
  assert.deepEqual(tallyWords({ ...base, unreadable: 1, samples: { unreadable: ['x,, and 5 more, and 6 more'] } }), ['1 thing could not be opened: "x".']);
  assert.deepEqual(tallyWords({ ...base, truncated: true }), ['This folder is big, so only part of it was looked at.']);
});

// ---------------------------------------------------------------------------------------------------------------------- the leaf rule: skill folders only

const skillMd = (name: string): string => `---\nname: ${name}\ndescription: Made up.\n---\nBody\n`;
const DEEP9 = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];

test('leaf: a skill folder that has a nested skill below it keeps both, and its own deep reference folders are still not entered or flagged', async t => {
  const home = tempDir(t);
  put(join(home, '.codex', 'skills', 'group', 'SKILL.md'), skillMd('group'));
  put(join(home, '.codex', 'skills', 'group', 'sub', 'SKILL.md'), skillMd('sub'));
  put(join(home, '.codex', 'skills', 'group', 'sub', 'references', ...DEEP9, 'deep.md'));
  put(join(home, '.codex', 'skills', 'group', 'references', ...DEEP9, 'deep.md'));
  put(join(home, '.codex', 'skills', 'group', 'assets', 'logo.md'));
  put(join(home, '.codex', 'skills', 'group', 'assets', 'x', 'y', 'SKILL.md'), skillMd('too-deep-to-count'));
  const scanner = createScanner({ home });
  const d = await scanner.discover();
  const codex = d.places.find(p => p.label === 'Codex at home')!;
  assert.equal(codex.counts.skills, 2, 'group and group/sub');
  assert.deepEqual(codex.details.notes, [], 'nothing about a deep reference folder: it is left out on purpose');
  const batch = await scanner.read(d.places.map(p => p.id));
  assert.deepEqual(batch.reads.flatMap(r => r.records.map(x => x.name)).sort(), ['group', 'sub']);
  assert.equal(batch.tally.truncated, false); assert.equal(batch.tally.unreadable, 0);
});

test('leaf: a stray SKILL.md in a Hermes profile folder does not hide that profile\'s skills and memories', async t => {
  const home = tempDir(t);
  put(join(home, '.hermes', 'profiles', 'p', 'SKILL.md'), skillMd('stray'));
  put(join(home, '.hermes', 'profiles', 'p', 'skills', 'cat', 'one', 'SKILL.md'), skillMd('one'));
  put(join(home, '.hermes', 'profiles', 'p', 'memories', 'm.md'), '# A memory\n');
  put(join(home, '.hermes', 'skills', 'top', 'SKILL.md'), skillMd('top'));
  const d = await createScanner({ home }).discover();
  const hermes = d.places.find(p => p.label === 'Hermes at home')!;
  assert.equal(hermes.counts.notes, 1, 'the memory under the profile');
  assert.equal(hermes.counts.skills, 2, 'p/skills/cat/one and skills/top');
});

test('leaf: a stray SKILL.md in an agents namespace folder does not hide the other agents under it', async t => {
  const home = tempDir(t);
  put(join(home, '.claude', 'agents', 'ns', 'SKILL.md'), skillMd('stray'));
  put(join(home, '.claude', 'agents', 'ns', 'a.md'), agentLike('a'));
  put(join(home, '.claude', 'agents', 'ns', 'more', 'b.md'), agentLike('b'));
  put(join(home, '.claude', 'agents', 'ns', 'more', 'less', 'c.md'), agentLike('c'));
  const scanner = createScanner({ home });
  const d = await scanner.discover();
  const claude = d.places.find(p => p.label === 'Claude Code at home')!;
  assert.equal(claude.counts.agents, 4, 'the three agents, and the stray file itself (a markdown file under agents/ is an agent)');
  const batch = await scanner.read([claude.id]);
  const names = batch.reads.flatMap(r => r.records.map(x => x.name));
  for (const name of ['a', 'b', 'c']) assert.ok(names.includes(name), name);
  assert.equal(batch.tally.truncated, false);
});

test('leaf: the walk enters only the immediate folders of a leaf that hold a marker file (nestedWhen), and nothing deeper', t => {
  const dir = tempDir(t);
  put(join(dir, 'skills', 'k', 'SKILL.md')); put(join(dir, 'skills', 'k', 'sub', 'SKILL.md')); put(join(dir, 'skills', 'k', 'sub', 'refs', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'z.md'));
  put(join(dir, 'skills', 'k', 'plain', 'readme.md')); put(join(dir, 'skills', 'k', 'plain', 'inner', 'SKILL.md'));
  put(join(dir, 'skills', 'k', 'x', 'y', 'SKILL.md'));
  const hasMarker = (names: readonly string[]): boolean => names.some(n => n.toLowerCase() === 'skill.md');
  const r = walk(dir, { accept: rel => /(^|\/)SKILL\.md$/.test(rel), leafWhen: hasMarker, nestedWhen: hasMarker });
  assert.deepEqual(r.out, ['skills/k/SKILL.md', 'skills/k/sub/SKILL.md']);
  assert.equal(r.tally.truncated, false);
  assert.equal(couldNotRead(r.tally), 0);
});

// ---------------------------------------------------------------------------------------------------------------------- the table

test('each program lists the top-level folders it may enter, from what its own paths can match; Bowerloom keeps none', () => {
  const roots = (id: Parameters<typeof adapterOf>[0]): readonly string[] | undefined => adapterOf(id).walkRoots;
  assert.deepEqual([...(roots('claude-code') ?? [])].sort(), ['agents', 'commands', 'plugins', 'skill', 'skills']);
  assert.deepEqual([...(roots('codex') ?? [])].sort(), ['agents', 'prompts', 'skill', 'skills']);
  assert.ok(roots('opencode')!.includes('skill') && roots('opencode')!.includes('agent') && roots('opencode')!.includes('plugin'));
  assert.ok(roots('hermes')!.includes('skills') && roots('hermes')!.includes('profiles') && roots('hermes')!.includes('memories'));
  assert.equal(roots('bowerloom'), undefined);
  for (const a of ADAPTERS) for (const r of a.walkRoots ?? []) assert.equal(r, r.toLowerCase(), 'compared in lower case');
});

// ---------------------------------------------------------------------------------------------------------------------- the whole reader on a lived-in machine

function toolHomes(t: TestContext): ReturnType<typeof buildToolHomes> {
  const f = buildToolHomes();
  t.after(() => f.cleanup());
  return f;
}

test('a failure while the folders are being locked leaves no locked folder and no temp tree behind, and the error still comes out', () => {
  const seen: string[] = [];
  const failAt = 1;
  assert.throws(() => buildToolHomes({ beforeLock: (dir, index) => { seen.push(dir); if (index === failAt) throw new Error('injected failure'); } }), /injected failure/);
  assert.equal(seen.length, failAt + 1, 'the first folder was locked, the failure came at the second');
  for (const dir of seen) {
    assert.equal(existsSync(dir), false, `a folder that was locked is gone: ${dir}`);
  }
});

test('the lock is undone again by cleanup, which also takes its exit hook away, and a second call is harmless', () => {
  const before = process.listenerCount('exit');
  const f = buildToolHomes();
  assert.equal(process.listenerCount('exit'), before + 1, 'a killed run restores the permissions at exit');
  assert.ok(f.locked.every(dir => (lstatSync(dir).mode & 0o777) === 0));
  f.cleanup();
  assert.equal(existsSync(f.root), false);
  assert.equal(process.listenerCount('exit'), before);
  f.cleanup();
});

test('step one on a lived-in machine: nothing is flagged as partly read, the real items are found, and the broken link is named', async t => {
  const f = toolHomes(t), before = fingerprint(f.root);
  const d = await createScanner({ home: f.home }).discover();
  const claude = d.places.find(p => p.label === 'Claude Code at home')!, codex = d.places.find(p => p.label === 'Codex at home')!;
  assert.ok(claude && codex);
  assert.deepEqual([claude.counts.agents, claude.counts.skills, claude.counts.tools], [1, 1, 1], 'agents/a.md, skills/s, commands/go.md');
  assert.deepEqual([codex.counts.agents, codex.counts.skills, codex.counts.tools], [1, 1, 1], 'agents/ok.toml, skills/k, prompts/p.md');
  assert.equal(d.notes.length, 0, d.notes.join(' | '));
  assert.equal(claude.details.notes.length, 0, claude.details.notes.join(' | '));
  assert.deepEqual(codex.details.notes, ['A link points at a file that is gone: "agents/x.toml".']);
  assert.equal(d.couldNotRead, 1, 'only the broken link; the locked folders outside the allowlist were never listed');
  assert.doesNotMatch(JSON.stringify(d), /big|partly|smaller/);
  assert.equal(fingerprint(f.root), before, 'nothing changed');
});

test('step two on a lived-in machine: no text outside the allowlist is opened, the skill folder is one skill, and the result is whole', async t => {
  const f = toolHomes(t), before = fingerprint(f.root);
  const scanner = createScanner({ home: f.home });
  const d = await scanner.discover();
  const batch = await scanner.read(d.places.map(p => p.id));
  const all = JSON.stringify(batch);
  assert.doesNotMatch(all, new RegExp(OUTSIDE_MARKER), 'no marker text from a file outside the allowlist');
  assert.doesNotMatch(all, /skill-k-asset|scratch|clone|worktree|trap/, 'nothing from scratch space, a clone, a work-folder copy, a package or a skill\'s support folders');
  const names = batch.reads.flatMap(r => r.records.map(x => `${r.place.apps[0]}:${x.kind}:${x.name}`)).sort();
  assert.deepEqual(names, ['claude-code:agent:agent-a', 'claude-code:prompt:go', 'claude-code:skill:skill-s', 'codex:agent:ok', 'codex:prompt:p', 'codex:skill:skill-k']);
  assert.equal(batch.tally.truncated, false); assert.equal(batch.tally.stoppedEarly, false);
  assert.equal(batch.tally.unreadable, 0, 'a locked folder outside the allowlist would have been counted');
  assert.equal(batch.tally.brokenLinks, 1);
  assert.equal(batch.tally.linksOutside + batch.tally.tooBig + batch.tally.binary, 0);
  const result = buildRealResult(batch.reads, batch.tally, { nowMs: Date.UTC(2026, 9, 26) });
  assert.equal(result.couldNotRead, 1);
  assert.ok(!result.notes.some(n => /big|partly/.test(n)), result.notes.join(' | '));
  assert.ok(SCRATCH_FILES >= 300);
  assert.equal(fingerprint(f.root), before, 'nothing changed');
});

test('scratch space is the reason the old reader said "big": the same tree read with only the deny-list is flagged, and with the allowlist it is not', t => {
  const dir = tempDir(t);
  put(join(dir, 'agents', 'a.md')); put(join(dir, 'jobs', 'abc', 'tmp', 'd1', 'd2', 'd3', 'd4', 'scratch.md'));
  const deny = walk(dir, { skipDirs: new Set(adapterOf('claude-code').skipInside) });
  assert.equal(deny.tally.truncated, true);
  const allow = walk(dir, { skipDirs: new Set(adapterOf('claude-code').skipInside), rootDirs: new Set(adapterOf('claude-code').walkRoots) });
  assert.deepEqual(allow.out, ['agents/a.md']); assert.equal(allow.tally.truncated, false);
});

test('a skill whose support folders are 9 levels deep is one skill in a real read, and a project folder keeps the old limits', async t => {
  const home = tempDir(t), work = join(home, 'work');
  put(join(home, '.agents', 'skills', 'synced', 'id1', 'SKILL.md'), '---\nname: synced-one\n---\nBody\n');
  put(join(home, '.agents', 'skills', 'synced', 'id1', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'x.md'));
  put(join(work, 'proj', '.claude', 'skills', 'mine', 'SKILL.md'), '---\nname: mine\n---\nBody\n');
  put(join(work, 'proj', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'deep.md'), '# Deep\n');
  const scanner = createScanner({ home });
  const d = await scanner.discover();
  const codex = d.places.find(p => p.label === 'Codex at home')!;
  assert.equal(codex.counts.skills, 1); assert.deepEqual(codex.details.notes, []);
  const picked = await scanner.addFolder(work);
  const proj = picked.places.find(p => p.label === 'proj')!;
  assert.ok(proj.details.notes.includes('This folder is big, so only part of it was looked at.'), 'a work folder past the depth cap is still partly read');
});

// ---------------------------------------------------------------------------------------------------------------------- the screens

const noop = (): void => undefined;
const BIG = 'This folder is big, so only part of it was looked at.';
const markup = (el: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(el);
const place = (kind: RealPlace['kind'], notes: string[]): RealPlace => ({
  id: `p-${kind}`, label: `Place ${kind}`, kind, apps: ['Claude Code'], appLabel: 'Claude Code', counts: { agents: 1, skills: 0, tools: 0, hooks: 0, notes: 0 }, empty: false,
  details: { path: '~', folders: ['.claude'], topics: [], notes },
});

test('"Pick a smaller folder" shows for a picked or project folder only, never for a tool home, and the names show in the details', () => {
  const row = (kind: RealPlace['kind'], notes: string[]): string => markup(createElement(PlaceRow, { place: place(kind, notes), on: true, open: true, onTick: noop }));
  assert.ok(row('picked', [BIG]).includes(REAL.hint.nextStep)); assert.ok(row('project', [BIG]).includes(REAL.hint.nextStep));
  assert.ok(row('home', [BIG]).includes(BIG), 'the sentence about a big tool home is still said'); assert.ok(!row('home', [BIG]).includes(REAL.hint.nextStep));
  const gone = 'A link points at a file that is gone: "agents/x.toml".';
  assert.ok(row('home', [gone]).includes('agents/x.toml'));
  const html = markup(createElement(PlaceNotes, { places: [{ name: 'Home', notes: [BIG], toolHome: true }, { name: 'Work', notes: [BIG] }, { name: 'Links', notes: [gone], toolHome: true }] }));
  assert.equal(html.split(REAL.hint.nextStep).length, 2, 'the step shows once, for the work folder');
  assert.ok(html.indexOf(REAL.hint.nextStep) > html.indexOf('Work') && html.indexOf(REAL.hint.nextStep) < html.indexOf('Links'));
  assert.ok(html.includes('agents/x.toml'));
});

test('the state marks the notes of a tool home, so the page can leave out the step that cannot work there', () => {
  const empty: RealResult = {
    world: { interfaces: [], items: [], scopes: [{ id: 'global', kind: 'global', name: 'Your home folder', parentId: null, path: '~' }], overrides: [], wikiPages: [], slices: [], versions: [], libraries: [] },
    others: [], counts: { agents: 0, skills: 0, tools: 0, hooks: 0, notes: 0 }, ages: {}, stoppedEarly: false, couldNotRead: 0, partlyRead: 0, textsCut: 0, notes: [], readOnly: true,
  };
  const state = realToHarnessState(empty, [place('home', [BIG]), place('project', [BIG])]);
  assert.deepEqual(state.real!.places, [{ name: 'Place home', notes: [BIG], toolHome: true }, { name: 'Place project', notes: [BIG] }]);
});
