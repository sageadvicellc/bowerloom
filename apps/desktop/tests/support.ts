import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
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

export function tempDir(t: TestContext, prefix = 'bowerloom-viewer-test-'): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
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
  process.once('exit', () => rmSync(app, { recursive: true, force: true }));
  return snapshot;
}
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
