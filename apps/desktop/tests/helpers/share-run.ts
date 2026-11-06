// Run by tests/bundle-worker-static.test.ts in a child process that has tests/helpers/deny-share.mjs loaded: one export in one app and one import in another, with the real worker
// thread, on made-up folders (first argument: a work folder). It prints the counts as JSON. If anything in the main thread or the worker started a process or reached a
// network other than the loopback of the project lock, the denial would have thrown and written a line to DENY_LOG.
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createEngineService } from '../../main/engine-service.js';
import type { Answer } from '../../shared/engine/types.js';
import { DESKTOP } from '../support.js';

const work = process.argv[2] ?? '';
if (work === '') throw new Error('Usage: share-run <work folder>');
const json = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`;
const put = (path: string, text: string): void => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
const value = <T>(a: Answer<T> | null): T => { if (a === null || !a.ok) throw new Error(`refused: ${JSON.stringify(a)}`); return a.value; };
const NO = { link: {}, leave: [] };

function app(name: string) {
  const home = join(work, name, 'home');
  mkdirSync(home, { recursive: true }); chmodSync(home, 0o700);
  const s = { folder: null as string | null, open: null as string | null, save: null as string | null };
  const service = createEngineService({
    home, stateRoot: join(home, '.local', 'state', 'bowerloom'), who: 'tester', now: () => new Date('2026-10-31T12:00:00Z'),
    chooseFolder: async () => s.folder, confirm: async () => true, chooseBundleOpen: async () => s.open, chooseBundleSave: async () => s.save,
    bundleWorker: () => join(DESKTOP, '.build', 'tests', 'bundle-worker.mjs'),
  });
  return { home, s, service };
}

const a = app('a'), b = app('b');
const source = join(a.home, 'Projects', 'rope-yard');
put(join(source, '.bowerloom/harness.json'), json({ format: 'bowerloom/harness/v1beta1', id: 'rope-yard', description: 'A made-up harness.', engines: [{ id: 'claude-code' }], parts: { 'system-prompt': 'instructions/AGENTS.md', skills: 'skills/' } }));
put(join(source, '.bowerloom/instructions/AGENTS.md'), '# Yard\n');
put(join(source, '.bowerloom/skills/check/SKILL.md'), '---\nname: check\ndescription: Checks orders.\n---\n\nCheck.\n');
a.s.folder = source;
const fa = value(await a.service.chooseFolder());
const plan = value(await a.service.planExport(fa.id));
a.s.save = join(work, 'out.bowerloom.json');
const written = value(await a.service.runExport(fa.id, plan.revision, plan.acknowledge));

b.s.open = a.s.save;
const target = join(b.home, 'Projects', 'target');
mkdirSync(target, { recursive: true });
b.s.folder = target;
const fb = value(await b.service.chooseFolder());
const bundle = value(await b.service.chooseBundle());
const ip = value(await b.service.planImport(fb.id, bundle.bundleId, NO));
const done = value(await b.service.runImport(fb.id, ip.revision, bundle.bundleId, NO, ip.acknowledge));
await a.service.close(); await b.service.close();
process.stdout.write(JSON.stringify({ exported: written.bytes, imported: done.written.length }));
