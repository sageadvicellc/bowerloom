/**
 * A private build of the main process, for a test that starts Electron. The shared `dist/` folder is rebuilt (removed, then made again) by other tests of the same run
 * (tests/packaging.test.ts runs the launcher's build), so a test that starts the app from `dist/` can find it half made. This builds main/main.ts with the options of
 * tools/bundle.mjs into a folder of the test's own, with the package file that names it, and starts nothing. esbuild runs in a child process, as in static-check.ts.
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CHILD = `
import { build } from 'esbuild';
const { entry, outfile } = JSON.parse(process.argv[1]);
const banner = "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);";
await build({ entryPoints: [entry], outfile, bundle: true, sourcemap: false, logLevel: 'silent', target: 'node24', format: 'esm', platform: 'node', external: ['electron'], banner: { js: banner } });
`;

/** Builds main/main.ts of `desktop` into `outDir` and writes the package file Electron needs to start it. Returns `outDir`. Throws if the build fails. */
export function buildMainInto(desktop: string, outDir: string): string {
  const ran = spawnSync(process.execPath, ['--input-type=module', '-e', CHILD, JSON.stringify({ entry: join(desktop, 'main', 'main.ts'), outfile: join(outDir, 'main.mjs') })], { cwd: desktop, encoding: 'utf8', timeout: 120000 });
  if (ran.status !== 0) throw new Error(`The private build of the main process failed: ${ran.stderr || String(ran.error)}`);
  writeFileSync(join(outDir, 'package.json'), JSON.stringify({ name: 'bowerloom-test-main', version: '0.0.0', main: 'main.mjs', type: 'module' }));
  return outDir;
}
