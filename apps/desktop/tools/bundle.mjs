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
  await build({ ...common, entryPoints: helpers, outdir: join(here, '.build/helpers'), outExtension: { '.js': '.mjs' }, format: 'esm', platform: 'node', external: ['electron'], banner: { js: banner } });
  // A page for the speed test of the map: the real map component with a made-up map of any size, in a plain window.
  await build({ ...common, entryPoints: [join(here, 'tests/perf/harness.tsx')], outfile: join(here, '.build/perf/harness.js'), format: 'iife', platform: 'browser', target: 'chrome140', jsx: 'automatic', loader: { '.css': 'css' }, define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'none' });
  await build({ ...common, entryPoints: entries, outdir: join(here, '.build/tests'), outExtension: { '.js': '.mjs' }, format: 'esm', platform: 'node', external: ['electron'], banner: { js: banner } });
} else {
  rmSync(join(here, 'dist'), { recursive: true, force: true });
  await build({ ...common, entryPoints: [join(here, 'main/main.ts')], outfile: join(here, 'dist/main.mjs'), format: 'esm', platform: 'node', external: ['electron', 'electron-updater'], banner: { js: banner } });
  await build({ ...common, entryPoints: [join(here, 'preload/preload.ts')], outfile: join(here, 'dist/preload.cjs'), format: 'cjs', platform: 'node', external: ['electron'] });
  // The read-only reader of a real setup (--prototype-real): its own bridge with three calls, and its own page script. Neither is loaded in any other mode.
  await build({ ...common, entryPoints: [join(here, 'preload/real-preload.ts')], outfile: join(here, 'dist/preload-real.cjs'), format: 'cjs', platform: 'node', external: ['electron'] });
  await build({ ...common, entryPoints: [join(here, 'renderer/home/real/entry.tsx')], outfile: join(here, 'dist/renderer/real.js'), format: 'iife', platform: 'browser', target: 'chrome140', jsx: 'automatic', loader: { '.css': 'css' }, define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'none' });
  // The page's policy allows no inline style element, and two libraries (force-graph and its tooltip) add one when they load. Their
  // few rules are in renderer/graph.css instead, and the injection is taken out here, so nothing is left to be refused.
  const noInlineStyle = { name: 'no-inline-style', setup(b) { b.onLoad({ filter: /(force-graph[\\/]dist[\\/]force-graph|float-tooltip[\\/]dist[\\/]float-tooltip)\.mjs$/ }, async args => {
    const { readFile } = await import('node:fs/promises'); const text = await readFile(args.path, 'utf8');
    if (!/styleInject\(css_248z\);/.test(text)) throw new Error(`The style injection was not found in ${args.path}; the library changed.`);
    return { contents: text.replace('styleInject(css_248z);', 'void css_248z; /* inline style element removed: see renderer/graph.css */'), loader: 'js' };
  }); } };
  await build({ ...common, entryPoints: [join(here, 'renderer/app.ts')], outfile: join(here, 'dist/renderer/app.js'), format: 'iife', platform: 'browser', target: 'chrome140', jsx: 'automatic', loader: { '.css': 'css' }, define: { 'process.env.NODE_ENV': '"production"' }, plugins: [noInlineStyle], legalComments: 'none' });
  mkdirSync(join(here, 'dist/renderer'), { recursive: true });
  for (const file of ['index.html', 'tokens.css', 'styles.css', 'graph.css']) cpSync(join(here, 'renderer', file), join(here, 'dist/renderer', file));
  cpSync(join(here, 'renderer/home/real/real.html'), join(here, 'dist/renderer/real.html'));
}
