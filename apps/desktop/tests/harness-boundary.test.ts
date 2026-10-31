// The harness-first preview (--prototype-v3) is held to the same locks as the home app preview (--prototype-v2): no bridge, no file, no network, no storage, no markup from text,
// a temporary data folder, no outside link. The launch mode is wired in main.ts, the launcher and the root script.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { APP_INDEX, decideNavigation } from '../main/security.js';
import { DESKTOP } from './support.js';

const read = (file: string): string => readFileSync(join(DESKTOP, file), 'utf8');
const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
function sources(dir: string): { file: string; text: string }[] {
  return readdirSync(join(DESKTOP, dir), { recursive: true, withFileTypes: true }).filter(e => e.isFile() && /\.tsx?$/.test(e.name)).map(e => { const file = join((e as unknown as { parentPath: string }).parentPath, e.name); return { file, text: readFileSync(file, 'utf8') }; });
}

test('main.ts: --prototype-v3 is one more prototype mode: no preload, no IPC, a temporary data folder, no outside link, and its own address', () => {
  const main = strip(read('main/main.ts'));
  assert.match(main, /const prototypeV3 = argv\.includes\('--prototype-v3'\);/);
  assert.match(main, /const prototypeMode = prototypeV2 \|\| prototypeReal \|\| prototypeV3 \|\| prototypeV3Real;/);
  assert.match(main, /else if \(prototypeV3 \|\| prototypeV3Real\) window\.loadURL\(`\$\{indexUrl\}\$\{prototypeV3Real \? '#prototype-v3-real' : '#prototype-v3'\}`\)\.catch\(startupFailed\);/, 'the real flag opens its own address and the sample flag the sample one');
  assert.match(main, /windowOptions\(prototypeV2 \|\| prototypeReal \|\| prototypeV3 \|\| prototypeV3Real\)/);
  assert.doesNotMatch(main, /prototypeV3\s*\?[^\n]*preload/);
  assert.equal([...main.matchAll(/preload\.cjs/g)].length, 1, 'the one normal bridge is named once, and no prototype names its own');
  assert.equal(decideNavigation(`${APP_INDEX}#prototype-v3/builder/harness-weekly-report-crew/graph`, APP_INDEX), 'allow-app');
  assert.equal(decideNavigation('https://example.com/#prototype-v3', APP_INDEX), 'block');
});

test('main.ts: --prototype-v3-real gets the read-only bridge and the same locks; the sample --prototype-v3 never does', () => {
  const main = strip(read('main/main.ts'));
  assert.match(main, /const prototypeV3Real = argv\.includes\('--prototype-v3-real'\);/);
  assert.match(main, /prototypeReal \|\| prototypeV3Real \? webPreferences\(join\(root, 'preload-real\.cjs'\), app\.isPackaged\) : webPreferences\(prototypeMode \? undefined : join\(root, 'preload\.cjs'\), app\.isPackaged\)/);
  assert.equal([...main.matchAll(/preload-real\.cjs/g)].length, 1, 'the read-only bridge is named once');
  assert.equal([...main.matchAll(/preload\.cjs/g)].length, 1, 'the one normal bridge is still named once');
  assert.match(main, /if \(prototypeReal \|\| prototypeV3Real\) \{\s*const home = usableHome\(/, 'the reader is registered for either real flag');
  assert.match(main, /if \(prototypeV2 \|\| prototypeReal \|\| prototypeV3 \|\| prototypeV3Real\) window\.on\('page-title-updated'/);
  // The line that names the read-only bridge never names the sample flag on its own.
  const bridgeLine = main.split('\n').find(line => line.includes('preload-real.cjs'))!;
  assert.doesNotMatch(bridgeLine, /prototypeV3(?!Real)\b/);
  assert.doesNotMatch(main, /prototypeV3(?!Real)\b[^\n]*preload-real/);
  assert.doesNotMatch(main, /registerRealIpc[^\n]*prototypeV3(?!Real)\b/);
  // A real preview whose bridge failed to load stops with the start-failed box, instead of opening as the sample.
  assert.match(main, /if \(prototypeReal \|\| prototypeV3Real\) window\.webContents\.on\('preload-error', \(_event, _path, error\) => startupFailed\(error\)\);/);
  assert.equal([...main.matchAll(/preload-error/g)].length, 1);
  assert.equal(decideNavigation(`${APP_INDEX}#prototype-v3/choose`, APP_INDEX), 'allow-app');
  assert.equal(decideNavigation(`${APP_INDEX}#prototype-v3-real/choose`, APP_INDEX), 'allow-app');
  assert.equal(decideNavigation(`${APP_INDEX}#prototype-v3-real`, APP_INDEX), 'allow-app');
  assert.equal(decideNavigation('https://example.com/#prototype-v3-real', APP_INDEX), 'block');
});

test('the mode comes from the address, not from the bridge: the mount asks the address, and a real address without its bridge is an error, not the sample', () => {
  const mount = strip(read('renderer/harness/mount.tsx')), app = strip(read('renderer/harness/HarnessApp.tsx')), router = strip(read('renderer/harness/router.ts'));
  assert.match(mount, /isRealHash\(location\.hash\)/); assert.doesNotMatch(mount, /real=\{getBridge\(\)\}/);
  assert.match(app, /chooseKind\(/); assert.match(app, /realMode \? blankRealState/);
  assert.doesNotMatch(app, /real === null \? createSampleWorld/, 'a missing bridge never decides the world');
  assert.match(router, /formatRoute\(route, baseOf\(location\.hash\)\)/, 'the page keeps the address it was opened on');
});

test('only the real screens and the mount file of the preview import the read-only bridge, and nothing in the shared or sample code names it', () => {
  const bridge = /home\/real\/bridge(?:\.js)?['"]/, named = /bowerloomReal/;
  for (const { file, text } of sources('renderer/harness')) {
    const code = strip(text), mayImport = /renderer\/harness\/real\//.test(file) || file.endsWith('renderer/harness/mount.tsx');
    if (!mayImport) assert.doesNotMatch(code, bridge, `${file} reaches the bridge`);
    assert.doesNotMatch(code, named, `${file} names the bridge: only home/real/bridge.ts does`);
  }
  for (const { file, text } of sources('shared/harness')) assert.doesNotMatch(strip(text), named, `${file} names the bridge`);
});

test('the launcher and the root script know --prototype-v3, keep one mode at a time, and give it a fresh temporary data folder', () => {
  const src = strip(read('tools/run.mjs'));
  assert.match(src, /KNOWN = new Set\(\[[^\]]*'--prototype-v3'/); assert.match(src, /MODES = new Set\(\[[^\]]*'--prototype-v3'/); assert.match(src, /PROTOTYPES = \[[^\]]*'--prototype-v3'/);
  const root = JSON.parse(read('../../package.json')) as { scripts: Record<string, string> };
  assert.equal(root.scripts['desktop:prototype:v3'], 'node apps/desktop/tools/run.mjs --prototype-v3');
  assert.equal(root.scripts['desktop:prototype:v2'], 'node apps/desktop/tools/run.mjs --prototype-v2');
  for (const other of ['--sample-data', '--real-data', '--prototype-v2', '--prototype-real', '--prototype-v3-real']) {
    const r = spawnSync(process.execPath, [join(DESKTOP, 'tools', 'run.mjs'), '--prototype-v3', other], { env: { PATH: process.env.PATH ?? '', HOME: '/tmp' }, encoding: 'utf8', timeout: 30000 });
    assert.equal(r.status, 2, other); assert.match(r.stderr, /not more/); assert.doesNotMatch(r.stdout, /Installing|Building/);
  }
});

test('the launcher and the root script know --prototype-v3-real: one mode at a time, a real home folder, the promise, and a fresh temporary data folder', async () => {
  const src = strip(read('tools/run.mjs'));
  assert.match(src, /KNOWN = new Set\(\[[^\]]*'--prototype-v3-real'/); assert.match(src, /MODES = new Set\(\[[^\]]*'--prototype-v3-real'/);
  assert.match(src, /REAL_FLAGS = \[REAL_FLAG, '--prototype-v3-real'\]/);
  assert.match(src, /REAL_FLAGS\.some\(flag => args\.includes\(flag\)\)/);
  const root = JSON.parse(read('../../package.json')) as { scripts: Record<string, string> };
  assert.equal(root.scripts['desktop:prototype:v3:real'], 'node apps/desktop/tools/run.mjs --prototype-v3-real');
  assert.equal(root.scripts['desktop:prototype:v3'], 'node apps/desktop/tools/run.mjs --prototype-v3', 'the sample keeps its own command');
  const run = (args: string[], env: Record<string, string>): { status: number | null; stdout: string; stderr: string } => {
    const r = spawnSync(process.execPath, [join(DESKTOP, 'tools', 'run.mjs'), ...args], { env: { PATH: process.env.PATH ?? '', ...env }, encoding: 'utf8', timeout: 30000 });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  for (const other of ['--sample-data', '--real-data', '--prototype-v2', '--prototype-v3', '--prototype-real']) {
    const r = run(['--prototype-v3-real', other], { HOME: '/tmp' });
    assert.equal(r.status, 2, other); assert.match(r.stderr, /not more/); assert.doesNotMatch(r.stdout, /Installing|Building/);
  }
  for (const home of ['', 'relative/home', '/this/folder/does/not/exist']) {
    const r = run(['--prototype-v3-real', '--build-only'], { HOME: home });
    assert.equal(r.status, 2, `HOME=${home}`); assert.match(r.stderr, /needs a home folder/); assert.doesNotMatch(r.stdout, /Installing|Building/, 'nothing is built, nothing is read');
  }
  const mod = await import(`${join(DESKTOP, 'tools', 'run.mjs')}`) as { REAL_FLAG: string; REAL_FLAGS: string[]; electronArgs(d: string, f: string[], u: string | null): string[] };
  assert.equal(mod.REAL_FLAG, '--prototype-real'); assert.deepEqual(mod.REAL_FLAGS, ['--prototype-real', '--prototype-v3-real']);
  assert.deepEqual(mod.electronArgs('/d', ['--prototype-v3-real'], '/tmp/bowerloom-prototype-x'), ['/d', '--user-data-dir=/tmp/bowerloom-prototype-x', '--prototype-v3-real']);
});

test('the page mounts the preview only on its own address, and the preload never names it', () => {
  const app = strip(read('renderer/app.ts'));
  assert.match(app, /isHarnessHash\(location\.hash\)\) \{ applyTheme\(\); mountHarness\(root\); \}/);
  assert.doesNotMatch(strip(read('preload/preload.ts')), /prototype/i);
});

test('the preview source never reaches the bridge, a file, the network, storage or markup from text; only the clock file reads the time', () => {
  const files = [...sources('renderer/harness'), ...sources('shared/harness')];
  assert.ok(files.length >= 30, `${files.length} files`);
  const banned: [string, RegExp][] = [['window.bowerloom', /window\.bowerloom|\bbowerloom\./], ['a node: import', /['"`]node:[a-z]/], ['fetch', /\bfetch\(|XMLHttpRequest|WebSocket/], ['storage', /localStorage|sessionStorage|indexedDB|document\.cookie/],
    ['markup from text', /innerHTML|outerHTML|insertAdjacentHTML|dangerouslySetInnerHTML|document\.write/], ['eval', /\beval\(|new Function\(/], ['Math.random', /Math\.random/], ['an outside link', /href=["']https?:|window\.open\(|<a\b[^>]*\btarget=/]];
  // One exception: the tour keeps "seen" in this window's sessionStorage (memory only, gone with the window), in renderer/harness/tour/seen.ts alone. It
  // writes nothing to disk: localStorage, indexedDB and cookies stay banned there too.
  const SEEN = 'renderer/harness/tour/seen.ts';
  for (const { file, text } of files) {
    const code = strip(text);
    for (const [name, pattern] of banned) {
      if (name === 'storage' && file.endsWith(SEEN)) { assert.doesNotMatch(code, /localStorage|indexedDB|document\.cookie/, `${file} uses storage on disk`); continue; }
      assert.doesNotMatch(code, pattern, `${file} uses ${name}`);
    }
    if (!file.endsWith('renderer/harness/clock.ts')) assert.doesNotMatch(code, /\bDate\b/, `${file} reads the clock`);
  }
  for (const { file, text } of sources('shared/harness')) assert.doesNotMatch(strip(text), /from ['"](react|react-dom)/, file);
  assert.match(strip(read('renderer/harness/clock.ts')), /new Date\(\)/);
  assert.equal([...strip(read(SEEN)).matchAll(/sessionStorage/g)].length, 2, 'the tour reads one store, sessionStorage, in one place');
});

test('the store imports nothing that could write: no file system, no network, no timer of its own but the default one', () => {
  const store = strip(read('shared/harness/store.ts'));
  assert.doesNotMatch(store, /from ['"]node:|require\(/);
  assert.equal([...store.matchAll(/setTimeout\(/g)].length, 1, 'one default timer, replaceable by the caller');
});
