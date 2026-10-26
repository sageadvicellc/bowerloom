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
  assert.match(main, /const prototypeMode = argv\.includes\('--prototype'\) \|\| prototypeV2 \|\| prototypeReal \|\| prototypeV3;/);
  assert.match(main, /else if \(prototypeV3\) window\.loadURL\(`\$\{indexUrl\}#prototype-v3`\)\.catch\(startupFailed\);/);
  assert.match(main, /windowOptions\(prototypeV2 \|\| prototypeReal \|\| prototypeV3\)/);
  assert.doesNotMatch(main, /prototypeV3\s*\?[^\n]*preload/);
  assert.equal([...main.matchAll(/preload\.cjs/g)].length, 1, 'the one normal bridge is named once, and no prototype names its own');
  assert.equal(decideNavigation(`${APP_INDEX}#prototype-v3/builder/harness-weekly-report-crew/graph`, APP_INDEX), 'allow-app');
  assert.equal(decideNavigation('https://example.com/#prototype-v3', APP_INDEX), 'block');
});

test('the launcher and the root script know --prototype-v3, keep one mode at a time, and give it a fresh temporary data folder', () => {
  const src = strip(read('tools/run.mjs'));
  assert.match(src, /KNOWN = new Set\(\[[^\]]*'--prototype-v3'/); assert.match(src, /MODES = new Set\(\[[^\]]*'--prototype-v3'/); assert.match(src, /PROTOTYPES = \[[^\]]*'--prototype-v3'/);
  const root = JSON.parse(read('../../package.json')) as { scripts: Record<string, string> };
  assert.equal(root.scripts['desktop:prototype:v3'], 'node apps/desktop/tools/run.mjs --prototype-v3');
  assert.equal(root.scripts['desktop:prototype:v2'], 'node apps/desktop/tools/run.mjs --prototype-v2');
  for (const other of ['--sample-data', '--real-data', '--sandbox', '--prototype', '--prototype-v2', '--prototype-real']) {
    const r = spawnSync(process.execPath, [join(DESKTOP, 'tools', 'run.mjs'), '--prototype-v3', other], { env: { PATH: process.env.PATH ?? '', HOME: '/tmp' }, encoding: 'utf8', timeout: 30000 });
    assert.equal(r.status, 2, other); assert.match(r.stderr, /not more/); assert.doesNotMatch(r.stdout, /Installing|Building/);
  }
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
  for (const { file, text } of files) {
    const code = strip(text);
    for (const [name, pattern] of banned) assert.doesNotMatch(code, pattern, `${file} uses ${name}`);
    if (!file.endsWith('renderer/harness/clock.ts')) assert.doesNotMatch(code, /\bDate\b/, `${file} reads the clock`);
  }
  for (const { file, text } of sources('shared/harness')) assert.doesNotMatch(strip(text), /from ['"](react|react-dom)/, file);
  assert.match(strip(read('renderer/harness/clock.ts')), /new Date\(\)/);
});

test('the store imports nothing that could write: no file system, no network, no timer of its own but the default one', () => {
  const store = strip(read('shared/harness/store.ts'));
  assert.doesNotMatch(store, /from ['"]node:|require\(/);
  assert.equal([...store.matchAll(/setTimeout\(/g)].length, 1, 'one default timer, replaceable by the caller');
});
