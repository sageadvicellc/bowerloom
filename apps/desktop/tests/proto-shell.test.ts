// The prototype shell: the six routes and their stubs, the launch flag, the guard that refuses every IPC channel, and the plain words of the screens.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CHANNELS } from '../shared/channels.js';
import { APP_INDEX, decideNavigation, isAllowedSender } from '../main/security.js';
import { App, ROUTES } from '../renderer/proto/App.js';
import { loadWorld } from '../renderer/proto/world.js';
import { countLine } from '../renderer/proto/words.js';
import { createEmptyWorld } from '../renderer/proto/fakeApi.js';
import { generateWorld } from '../shared/proto/sample.js';
import type { World } from '../shared/proto/types.js';
import { DESKTOP, tempDir } from './support.js';
import { agent, makeWorld, skill } from './proto-testworld.js';

// The same idea as in viewmodel.test.ts: no screen word may tell a person to type a command.
const COMMAND = /\bbowerloom (ls|status|use|unuse|lock|apply|skills|skill|prompt|team|store|folder|slice|context|cache|up|help)\b|\bnpm (run|install)\b|\bgit (push|init|add|commit|remote)\b|\bcd \S|\bchmod\b|--[a-z]{3,}|terminal|command line|\$ /i;
const BANNED_WORD = /\bhelpers?\b|\bteams?\b/i;
const ids = ['setup', 'harness', 'skills', 'agents', 'knowledge', 'versions'] as const;
const read = (file: string): string => readFileSync(join(DESKTOP, file), 'utf8');
const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const textOf = (markup: string): string => markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
function filesUnder(dir: string): string[] {
  return readdirSync(join(DESKTOP, dir), { recursive: true, withFileTypes: true }).filter(e => e.isFile() && /\.tsx?$/.test(e.name)).map(e => join((e as unknown as { parentPath: string }).parentPath, e.name));
}

function bigger(): World {
  const w = makeWorld();
  return { ...w, items: [...w.items, skill('s7', 'Another'), agent('a7', 'Third')], versions: [{ id: 'v1', parentId: null, counter: 1, label: 'one', snapshotJson: '{}' }] };
}

test('the route table has six routes, each with a screen file of its own', () => {
  assert.deepEqual(ROUTES.map(r => r.id), [...ids]);
  for (const route of ROUTES) assert.equal(typeof route.Screen, 'function', route.id);
  for (const name of ['Setup', 'Harness', 'Skills', 'Agents', 'Knowledge', 'Versions']) assert.equal(existsSync(join(DESKTOP, 'renderer', 'proto', `${name}Screen.tsx`)), true, name);
  assert.equal(existsSync(join(DESKTOP, 'renderer', 'proto', 'App.tsx')), true); assert.equal(existsSync(join(DESKTOP, 'renderer', 'proto', 'world.ts')), true);
});

test('each screen has a title heading, and each stub also shows the number of items of its kind and nothing else', () => {
  const w = bigger();
  const expected: Record<string, string> = { setup: '3 interfaces', harness: `${w.items.length} items`, skills: '5 skills', agents: '3 agents', knowledge: '6 pages', versions: '1 version' };
  for (const route of ROUTES) {
    const markup = renderToStaticMarkup(createElement(route.Screen, { world: w }));
    assert.match(markup, new RegExp(`<h1[^>]*>${route.label}</h1>`), route.id);
    // A screen that a later slice has replaced no longer calls countLine, and is not held to the stub rule.
    const stub = /countLine\(/.test(readFileSync(join(DESKTOP, 'renderer', 'proto', `${route.label}Screen.tsx`), 'utf8'));
    if (stub) assert.equal(textOf(markup), `${route.label} ${expected[route.id]}`, 'the title and the count, nothing more');
  }
});

test('an empty world says none, with the right plural', () => {
  const lines = ids.map(id => countLine(id, createEmptyWorld()));
  assert.deepEqual(lines, ['3 interfaces', '0 items', '0 skills', '0 agents', '0 pages', '0 versions']);
  assert.equal(countLine('versions', bigger()), '1 version');
});

test('the shell uses the existing shell markup: a sidebar with a main navigation, a main area, and a footer', () => {
  const markup = renderToStaticMarkup(createElement(App));
  assert.match(markup, /class="shell"/); assert.match(markup, /<aside class="sidebar"/); assert.match(markup, /class="brand"/); assert.match(markup, /<nav class="nav" aria-label="Main"/);
  assert.match(markup, /<main id="main"/); assert.match(markup, /class="footer"/);
  const navMarkup = /<nav[\s\S]*?<\/nav>/.exec(markup)![0], buttons = [...navMarkup.matchAll(/<button[^>]*>/g)].map(m => m[0]);
  assert.equal(buttons.length, 6, 'one button per route'); assert.equal(buttons.filter(b => b.includes('aria-current="page"')).length, 1);
  assert.match(markup, /<button[^>]*aria-current="page"[^>]*>[\s\S]*?Setup/, 'the first route is the one showing');
  assert.doesNotMatch(markup, /<script|onclick|style=/i);
  for (const route of ROUTES) assert.ok(textOf(markup).includes(route.label), route.label);
});

test('the screen words are plain: the right nouns, no helper, no team, no command line', () => {
  const worlds = [createEmptyWorld(), bigger()];
  const words: string[] = [];
  for (const w of worlds) {
    for (const route of ROUTES) { words.push(route.label, textOf(renderToStaticMarkup(createElement(route.Screen, { world: w })))); words.push(countLine(route.id, w)); }
    words.push(textOf(renderToStaticMarkup(createElement(App))));
  }
  assert.ok(words.length > 20);
  for (const word of words) { assert.doesNotMatch(word, COMMAND, word); assert.doesNotMatch(word, BANNED_WORD, word); }
  assert.deepEqual(ROUTES.map(r => r.label), ['Setup', 'Harness', 'Skills', 'Agents', 'Knowledge', 'Versions']);
  // The source of the screens has no such words either (comments aside).
  for (const file of filesUnder('renderer/proto').filter(f => /\.tsx$/.test(f) || f.endsWith('words.ts'))) {
    const code = strip(readFileSync(file, 'utf8'));
    assert.doesNotMatch(code, BANNED_WORD, file); assert.doesNotMatch(code, /terminal|command line|npm run/i, file);
  }
});

test('loadWorld is the one place the world comes from: the seeded sample world, a fresh object every call', () => {
  const a = loadWorld(), b = loadWorld();
  assert.deepEqual(a, generateWorld(1)); assert.deepEqual(a, b); assert.notEqual(a, b); assert.notEqual(a.items, b.items); assert.equal(a.wikiPages.length, 700);
  const source = strip(read('renderer/proto/world.ts'));
  assert.match(source, /export function loadWorld\(\)/);
  for (const file of filesUnder('renderer/proto').filter(f => /Screen\.tsx$|App\.tsx$/.test(f))) assert.doesNotMatch(strip(readFileSync(file, 'utf8')), /createEmptyWorld/, `${file} gets its world from loadWorld`);
});

test('the prototype and shared prototype source never reach the window bridge, a file, markup from text, a random number or a clock', () => {
  const files = [...filesUnder('renderer/proto'), ...filesUnder('shared/proto')];
  assert.ok(files.length >= 12, `${files.length} files`);
  const banned: [string, RegExp][] = [['window.bowerloom', /window\.bowerloom|\bbowerloom\./], ['node:fs', /node:fs|from ['"]fs['"]/], ['innerHTML', /innerHTML|outerHTML|insertAdjacentHTML|dangerouslySetInnerHTML/], ['Math.random', /Math\.random/], ['Date', /\bDate\b/], ['performance.now', /performance\.now/]];
  for (const file of files) {
    const code = strip(readFileSync(file, 'utf8'));
    for (const [name, pattern] of banned) assert.doesNotMatch(code, pattern, `${file} uses ${name}`);
  }
});

test('main.ts: the --prototype flag loads the same app address with #prototype, and the plain load line is unchanged', () => {
  const main = strip(read('main/main.ts'));
  assert.match(main, /argv\.includes\('--prototype'\)/); assert.match(main, /loadURL\(indexUrl\)/); assert.match(main, /loadURL\(`\$\{indexUrl\}#prototype`\)/);
  assert.equal(decideNavigation(`${APP_INDEX}#prototype`, APP_INDEX), 'allow-app', 'the app address with the hash is still the app\'s own page');
  assert.equal([...main.matchAll(/ipcMain\.handle/g)].length, 1, 'still one guard');
  assert.match(main, /isAllowedSender\(/);
  // The guard asks first and only then runs the handler.
  const guard = main.slice(main.indexOf('const guarded'), main.indexOf("guarded('getInfo'"));
  assert.ok(guard.indexOf('isAllowedSender(') > -1 && guard.indexOf('isAllowedSender(') < guard.indexOf('handler(...'), 'the sender check comes before the handler');
  assert.match(guard, /prototypeMode/);
});

test('in prototype mode every IPC channel is refused, for every sender; outside it only the app\'s own page is let in', () => {
  for (const name of Object.keys(CHANNELS)) {
    assert.equal(isAllowedSender(true, APP_INDEX, APP_INDEX), false, `${name}: the app page itself`);
    assert.equal(isAllowedSender(true, `${APP_INDEX}#prototype`, APP_INDEX), false, `${name}: the app page with the hash`);
    assert.equal(isAllowedSender(true, null, APP_INDEX), false, `${name}: no frame`);
    assert.equal(isAllowedSender(true, 'https://github.com/x', APP_INDEX), false, `${name}: elsewhere`);
  }
  assert.equal(isAllowedSender(false, APP_INDEX, APP_INDEX), true); assert.equal(isAllowedSender(false, `${APP_INDEX}#x`, APP_INDEX), true);
  assert.equal(isAllowedSender(false, null, APP_INDEX), false); assert.equal(isAllowedSender(false, 'https://example.com/', APP_INDEX), false); assert.equal(isAllowedSender(false, 'file:///etc/passwd', APP_INDEX), false);
});

test('the preload surface is unchanged: it still exposes exactly the channels, so the smoke spec\'s name list stays valid', () => {
  const preload = strip(read('preload/preload.ts'));
  assert.equal([...preload.matchAll(/exposeInMainWorld/g)].length, 1);
  assert.doesNotMatch(preload, /prototype/i);
  const smoke = read('e2e/smoke.spec.ts');
  for (const name of Object.keys(CHANNELS)) assert.ok(smoke.includes(`'${name}'`), `the smoke spec lists ${name}`);
});

test('app.ts mounts the prototype only for the #prototype hash and leaves the normal boot path as it was', () => {
  const app = strip(read('renderer/app.ts'));
  assert.match(app, /location\.hash === '#prototype'/); assert.match(app, /from '\.\/proto\/mount\.js'/);
  assert.match(app, /void reload\(\);/);
  const branch = app.slice(app.indexOf("location.hash === '#prototype'"));
  assert.ok(branch.indexOf('mountPrototype(') > -1 && branch.indexOf('mountPrototype(') < branch.indexOf('void reload()'), 'the prototype is chosen before the normal boot');
  assert.match(branch, /else/);
});

test('the launcher: --prototype is a known flag, a mode that excludes the other modes, and is passed on', () => {
  const src = strip(read('tools/run.mjs'));
  assert.match(src, /KNOWN = new Set\(\[[^\]]*'--prototype'/); assert.match(src, /MODES = new Set\(\[[^\]]*'--prototype'/); assert.match(src, /args\.includes\('--prototype'\)/); assert.match(src, /mkdtempSync\(/);
  for (const other of ['--sample-data', '--real-data', '--sandbox']) {
    const r = spawnSync(process.execPath, [join(DESKTOP, 'tools', 'run.mjs'), '--prototype', other], { cwd: tmpdir(), encoding: 'utf8', timeout: 30000 });
    assert.equal(r.status, 2, other); assert.match(r.stderr, /not more/); assert.doesNotMatch(r.stdout, /Installing|Building/);
  }
});

test('the launcher gives the prototype a fresh temporary data folder, and removes only such a folder', async t => {
  const { electronArgs, makePrototypeDataDir, removePrototypeDataDir } = await import(`${join(DESKTOP, 'tools', 'run.mjs')}`) as {
    electronArgs(desktop: string, flags: string[], userDataDir: string | null): string[]; makePrototypeDataDir(tmp: string): string; removePrototypeDataDir(dir: string, tmp: string): boolean;
  };
  assert.deepEqual(electronArgs('/d', ['--prototype'], '/tmp/x'), ['/d', '--user-data-dir=/tmp/x', '--prototype']);
  assert.deepEqual(electronArgs('/d', ['--sample-data'], null), ['/d', '--sample-data']);
  const tmp = tempDir(t), a = makePrototypeDataDir(tmp), b = makePrototypeDataDir(tmp);
  assert.notEqual(a, b); assert.equal(a.startsWith(tmp), true); assert.match(a, /bowerloom-prototype-/); assert.equal(lstatSync(a).isDirectory(), true);
  writeFileSync(join(a, 'cache'), 'x');
  assert.equal(removePrototypeDataDir(a, tmp), true); assert.equal(existsSync(a), false); assert.equal(existsSync(b), true);
  // Anything else is left alone: a folder with another name, a folder outside the temp folder, a link that points somewhere else, a missing folder.
  const other = join(tmp, 'keep-me'); mkdirSync(other); assert.equal(removePrototypeDataDir(other, tmp), false); assert.equal(existsSync(other), true);
  const elsewhere = tempDir(t); const decoy = join(elsewhere, 'bowerloom-prototype-decoy'); mkdirSync(decoy); assert.equal(removePrototypeDataDir(decoy, tmp), false); assert.equal(existsSync(decoy), true);
  const target = tempDir(t); writeFileSync(join(target, 'precious'), 'x'); const link = join(tmp, 'bowerloom-prototype-link'); symlinkSync(target, link);
  assert.equal(removePrototypeDataDir(link, tmp), false); assert.equal(existsSync(join(target, 'precious')), true);
  assert.equal(removePrototypeDataDir(join(tmp, 'bowerloom-prototype-gone'), tmp), false);
});

test('the root package has the desktop:prototype command', () => {
  const root = JSON.parse(readFileSync(join(DESKTOP, '..', '..', 'package.json'), 'utf8')) as { scripts: Record<string, string> };
  assert.equal(root.scripts['desktop:prototype'], 'node apps/desktop/tools/run.mjs --prototype');
});

test('the README has a short Prototype section that says nothing is written', () => {
  const readme = read('README.md'), at = readme.indexOf('## Prototype');
  assert.ok(at > -1); const section = readme.slice(at, readme.indexOf('\n## ', at + 5) === -1 ? undefined : readme.indexOf('\n## ', at + 5));
  assert.match(section, /desktop:prototype/); assert.match(section, /simulated in memory/); assert.match(section, /nothing is written/i);
  assert.ok(section.split(/\s+/).length < 140, 'short');
});
