// Bundles the spike with the app's own esbuild.
//   node build.mjs           the Electron side: app/dist/child.mjs (the Node core) and app/dist/main.mjs (the spike main process)
//   node build.mjs --tauri   the Tauri side: tauri/src-tauri/resources/core.mjs (the Node core as the sidecar script) and tauri/dist (the page)
// Same bundling rules as apps/desktop/tools/bundle.mjs.
import { createRequire } from 'node:module';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, '..', '..', 'apps', 'desktop');
const { build } = createRequire(join(desktop, 'package.json'))('esbuild');
const banner = "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);";
const common = { bundle: true, sourcemap: true, logLevel: 'warning', target: 'node24', format: 'esm', platform: 'node', external: ['electron'], banner: { js: banner } };

if (process.argv.includes('--e2e')) {
  // The page of the test build: the same call path, a small screen, and the WebdriverIO plugin's page side.
  rmSync(join(here, 'tauri', 'dist-e2e'), { recursive: true, force: true });
  await build({ bundle: true, logLevel: 'warning', target: 'safari16', format: 'iife', platform: 'browser', entryPoints: [join(here, 'tauri', 'page', 'e2e.js')], outfile: join(here, 'tauri', 'dist-e2e', 'page.js') });
  mkdirSync(join(here, 'tauri', 'dist-e2e'), { recursive: true });
  cpSync(join(here, 'tauri', 'page', 'e2e.html'), join(here, 'tauri', 'dist-e2e', 'index.html'));
} else if (process.argv.includes('--tauri')) {
  rmSync(join(here, 'tauri', 'dist'), { recursive: true, force: true });
  rmSync(join(here, 'tauri', 'src-tauri', 'resources'), { recursive: true, force: true });
  // The sidecar script. No source map: it sits in the app bundle.
  await build({ ...common, sourcemap: false, entryPoints: [join(here, 'src', 'stdio.ts')], outfile: join(here, 'tauri', 'src-tauri', 'resources', 'core.mjs') });
  // The page: the scenarios, with the Tauri API bundled in.
  await build({ bundle: true, logLevel: 'warning', target: 'safari16', format: 'iife', platform: 'browser', entryPoints: [join(here, 'tauri', 'page', 'main.js')], outfile: join(here, 'tauri', 'dist', 'page.js') });
  mkdirSync(join(here, 'tauri', 'dist'), { recursive: true });
  for (const file of ['index.html', 'features.css']) cpSync(join(here, 'tauri', 'page', file), join(here, 'tauri', 'dist', file));
} else {
  rmSync(join(here, 'app', 'dist'), { recursive: true, force: true });
  await build({ ...common, entryPoints: [join(here, 'src', 'child.ts')], outfile: join(here, 'app', 'dist', 'child.mjs') });
  await build({ ...common, entryPoints: [join(here, 'src', 'main.mjs')], outfile: join(here, 'app', 'dist', 'main.mjs') });
}
