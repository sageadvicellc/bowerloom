// Bundles the spike with the app's own esbuild: the child (the Node core, with the shipped code bundled in) and the Electron main process of the spike.
// Output: app/dist/child.mjs and app/dist/main.mjs. Same bundling rules as apps/desktop/tools/bundle.mjs.
import { createRequire } from 'node:module';
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, '..', '..', 'apps', 'desktop');
const { build } = createRequire(join(desktop, 'package.json'))('esbuild');
const banner = "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);";
const common = { bundle: true, sourcemap: true, logLevel: 'warning', target: 'node24', format: 'esm', platform: 'node', external: ['electron'], banner: { js: banner } };

rmSync(join(here, 'app', 'dist'), { recursive: true, force: true });
await build({ ...common, entryPoints: [join(here, 'src', 'child.ts')], outfile: join(here, 'app', 'dist', 'child.mjs') });
await build({ ...common, entryPoints: [join(here, 'src', 'main.mjs')], outfile: join(here, 'app', 'dist', 'main.mjs') });
