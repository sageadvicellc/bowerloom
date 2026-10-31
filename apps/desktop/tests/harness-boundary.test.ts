// The harness-first app is held to the same locks in both launches: the sample (--sample) has no bridge, no file, no network, no storage, no markup from text, a temporary data folder and no outside link;
// the app on the person's own folders (no flag) has the one bridge of main/real-preload.ts. The launch is wired in main/launch.ts, main.ts, the launcher and the root scripts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { APP_INDEX, decideNavigation } from '../main/security.js';
import { DESKTOP } from './support.js';

const read = (file: string): string => readFileSync(join(DESKTOP, file), 'utf8');
const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
function sources(dir: string): { file: string; text: string }[] {
  return readdirSync(join(DESKTOP, dir), { recursive: true, withFileTypes: true }).filter(e => e.isFile() && /\.tsx?$/.test(e.name)).map(e => { const file = join((e as unknown as { parentPath: string }).parentPath, e.name); return { file, text: readFileSync(file, 'utf8') }; });
}

test('main.ts: the sample launch has no preload, no IPC, a temporary data folder and its own address; the others have the one bridge', () => {
  const main = strip(read('main/main.ts'));
  assert.match(main, /const launch = launchOf\(argv\);/);
  assert.match(main, /\.\.\.windowOptions\(\)/);
  assert.match(main, /webPreferences\(launch\.preload === 'real' \? join\(root, 'preload-real\.cjs'\) : undefined, app\.isPackaged\)/);
  assert.equal([...main.matchAll(/preload-real\.cjs/g)].length, 1, 'the one bridge is named once');
  assert.equal([...main.matchAll(/preload\.cjs/g)].length, 0, 'the old viewer bridge is not named');
  assert.match(main, /if \(launch\.temporaryData\) \{/);
  assert.match(main, /window\.on\('page-title-updated', event => event\.preventDefault\(\)\);/);
  assert.equal(decideNavigation(`${APP_INDEX}#sample/builder/harness-weekly-report-crew/graph`, APP_INDEX), 'allow-app');
  assert.equal(decideNavigation('https://example.com/#sample', APP_INDEX), 'block');
});

test('main.ts: the app on the person\'s own folders gets the read-only bridge and the engine calls; a failed bridge stops the start; the sample never has either', () => {
  const main = strip(read('main/main.ts'));
  assert.match(main, /if \(launch\.realReader\) \{\s*const home = usableHome\(/, 'the reader is registered for a launch that asks for it');
  assert.match(main, /if \(launch\.engineCalls\) \{\s*const engine = registerEngineIpc\(/);
  // A launch whose bridge failed to load stops with the start-failed box, instead of opening as the sample.
  assert.match(main, /if \(launch\.preload === 'real'\) window\.webContents\.on\('preload-error', \(_event, _path, error\) => startupFailed\(error\)\);/);
  assert.equal([...main.matchAll(/preload-error/g)].length, 1);
  assert.doesNotMatch(main, /sample[^\n]*(registerRealIpc|registerEngineIpc|preload-real)/i);
  assert.equal(decideNavigation(`${APP_INDEX}#sample/choose`, APP_INDEX), 'allow-app');
  assert.equal(decideNavigation(`${APP_INDEX}#app/choose`, APP_INDEX), 'allow-app');
  assert.equal(decideNavigation(`${APP_INDEX}#app`, APP_INDEX), 'allow-app');
  assert.equal(decideNavigation('https://example.com/#app', APP_INDEX), 'block');
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

test('the launcher and the root scripts: no flag opens the app on the person\'s own folders, --sample opens the sample, one mode at a time, and a real home folder is needed for the first', async () => {
  const src = strip(read('tools/run.mjs'));
  assert.match(src, /KNOWN = new Set\(\['--sample', '--home-sample', '--home-real', '--build-only'\]\)/); assert.match(src, /MODES = new Set\(\['--sample', '--home-sample', '--home-real'\]\)/);
  assert.match(src, /const onRealSetup = !args\.some\(a => a === '--sample' \|\| a === '--home-sample'\);/);
  assert.match(src, /const dataDir = TEMPORARY\.some\(flag => args\.includes\(flag\)\) \? makeTempDataDir\(\) : null;/, 'only the flagged launches get a temporary data folder');
  const root = JSON.parse(read('../../package.json')) as { scripts: Record<string, string> };
  assert.equal(root.scripts.desktop, 'node apps/desktop/tools/run.mjs');
  assert.equal(root.scripts['desktop:sample'], 'node apps/desktop/tools/run.mjs --sample');
  assert.equal(root.scripts['desktop:dev'], 'node apps/desktop/tools/run.mjs --sample');
  assert.deepEqual(Object.keys(root.scripts).filter(name => name.startsWith('desktop:prototype')), [], 'the four prototype scripts are gone');
  const run = (args: string[], env: Record<string, string>): { status: number | null; stdout: string; stderr: string } => {
    const r = spawnSync(process.execPath, [join(DESKTOP, 'tools', 'run.mjs'), ...args], { env: { PATH: process.env.PATH ?? '', ...env }, encoding: 'utf8', timeout: 30000 });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  for (const [first, second] of [['--sample', '--home-sample'], ['--sample', '--home-real'], ['--home-sample', '--home-real']] as const) {
    const r = run([first, second], { HOME: '/tmp' });
    assert.equal(r.status, 2, `${first} ${second}`); assert.match(r.stderr, /not more/); assert.doesNotMatch(r.stdout, /Installing|Building/);
  }
  for (const old of ['--prototype-v2', '--prototype-v3', '--prototype-real', '--prototype-v3-real', '--sample-data', '--real-data']) {
    const r = run([old], { HOME: '/tmp' });
    assert.equal(r.status, 2, old); assert.match(r.stderr, new RegExp(`do not know "${old}"`)); assert.doesNotMatch(r.stdout, /Installing|Building/);
  }
  for (const flags of [[], ['--home-real']]) {
    for (const home of ['', 'relative/home', '/this/folder/does/not/exist']) {
      const r = run([...flags, '--build-only'], { HOME: home });
      assert.equal(r.status, 2, `${flags.join(' ')} HOME=${home}`); assert.match(r.stderr, /needs a home folder/); assert.doesNotMatch(r.stdout, /Installing|Building/, 'nothing is built, nothing is read');
    }
  }
  const mod = await import(`${join(DESKTOP, 'tools', 'run.mjs')}`) as { REAL_FLAG: string; electronArgs(d: string, f: string[], u: string | null): string[] };
  assert.equal(mod.REAL_FLAG, '--home-real');
  assert.deepEqual(mod.electronArgs('/d', ['--sample'], '/tmp/bowerloom-sample-x'), ['/d', '--user-data-dir=/tmp/bowerloom-sample-x', '--sample']);
  assert.deepEqual(mod.electronArgs('/d', [], null), ['/d'], 'the app on the person\'s own folders gets no data folder argument');
});

test('the page mounts the harness-first app on its own addresses, a bare address is the app on the person\'s own folders, and the old viewer bridge is gone', () => {
  const app = strip(read('renderer/app.ts'));
  assert.match(app, /if \(!isHarnessHash\(location\.hash\)\) location\.hash = REAL_BASE;\s*mountHarness\(root\);/);
  assert.equal(existsSync(join(DESKTOP, 'preload', 'preload.ts')), false);
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
