// Security rules, each with a test: window settings, policy, links, navigation, the bridge, and what the main process may do.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { APP_INDEX, CSP, EXTERNAL_HOSTS, allowRequest, decideNavigation, isAllowedExternal, isAllowedRealSender, resolveAppFile, webPreferences } from '../main/security.js';
import { REAL_CALLS, REAL_CHANNELS } from '../shared/real/types.js';
import { ENGINE_ARITY, ENGINE_CALLS, ENGINE_CHANNELS } from '../shared/engine/types.js';
import { DESKTOP } from './support.js';

const read = (path: string): string => readFileSync(join(DESKTOP, path), 'utf8');
const sources = (dir: string): { file: string; text: string }[] => (readdirSync(join(DESKTOP, dir), { recursive: true }) as string[]).filter(f => /\.tsx?$/.test(f) && !f.endsWith('.d.ts')).map(f => ({ file: `${dir}/${f}`, text: read(`${dir}/${f}`) }));
const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('the window has context isolation, no Node, a sandbox, and no webview', () => {
  const p = webPreferences('/x/preload.cjs');
  assert.equal(p.contextIsolation, true); assert.equal(p.nodeIntegration, false); assert.equal(p.sandbox, true);
  assert.equal(p.webSecurity, true); assert.equal(p.allowRunningInsecureContent, false); assert.equal(p.webviewTag, false);
  assert.equal(p.nodeIntegrationInWorker, false); assert.equal(p.nodeIntegrationInSubFrames, false); assert.equal(p.experimentalFeatures, false);
  assert.equal(p.preload, '/x/preload.cjs');
  // The real window is made from those settings and no other.
  const main = read('main/main.ts');
  assert.match(main, /webPreferences: webPreferences\(launch\.preload === 'real' \? join\(root, 'preload-real\.cjs'\) : undefined, app\.isPackaged\)/);
  assert.doesNotMatch(main, /nodeIntegration\s*:\s*true|contextIsolation\s*:\s*false|sandbox\s*:\s*false|webSecurity\s*:\s*false/);
});

test('the content security policy is strict and the page carries exactly that policy', () => {
  assert.doesNotMatch(CSP, /unsafe-inline|unsafe-eval|https?:|\*/);
  assert.match(CSP, /default-src 'none'/); assert.match(CSP, /script-src 'self'(;|$)/); assert.match(CSP, /connect-src 'none'/); assert.match(CSP, /frame-src 'none'/); assert.match(CSP, /base-uri 'none'/);
  const html = read('renderer/index.html'), meta = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html);
  assert.ok(meta, 'the page has a policy'); assert.equal(meta![1], CSP);
  assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/, 'no inline script');
  assert.doesNotMatch(html, /\son[a-z]+\s*=/, 'no inline handler');
  assert.doesNotMatch(html, /(src|href)="https?:/, 'no remote content');
});

test('only an allowlisted https link opens outside the app', () => {
  for (const ok of ['https://github.com/sageadvicellc/bowerloom', 'https://www.npmjs.com/package/x', 'https://npmjs.com/']) assert.equal(isAllowedExternal(ok), true, ok);
  for (const bad of ['http://github.com/x', 'https://example.com/', 'https://github.com.evil.example/', 'https://user:pw@github.com/x', 'https://github.com:8443/x', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi', 'https://github.com/a b', 'https://github.com/\n', '', 'github.com', 42, null, undefined, { href: 'https://github.com' }, `https://github.com/${'a'.repeat(3000)}`]) assert.equal(isAllowedExternal(bad), false, String(bad));
  assert.deepEqual([...EXTERNAL_HOSTS].sort(), ['github.com', 'npmjs.com', 'www.npmjs.com']);
});

test('navigation: only the app page stays; links go outside only when allowlisted; everything else is blocked', () => {
  const index = 'file:///app/dist/renderer/index.html';
  assert.equal(decideNavigation(index, index), 'allow-app'); assert.equal(decideNavigation(`${index}#x`, index), 'allow-app');
  assert.equal(decideNavigation('file:///etc/passwd', index), 'block'); assert.equal(decideNavigation('file:///app/dist/renderer/other.html', index), 'block');
  assert.equal(decideNavigation(`${index}?next=1`, index), 'block');
  assert.equal(decideNavigation('https://example.com', index), 'block'); assert.equal(decideNavigation('https://github.com/x', index), 'open-external');
  assert.equal(decideNavigation('not a url', index), 'block');
  const main = read('main/main.ts');
  for (const hook of ["'will-navigate'", "'will-redirect'", 'setWindowOpenHandler', "'will-attach-webview'", 'setPermissionRequestHandler', 'onBeforeRequest']) assert.ok(main.includes(hook), hook);
  assert.match(main, /action: 'deny'/);
  // The page opens no outside link of its own: a navigation that is not to the app page is refused, even to an allowlisted host.
  assert.match(strip(main), /contents\.on\('will-navigate', \(event, url\) => \{\s*if \(decideNavigation\(url, indexUrl\) !== 'allow-app'\) event\.preventDefault\(\);\s*\}\);/);
  assert.match(strip(main), /contents\.setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\);/);
});

test('no request leaves the machine: the session lets through only files under the app\'s own dist folder', () => {
  const dist = '/app/dist';
  for (const url of ['file:///app/dist/renderer/app.js', 'file:///app/dist/renderer/index.html#x', 'file:///app/dist']) assert.equal(allowRequest(url, dist), true, url);
  for (const url of ['file:///app/dist-evil/app.js', 'file:///app/distant/x', 'file:///etc/passwd', 'file:///app/dist/../secret', 'file:///app/dist/%2e%2e/secret', 'file://server/app/dist/x', 'https://example.com/a.js', 'http://localhost:3000/', 'ws://localhost/', 'ftp://x/', 'data:text/html,x', 'not a url']) assert.equal(allowRequest(url, dist), false, url);
  assert.match(read('main/main.ts'), /allowRequest\(details\.url, root\)/);
});

test('the packaged window turns the developer tools off, and every frame navigation and device permission is refused', () => {
  assert.equal(webPreferences('/p', true).devTools, false); assert.equal(webPreferences('/p', false).devTools, true); assert.equal(webPreferences('/p').devTools, true);
  const main = read('main/main.ts');
  assert.match(main, /webPreferences\(launch\.preload === 'real' \? join\(root, 'preload-real\.cjs'\) : undefined, app\.isPackaged\)/); assert.match(main, /'will-frame-navigate'/); assert.match(main, /setDevicePermissionHandler\(\(\) => false\)/);
  assert.match(main, /setPermissionRequestHandler\(\(_contents, _permission, callback\) => callback\(false\)\)/); assert.match(main, /setPermissionCheckHandler\(\(\) => false\)/);
});

test('the bridge: one named call per channel, nothing generic, two objects and no more, and the viewer\'s bridge is gone', () => {
  assert.equal(existsSync(join(DESKTOP, 'preload', 'preload.ts')), false, 'the viewer bridge is removed');
  assert.deepEqual(readdirSync(join(DESKTOP, 'preload')).sort(), ['real-preload.ts']);
  const preload = strip(read('preload/real-preload.ts')).replace(/^import .*$/gm, '');
  for (const n of REAL_CALLS) assert.match(preload, new RegExp(`${n}: .*ipcRenderer\\.invoke\\(REAL_CHANNELS\\.${n}`), `preload exposes ${n}`);
  assert.match(preload, /for \(const call of ENGINE_CALLS\) engine\[call\] = \(\.\.\.args: unknown\[\]\) => ipcRenderer\.invoke\(ENGINE_CHANNELS\[call\], \.\.\.args\)/);
  assert.equal([...preload.matchAll(/ipcRenderer\.(\w+)/g)].every(m => m[1] === 'invoke'), true, 'only invoke');
  assert.doesNotMatch(preload, /ipcRenderer\s*[,}]|exposeInMainWorld\('[^']+',\s*ipcRenderer|require\(|process\./);
  assert.deepEqual([...preload.matchAll(/exposeInMainWorld\('(\w+)'/g)].map(m => m[1]), ['bowerloomReal', 'bowerloomEngine'], 'two bridges, one for each reader');
  // Every channel main answers is one of these two lists. Main answers none itself: the handlers of the two files check the sender before they run.
  const main = strip(read('main/main.ts'));
  assert.equal([...main.matchAll(/ipcMain\.\w+/g)].length, 0, 'main.ts answers no channel itself');
  for (const file of ['main/real-ipc.ts', 'main/engine-ipc.ts']) {
    const code = strip(read(file));
    assert.equal([...code.matchAll(/ipc\.handle\(/g)].length, 1, `${file}: one place registers handlers`);
    assert.match(code, /senderFrame/); assert.match(code, /isAllowedRealSender\(true, /);
    assert.ok(code.indexOf('isAllowedRealSender(') < code.indexOf('args.length'), `${file}: the sender check comes before the argument check and the handler`);
  }
  assert.deepEqual(Object.keys(REAL_CHANNELS).sort(), [...REAL_CALLS].sort());
  assert.deepEqual([...ENGINE_CALLS].sort(), Object.keys(ENGINE_CHANNELS).sort());
  assert.deepEqual(Object.keys(ENGINE_ARITY).sort(), [...ENGINE_CALLS].sort());
  assert.deepEqual([...Object.values(REAL_CHANNELS), ...Object.values(ENGINE_CHANNELS)].filter(c => c.startsWith('viewer:')), [], 'none of the viewer\'s channels is left');
});

test('the main process calls no command that writes Bowerloom data outside the engine service and starts no process or server', () => {
  const forbidden = /\b(applyFolder\w+|applyConfigChange|applyLockUpdate|applySync|applyProjectApply|applyCachePrune|applyStoreMigrate|applyMigrate|applyItemRecovery|applyReceiptClean|runApplyCommand|runUseCommand|runLockCommand|runCacheCommand|runStoreCommand|runFolderCommand|runUpCommand|runSyncCommand|runCreateCommand|runAdoptCommand|withStoreForWrite|withProjectLock|withCacheLock)\b/;
  for (const { file, text } of [...sources('main'), ...sources('shared'), ...sources('preload')]) {
    const code = strip(text);
    assert.doesNotMatch(code, forbidden, `${file} calls a write command`);
    assert.doesNotMatch(code, /child_process|worker_threads|node:net|node:http|node:https|(?<![.\w])(spawn|exec|fork)\(|createServer|\.listen\(/, `${file} starts a process or a server`);
  }
});

test('the files the app\'s own source can write are held by tests/writers.test.ts, and the old viewer writers are gone', () => {
  for (const gone of ['main/config.ts', 'main/sample.ts', 'main/sketches.ts', 'main/boundary.ts', 'main/controller.ts', 'main/reader.ts']) assert.equal(existsSync(join(DESKTOP, gone)), false, gone);
  assert.equal(existsSync(join(DESKTOP, 'tests', 'writers.test.ts')), true);
});

test('the page never builds markup from text: no innerHTML, no eval, no document.write', () => {
  for (const { file, text } of [...sources('renderer'), ...sources('shared')]) assert.doesNotMatch(strip(text), /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(|setAttribute\(\s*['"]on|srcdoc|dangerouslySetInnerHTML/, file);
});

test('process.env is read in exactly one place of main (the state folder and preview switch of the install sheets), and the token module of the viewer is gone', () => {
  const users = sources('main').filter(({ text }) => /process\.env/.test(strip(text))).map(f => f.file).sort();
  assert.deepEqual(users, ['main/engine-state.ts']);
  // The install sheets read two variables and nothing else of the environment: XDG_STATE_HOME, and BOWERLOOM_PREVIEW_ENGINES (beta.1: only the exact value 1 turns preview engines on; only a yes or no leaves the file). The usage log and the problem report read two more, PATH (to find the engines' version commands) and BOWERLOOM_EVENT_LOG (the off switch), and pass on nothing else.
  assert.deepEqual([...strip(read('main/engine-state.ts')).matchAll(/process\.env(\.\w+)?/g)].map(m => m[0]), ['process.env.XDG_STATE_HOME', 'process.env.BOWERLOOM_PREVIEW_ENGINES', 'process.env.PATH', 'process.env.BOWERLOOM_EVENT_LOG']);
  assert.equal(existsSync(join(DESKTOP, 'main', 'token.ts')), false, 'the viewer read the GitHub token state; the app does not');
});

test('the page is served by the app itself, and only files below its renderer folder can be asked for', () => {
  assert.equal(APP_INDEX, 'app://viewer/index.html'); assert.equal(decideNavigation(APP_INDEX, APP_INDEX), 'allow-app'); assert.equal(decideNavigation('app://viewer/other.html', APP_INDEX), 'block'); assert.equal(decideNavigation('app://evil/index.html', APP_INDEX), 'block');
  assert.equal(allowRequest('app://viewer/app.js', '/x'), true); assert.equal(allowRequest('app://evil/app.js', '/x'), false);
  const dir = '/app/dist/renderer';
  assert.equal(resolveAppFile(dir, '/index.html'), '/app/dist/renderer/index.html'); assert.equal(resolveAppFile(dir, '/a%20b.css'), '/app/dist/renderer/a b.css'); assert.equal(resolveAppFile(dir, '/'), dir);
  for (const bad of ['/../main.mjs', '/%2e%2e/main.mjs', '/..%2fmain.mjs', '/a/../../main.mjs', '/%00', '/..\\main.mjs', '/%E0%A4%A']) assert.equal(resolveAppFile(dir, bad), null, bad);
  assert.equal(resolveAppFile('/app/dist/renderer', '/../renderer-evil/x'), null);
  const main = read('main/main.ts'); assert.match(main, /protocol\.handle\(APP_SCHEME/); assert.match(main, /registerSchemesAsPrivileged/); assert.match(main, /loadURL\(`\$\{indexUrl\}\$\{launch\.hash\}`\)/);
});

test('React is in the window only: the main process, the bridge, and the shared code are free of it, and no markup is built from text', () => {
  for (const { file, text } of [...sources('main'), ...sources('preload'), ...sources('shared')]) assert.doesNotMatch(strip(text), /from ['"](react|react-dom)/, file);
  for (const { file, text } of sources('renderer')) assert.doesNotMatch(strip(text), /dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(/, file);
  const html = read('renderer/index.html'); assert.match(html, /href="app\.css"/); assert.doesNotMatch(html, /graph\.css/); assert.doesNotMatch(html, /<style/);
});

test('the bundle adds no inline style element and no eval, and no graph library is left in the app', () => {
  const bundle = readFileSync(join(DESKTOP, 'dist', 'renderer', 'app.js'), 'utf8');
  assert.doesNotMatch(bundle, /createElement\(["']style["']\)/, 'no code that makes a style element');
  assert.doesNotMatch(bundle, /\beval\(|new Function\(/);
  assert.doesNotMatch(bundle, /force-graph|float-tooltip/, 'the knowledge graph of the viewer is gone');
  const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
  assert.deepEqual(Object.keys(pkg.dependencies).filter(name => /force-graph|xyflow/.test(name)), []);
  assert.doesNotMatch(read('tools/bundle.mjs'), /force-graph|noInlineStyle/);
});

// ---- The launches. The plan of each is held in tests/launch.test.ts; here the properties that make them safe.

test('a made-up launch gets no bridge, no calls, no outside link and a temporary data folder; the others get the one bridge', () => {
  const main = strip(read('main/main.ts'));
  assert.match(main, /const launch = launchOf\(argv\);/);
  assert.match(main, /if \(launch\.temporaryData\) \{\s*const choice = chooseUserData\(userDataArg\(argv\), tmpdir\(\)\)/);
  assert.match(main, /webPreferences\(launch\.preload === 'real' \? join\(root, 'preload-real\.cjs'\) : undefined, app\.isPackaged\)/);
  assert.match(main, /if \(launch\.realReader\) \{[\s\S]*?registerRealIpc\(/);
  assert.match(main, /if \(launch\.engineCalls\) \{\s*const engine = registerEngineIpc\(/);
  assert.doesNotMatch(main, /prototype/i, 'no prototype mode is left');
  assert.doesNotMatch(main, /openLink/, 'the window can ask for no outside link');
});

test('every address of the app is the app\'s own page: navigation inside it is allowed, and nothing else leaves', () => {
  for (const hash of ['#sample/choose', '#sample', '#app', '#app/choose', '#sample/builder/harness-weekly-report-crew/list']) assert.equal(decideNavigation(`${APP_INDEX}${hash}`, APP_INDEX), 'allow-app', hash);
  assert.equal(decideNavigation('https://example.com/#app', APP_INDEX), 'block');
  assert.doesNotMatch(strip(read('preload/real-preload.ts')), /prototype/i);
});

test('the kit and shell code that the app keeps in the home folders never reaches the bridge, a file, the network, storage or markup from text', () => {
  const files = [...sources('renderer/home'), ...sources('shared/home')];
  assert.ok(files.length >= 10, `${files.length} files`);
  const banned: [string, RegExp][] = [['window.bowerloom', /window\.bowerloom\b|\bbowerloom\./], ['node:', /node:/], ['fetch', /\bfetch\(|XMLHttpRequest|WebSocket/], ['localStorage', /localStorage|sessionStorage|indexedDB|document\.cookie/], ['innerHTML', /innerHTML|outerHTML|insertAdjacentHTML|dangerouslySetInnerHTML/], ['eval', /\beval\(|new Function\(/], ['Date', /\bDate\b/], ['Math.random', /Math\.random/]];
  for (const { file, text } of files) { const code = strip(text); for (const [name, pattern] of banned) assert.doesNotMatch(code, pattern, `${file} uses ${name}`); }
});

test('only main/engine-service.ts calls the packages\' writes of adoption and the projection, each with a revision the person approved; no window or shared code names them', () => {
  const writes = /\b(applyAdoption|applyAdoptionRecovery|applyPortable|applyPortableRemoval|applyPortableRecovery)\b/;
  const callers = sources('main').filter(({ text }) => writes.test(strip(text))).map(f => f.file);
  assert.deepEqual(callers, ['main/engine-service.ts']);
  for (const { file, text } of [...sources('renderer'), ...sources('shared'), ...sources('preload')]) assert.doesNotMatch(strip(text), writes, file);
  // How each write is held (the plan shown last, the same choices, main's own question, a "no" writes nothing) is tested by behaviour, on real folders:
  // tests/engine-consent.test.ts and tests/engine-consent2.test.ts. Here only the module boundary is held: one file calls the writes, and it writes no file itself.
  const service = strip(read('main/engine-service.ts'));
  assert.doesNotMatch(service, /\b(writeFileSync|writeFile|mkdirSync|rmSync|unlinkSync|renameSync)\b/, 'the service itself writes no file');
  // The engine calls are registered for the app on the person's own folders only, never for the sample.
  assert.match(strip(read('main/main.ts')), /if \(launch\.engineCalls\) \{\s*const engine = registerEngineIpc\(/);
  // Main's private copies of tidy-up reports go when the app quits.
  assert.match(strip(read('main/main.ts')), /app\.once\('quit', \(\) => engine\.clearReportCopies\(\)\)/);
});

test('the guard of each reader checks the sender before it runs the handler', () => {
  assert.equal(isAllowedRealSender(true, APP_INDEX, APP_INDEX), true);
  assert.equal(isAllowedRealSender(true, `${APP_INDEX}#app`, APP_INDEX), true);
  assert.equal(isAllowedRealSender(true, null, APP_INDEX), false);
  assert.equal(isAllowedRealSender(true, 'https://example.com/', APP_INDEX), false);
  assert.equal(isAllowedRealSender(true, 'file:///etc/passwd', APP_INDEX), false);
  assert.equal(isAllowedRealSender(false, APP_INDEX, APP_INDEX), false);
});
