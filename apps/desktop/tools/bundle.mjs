// Bundles the app (and, with --tests, the tests) with esbuild. Bowerloom's own TypeScript is bundled into the main file,
// so the app needs no separate Bowerloom install.
import { build } from 'esbuild';
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = join(dirname(fileURLToPath(import.meta.url)), '..');
const banner = "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);";
const common = { bundle: true, sourcemap: true, logLevel: 'warning', target: 'node24' };

if (process.argv.includes('--tests')) {
  rmSync(join(here, '.build'), { recursive: true, force: true });
  const entries = readdirSync(join(here, 'tests')).filter(f => f.endsWith('.test.ts')).map(f => join(here, 'tests', f));
  await build({ ...common, entryPoints: entries, outdir: join(here, '.build/tests'), outExtension: { '.js': '.mjs' }, format: 'esm', platform: 'node', external: ['electron'], banner: { js: banner } });
} else {
  rmSync(join(here, 'dist'), { recursive: true, force: true });
  await build({ ...common, entryPoints: [join(here, 'main/main.ts')], outfile: join(here, 'dist/main.mjs'), format: 'esm', platform: 'node', external: ['electron', 'electron-updater'], banner: { js: banner } });
  await build({ ...common, entryPoints: [join(here, 'preload/preload.ts')], outfile: join(here, 'dist/preload.cjs'), format: 'cjs', platform: 'node', external: ['electron'] });
  await build({ ...common, entryPoints: [join(here, 'renderer/app.ts')], outfile: join(here, 'dist/renderer/app.js'), format: 'iife', platform: 'browser', target: 'chrome140' });
  mkdirSync(join(here, 'dist/renderer'), { recursive: true });
  for (const file of ['index.html', 'tokens.css', 'styles.css']) cpSync(join(here, 'renderer', file), join(here, 'dist/renderer', file));
}
