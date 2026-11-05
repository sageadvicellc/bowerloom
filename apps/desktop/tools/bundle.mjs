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
  const helpers = readdirSync(join(here, 'tests/helpers')).filter(f => f.endsWith('.ts')).map(f => join(here, 'tests/helpers', f));
  // The worker thread of export and import sits beside the bundled tests, where `new URL('./bundle-worker.mjs', import.meta.url)` finds it.
  await build({ ...common, entryPoints: [join(here, 'main/engine-bundle-worker.ts')], outfile: join(here, '.build/tests/bundle-worker.mjs'), format: 'esm', platform: 'node', external: ['electron'], banner: { js: banner } });
  await build({ ...common, entryPoints: helpers, outdir: join(here, '.build/helpers'), outExtension: { '.js': '.mjs' }, format: 'esm', platform: 'node', external: ['electron'], banner: { js: banner } });
  await build({ ...common, entryPoints: entries, outdir: join(here, '.build/tests'), outExtension: { '.js': '.mjs' }, format: 'esm', platform: 'node', external: ['electron'], banner: { js: banner } });
} else {
  rmSync(join(here, 'dist'), { recursive: true, force: true });
  await build({ ...common, entryPoints: [join(here, 'main/main.ts')], outfile: join(here, 'dist/main.mjs'), format: 'esm', platform: 'node', external: ['electron'], banner: { js: banner } });
  await build({ ...common, entryPoints: [join(here, 'main/engine-bundle-worker.ts')], outfile: join(here, 'dist/bundle-worker.mjs'), format: 'esm', platform: 'node', external: ['electron'], banner: { js: banner } });
  await build({ ...common, entryPoints: [join(here, 'preload/real-preload.ts')], outfile: join(here, 'dist/preload-real.cjs'), format: 'cjs', platform: 'node', external: ['electron'] });
  await build({ ...common, entryPoints: [join(here, 'renderer/app.ts')], outfile: join(here, 'dist/renderer/app.js'), format: 'iife', platform: 'browser', target: 'chrome140', jsx: 'automatic', loader: { '.css': 'css' }, define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'none' });
  mkdirSync(join(here, 'dist/renderer'), { recursive: true });
  for (const file of ['index.html', 'brand.css', 'tokens.css', 'styles.css']) cpSync(join(here, 'renderer', file), join(here, 'dist/renderer', file));
  copyFonts();
}

/** The website's own font files and their licences (apps/landing/public/fonts), so the app and the site set the same type. Only Newsreader and Manrope are used. */
function copyFonts() {
  const fonts = join(here, '..', 'landing', 'public', 'fonts');
  for (const [family, files] of [['newsreader', ['roman.ttf', 'italic.ttf', 'OFL.txt']], ['manrope', ['font.ttf', 'OFL.txt']]]) {
    mkdirSync(join(here, 'dist/renderer/fonts', family), { recursive: true });
    for (const file of files) cpSync(join(fonts, family, file), join(here, 'dist/renderer/fonts', family, file));
  }
}
