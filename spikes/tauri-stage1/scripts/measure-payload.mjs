// The payload baseline: how big is the biggest scan result the app handles today? Run it with `npm run payload` (it builds first).
// It runs the app's own reader (real-scan.ts and map-world.ts) inside the Node core, in the child process of an Electron main process, on each fixture, and prints the
// serialized size (UTF-8 bytes of JSON.stringify of the result) as a table and as JSON. The largest shape is the one marked `baseline: true` in src/fixture.mjs.
// The reader's limits (apps/desktop/shared/real/types.ts) and the saved-read cap (shared/real/saved-scan.ts) are printed beside it.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHAPES, makeScanFixture } from '../src/fixture.mjs';

const spike = join(dirname(fileURLToPath(import.meta.url)), '..');
const desktop = join(spike, '..', '..', 'apps', 'desktop');
const electron = process.env.SPIKE_ELECTRON_EXE ?? join(desktop, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');
const packaged = typeof process.env.SPIKE_ELECTRON_EXE === 'string' && process.env.SPIKE_ELECTRON_EXE !== '';

async function measure(label, fixture) {
  const work = mkdtempSync(join(tmpdir(), 'stage1-payload-'));
  const out = join(work, 'result.json');
  const args = [...(packaged ? [] : [join(spike, 'app')]), '--scenario=payload', `--out=${out}`, `--user-data=${join(work, 'user-data')}`, `--options=${JSON.stringify({ picked: fixture.picked, home: fixture.home })}`];
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, args, { env, stdio: 'ignore' });
  await new Promise(resolve => child.once('exit', resolve));
  const result = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : { error: 'no result' };
  rmSync(work, { recursive: true, force: true });
  return { label, ...result };
}

const rows = [];
const base = mkdtempSync(join(tmpdir(), 'stage1-fixtures-'));
try {
  // The one realistic input in the repository: the made-up home of the acceptance journeys. It is a few kilobytes.
  const { buildMadeUpHome } = await import('../../../apps/desktop/tools/made-up-home.ts');
  const made = buildMadeUpHome(join(base, 'made-up'));
  rows.push({ ...(await measure('made-up-home (realistic, small)', { picked: made.projects, home: made.home })), shape: null });
  for (const shape of SHAPES) {
    const fixture = makeScanFixture(join(base, shape.name), shape);
    rows.push({ ...(await measure(shape.name, fixture)), shape });
  }
} finally {
  rmSync(base, { recursive: true, force: true });
}

const MIB = 1024 * 1024;
for (const r of rows) {
  if (r.error) { console.log(`${r.label}: ERROR ${r.error.split('\n')[0]}`); continue; }
  console.log(`${r.label.padEnd(34)} places ${String(r.places).padStart(3)}  items ${String(r.items).padStart(6)}  bytes ${String(r.bytes).padStart(10)}  (${(r.bytes / MIB).toFixed(2)} MiB)  hashOk ${r.digestMatch}  ms ${r.ms}`);
}
const largest = rows.filter(r => !r.error && r.shape !== null).sort((a, b) => b.bytes - a.bytes)[0];
console.log(`largest shape: ${largest?.shape.name} at ${largest?.bytes} bytes; marked baseline in src/fixture.mjs: ${SHAPES.find(s => s.baseline)?.name}`);
console.log('limits: places 200 (199 projects + the picked folder), 10,000 files per call, 20 MiB read per call, 2 MiB per file, 4,000,000 text characters whole then 1,000 each, saved read capped at 24 MiB');
console.log(JSON.stringify(rows.map(({ shape, ...r }) => ({ ...r, shape: shape?.name ?? null }))));
