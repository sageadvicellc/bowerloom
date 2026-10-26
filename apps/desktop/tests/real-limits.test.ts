// The limits of the real-setup reader hold while it READS, not only between folders: the clock is looked at inside every read loop, the bytes and the files of one call
// are counted, a pipe is never waited on, the text that goes to the page is capped, and a place is read only inside the real folder recorded when it was found.
// Nothing here reads a real folder: every tree is built in a temporary folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { createScanner } from '../main/real-scan.js';
import { listDir, makeBudget, mustStop, newTally, readText, walkFiles } from '../main/real-fs.js';
import { registerRealIpc } from '../main/real-ipc.js';
import type { RealEvent } from '../main/real-ipc.js';
import { APP_INDEX } from '../main/security.js';
import { hashText, validateWorld } from '../shared/proto/sample.js';
import { buildRealResult } from '../shared/real/map-world.js';
import type { PlaceRead, StampedRecord } from '../shared/real/place.js';
import { parseToml } from '../shared/real/toml.js';
import { REAL_CHANNELS, REAL_HASH, REAL_LIMITS } from '../shared/real/types.js';
import { DESKTOP, tempDir } from './support.js';

const put = (file: string, text: string | Buffer): void => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, text); };
const skill = (name: string, filler = ''): string => `---\nname: ${name}\ndescription: A skill for the limits test.\n---\n${filler}`;
const filler = (bytes: number, tag: string): string => {
  const line = `Line of plain words for the big file ${tag}, nothing secret in it.\n`;
  return line.repeat(Math.floor(bytes / line.length));
};

// ---------------------------------------------------------------------------------------------------------------------- the clock inside the read loops

test('the time budget is checked inside the loop that reads files, not only once for each folder', async t => {
  const home = tempDir(t), total = 400;
  for (let i = 0; i < total; i += 1) put(join(home, '.claude', 'skills', `s${String(i).padStart(3, '0')}.md`), skill(`Skill ${i}`, 'Plain text.\n'));
  // The clock says "no time has passed" for the first looks, and "the time is long gone" after that. All the files are in one folder.
  let calls = 0;
  const scanner = createScanner({ home, now: () => { calls += 1; return calls > 700 ? 1e12 : 0; } });
  const found = await scanner.discover();
  calls = 0;
  const batch = await scanner.read(found.places.map(p => p.id));
  const read = batch.reads.reduce((n, r) => n + r.records.length, 0);
  assert.ok(read > 0 && read < total, `some files were read, then the clock stopped it: ${read} of ${total}`);
  assert.equal(batch.tally.stoppedEarly, true);
  assert.equal(batch.tally.overBytes, false, 'it was the clock');
});

// ---------------------------------------------------------------------------------------------------------------------- the byte and file caps

test('a call that would read more than the byte cap stops early, says so, and the page gets a result of a stated size', async t => {
  const home = tempDir(t), files = 14, each = 2_000_000;
  assert.ok(files * each > REAL_LIMITS.totalBytes && each <= REAL_LIMITS.fileBytes);
  for (let i = 0; i < files; i += 1) put(join(home, '.claude', 'skills', `big${String(i).padStart(2, '0')}`, 'SKILL.md'), skill(`Big ${i}`, filler(each, String(i))));
  const scanner = createScanner({ home });
  const found = await scanner.discover();
  const batch = await scanner.read(found.places.map(p => p.id));
  const records = batch.reads.flatMap(r => r.records);
  assert.equal(batch.tally.stoppedEarly, true, 'stopped early');
  assert.equal(batch.tally.overBytes, true, 'because of the bytes, not the clock');
  assert.ok(records.length >= 9 && records.length <= 11, `${records.length} of ${files} files were read before the cap`);
  assert.ok(records.length * each <= REAL_LIMITS.totalBytes);
  const result = buildRealResult(batch.reads, batch.tally, { nowMs: Date.UTC(2026, 9, 26) });
  assert.equal(result.stoppedEarly, true);
  assert.match(result.notes.join(' '), /stopped early to stay within its size limit/);
  // The page gets an excerpt of each text, never the 2 MB.
  const sizes = result.world.items.flatMap(i => i.foundAt.map(f => f.text.length));
  assert.ok(sizes.length > 0 && Math.max(...sizes) <= REAL_LIMITS.excerptChars + 100, `the longest text sent is ${Math.max(...sizes)} characters`);
  assert.equal(result.textsCut, records.length, 'every text was cut, and the count says so');
  const payload = JSON.stringify(result).length;
  assert.ok(payload < 1_000_000, `the result is ${payload} bytes`);
  assert.deepEqual(validateWorld(result.world), [], 'a cut text still matches its own hash');
});

test('a file count and a byte count are taken one file at a time, and a spent budget refuses every later file', () => {
  const budget = makeBudget(() => 0, 1000, 100, 3);
  assert.equal(budget.take(40), true); assert.equal(budget.take(40), true);
  assert.equal(budget.take(40), false, 'the third file would pass the byte cap');
  assert.equal(budget.spent(), true);
  assert.equal(budget.take(1), false, 'once spent, nothing more is taken');
  const tally = newTally();
  assert.equal(mustStop(budget, tally), true);
  assert.deepEqual([tally.stoppedEarly, tally.overBytes], [true, true]);
  const files = makeBudget(() => 0, 1000, 1e9, 2);
  assert.deepEqual([files.take(1), files.take(1), files.take(1)], [true, true, false], 'the file count caps too');
  let clock = 0;
  const timed = makeBudget(() => clock, 10);
  assert.equal(mustStop(timed, newTally()), false); clock = 10;
  const t2 = newTally();
  assert.equal(mustStop(timed, t2), true); assert.deepEqual([t2.stoppedEarly, t2.overBytes], [true, false], 'a spent clock is not a byte stop');
});

test('the text that goes to the page is capped for each text and for the whole result, and the cap is stated', () => {
  const big = 'word '.repeat(20000), count = 2000;
  const records: StampedRecord[] = Array.from({ length: count }, (_v, i) => ({
    kind: 'skill', app: 'claude-code', name: `skill ${i}`, slug: `skill-${i}`, description: 'A skill.', relPath: `.claude/skills/s${i}/SKILL.md`, text: `${i} ${big}`, partial: false, meta: {}, mtimeMs: 0,
  }));
  const read: PlaceRead = {
    place: { id: 'place-test', kind: 'home', label: 'Claude Code at home', path: '~', apps: ['claude-code'] }, records, notes: [], notesLeftOut: 0, partlyRead: 0, folders: ['.claude'],
    tally: { tooBig: 0, binary: 0, unreadable: 0, linksOutside: 0, stoppedEarly: false, truncated: false },
  };
  const result = buildRealResult([read], read.tally, { nowMs: 0 });
  const texts = result.world.items.flatMap(i => i.foundAt.map(f => f.text));
  assert.equal(texts.length, count);
  assert.ok(texts.every(x => x.length <= REAL_LIMITS.excerptChars + 60));
  const total = texts.reduce((n, x) => n + x.length, 0);
  assert.ok(total <= REAL_LIMITS.resultTextChars + count * (REAL_LIMITS.minExcerptChars + 60), `${total} characters of text in all`);
  assert.ok(texts.slice(-10).every(x => x.length <= REAL_LIMITS.minExcerptChars + 60), 'once the whole-result cap is spent each text is short');
  const payload = JSON.stringify(result).length;
  assert.ok(payload < 12_000_000, `the result is ${payload} bytes (stated cap: ${REAL_LIMITS.resultTextChars} characters of text, then ${REAL_LIMITS.minExcerptChars} for each item)`);
  assert.equal(result.textsCut, count);
  for (const item of result.world.items) for (const f of item.foundAt) assert.equal(f.contentHash, hashText(f.text));
  assert.match(texts[0]!, /\[cut: \d+ characters in all\]$/);
});

// ---------------------------------------------------------------------------------------------------------------------- a pipe is never waited on

const CHILD = `
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [home, fifo] = process.argv.slice(1);
const out = await build({ stdin: { contents: "export * from './main/real-scan.ts'; export * from './main/real-fs.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const file = join(mkdtempSync(join(tmpdir(), 'bowerloom-real-child-')), 'reader.mjs');
writeFileSync(file, out.outputFiles[0].text);
const reader = await import(pathToFileURL(file).href);
const tally = reader.newTally();
const direct = reader.readText(fifo, home, tally);
const scanner = reader.createScanner({ home });
const found = await scanner.discover();
const batch = await scanner.read(found.places.map(p => p.id));
process.stdout.write(JSON.stringify({ direct, directCounted: tally.unreadable, discoverCounted: found.couldNotRead, readCounted: batch.reads.reduce((n, r) => n + r.tally.unreadable, 0), records: batch.reads.flatMap(r => r.records.map(x => x.name)) }));
`;

test('a pipe where a skill, an agent or a settings file should be is skipped and counted, and nothing waits for it', t => {
  const home = tempDir(t);
  put(join(home, '.claude', 'skills', 'fine', 'SKILL.md'), skill('Fine skill'));
  for (const file of [join(home, '.claude', 'skills', 'pipe', 'SKILL.md'), join(home, '.claude', 'agents', 'pipe.md'), join(home, '.claude', 'settings.json')]) {
    mkdirSync(join(file, '..'), { recursive: true });
    execFileSync('mkfifo', [file]);
  }
  const direct = join(home, '.claude', 'skills', 'direct.md');
  execFileSync('mkfifo', [direct]);
  const ran = spawnSync(process.execPath, ['--input-type=module', '-e', CHILD, home, direct], { cwd: DESKTOP, encoding: 'utf8', timeout: 30000 });
  assert.equal(ran.error, undefined, `the reader did not finish: ${String(ran.error)}`);
  assert.equal(ran.status, 0, ran.stderr);
  const out = JSON.parse(ran.stdout) as { direct: string | null; directCounted: number; discoverCounted: number; readCounted: number; records: string[] };
  assert.equal(out.direct, null); assert.equal(out.directCounted, 1);
  assert.deepEqual(out.records, ['Fine skill']);
  assert.ok(out.discoverCounted >= 1 && out.readCounted >= 3, `the pipes are counted: ${out.discoverCounted} and ${out.readCounted}`);
});

// ---------------------------------------------------------------------------------------------------------------------- a huge folder is listed only as far as the cap

test('a folder is listed only up to the entry limit, and a walk over a huge folder stops at the entry cap', t => {
  const dir = tempDir(t);
  for (let i = 0; i < 3000; i += 1) writeFileSync(join(dir, `f${String(i).padStart(4, '0')}.md`), '# x\n');
  const tally = newTally();
  assert.equal(listDir(dir, tally, 100).length, 100, 'only 100 of 3000 names were taken from the folder');
  assert.equal(listDir(dir, tally).length, 3000, 'the default limit is the discovery cap, so this folder is listed whole');
  const walked = walkFiles(dir, dir, { maxDepth: 2, maxFiles: 1e9, maxEntries: 50, skipDirs: new Set(), skipHidden: false, accept: () => true }, makeBudget(() => 0), tally);
  assert.equal(walked.length, 50); assert.equal(tally.truncated, true);
});

// ---------------------------------------------------------------------------------------------------------------------- toml in linear time

test('a long multi-line TOML array is read in time linear in its size', t => {
  const lines = ['items = ['];
  for (let i = 0; i < 1900; i += 1) lines.push(`  "${'x'.repeat(1000)}",`);
  lines.push(']', '[mcp_servers.a]', 'command = "node"');
  const start = performance.now();
  const tables = parseToml(lines.join('\n'));
  const ms = performance.now() - start;
  t.diagnostic(`a TOML array of 1.9 MB: ${Math.round(ms)} ms`);
  assert.ok(ms < 1000, `took ${Math.round(ms)} ms`);
  assert.equal(tables.length, 2);
});

// ---------------------------------------------------------------------------------------------------------------------- a place is read only inside the folder found

function twoFolders(t: TestContext): { work: string; home: string; outside: string } {
  const home = tempDir(t), work = join(home, 'work'), outside = join(home, 'elsewhere', 'looks-like-a-project');
  put(join(work, 'proj', '.claude', 'skills', 'mine', 'SKILL.md'), skill('Mine'));
  put(join(outside, '.claude', 'skills', 'evil', 'SKILL.md'), skill('Evil outside skill'));
  put(join(outside, 'notes', 'secret.md'), '# Evil outside note\n\nNot yours.\n');
  return { work, home, outside };
}

test('a work folder that is swapped for a shortcut after it was found is not followed when it is read', async t => {
  const { work, home, outside } = twoFolders(t);
  const scanner = createScanner({ home });
  const picked = await scanner.addFolder(work);
  const proj = picked.places.find(p => p.label === 'proj');
  assert.ok(proj, picked.places.map(p => p.label).join(','));
  renameSync(join(work, 'proj'), join(work, 'proj-moved'));
  symlinkSync(outside, join(work, 'proj'));
  const batch = await scanner.read([proj.id]);
  const all = JSON.stringify(batch.reads);
  assert.doesNotMatch(all, /Evil|Not yours/, 'nothing from outside the folder that was found');
  assert.ok(batch.tally.unreadable >= 1, 'the swap is counted');
});

test('a tool folder inside a work folder that is swapped for a shortcut after it was found is not followed', async t => {
  const { work, home, outside } = twoFolders(t);
  const scanner = createScanner({ home });
  const picked = await scanner.addFolder(work);
  const proj = picked.places.find(p => p.label === 'proj')!;
  renameSync(join(work, 'proj', '.claude'), join(work, 'proj', '.claude-moved'));
  symlinkSync(join(outside, '.claude'), join(work, 'proj', '.claude'));
  const batch = await scanner.read([proj.id]);
  assert.doesNotMatch(JSON.stringify(batch.reads), /Evil/);
});

test('a work folder that is itself a shortcut to a folder inside the picked one is read by its real location', async t => {
  const home = tempDir(t), work = join(home, 'work');
  put(join(work, 'real-proj', '.claude', 'skills', 'mine', 'SKILL.md'), skill('Mine'));
  symlinkSync(join(work, 'real-proj'), join(work, 'linked-proj'));
  const scanner = createScanner({ home });
  const picked = await scanner.addFolder(work);
  assert.equal(picked.places.length, 2, `the picked folder and one place for the one real folder: ${picked.places.map(p => p.label).join(', ')}`);
  const batch = await scanner.read(picked.places.map(p => p.id));
  assert.deepEqual(batch.reads.flatMap(r => r.records.map(x => x.name)), ['Mine']);
});

test('a skill file that is swapped for a shortcut that leads outside is not read', t => {
  const home = tempDir(t), outside = tempDir(t, 'bowerloom-outside-');
  put(join(home, 'inside', 'a.md'), 'inside text');
  put(join(outside, 'b.md'), 'outside text');
  symlinkSync(join(outside, 'b.md'), join(home, 'inside', 'b.md'));
  const tally = newTally();
  assert.equal(readText(join(home, 'inside', 'a.md'), join(home, 'inside'), tally), 'inside text');
  assert.equal(readText(join(home, 'inside', 'b.md'), join(home, 'inside'), tally), null);
  assert.equal(tally.linksOutside, 1);
});

// ---------------------------------------------------------------------------------------------------------------------- names and paths

test('a folder name with a control character is not a place, and the paths shown are one plain line', async t => {
  const home = tempDir(t), work = join(home, `odd${String.fromCharCode(0x202e)}name`);
  put(join(work, 'bad\nfolder', '.claude', 'skills', 'x', 'SKILL.md'), skill('Bad folder skill'));
  put(join(work, 'fine', '.claude', 'skills', 'y', 'SKILL.md'), skill('Fine folder skill'));
  const scanner = createScanner({ home });
  const picked = await scanner.addFolder(work);
  assert.deepEqual(picked.places.map(p => p.label), ['odd name', 'fine'], 'the folder with the control character is not listed');
  assert.ok(picked.couldNotRead >= 1, 'and it is counted');
  const batch = await scanner.read(picked.places.map(p => p.id));
  const result = buildRealResult(batch.reads, batch.tally, { nowMs: 0 });
  const shown = [...picked.places.map(p => p.details.path), ...result.world.scopes.map(s => s.path ?? ''), ...result.world.items.flatMap(i => i.foundAt.map(f => f.path))];
  assert.ok(shown.length >= 4);
  for (const path of shown) assert.doesNotMatch(path, /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u, path);
  assert.doesNotMatch(JSON.stringify(result), /Bad folder skill/);
});

// ---------------------------------------------------------------------------------------------------------------------- the chooser and a second look

test('a second look at the home folder does not forget a folder the person picked', async t => {
  const home = tempDir(t), work = join(home, 'work');
  put(join(home, '.claude', 'skills', 'h', 'SKILL.md'), skill('Home skill'));
  put(join(work, 'proj', '.claude', 'skills', 'p', 'SKILL.md'), skill('Project skill'));
  const scanner = createScanner({ home });
  const first = await scanner.discover();
  const picked = await scanner.addFolder(work);
  const second = await scanner.discover();
  assert.deepEqual(second.places.map(p => p.label), first.places.map(p => p.label), 'the second look lists the home places');
  const batch = await scanner.read([...picked.places.map(p => p.id), ...second.places.map(p => p.id)]);
  assert.deepEqual(batch.reads.flatMap(r => r.records.map(x => x.name)).sort(), ['Home skill', 'Project skill']);
});

type Listener = (event: RealEvent, ...args: unknown[]) => unknown;

test('while the folder chooser is open no other call starts, and a closed chooser is a cancelled pick', async t => {
  const home = tempDir(t), work = join(home, 'work');
  put(join(work, 'proj', '.claude', 'skills', 'p', 'SKILL.md'), skill('Project skill'));
  const handlers = new Map<string, Listener>();
  let answer: (folder: string | null) => void = () => undefined;
  registerRealIpc({
    ipc: { handle: (channel, listener) => { handlers.set(channel, listener); } }, appIndexUrl: APP_INDEX, home,
    chooseFolder: () => new Promise<string | null>(resolve => { answer = resolve; }),
  });
  const page: RealEvent = { senderFrame: { url: `${APP_INDEX}${REAL_HASH}`, parent: null } };
  const call = (channel: string, ...args: unknown[]): Promise<unknown> => Promise.resolve(handlers.get(channel)!(page, ...args));
  const pick = call(REAL_CHANNELS.pickFolder);
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(call(REAL_CHANNELS.discoverPlaces), (e: Error) => e.message === 'BUSY');
  await assert.rejects(call(REAL_CHANNELS.pickFolder), (e: Error) => e.message === 'BUSY');
  answer(null);
  assert.equal(((await pick) as { cancelled: boolean }).cancelled, true);
  const again = call(REAL_CHANNELS.pickFolder);
  await new Promise(resolve => setImmediate(resolve));
  answer(work);
  const found = (await again) as { cancelled: boolean; places: { label: string }[] };
  assert.deepEqual([found.cancelled, found.places.map(p => p.label)], [false, ['work', 'proj']]);
  await call(REAL_CHANNELS.discoverPlaces);
});
