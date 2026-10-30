import { chmodSync, lstatSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'node:test';
import { seedSample } from '../main/sample.js';
import type { SampleWorld } from '../main/sample.js';
import { readSnapshot } from '../main/reader.js';
import type { ReadContext } from '../main/reader.js';
import type { Snapshot } from '../shared/types.js';

/** The tests run from `.build/tests`, so the package folder is two levels up. */
export const DESKTOP = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SAMPLE_DIR = join(DESKTOP, 'sample-data');

/**
 * Removes a folder tree, also when a test left a part of it locked: every folder gets owner read, write and search rights
 * (u+rwx) and every file owner read and write (u+rw), then the tree goes. A link is never followed.
 */
export function removeTree(path: string): void {
  try { rmSync(path, { recursive: true, force: true }); return; } catch { /* a part without owner rights: open it, then try again */ }
  const open = (at: string): void => {
    let stat; try { stat = lstatSync(at); } catch { return; }
    if (stat.isSymbolicLink()) return;
    if (!stat.isDirectory()) { try { chmodSync(at, stat.mode | 0o600); } catch { /* gone */ } return; }
    try { chmodSync(at, stat.mode | 0o700); } catch { return; }
    let names: string[] = []; try { names = readdirSync(at); } catch { return; }
    for (const name of names) open(join(at, name));
  };
  open(path);
  rmSync(path, { recursive: true, force: true });
}
export function tempDir(t: TestContext, prefix = 'bowerloom-viewer-test-'): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  t.after(() => removeTree(dir));
  return dir;
}
export function sampleWorld(t: TestContext): { app: string; world: SampleWorld; ctx: ReadContext } {
  const app = tempDir(t), world = seedSample(app, SAMPLE_DIR);
  return { app, world, ctx: { mode: 'sample', home: world.home, env: world.env, roots: [world.projects] } };
}
let cached: { snapshot: Snapshot; app: string } | null = null;
/** One shared read of the sample for tests that only look at the result. */
export async function sampleSnapshot(): Promise<Snapshot> {
  if (cached !== null) return cached.snapshot;
  const app = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-viewer-snap-')));
  const world = seedSample(app, SAMPLE_DIR);
  const { snapshot } = await readSnapshot({ mode: 'sample', home: world.home, env: world.env, roots: [world.projects] });
  cached = { snapshot, app };
  process.once('exit', () => removeTree(app));
  return snapshot;
}
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
