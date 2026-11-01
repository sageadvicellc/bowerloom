// How long export and import hold Electron's main thread. The service runs on this thread and the codec runs in a worker thread, so the longest stretch this thread goes
// without a turn of its event loop is what a person would feel as a frozen window. It is measured here on a maximum bundle and on a bundle of hostile YAML, for the choose,
// the plan and the write of an import and for an export. The numbers are printed for the report. The pass rule is a hang guard, not a speed claim: the longest stretch must be
// far under the seconds a held thread would show (a decode of the maximum bundle on this thread takes 1 to 8 s), and the structure that makes it so is held by
// tests/bundle-worker-static.test.ts (the codec is not in main.mjs at all). Timing varies with the machine and with the tests that run beside this one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeBundle } from '../../../packages/harness-bundle/src/index.js';
import { loadDefinitionFiles } from '../../../packages/harness-definition/src/index.js';
import type { DefinitionFile } from '../../../packages/harness-definition/src/index.js';
import { NO_CHOICES, plainFolder, shareSetup, value } from './helpers-engine/share.js';
import type { Share } from './helpers-engine/share.js';

const MIB = 1024 * 1024;
/** A thread that did the work itself would stand still for seconds. Anything under this is a thread that is not held; the real numbers are printed. */
const HANG_GUARD_MS = 2500;
const harness = (parts: Record<string, string>): string => `${JSON.stringify({ format: 'bowerloom/harness/v1beta1', id: 'stall', description: 'A made-up harness.', engines: [{ id: 'claude-code' }], parts })}\n`;
const HARNESS = { parts: { skills: 'skills/', scripts: 'scripts/', 'system-prompt': 'instructions/AGENTS.md' } };
const file = (path: string, bytes: Uint8Array | string, executable = false): DefinitionFile => ({ path, bytes: typeof bytes === 'string' ? Buffer.from(bytes) : bytes, executable });

/** The longest stretch (ms) the event loop of this thread went without a turn while `run` ran. */
async function stall<T>(run: () => Promise<T>): Promise<{ result: T; maxMs: number; totalMs: number }> {
  const h = monitorEventLoopDelay({ resolution: 1 });
  h.enable();
  const began = performance.now();
  const result = await run();
  const totalMs = performance.now() - began;
  h.disable();
  return { result, maxMs: Math.round(h.max / 1e6), totalMs: Math.round(totalMs) };
}

async function bundleFile(dir: string, name: string, files: DefinitionFile[]): Promise<string> {
  const loaded = loadDefinitionFiles(files, '');
  if (!loaded.ok) throw new Error(`the made-up harness does not load: ${JSON.stringify(loaded.problems.slice(0, 3))}`);
  const encoded = await encodeBundle(loaded.definition);
  const path = join(dir, name);
  writeFileSync(path, encoded.bytes);
  process.stderr.write(`# ${name}: ${Math.round(encoded.bytes.length / MIB)} MiB file\n`);
  return path;
}

const report = (label: string, r: { maxMs: number; totalMs: number }): void => { process.stderr.write(`# main-thread stall, ${label}: longest ${r.maxMs} ms (call took ${r.totalMs} ms)\n`); };

async function through(t: test.TestContext, label: string, make: (b: Share) => Promise<string>, limitMs: number): Promise<void> {
  const b = shareSetup(t, `stall-${label.split(' ')[0]}`);
  b.open = await make(b);
  const f = await b.choose(plainFolder(b.home, 'target'));
  const choose = await stall(() => b.service.chooseBundle());
  report(`${label}, choose the file`, choose);
  const bundle = value(choose.result);
  const plan = await stall(() => b.service.planImport(f.id, bundle.bundleId, NO_CHOICES));
  report(`${label}, plan the import`, plan);
  const view = value(plan.result);
  const write = await stall(() => b.service.runImport(f.id, view.revision, bundle.bundleId, NO_CHOICES, view.acknowledge));
  report(`${label}, write the import`, write);
  value(write.result);
  for (const r of [choose, plan, write]) assert.ok(r.maxMs < limitMs, `the main thread went ${r.maxMs} ms without a turn (limit ${limitMs} ms)`);
}

test('stall: a maximum bundle (31 files of 1 MiB, about 41 MiB on disk) never holds the main thread', { timeout: 300_000 }, async t => {
  await through(t, 'maximum bundle', async b => {
    const files = [file('harness.json', harness(HARNESS.parts)), file('instructions/AGENTS.md', '# Stall\n'), file('skills/one/SKILL.md', '---\nname: one\ndescription: One.\n---\n\nOne.\n')];
    let stamp = 7;
    for (let i = 0; i < 31; i += 1) {
      const block = Buffer.alloc(MIB);
      for (let j = 0; j < block.length; j += 4) block.writeUInt32LE((Math.imul(++stamp, 2654435761) ^ (stamp << 3)) >>> 0, j);
      files.push(file(`scripts/block-${i}.bin`, block));
    }
    return bundleFile(b.base, 'max.bowerloom.json', files);
  }, HANG_GUARD_MS);
});

test('stall: a bundle of 500 small text files never holds the main thread (4,000 files took 113 s to write, almost all of it fsync in the save, and the main thread went 15 ms)', { timeout: 300_000 }, async t => {
  await through(t, 'many files', async b => {
    const files = [file('harness.json', harness({ 'system-prompt': 'instructions/AGENTS.md', scripts: 'scripts/' })), file('instructions/AGENTS.md', '# Stall\n')];
    for (let i = 0; i < 498; i += 1) files.push(file(`scripts/dir-${i % 40}/note-${i}.md`, `# Note ${i}\n\n${'Count the coils before you report. '.repeat(20)}\n`));
    return bundleFile(b.base, 'many.bowerloom.json', files);
  }, HANG_GUARD_MS);
});

test('stall: hostile YAML that the loader accepts (15 skills with a frontmatter block of about 60 KiB each, 5,000 keys) never holds the main thread', { timeout: 300_000 }, async t => {
  await through(t, 'hostile yaml', async b => {
    const files = [file('harness.json', harness({ 'system-prompt': 'instructions/AGENTS.md', skills: 'skills/' })), file('instructions/AGENTS.md', '# Stall\n')];
    for (let s = 0; s < 15; s += 1) {
      const keys = Array.from({ length: 3000 }, (_, i) => `  field${i}: v${i}`).join('\n');
      files.push(file(`skills/yaml-${s}/SKILL.md`, `---\nname: yaml-${s}\ndescription: Hostile YAML.\nmetadata:\n${keys}\n---\n\nBody.\n`));
    }
    return bundleFile(b.base, 'yaml.bowerloom.json', files);
  }, HANG_GUARD_MS);
});

test('stall: an export of a maximum harness never holds the main thread', { timeout: 300_000 }, async t => {
  const a = shareSetup(t, 'stall-export');
  const { mkdirSync, writeFileSync: write } = await import('node:fs');
  const dir = join(a.home, 'Projects', 'big');
  mkdirSync(join(dir, '.bowerloom', 'scripts'), { recursive: true });
  write(join(dir, '.bowerloom', 'harness.json'), harness({ scripts: 'scripts/' }));
  let stamp = 9;
  for (let i = 0; i < 30; i += 1) {
    const block = Buffer.alloc(MIB);
    for (let j = 0; j < block.length; j += 4) block.writeUInt32LE((Math.imul(++stamp, 2654435761) ^ (stamp << 3)) >>> 0, j);
    write(join(dir, '.bowerloom', 'scripts', `block-${i}.bin`), block);
  }
  const f = await a.choose(dir);
  const plan = await stall(() => a.service.planExport(f.id));
  report('export, plan', plan);
  const view = value(plan.result);
  a.save = join(a.base, 'big.bowerloom.json');
  const run = await stall(() => a.service.runExport(f.id, view.revision, view.acknowledge));
  report('export, write', run);
  value(run.result);
  for (const r of [plan, run]) assert.ok(r.maxMs < HANG_GUARD_MS, `the main thread went ${r.maxMs} ms without a turn`);
});
